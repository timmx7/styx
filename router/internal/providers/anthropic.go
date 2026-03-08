package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/styx/router/internal/fallback"
)

// Anthropic implements the Provider interface for Anthropic's Claude API.
type Anthropic struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	models     []string
	cb         *fallback.CircuitBreaker
	modelCosts map[string]ModelCostInfo
}

// NewAnthropic creates a new Anthropic provider.
func NewAnthropic(baseURL, apiKeyEnv string, models []string) (*Anthropic, error) {
	apiKey := os.Getenv(apiKeyEnv)
	if apiKey == "" {
		return nil, fmt.Errorf("environment variable %s is not set", apiKeyEnv)
	}

	return &Anthropic{
		baseURL: baseURL,
		apiKey:  apiKey,
		// Safety-net timeout: prevents indefinite hangs if the context
		// deadline is not set or is very large.
		httpClient: &http.Client{Timeout: 5 * time.Minute},
		models:     models,
	}, nil
}

func (a *Anthropic) Name() string     { return "anthropic" }
func (a *Anthropic) BaseURL() string  { return a.baseURL }
func (a *Anthropic) Models() []string { return a.models }

func (a *Anthropic) IsHealthy() bool {
	if a.cb != nil {
		return a.cb.IsAvailable()
	}
	return true
}

func (a *Anthropic) SetCircuitBreaker(cb *fallback.CircuitBreaker) { a.cb = cb }
func (a *Anthropic) GetCircuitBreaker() *fallback.CircuitBreaker   { return a.cb }
func (a *Anthropic) SetModelCosts(costs map[string]ModelCostInfo)  { a.modelCosts = costs }

// anthropicMessage represents a single message in Anthropic's format.
type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// openAIRequest is a partial parse of the incoming OpenAI-format request.
type openAIRequest struct {
	Model       string            `json:"model"`
	Messages    []json.RawMessage `json:"messages"`
	MaxTokens   int               `json:"max_tokens,omitempty"`
	Temperature *float64          `json:"temperature,omitempty"`
	Stream      bool              `json:"stream,omitempty"`
}

// openAIMessage is used to parse individual messages.
type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// anthropicRequest is the body we send to Anthropic.
type anthropicRequest struct {
	Model       string             `json:"model"`
	MaxTokens   int                `json:"max_tokens"`
	Messages    []anthropicMessage `json:"messages"`
	System      string             `json:"system,omitempty"`
	Stream      bool               `json:"stream,omitempty"`
	Temperature *float64           `json:"temperature,omitempty"`
}

func (a *Anthropic) Forward(ctx context.Context, req *ProxyRequest) (*ProxyResponse, error) {
	// Circuit breaker check
	if a.cb != nil && !a.cb.Allow() {
		return nil, fmt.Errorf("circuit breaker open for anthropic")
	}

	start := time.Now()

	var body []byte
	var err error

	if req.Path == "/v1/messages" {
		// Native Anthropic request — pass through body as-is (R-P1).
		body = req.Body
	} else {
		// OpenAI-compatible request structure:
		var oaiReq openAIRequest
		if unmarshalErr := json.Unmarshal(req.Body, &oaiReq); unmarshalErr != nil {
			return nil, fmt.Errorf("parsing OpenAI request body: %w", unmarshalErr)
		}

		var systemPrompt string
		var messages []anthropicMessage
		for _, raw := range oaiReq.Messages {
			var msg openAIMessage
			if mErr := json.Unmarshal(raw, &msg); mErr != nil {
				continue
			}
			if msg.Role == "system" {
				systemPrompt = msg.Content
				continue
			}
			messages = append(messages, anthropicMessage{
				Role:    msg.Role,
				Content: msg.Content,
			})
		}

		maxTokens := oaiReq.MaxTokens
		if maxTokens == 0 {
			maxTokens = 4096
		}

		antReq := anthropicRequest{
			Model:       req.Model,
			MaxTokens:   maxTokens,
			Messages:    messages,
			System:      systemPrompt,
			Stream:      req.Stream,
			Temperature: oaiReq.Temperature,
		}

		body, err = json.Marshal(antReq)
		if err != nil {
			return nil, fmt.Errorf("marshaling Anthropic request: %w", err)
		}
	}

	targetURL := a.baseURL + "/v1/messages"

	httpReq, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if reqErr != nil {
		return nil, fmt.Errorf("creating request: %w", reqErr)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	// Use BYOK key if the project provided one, otherwise fall back to env var
	apiKey := a.apiKey
	if byok, ok := req.ProviderKeys["anthropic"]; ok && byok != "" {
		apiKey = byok
	}
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	slog.Debug("forwarding request to Anthropic",
		"url", targetURL,
		"model", req.Model,
		"stream", req.Stream,
	)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		if a.cb != nil {
			a.cb.RecordFailure()
		}
		return nil, fmt.Errorf("forwarding to Anthropic: %w", err)
	}

	latency := time.Since(start).Milliseconds()

	if resp.StatusCode >= 500 || resp.StatusCode == 429 {
		if a.cb != nil {
			a.cb.RecordFailure()
		}
		slog.Warn("Anthropic returned error", "status", resp.StatusCode, "latency_ms", latency)
	} else {
		if a.cb != nil {
			a.cb.RecordSuccess()
		}
	}

	if resp.StatusCode == http.StatusOK && !req.Stream && req.Path == "/v1/chat/completions" {
		// Use LimitReader to prevent OOM from unbounded response bodies (R-C3).
		const maxAnthropicRespSize = 100 * 1024 * 1024 // 100 MB
		bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxAnthropicRespSize))
		if err == nil {
			resp.Body.Close()
			convBody, _ := convertAnthropicToOpenAI(bodyBytes)
			if convBody != nil {
				resp.Body = io.NopCloser(bytes.NewReader(convBody))
				if resp.Header.Get("Content-Length") != "" {
					resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(convBody)))
				}
			} else {
				resp.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			}
		}
	}

	return &ProxyResponse{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       resp.Body,
		Provider:   "anthropic",
		Model:      req.Model,
		LatencyMs:  int(latency),
	}, nil
}

func (a *Anthropic) EstimateCost(req *ProxyRequest) (int, error) {
	return EstimateCostFromConfig(a.modelCosts, req.Model, len(req.Body), 0.3), nil
}

type anthropicResponse struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Role    string `json:"role"`
	Model   string `json:"model"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	StopReason   string `json:"stop_reason"`
	StopSequence string `json:"stop_sequence"`
	Usage        struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

type openAIResponse struct {
	ID                string `json:"id"`
	Object            string `json:"object"`
	Created           int64  `json:"created"`
	Model             string `json:"model"`
	SystemFingerprint string `json:"system_fingerprint,omitempty"`
	Choices           []struct {
		Index   int `json:"index"`
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		Logprobs     interface{} `json:"logprobs"`
		FinishReason string      `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func convertAnthropicToOpenAI(body []byte) ([]byte, error) {
	var antResp anthropicResponse
	if err := json.Unmarshal(body, &antResp); err != nil {
		return nil, err
	}
	if antResp.Type != "message" {
		return body, nil
	}

	text := ""
	for _, c := range antResp.Content {
		if c.Type == "text" {
			text += c.Text
		}
	}

	finishReason := antResp.StopReason
	if finishReason == "end_turn" {
		finishReason = "stop"
	} else if finishReason == "max_tokens" {
		finishReason = "length"
	}

	oaiResp := openAIResponse{
		ID:      antResp.ID,
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   antResp.Model,
		Choices: []struct {
			Index   int `json:"index"`
			Message struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"message"`
			Logprobs     interface{} `json:"logprobs"`
			FinishReason string      `json:"finish_reason"`
		}{
			{
				Index: 0,
				Message: struct {
					Role    string `json:"role"`
					Content string `json:"content"`
				}{
					Role:    antResp.Role,
					Content: text,
				},
				FinishReason: finishReason,
			},
		},
		Usage: struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		}{
			PromptTokens:     antResp.Usage.InputTokens,
			CompletionTokens: antResp.Usage.OutputTokens,
			TotalTokens:      antResp.Usage.InputTokens + antResp.Usage.OutputTokens,
		},
	}

	return json.Marshal(oaiResp)
}
