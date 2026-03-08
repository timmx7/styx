package providers

import (
	"context"
	"io"
	"net/http"

	"github.com/styx/router/internal/auth"
	"github.com/styx/router/internal/fallback"
)

// ProxyRequest represents an incoming request to be forwarded to a provider.
type ProxyRequest struct {
	Method              string
	Path                string
	Headers             http.Header
	Body                []byte
	Model               string
	Stream              bool
	ProjectID           string
	Complexity          string                 // "simple", "medium", "complex" — set by classifier
	ProviderKeys        map[string]string      // BYOK: per-project provider keys (decrypted), keyed by provider name
	SystemPrompt        *string                // Prompt Playground override
	PIIRedactionEnabled bool                   // High-Performance Regex Obfuscator
	Guardrails          *auth.GuardrailsConfig // Custom validation rules
}

// ProxyResponse represents the response from a provider.
type ProxyResponse struct {
	StatusCode   int
	Headers      http.Header
	Body         io.ReadCloser
	Provider     string
	Model        string
	InputTokens  int
	OutputTokens int
	CostCents    int
	LatencyMs    int
	CacheHit     bool // true if served from semantic cache
	WasFallback  bool // true if this was a fallback provider
}

// ModelCostInfo holds per-model pricing loaded from configuration.
type ModelCostInfo struct {
	InputCostPer1K  float64
	OutputCostPer1K float64
}

// Provider defines the interface every AI provider adapter must implement.
type Provider interface {
	Name() string
	BaseURL() string
	IsHealthy() bool
	Forward(ctx context.Context, req *ProxyRequest) (*ProxyResponse, error)
	EstimateCost(req *ProxyRequest) (cents int, err error)
	Models() []string

	// SetModelCosts injects per-model cost configuration at startup.
	SetModelCosts(costs map[string]ModelCostInfo)

	// Circuit breaker integration
	SetCircuitBreaker(cb *fallback.CircuitBreaker)
	GetCircuitBreaker() *fallback.CircuitBreaker
}

// EstimateCostFromConfig is a shared helper that all providers use.
// If the model is not in the cost map, it falls back to the given default cost.
func EstimateCostFromConfig(modelCosts map[string]ModelCostInfo, model string, bodyLen int, defaultCostPer1K float64) int {
	inputTokens := bodyLen / 4
	if inputTokens < 10 {
		inputTokens = 10
	}

	costPer1K := defaultCostPer1K
	if mc, ok := modelCosts[model]; ok {
		costPer1K = mc.InputCostPer1K
	}

	cents := int(float64(inputTokens) / 1000.0 * costPer1K)
	if cents == 0 {
		cents = 1
	}
	return cents
}
