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

// OpenAI implements the Provider interface for OpenAI's API.
type OpenAI struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	models     []string
	cb         *fallback.CircuitBreaker
	modelCosts map[string]ModelCostInfo
}

// NewOpenAI creates a new OpenAI provider from config values.
func NewOpenAI(baseURL, apiKeyEnv string, models []string) (*OpenAI, error) {
	apiKey := os.Getenv(apiKeyEnv)
	if apiKey == "" {
		return nil, fmt.Errorf("environment variable %s is not set", apiKeyEnv)
	}

	return &OpenAI{
		baseURL: baseURL,
		apiKey:  apiKey,
		// Safety-net timeout: prevents indefinite hangs if the context
		// deadline is not set or is very large. The context deadline
		// still controls cancellation for normal requests; this is a
		// hard upper bound.
		httpClient: &http.Client{Timeout: 5 * time.Minute},
		models:     models,
	}, nil
}

func (o *OpenAI) Name() string     { return "openai" }
func (o *OpenAI) BaseURL() string  { return o.baseURL }
func (o *OpenAI) Models() []string { return o.models }

func (o *OpenAI) IsHealthy() bool {
	if o.cb != nil {
		return o.cb.IsAvailable()
	}
	return true
}

func (o *OpenAI) SetCircuitBreaker(cb *fallback.CircuitBreaker) { o.cb = cb }
func (o *OpenAI) GetCircuitBreaker() *fallback.CircuitBreaker   { return o.cb }
func (o *OpenAI) SetModelCosts(costs map[string]ModelCostInfo)  { o.modelCosts = costs }

func (o *OpenAI) Forward(ctx context.Context, req *ProxyRequest) (*ProxyResponse, error) {
	// Circuit breaker check
	if o.cb != nil && !o.cb.Allow() {
		return nil, fmt.Errorf("circuit breaker open for openai")
	}

	start := time.Now()

	targetURL := o.baseURL + req.Path

	bodyBytes := req.Body

	// We need to potentially modify the JSON body for:
	// 1. Injecting a system prompt (if overrides are set)
	// 2. Injecting stream_options (OpenAI requires this to return token usage in streams)
	if req.SystemPrompt != nil || req.Stream {
		var payload map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &payload); err == nil {
			modified := false

			// Inject system prompt
			if req.SystemPrompt != nil {
				if msgs, ok := payload["messages"].([]interface{}); ok {
					var newMsgs []interface{}
					newMsgs = append(newMsgs, map[string]interface{}{
						"role":    "system",
						"content": *req.SystemPrompt,
					})
					for _, m := range msgs {
						if msgMap, ok2 := m.(map[string]interface{}); ok2 {
							if msgMap["role"] != "system" {
								newMsgs = append(newMsgs, msgMap)
							}
						}
					}
					payload["messages"] = newMsgs
					modified = true
				}
			}

			// Inject stream_options for usage tracking
			if req.Stream {
				// Initialize stream_options if it doesn't exist
				if _, ok := payload["stream_options"]; !ok {
					payload["stream_options"] = map[string]interface{}{
						"include_usage": true,
					}
					modified = true
				} else if soMap, ok := payload["stream_options"].(map[string]interface{}); ok {
					soMap["include_usage"] = true
					payload["stream_options"] = soMap
					modified = true
				}
			}

			if modified {
				if modifiedBody, err := json.Marshal(payload); err == nil {
					bodyBytes = modifiedBody
				}
			}
		}
	}

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	for key, values := range req.Headers {
		for _, v := range values {
			httpReq.Header.Add(key, v)
		}
	}

	// Use BYOK key if the project provided one, otherwise fall back to env var
	apiKey := o.apiKey
	if byok, ok := req.ProviderKeys["openai"]; ok && byok != "" {
		apiKey = byok
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	if httpReq.Header.Get("Content-Type") == "" {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	httpReq.Header.Del("Host")

	slog.Debug("forwarding request to OpenAI",
		"url", targetURL,
		"method", req.Method,
		"model", req.Model,
		"stream", req.Stream,
	)

	resp, err := o.httpClient.Do(httpReq)
	if err != nil {
		if o.cb != nil {
			o.cb.RecordFailure()
		}
		return nil, fmt.Errorf("forwarding to OpenAI: %w", err)
	}

	latency := time.Since(start).Milliseconds()

	if resp.StatusCode >= 500 || resp.StatusCode == 429 {
		if o.cb != nil {
			o.cb.RecordFailure()
		}
		slog.Warn("OpenAI returned error",
			"status", resp.StatusCode,
			"latency_ms", latency,
		)
	} else {
		if o.cb != nil {
			o.cb.RecordSuccess()
		}
	}

	return &ProxyResponse{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       resp.Body,
		Provider:   "openai",
		Model:      req.Model,
		LatencyMs:  int(latency),
	}, nil
}

func (o *OpenAI) EstimateCost(req *ProxyRequest) (int, error) {
	return EstimateCostFromConfig(o.modelCosts, req.Model, len(req.Body), 0.25), nil
}

// bodyToBytes reads the body into bytes without consuming it for the caller.
// Uses LimitReader to prevent OOM from unbounded response bodies (R-C3).
func bodyToBytes(body io.ReadCloser) ([]byte, error) {
	if body == nil {
		return nil, nil
	}
	const maxBodySize = 100 * 1024 * 1024 // 100 MB
	data, err := io.ReadAll(io.LimitReader(body, maxBodySize))
	if err != nil {
		return nil, err
	}
	return data, body.Close()
}
