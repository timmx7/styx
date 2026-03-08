package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/styx/router/internal/fallback"
)

// Google implements the Provider interface for Google AI (Gemini) API.
type Google struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	models     []string
	cb         *fallback.CircuitBreaker
	modelCosts map[string]ModelCostInfo
}

// NewGoogle creates a new Google AI provider.
func NewGoogle(baseURL, apiKeyEnv string, models []string) (*Google, error) {
	apiKey := os.Getenv(apiKeyEnv)
	if apiKey == "" {
		return nil, fmt.Errorf("environment variable %s is not set", apiKeyEnv)
	}

	return &Google{
		baseURL:    baseURL,
		apiKey:     apiKey,
		// Safety-net timeout: prevents indefinite hangs if the context
		// deadline is not set or is very large.
		httpClient: &http.Client{Timeout: 5 * time.Minute},
		models:     models,
	}, nil
}

func (g *Google) Name() string    { return "google" }
func (g *Google) BaseURL() string { return g.baseURL }
func (g *Google) Models() []string { return g.models }

func (g *Google) IsHealthy() bool {
	if g.cb != nil {
		return g.cb.IsAvailable()
	}
	return true
}

func (g *Google) SetCircuitBreaker(cb *fallback.CircuitBreaker)   { g.cb = cb }
func (g *Google) GetCircuitBreaker() *fallback.CircuitBreaker     { return g.cb }
func (g *Google) SetModelCosts(costs map[string]ModelCostInfo)    { g.modelCosts = costs }

// Gemini request types
type geminiContent struct {
	Role  string       `json:"role"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiRequest struct {
	Contents          []geminiContent  `json:"contents"`
	SystemInstruction *geminiContent   `json:"systemInstruction,omitempty"`
	GenerationConfig  *geminiGenConfig `json:"generationConfig,omitempty"`
}

type geminiGenConfig struct {
	MaxOutputTokens int      `json:"maxOutputTokens,omitempty"`
	Temperature     *float64 `json:"temperature,omitempty"`
}

func (g *Google) Forward(ctx context.Context, req *ProxyRequest) (*ProxyResponse, error) {
	// Circuit breaker check
	if g.cb != nil && !g.cb.Allow() {
		return nil, fmt.Errorf("circuit breaker open for google")
	}

	start := time.Now()

	var oaiReq openAIRequest
	if err := json.Unmarshal(req.Body, &oaiReq); err != nil {
		return nil, fmt.Errorf("parsing request body: %w", err)
	}

	var contents []geminiContent
	var systemInstruction *geminiContent

	for _, raw := range oaiReq.Messages {
		var msg openAIMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg.Role == "system" {
			systemInstruction = &geminiContent{
				Role:  "user",
				Parts: []geminiPart{{Text: msg.Content}},
			}
			continue
		}
		role := msg.Role
		if role == "assistant" {
			role = "model"
		}
		contents = append(contents, geminiContent{
			Role:  role,
			Parts: []geminiPart{{Text: msg.Content}},
		})
	}

	gemReq := geminiRequest{
		Contents:          contents,
		SystemInstruction: systemInstruction,
	}

	if oaiReq.MaxTokens > 0 || oaiReq.Temperature != nil {
		gemReq.GenerationConfig = &geminiGenConfig{
			MaxOutputTokens: oaiReq.MaxTokens,
			Temperature:     oaiReq.Temperature,
		}
	}

	body, err := json.Marshal(gemReq)
	if err != nil {
		return nil, fmt.Errorf("marshaling Gemini request: %w", err)
	}

	action := "generateContent"
	if req.Stream {
		action = "streamGenerateContent?alt=sse"
	}
	targetURL := fmt.Sprintf("%s/v1beta/models/%s:%s", g.baseURL, url.PathEscape(req.Model), action)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	// Use header-based auth instead of URL query parameter to prevent
	// API key leakage in logs, CDN caches, and referrer headers.
	// Use BYOK key if the project provided one, otherwise fall back to env var
	apiKey := g.apiKey
	if byok, ok := req.ProviderKeys["google"]; ok && byok != "" {
		apiKey = byok
	}
	httpReq.Header.Set("x-goog-api-key", apiKey)

	slog.Debug("forwarding request to Google AI",
		"url", targetURL,
		"model", req.Model,
		"stream", req.Stream,
	)

	resp, err := g.httpClient.Do(httpReq)
	if err != nil {
		if g.cb != nil {
			g.cb.RecordFailure()
		}
		return nil, fmt.Errorf("forwarding to Google: %w", err)
	}

	latency := time.Since(start).Milliseconds()

	if resp.StatusCode >= 500 || resp.StatusCode == 429 {
		if g.cb != nil {
			g.cb.RecordFailure()
		}
		slog.Warn("Google AI returned error", "status", resp.StatusCode, "latency_ms", latency)
	} else {
		if g.cb != nil {
			g.cb.RecordSuccess()
		}
	}

	return &ProxyResponse{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       resp.Body,
		Provider:   "google",
		Model:      req.Model,
		LatencyMs:  int(latency),
	}, nil
}

func (g *Google) EstimateCost(req *ProxyRequest) (int, error) {
	return EstimateCostFromConfig(g.modelCosts, req.Model, len(req.Body), 0.125), nil
}
