package providers

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/styx/router/internal/fallback"
)

// Mistral implements the Provider interface for Mistral AI's API.
type Mistral struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
	models     []string
	cb         *fallback.CircuitBreaker
	modelCosts map[string]ModelCostInfo
}

// NewMistral creates a new Mistral provider.
func NewMistral(baseURL, apiKeyEnv string, models []string) (*Mistral, error) {
	apiKey := os.Getenv(apiKeyEnv)
	if apiKey == "" {
		return nil, fmt.Errorf("environment variable %s is not set", apiKeyEnv)
	}

	return &Mistral{
		baseURL:    baseURL,
		apiKey:     apiKey,
		// Safety-net timeout: prevents indefinite hangs if the context
		// deadline is not set or is very large.
		httpClient: &http.Client{Timeout: 5 * time.Minute},
		models:     models,
	}, nil
}

func (m *Mistral) Name() string    { return "mistral" }
func (m *Mistral) BaseURL() string { return m.baseURL }
func (m *Mistral) Models() []string { return m.models }

func (m *Mistral) IsHealthy() bool {
	if m.cb != nil {
		return m.cb.IsAvailable()
	}
	return true
}

func (m *Mistral) SetCircuitBreaker(cb *fallback.CircuitBreaker)   { m.cb = cb }
func (m *Mistral) GetCircuitBreaker() *fallback.CircuitBreaker     { return m.cb }
func (m *Mistral) SetModelCosts(costs map[string]ModelCostInfo)    { m.modelCosts = costs }

func (m *Mistral) Forward(ctx context.Context, req *ProxyRequest) (*ProxyResponse, error) {
	// Circuit breaker check
	if m.cb != nil && !m.cb.Allow() {
		return nil, fmt.Errorf("circuit breaker open for mistral")
	}

	start := time.Now()

	targetURL := m.baseURL + req.Path

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL, bytes.NewReader(req.Body))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	for key, values := range req.Headers {
		for _, v := range values {
			httpReq.Header.Add(key, v)
		}
	}

	// Use BYOK key if the project provided one, otherwise fall back to env var
	apiKey := m.apiKey
	if byok, ok := req.ProviderKeys["mistral"]; ok && byok != "" {
		apiKey = byok
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	if httpReq.Header.Get("Content-Type") == "" {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	httpReq.Header.Del("Host")

	slog.Debug("forwarding request to Mistral",
		"url", targetURL,
		"model", req.Model,
		"stream", req.Stream,
	)

	resp, err := m.httpClient.Do(httpReq)
	if err != nil {
		if m.cb != nil {
			m.cb.RecordFailure()
		}
		return nil, fmt.Errorf("forwarding to Mistral: %w", err)
	}

	latency := time.Since(start).Milliseconds()

	if resp.StatusCode >= 500 || resp.StatusCode == 429 {
		if m.cb != nil {
			m.cb.RecordFailure()
		}
		slog.Warn("Mistral returned error", "status", resp.StatusCode, "latency_ms", latency)
	} else {
		if m.cb != nil {
			m.cb.RecordSuccess()
		}
	}

	return &ProxyResponse{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       resp.Body,
		Provider:   "mistral",
		Model:      req.Model,
		LatencyMs:  int(latency),
	}, nil
}

func (m *Mistral) EstimateCost(req *ProxyRequest) (int, error) {
	return EstimateCostFromConfig(m.modelCosts, req.Model, len(req.Body), 0.2), nil
}
