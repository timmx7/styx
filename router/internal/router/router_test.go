package router

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/styx/router/internal/config"
	"github.com/styx/router/internal/fallback"
	"github.com/styx/router/internal/providers"
)

// ─── Mock provider ──────────────────────────────────────────────

type mockProvider struct {
	name      string
	baseURL   string
	healthy   bool
	models    []string
	cb        *fallback.CircuitBreaker
	forwardFn func(ctx context.Context, req *providers.ProxyRequest) (*providers.ProxyResponse, error)
}

func newMockProvider(name string, healthy bool, models []string) *mockProvider {
	return &mockProvider{
		name:    name,
		baseURL: "https://api." + name + ".com",
		healthy: healthy,
		models:  models,
	}
}

func (m *mockProvider) Name() string     { return m.name }
func (m *mockProvider) BaseURL() string  { return m.baseURL }
func (m *mockProvider) Models() []string { return m.models }
func (m *mockProvider) IsHealthy() bool {
	if m.cb != nil {
		return m.cb.IsAvailable()
	}
	return m.healthy
}
func (m *mockProvider) SetCircuitBreaker(cb *fallback.CircuitBreaker)       { m.cb = cb }
func (m *mockProvider) GetCircuitBreaker() *fallback.CircuitBreaker         { return m.cb }
func (m *mockProvider) SetModelCosts(_ map[string]providers.ModelCostInfo)  { /* no-op in tests */ }

func (m *mockProvider) Forward(ctx context.Context, req *providers.ProxyRequest) (*providers.ProxyResponse, error) {
	if m.forwardFn != nil {
		return m.forwardFn(ctx, req)
	}
	if !m.healthy {
		return nil, fmt.Errorf("provider %s is unhealthy", m.name)
	}
	return &providers.ProxyResponse{
		StatusCode: 200,
		Headers:    http.Header{},
		Body:       io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"hello"}}]}`)),
		Provider:   m.name,
		Model:      req.Model,
		LatencyMs:  10,
	}, nil
}

func (m *mockProvider) EstimateCost(req *providers.ProxyRequest) (int, error) {
	return 1, nil
}

// ─── Helper to build a router ────────────────────────────────────

func buildTestRouter(provs map[string]providers.Provider, cfgs map[string]config.ProviderConfig) *SmartRouter {
	return New(provs, cfgs, nil, nil)
}

func defaultProviders() (map[string]providers.Provider, map[string]config.ProviderConfig) {
	openai := newMockProvider("openai", true, []string{"gpt-4o", "gpt-4o-mini"})
	anthropic := newMockProvider("anthropic", true, []string{"claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"})
	google := newMockProvider("google", true, []string{"gemini-1.5-pro", "gemini-1.5-flash"})

	provMap := map[string]providers.Provider{
		"openai":    openai,
		"anthropic": anthropic,
		"google":    google,
	}

	cfgMap := map[string]config.ProviderConfig{
		"openai": {
			Models: []config.ModelConfig{
				{Name: "gpt-4o", InputCostPer1K: 0.25, OutputCostPer1K: 1.0, Tier: "heavy"},
				{Name: "gpt-4o-mini", InputCostPer1K: 0.015, OutputCostPer1K: 0.06, Tier: "light"},
			},
		},
		"anthropic": {
			Models: []config.ModelConfig{
				{Name: "claude-3-5-sonnet-20241022", InputCostPer1K: 0.3, OutputCostPer1K: 1.5, Tier: "heavy"},
				{Name: "claude-3-5-haiku-20241022", InputCostPer1K: 0.025, OutputCostPer1K: 0.125, Tier: "light"},
			},
		},
		"google": {
			Models: []config.ModelConfig{
				{Name: "gemini-1.5-pro", InputCostPer1K: 0.125, OutputCostPer1K: 0.5, Tier: "medium"},
				{Name: "gemini-1.5-flash", InputCostPer1K: 0.0075, OutputCostPer1K: 0.03, Tier: "light"},
			},
		},
	}

	return provMap, cfgMap
}

// ─── Original Tests (updated signatures) ─────────────────────────

func TestNew_InitializesCorrectly(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	if len(r.modelMap) != 6 {
		t.Errorf("expected 6 models in modelMap, got %d", len(r.modelMap))
	}

	// Check tiers exist
	if len(r.tierModels["light"]) == 0 {
		t.Error("expected light tier to have models")
	}
	if len(r.tierModels["medium"]) == 0 {
		t.Error("expected medium tier to have models")
	}
	if len(r.tierModels["heavy"]) == 0 {
		t.Error("expected heavy tier to have models")
	}

	// Check LoadBalancer and RuleEngine are initialized
	if r.lb == nil {
		t.Error("expected LoadBalancer to be initialized")
	}
	if r.re == nil {
		t.Error("expected RuleEngine to be initialized")
	}
}

func TestNew_SortsTiersByCost(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	// Light tier should be sorted cheapest first
	lightModels := r.tierModels["light"]
	if len(lightModels) < 2 {
		t.Fatal("expected at least 2 light models")
	}

	for i := 1; i < len(lightModels); i++ {
		prev := r.modelMap[lightModels[i-1]]
		curr := r.modelMap[lightModels[i]]
		if prev.CostIn > curr.CostIn {
			t.Errorf("light tier not sorted: %s (%.4f) > %s (%.4f)",
				lightModels[i-1], prev.CostIn, lightModels[i], curr.CostIn)
		}
	}
}

func TestRoute_ExplicitModel(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "gpt-4o", Complexity: "simple"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if model != "gpt-4o" {
		t.Errorf("expected model gpt-4o, got %s", model)
	}
	if prov.Name() != "openai" {
		t.Errorf("expected provider openai, got %s", prov.Name())
	}
}

func TestRoute_SmartRouting_Simple(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should pick a light tier model
	entry := r.modelMap[model]
	if entry.Tier != "light" {
		t.Errorf("simple request should route to light tier, got %s (model=%s, provider=%s)", entry.Tier, model, prov.Name())
	}
}

func TestRoute_SmartRouting_Complex(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "auto", Complexity: "complex"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	entry := r.modelMap[model]
	if entry.Tier != "heavy" {
		t.Errorf("complex request should route to heavy tier, got %s (model=%s, provider=%s)", entry.Tier, model, prov.Name())
	}
}

func TestRoute_SmartRouting_Medium(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "auto", Complexity: "medium"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	entry := r.modelMap[model]
	if entry.Tier != "medium" {
		t.Errorf("medium request should route to medium tier, got %s (model=%s, provider=%s)", entry.Tier, model, prov.Name())
	}
}

func TestRoute_FallbackWhenProviderUnhealthy(t *testing.T) {
	provMap, cfgMap := defaultProviders()

	// Make openai unhealthy
	provMap["openai"].(*mockProvider).healthy = false

	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "gpt-4o", Complexity: "complex"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should fall back to another heavy tier provider (anthropic)
	if prov.Name() == "openai" {
		t.Error("should not route to unhealthy openai")
	}
	_ = model // model will be from the fallback provider
}

func TestRoute_AllProvidersDown(t *testing.T) {
	provMap, cfgMap := defaultProviders()

	// Make all providers unhealthy
	for _, p := range provMap {
		p.(*mockProvider).healthy = false
	}

	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}
	_, _, err := r.Route(req, nil)

	if err == nil {
		t.Error("expected error when all providers are down")
	}
}

func TestForward_Success(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{
		Method:     "POST",
		Path:       "/v1/chat/completions",
		Headers:    http.Header{},
		Body:       []byte(`{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}`),
		Model:      "gpt-4o-mini",
		Complexity: "simple",
	}

	resp, err := r.Forward(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("expected status 200, got %d", resp.StatusCode)
	}
}

func TestForward_FallbackOnError(t *testing.T) {
	provMap, cfgMap := defaultProviders()

	// Make openai fail on forward
	provMap["openai"].(*mockProvider).forwardFn = func(ctx context.Context, req *providers.ProxyRequest) (*providers.ProxyResponse, error) {
		return nil, fmt.Errorf("connection refused")
	}

	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{
		Method:     "POST",
		Path:       "/v1/chat/completions",
		Headers:    http.Header{},
		Body:       []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`),
		Model:      "gpt-4o",
		Complexity: "complex",
	}

	resp, err := r.Forward(context.Background(), req, nil)
	if err != nil {
		t.Fatalf("forward should succeed via fallback, got error: %v", err)
	}
	defer resp.Body.Close()

	// Should have fallen back to anthropic (also heavy tier)
	if resp.Provider == "openai" {
		t.Error("should not have been served by openai")
	}
}

func TestComplexityToTier(t *testing.T) {
	tests := []struct {
		complexity string
		expected   string
	}{
		{"simple", "light"},
		{"medium", "medium"},
		{"complex", "heavy"},
		{"unknown", "light"},
		{"", "light"},
	}

	for _, tc := range tests {
		got := complexityToTier(tc.complexity)
		if got != tc.expected {
			t.Errorf("complexityToTier(%q) = %q, want %q", tc.complexity, got, tc.expected)
		}
	}
}

func TestPickFromTier_EmptyTier(t *testing.T) {
	r := &SmartRouter{
		modelMap:   make(map[string]ModelEntry),
		tierModels: make(map[string][]string),
		lb:         NewLoadBalancer(),
		re:         NewRuleEngine(),
	}

	_, _, err := r.pickFromTier("nonexistent", nil, nil)
	if err == nil {
		t.Error("expected error for empty tier")
	}
}

func TestPickFromTier_AllUnhealthy(t *testing.T) {
	prov := newMockProvider("test", false, []string{"model-a"})
	r := &SmartRouter{
		modelMap: map[string]ModelEntry{
			"model-a": {Provider: prov, Tier: "light", CostIn: 0.01},
		},
		tierModels: map[string][]string{
			"light": {"model-a"},
		},
		lb: NewLoadBalancer(),
		re: NewRuleEngine(),
	}

	_, _, err := r.pickFromTier("light", nil, nil)
	if err == nil {
		t.Error("expected error when all providers in tier are unhealthy")
	}
}

// Test with circuit breaker integration
func TestRoute_WithCircuitBreaker(t *testing.T) {
	provMap, cfgMap := defaultProviders()

	// Attach circuit breaker to openai and trip it
	cb := fallback.NewCircuitBreaker("openai", 3, 30*time.Second)
	for i := 0; i < 5; i++ {
		cb.RecordFailure()
	}

	provMap["openai"].(*mockProvider).SetCircuitBreaker(cb)

	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "gpt-4o", Complexity: "complex"}
	prov, _, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if prov.Name() == "openai" {
		t.Error("should not route to openai when circuit breaker is open")
	}
}

// ─── NEW Tests: RuleEngine Integration ──────────────────────────

func TestRoute_ForcedProvider(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	rule := &RoutingRule{ForcedProvider: "anthropic"}
	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}

	prov, model, err := r.Route(req, rule)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if prov.Name() != "anthropic" {
		t.Errorf("forced provider should be anthropic, got %s", prov.Name())
	}
	// Model should belong to anthropic
	entry := r.modelMap[model]
	if entry.Provider.Name() != "anthropic" {
		t.Errorf("model %s should belong to anthropic, got %s", model, entry.Provider.Name())
	}
}

func TestRoute_ForcedProvider_Unhealthy(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	provMap["anthropic"].(*mockProvider).healthy = false
	r := buildTestRouter(provMap, cfgMap)

	rule := &RoutingRule{ForcedProvider: "anthropic"}
	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}

	_, _, err := r.Route(req, rule)
	if err == nil {
		t.Error("expected error when forced provider is unhealthy")
	}
}

func TestRoute_AllowedProviders(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	// Only allow google
	rule := &RoutingRule{AllowedProviders: []string{"google"}}
	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}

	prov, _, err := r.Route(req, rule)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if prov.Name() != "google" {
		t.Errorf("should route to google (only allowed), got %s", prov.Name())
	}
}

func TestRoute_AllowedProviders_BlocksOthers(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	// Only allow anthropic — request for openai model should be rejected
	rule := &RoutingRule{AllowedProviders: []string{"anthropic"}}
	req := &providers.ProxyRequest{Model: "gpt-4o", Complexity: "complex"}

	prov, _, err := r.Route(req, rule)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// gpt-4o belongs to openai which is not allowed → should fall back to anthropic
	if prov.Name() != "anthropic" {
		t.Errorf("should fall back to anthropic, got %s", prov.Name())
	}
}

func TestRoute_PreferredTier(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	// Force heavy tier even for simple complexity
	rule := &RoutingRule{PreferredTier: "heavy"}
	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}

	_, model, err := r.Route(req, rule)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	entry := r.modelMap[model]
	if entry.Tier != "heavy" {
		t.Errorf("preferred tier heavy should override simple complexity, got tier %s", entry.Tier)
	}
}

func TestRoute_AllowedModels(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	// Only allow specific model
	rule := &RoutingRule{AllowedModels: []string{"gemini-1.5-flash"}}
	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}

	_, model, err := r.Route(req, rule)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if model != "gemini-1.5-flash" {
		t.Errorf("should only route to gemini-1.5-flash, got %s", model)
	}
}

func TestRoute_NilRule_NoRestrictions(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "auto", Complexity: "medium"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// With nil rule, should work exactly as before — pick medium tier
	entry := r.modelMap[model]
	if entry.Tier != "medium" {
		t.Errorf("nil rule should not restrict routing, expected medium tier, got %s (model=%s, provider=%s)",
			entry.Tier, model, prov.Name())
	}
}

// ─── NEW Tests: LoadBalancer Integration ────────────────────────

func TestRoute_LoadBalancer_DistributesRequests(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	lb := NewLoadBalancer()
	r := New(provMap, cfgMap, lb, nil)

	// Heavy tier has openai (gpt-4o) and anthropic (claude-3-5-sonnet)
	// Send multiple complex requests — should see both providers used
	providerCounts := make(map[string]int)
	for i := 0; i < 20; i++ {
		req := &providers.ProxyRequest{Model: "auto", Complexity: "complex"}
		prov, _, err := r.Route(req, nil)
		if err != nil {
			t.Fatalf("unexpected error on iteration %d: %v", i, err)
		}
		providerCounts[prov.Name()]++
	}

	// Both providers should be used at least once
	if providerCounts["openai"] == 0 {
		t.Error("LoadBalancer should distribute some requests to openai")
	}
	if providerCounts["anthropic"] == 0 {
		t.Error("LoadBalancer should distribute some requests to anthropic")
	}
}

func TestRoute_LoadBalancer_RecordsRequests(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	lb := NewLoadBalancer()
	r := New(provMap, cfgMap, lb, nil)

	// Send a few requests
	for i := 0; i < 5; i++ {
		req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}
		_, _, err := r.Route(req, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	}

	counts := lb.GetCounts()
	total := uint64(0)
	for _, c := range counts {
		total += c
	}

	if total != 5 {
		t.Errorf("expected 5 total recorded requests, got %d", total)
	}
}

func TestForward_WithRoutingRule(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	rule := &RoutingRule{AllowedProviders: []string{"google"}}
	req := &providers.ProxyRequest{
		Method:     "POST",
		Path:       "/v1/chat/completions",
		Headers:    http.Header{},
		Body:       []byte(`{"model":"auto","messages":[{"role":"user","content":"hi"}]}`),
		Model:      "auto",
		Complexity: "simple",
	}

	resp, err := r.Forward(context.Background(), req, rule)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if resp.Provider != "google" {
		t.Errorf("expected provider google (only allowed), got %s", resp.Provider)
	}
}

// ─── NEW Tests: Combined Rules ──────────────────────────────────

func TestRoute_AllowedProviders_WithPreferredTier(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	// Allow only openai+anthropic, prefer heavy tier
	rule := &RoutingRule{
		AllowedProviders: []string{"openai", "anthropic"},
		PreferredTier:    "heavy",
	}
	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}

	prov, model, err := r.Route(req, rule)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	entry := r.modelMap[model]
	if entry.Tier != "heavy" {
		t.Errorf("preferred tier should be heavy, got %s", entry.Tier)
	}
	if prov.Name() != "openai" && prov.Name() != "anthropic" {
		t.Errorf("should only use openai or anthropic, got %s", prov.Name())
	}
}

func TestRoute_NoMatchingProviders_ReturnsError(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	// Allow a provider that doesn't exist
	rule := &RoutingRule{AllowedProviders: []string{"nonexistent"}}
	req := &providers.ProxyRequest{Model: "auto", Complexity: "simple"}

	_, _, err := r.Route(req, rule)
	if err == nil {
		t.Error("expected error when no providers match the filter")
	}
}

// ─── NEW Tests: Passthrough routing (step 1c) ────────────────────

// passthroughProviders returns a router with 4 providers but NO explicit models
// in modelMap. Every request will hit the passthrough logic (step 1c) or tier routing.
func passthroughProviders() (map[string]providers.Provider, map[string]config.ProviderConfig) {
	openai := newMockProvider("openai", true, []string{})
	anthropic := newMockProvider("anthropic", true, []string{})
	google := newMockProvider("google", true, []string{})
	mistral := newMockProvider("mistral", true, []string{})

	provMap := map[string]providers.Provider{
		"openai":    openai,
		"anthropic": anthropic,
		"google":    google,
		"mistral":   mistral,
	}
	// Empty cfgMap → modelMap and tierModels will be empty
	cfgMap := map[string]config.ProviderConfig{}

	return provMap, cfgMap
}

func TestRoute_Passthrough_GPTPrefix(t *testing.T) {
	provMap, cfgMap := passthroughProviders()
	r := buildTestRouter(provMap, cfgMap)

	// gpt-4.2 is not in config but should be inferred as openai
	req := &providers.ProxyRequest{Model: "gpt-4.2", Complexity: "simple"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error for gpt-4.2: %v", err)
	}
	if prov.Name() != "openai" {
		t.Errorf("gpt-4.2 should route to openai, got %s", prov.Name())
	}
	if model != "gpt-4.2" {
		t.Errorf("passthrough should preserve original model name, got %s", model)
	}
}

func TestRoute_Passthrough_ClaudePrefix(t *testing.T) {
	provMap, cfgMap := passthroughProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "claude-opus-5-20261001", Complexity: "complex"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error for claude-opus-5: %v", err)
	}
	if prov.Name() != "anthropic" {
		t.Errorf("claude-* should route to anthropic, got %s", prov.Name())
	}
	if model != "claude-opus-5-20261001" {
		t.Errorf("passthrough should preserve original model name, got %s", model)
	}
}

func TestRoute_Passthrough_GeminiPrefix(t *testing.T) {
	provMap, cfgMap := passthroughProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "gemini-3.0-pro", Complexity: "medium"}
	prov, model, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error for gemini-3.0-pro: %v", err)
	}
	if prov.Name() != "google" {
		t.Errorf("gemini-* should route to google, got %s", prov.Name())
	}
	if model != "gemini-3.0-pro" {
		t.Errorf("passthrough should preserve original model name, got %s", model)
	}
}

func TestRoute_Passthrough_MistralPrefix(t *testing.T) {
	provMap, cfgMap := passthroughProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "mistral-large-3", Complexity: "simple"}
	prov, _, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error for mistral-large-3: %v", err)
	}
	if prov.Name() != "mistral" {
		t.Errorf("mistral-* should route to mistral, got %s", prov.Name())
	}
}

func TestRoute_Passthrough_CodestralPrefix(t *testing.T) {
	provMap, cfgMap := passthroughProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "codestral-2026", Complexity: "simple"}
	prov, _, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error for codestral-2026: %v", err)
	}
	if prov.Name() != "mistral" {
		t.Errorf("codestral-* should route to mistral, got %s", prov.Name())
	}
}

func TestRoute_Passthrough_O3Prefix(t *testing.T) {
	provMap, cfgMap := passthroughProviders()
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "o3-mini", Complexity: "medium"}
	prov, _, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unexpected error for o3-mini: %v", err)
	}
	if prov.Name() != "openai" {
		t.Errorf("o3-* should route to openai, got %s", prov.Name())
	}
}

func TestRoute_Passthrough_UnknownPrefix_FallsToTier(t *testing.T) {
	// Use defaultProviders so tier routing can work as fallback
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	// "cohere-command-r" has no known prefix → should fall to tier routing (not error)
	req := &providers.ProxyRequest{Model: "cohere-command-r", Complexity: "simple"}
	prov, _, err := r.Route(req, nil)

	if err != nil {
		t.Fatalf("unknown prefix should fall back to tier routing, got error: %v", err)
	}
	// Should have been routed to some provider via tier routing
	if prov == nil {
		t.Error("expected a provider from tier routing fallback")
	}
}

func TestRoute_Passthrough_ProviderUnhealthy(t *testing.T) {
	provMap, cfgMap := passthroughProviders()
	// Make openai unhealthy — passthrough for gpt-* should fail
	provMap["openai"].(*mockProvider).healthy = false
	r := buildTestRouter(provMap, cfgMap)

	req := &providers.ProxyRequest{Model: "gpt-4.2", Complexity: "simple"}
	_, _, err := r.Route(req, nil)

	// Without any tier models, all paths fail → expect error
	if err == nil {
		t.Error("expected error when passthrough provider is unhealthy and no tier models exist")
	}
}

func TestRoute_Passthrough_RuleBlocksInferredProvider(t *testing.T) {
	provMap, cfgMap := passthroughProviders()
	// Add some tier models so there's a valid fallback path
	provMap2, cfgMap2 := defaultProviders()
	for k, v := range provMap2 {
		provMap[k] = v
	}
	for k, v := range cfgMap2 {
		cfgMap[k] = v
	}

	r := buildTestRouter(provMap, cfgMap)

	// Block openai — gpt-4.2 should not be routed to openai (passthrough blocked)
	// but tier routing to anthropic/google should still work
	rule := &RoutingRule{AllowedProviders: []string{"anthropic", "google", "mistral"}}
	req := &providers.ProxyRequest{Model: "gpt-4.2", Complexity: "simple"}

	prov, _, err := r.Route(req, rule)
	if err != nil {
		t.Fatalf("should fall back to tier routing after passthrough is blocked: %v", err)
	}
	if prov.Name() == "openai" {
		t.Error("openai should be blocked by routing rule")
	}
}

// ─── NEW Tests: ListModels ───────────────────────────────────────

func TestListModels_ReturnsAllConfiguredModels(t *testing.T) {
	provMap, cfgMap := defaultProviders()
	r := buildTestRouter(provMap, cfgMap)

	models := r.ListModels()

	// Should have 6 models (2 OpenAI + 2 Anthropic + 2 Google from defaultProviders)
	if len(models) != 6 {
		t.Errorf("expected 6 models from ListModels, got %d", len(models))
	}

	// All should be available (defaultProviders are all healthy)
	for _, m := range models {
		if !m.Available {
			t.Errorf("model %s should be available, got Available=false", m.ID)
		}
	}
}

func TestListModels_IncludesUnavailableModels(t *testing.T) {
	openai := newMockProvider("openai", true, []string{"gpt-4o"})
	provMap := map[string]providers.Provider{
		"openai": openai,
	}
	cfgMap := map[string]config.ProviderConfig{
		"openai": {
			Models: []config.ModelConfig{
				{Name: "gpt-4o", InputCostPer1K: 0.25, OutputCostPer1K: 1.0, Tier: "heavy"},
			},
		},
		// Anthropic is configured but NOT in provMap (no API key)
		"anthropic": {
			Models: []config.ModelConfig{
				{Name: "claude-3-5-sonnet-20241022", InputCostPer1K: 0.3, OutputCostPer1K: 1.5, Tier: "heavy"},
			},
		},
	}

	r := buildTestRouter(provMap, cfgMap)
	models := r.ListModels()

	// Should have 2 models total: 1 available + 1 unavailable
	if len(models) != 2 {
		t.Errorf("expected 2 models (1 available + 1 unavailable), got %d", len(models))
	}

	available := 0
	unavailable := 0
	for _, m := range models {
		if m.Available {
			available++
		} else {
			unavailable++
		}
	}
	if available != 1 {
		t.Errorf("expected 1 available model, got %d", available)
	}
	if unavailable != 1 {
		t.Errorf("expected 1 unavailable model, got %d", unavailable)
	}
}

func TestListModels_UnavailableHasProviderName(t *testing.T) {
	provMap := map[string]providers.Provider{} // no providers initialized
	cfgMap := map[string]config.ProviderConfig{
		"openai": {
			Models: []config.ModelConfig{
				{Name: "gpt-4o", Tier: "heavy"},
			},
		},
	}

	r := buildTestRouter(provMap, cfgMap)
	models := r.ListModels()

	if len(models) != 1 {
		t.Fatalf("expected 1 model, got %d", len(models))
	}

	m := models[0]
	if m.ID != "gpt-4o" {
		t.Errorf("ID = %q, want 'gpt-4o'", m.ID)
	}
	if m.Provider != "openai" {
		t.Errorf("Provider = %q, want 'openai'", m.Provider)
	}
	if m.Available {
		t.Error("model should be unavailable when provider is not initialized")
	}
}
