package classifier

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

// ClassifyRequest is sent to the Python classifier service.
type ClassifyRequest struct {
	Prompt          string `json:"prompt"`
	MaxTokens       int    `json:"max_tokens"`
	HasSystemPrompt bool   `json:"has_system_prompt"`
}

// ClassifyResponse is returned by the Python classifier service.
type ClassifyResponse struct {
	Complexity string  `json:"complexity"` // "simple", "medium", "complex"
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
	Toxicity   float64 `json:"toxicity"`
}

// Client talks to the Python classifier microservice.
type Client struct {
	baseURL        string
	httpClient     *http.Client
	internalSecret string
}

// NewClient creates a classifier client.
// timeoutSeconds of 0 defaults to 3 seconds.
func NewClient(baseURL string, timeoutSeconds ...int) *Client {
	timeout := 3 * time.Second
	if len(timeoutSeconds) > 0 && timeoutSeconds[0] > 0 {
		timeout = time.Duration(timeoutSeconds[0]) * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: timeout,
		},
		internalSecret: os.Getenv("INTERNAL_SECRET"),
	}
}

// Heuristic rules for local Go classification
var complexKeywords = []string{
	`\banalyze\b`, `\banalysis\b`, `\breview\b`, `\baudit\b`,
	`\bcompare\b`, `\bcontrast\b`, `\bevaluate\b`, `\bcritique\b`,
	`\brefactor\b`, `\barchitect\b`, `\bdesign\b`, `\bimplement\b`,
	`\bdebug\b`, `\boptimize\b`, `\bexplain in detail\b`,
	`\blegal\b`, `\bcontract\b`, `\bcompliance\b`, `\bregulat\b`,
	`\bstrateg\b`, `\bframework\b`, `\bmulti-step\b`,
	`\bwrite a full\b`, `\bbuild a\b`, `\bcreate a complete\b`,
}

var mediumKeywords = []string{
	`\bsummarize\b`, `\bsummary\b`, `\brewrite\b`, `\btranslate\b`,
	`\bconvert\b`, `\bgenerate\b`, `\blist\b`, `\boutline\b`,
	`\bdescribe\b`, `\bexplain\b`, `\bwrite\b`, `\bdraft\b`,
	`\bformat\b`, `\bextract\b`, `\bclassify\b`,
}

var (
	complexRegexes []*regexp.Regexp
	mediumRegexes  []*regexp.Regexp
)

func init() {
	for _, kw := range complexKeywords {
		complexRegexes = append(complexRegexes, regexp.MustCompile(kw))
	}
	for _, kw := range mediumKeywords {
		mediumRegexes = append(mediumRegexes, regexp.MustCompile(kw))
	}
}

// classifyLocal computes complexity locally in 0ms using heuristics.
func classifyLocal(prompt string, maxTokens int, hasSystemPrompt bool) *ClassifyResponse {
	promptLower := strings.ToLower(prompt)
	promptLen := len(prompt)
	var reasons []string
	score := 0

	// Length heuristic
	if promptLen > 2000 {
		score += 3
		reasons = append(reasons, "long_prompt")
	} else if promptLen > 500 {
		score += 1
		reasons = append(reasons, "medium_prompt")
	} else if promptLen < 100 {
		score -= 2
		reasons = append(reasons, "short_prompt")
	}

	// max_tokens heuristic
	if maxTokens > 2000 {
		score += 2
		reasons = append(reasons, "high_max_tokens")
	} else if maxTokens > 500 {
		score += 1
		reasons = append(reasons, "medium_max_tokens")
	}

	// System prompt
	if hasSystemPrompt {
		score += 1
		reasons = append(reasons, "has_system_prompt")
	}

	// Keyword matching
	complexHits := 0
	for _, re := range complexRegexes {
		if re.MatchString(promptLower) {
			complexHits++
		}
	}
	mediumHits := 0
	for _, re := range mediumRegexes {
		if re.MatchString(promptLower) {
			mediumHits++
		}
	}

	if complexHits >= 2 {
		score += 3
		reasons = append(reasons, fmt.Sprintf("complex_keywords(%d)", complexHits))
	} else if complexHits == 1 {
		score += 1
		reasons = append(reasons, fmt.Sprintf("complex_keyword(%d)", complexHits))
	}

	if mediumHits >= 2 {
		score += 1
		reasons = append(reasons, fmt.Sprintf("medium_keywords(%d)", mediumHits))
	}

	// Code detection
	codeIndicators := []string{"```", "def ", "function ", "class ", "import ", "SELECT ", "CREATE TABLE"}
	codeHits := 0
	for _, ind := range codeIndicators {
		if strings.Contains(prompt, ind) {
			codeHits++
		}
	}
	if codeHits >= 2 {
		score += 2
		reasons = append(reasons, "contains_code")
	}

	// Simple Q&A
	if strings.HasSuffix(strings.TrimSpace(prompt), "?") && promptLen < 200 {
		score -= 1
		reasons = append(reasons, "simple_question")
	}

	// Final classification
	var complexity string
	var confidence float64
	if score >= 4 {
		complexity = "complex"
		confidence = 0.6 + float64(score)*0.05
		if confidence > 0.95 {
			confidence = 0.95
		}
	} else if score >= 1 {
		complexity = "medium"
		confidence = 0.5 + float64(score)*0.1
		if confidence > 0.90 {
			confidence = 0.90
		}
	} else {
		complexity = "simple"
		absScore := score
		if absScore < 0 {
			absScore = -absScore
		}
		confidence = 0.7 + float64(absScore)*0.05
		if confidence > 0.95 {
			confidence = 0.95
		}
	}

	reasonStr := "heuristic:default_simple"
	if len(reasons) > 0 {
		reasonStr = "heuristic:" + strings.Join(reasons, "+")
	}

	return &ClassifyResponse{
		Complexity: complexity,
		Confidence: confidence,
		Reason:     reasonStr,
	}
}

// Classify sends a request to the classifier and returns the complexity.
// requestID is propagated as X-Request-ID header for correlation.
func (c *Client) Classify(ctx context.Context, prompt string, maxTokens int, hasSystemPrompt bool, requestID ...string) (*ClassifyResponse, error) {
	// Fast local heuristic to bypass HTTP roundtrip for simple/medium requests
	localRes := classifyLocal(prompt, maxTokens, hasSystemPrompt)

	// If the heuristic says it's simple/medium natively, trust it entirely!
	// We only fall back to Python if the heuristic suspects it's complex OR
	// if confidence in simple/medium is lower than 80%.
	if (localRes.Complexity == "simple" || localRes.Complexity == "medium") && localRes.Confidence >= 0.80 {
		slog.Debug("used local fast-path heuristic",
			"complexity", localRes.Complexity,
			"confidence", localRes.Confidence)
		return localRes, nil
	}

	// Fallback to Python ML service for deep analysis if complex
	body, err := json.Marshal(ClassifyRequest{
		Prompt:          prompt,
		MaxTokens:       maxTokens,
		HasSystemPrompt: hasSystemPrompt,
	})
	if err != nil {
		return localRes, fmt.Errorf("marshaling classify request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/classify", bytes.NewReader(body))
	if err != nil {
		return localRes, fmt.Errorf("creating classify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.internalSecret != "" {
		req.Header.Set("X-Internal-Secret", c.internalSecret)
	}
	if len(requestID) > 0 && requestID[0] != "" {
		req.Header.Set("X-Request-ID", requestID[0])
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Warn("classifier unreachable, defaulting to local heuristic", "error", err)
		return localRes, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("classifier returned error, defaulting to local heuristic", "status", resp.StatusCode)
		return localRes, nil
	}

	var result ClassifyResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return localRes, fmt.Errorf("decoding classify response: %w", err)
	}

	return &result, nil
}
