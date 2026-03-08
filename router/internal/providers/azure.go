package providers

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/styx/router/internal/fallback"
)

// Azure implements the Provider interface for Azure OpenAI Service.
// URL format: https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-02-01
type Azure struct {
	baseURL    string // e.g., https://myresource.openai.azure.com
	apiKey     string
	httpClient *http.Client
	models     []string
	cb         *fallback.CircuitBreaker
	modelCosts map[string]ModelCostInfo
	apiVersion string
}

// NewAzure creates a new Azure OpenAI provider from config values.
func NewAzure(baseURL, apiKeyEnv string, models []string) (*Azure, error) {
	apiKey := os.Getenv(apiKeyEnv)
	if apiKey == "" {
		return nil, fmt.Errorf("environment variable %s is not set", apiKeyEnv)
	}

	return &Azure{
		baseURL: baseURL,
		apiKey:  apiKey,
		// Safety-net timeout: prevents indefinite hangs if the context
		// deadline is not set or is very large.
		httpClient: &http.Client{Timeout: 5 * time.Minute},
		models:     models,
		apiVersion: "2024-02-01",
	}, nil
}

func (a *Azure) Name() string     { return "azure" }
func (a *Azure) BaseURL() string  { return a.baseURL }
func (a *Azure) Models() []string { return a.models }

func (a *Azure) IsHealthy() bool {
	if a.cb != nil {
		return a.cb.IsAvailable()
	}
	return true
}

func (a *Azure) SetCircuitBreaker(cb *fallback.CircuitBreaker)   { a.cb = cb }
func (a *Azure) GetCircuitBreaker() *fallback.CircuitBreaker     { return a.cb }
func (a *Azure) SetModelCosts(costs map[string]ModelCostInfo)    { a.modelCosts = costs }

func (a *Azure) Forward(ctx context.Context, req *ProxyRequest) (*ProxyResponse, error) {
	// Circuit breaker check
	if a.cb != nil && !a.cb.Allow() {
		return nil, fmt.Errorf("circuit breaker open for azure")
	}

	start := time.Now()

	// Azure uses deployment-based URLs:
	// /openai/deployments/{deployment}/chat/completions?api-version=...
	// The model name is typically used as the deployment name
	targetURL := fmt.Sprintf("%s/openai/deployments/%s/chat/completions?api-version=%s",
		a.baseURL, url.PathEscape(req.Model), a.apiVersion)

	httpReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL, bytes.NewReader(req.Body))
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	// Copy relevant headers
	for key, values := range req.Headers {
		for _, v := range values {
			httpReq.Header.Add(key, v)
		}
	}

	// Use BYOK key if the project provided one, otherwise fall back to env var
	apiKey := a.apiKey
	if byok, ok := req.ProviderKeys["azure"]; ok && byok != "" {
		apiKey = byok
	}
	// Azure uses api-key header for authentication
	httpReq.Header.Set("api-key", apiKey)
	if httpReq.Header.Get("Content-Type") == "" {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	httpReq.Header.Del("Host")

	slog.Debug("forwarding request to Azure OpenAI",
		"url", targetURL,
		"method", req.Method,
		"model", req.Model,
		"stream", req.Stream,
	)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		if a.cb != nil {
			a.cb.RecordFailure()
		}
		return nil, fmt.Errorf("forwarding to Azure: %w", err)
	}

	latency := time.Since(start).Milliseconds()

	if resp.StatusCode >= 500 || resp.StatusCode == 429 {
		if a.cb != nil {
			a.cb.RecordFailure()
		}
		slog.Warn("Azure returned error",
			"status", resp.StatusCode,
			"latency_ms", latency,
		)
	} else {
		if a.cb != nil {
			a.cb.RecordSuccess()
		}
	}

	return &ProxyResponse{
		StatusCode: resp.StatusCode,
		Headers:    resp.Header,
		Body:       resp.Body,
		Provider:   "azure",
		Model:      req.Model,
		LatencyMs:  int(latency),
	}, nil
}

func (a *Azure) EstimateCost(req *ProxyRequest) (int, error) {
	return EstimateCostFromConfig(a.modelCosts, req.Model, len(req.Body), 0.25), nil
}
