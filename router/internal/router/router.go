package router

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/styx/router/internal/config"
	"github.com/styx/router/internal/fallback"
	"github.com/styx/router/internal/pricing"
	"github.com/styx/router/internal/providers"
)

// ModelEntry maps a model name to its provider and tier.
type ModelEntry struct {
	Provider providers.Provider
	Tier     string  // "light", "medium", "heavy"
	CostIn   float64 // input cost per 1K tokens (for sorting)
}

// SmartRouter selects the best provider/model based on request complexity,
// routing rules, and load balancing.
type SmartRouter struct {
	mu                sync.RWMutex
	providers         map[string]providers.Provider // keyed by provider name
	modelMap          map[string]ModelEntry         // keyed by model name
	tierModels        map[string][]string           // tier → sorted model names (cheapest first)
	unavailableModels map[string]string             // model name → provider name (configured but not initialized)
	lb                *LoadBalancer                 // distributes requests across providers
	re                *RuleEngine                   // evaluates per-project routing rules
	pricingMgr        *pricing.Manager              // live per-model cost data
}

// New creates a SmartRouter from the loaded config and initialized providers.
// The LoadBalancer and RuleEngine are optional — pass nil to disable.
func New(providerMap map[string]providers.Provider, cfg map[string]config.ProviderConfig, lb *LoadBalancer, re *RuleEngine) *SmartRouter {
	if lb == nil {
		lb = NewLoadBalancer()
	}
	if re == nil {
		re = NewRuleEngine()
	}

	r := &SmartRouter{
		providers:         providerMap,
		modelMap:          make(map[string]ModelEntry),
		tierModels:        make(map[string][]string),
		unavailableModels: make(map[string]string),
		lb:                lb,
		re:                re,
	}

	// Build model map and tier index (only for initialized providers)
	for provName, provCfg := range cfg {
		prov, ok := providerMap[provName]
		if !ok {
			// Provider is configured but NOT initialized (e.g. empty API key).
			// Track its models so we can return explicit errors instead of
			// silently falling back to a different provider.
			for _, m := range provCfg.Models {
				r.unavailableModels[m.Name] = provName
			}
			continue
		}
		for _, m := range provCfg.Models {
			r.modelMap[m.Name] = ModelEntry{
				Provider: prov,
				Tier:     m.Tier,
				CostIn:   m.InputCostPer1K,
			}
			r.tierModels[m.Tier] = append(r.tierModels[m.Tier], m.Name)
		}
	}

	if len(r.unavailableModels) > 0 {
		slog.Warn("some models are unavailable because their provider is not configured",
			"unavailable_models", len(r.unavailableModels),
		)
	}

	// Sort each tier by cost (cheapest first) — simple insertion sort
	for tier, models := range r.tierModels {
		sorted := make([]string, len(models))
		copy(sorted, models)
		for i := 1; i < len(sorted); i++ {
			for j := i; j > 0 && r.modelMap[sorted[j]].CostIn < r.modelMap[sorted[j-1]].CostIn; j-- {
				sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
			}
		}
		r.tierModels[tier] = sorted
	}

	slog.Info("smart router initialized",
		"providers", len(providerMap),
		"models", len(r.modelMap),
		"tiers", fmt.Sprintf("light=%d medium=%d heavy=%d",
			len(r.tierModels["light"]),
			len(r.tierModels["medium"]),
			len(r.tierModels["heavy"])),
	)

	return r
}

// Route selects the best provider and model for a request.
// If the request specifies a known model, use that model's provider.
// Otherwise, pick a model based on complexity.
// The optional RoutingRule filters providers/models per project settings.
func (r *SmartRouter) Route(req *providers.ProxyRequest, rule *RoutingRule) (providers.Provider, string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// If the user called the native Anthropic endpoint, we MUST force Anthropic
	// and we should preserve the requested model (even if not in our map).
	if req.Path == "/v1/messages" {
		if prov, ok := r.providers["anthropic"]; ok && prov.IsHealthy() {
			r.lb.RecordRequest("anthropic")
			slog.Info("routing native anthropic request",
				"provider", "anthropic",
				"model", req.Model,
			)
			return prov, req.Model, nil
		}
		return nil, "", fmt.Errorf("anthropic provider is unavailable for native /v1/messages request")
	}

	// Evaluate routing rules to get filtered providers/models
	allProviderNames := r.providerNames()
	forcedProvider, allowedProviders, _ := r.re.Evaluate(rule, allProviderNames)

	// If rules are active but no providers match, fail fast
	if rule != nil && len(rule.AllowedProviders) > 0 && len(allowedProviders) == 0 && forcedProvider == "" {
		return nil, "", fmt.Errorf("no available providers match the routing rules (allowed: %v)", rule.AllowedProviders)
	}

	// If a forced provider is set (compliance), use it directly
	if forcedProvider != "" {
		if prov, ok := r.providers[forcedProvider]; ok && prov.IsHealthy() {
			model := r.bestModelForProvider(forcedProvider, complexityToTier(req.Complexity), rule)
			if model != "" {
				r.lb.RecordRequest(forcedProvider)
				slog.Info("routing to forced provider",
					"provider", forcedProvider,
					"model", model,
				)
				return prov, model, nil
			}
		}
		return nil, "", fmt.Errorf("forced provider %q is unavailable or has no matching models", forcedProvider)
	}

	// Check for preferred tier override from rule
	targetTier := complexityToTier(req.Complexity)
	if prefTier := r.re.GetPreferredTier(rule); prefTier != "" {
		targetTier = prefTier
	}

	// 1. If the client specified a known model, use it directly
	if entry, ok := r.modelMap[req.Model]; ok {
		// Check if this model/provider is allowed by rules
		if r.re.IsProviderAllowed(rule, entry.Provider.Name()) && r.re.IsModelAllowed(rule, req.Model) {
			if entry.Provider.IsHealthy() {
				r.lb.RecordRequest(entry.Provider.Name())
				slog.Debug("routing to explicit model",
					"model", req.Model,
					"provider", entry.Provider.Name(),
					"tier", entry.Tier,
				)
				return entry.Provider, req.Model, nil
			}
		}
		// Provider unhealthy or not allowed — try fallback in same tier
		slog.Warn("requested provider unavailable, attempting fallback",
			"model", req.Model,
			"provider", entry.Provider.Name(),
		)
		if prov, model, err := r.pickFromTier(entry.Tier, allowedProviders, rule); err == nil {
			return prov, model, nil
		}
	}

	// 1b. If the model belongs to a configured-but-uninitialized provider, return
	// an explicit error instead of silently routing to a different provider.
	if provName, unavailable := r.unavailableModels[req.Model]; unavailable {
		return nil, "", fmt.Errorf("provider %q is not configured on this instance (model %q requires it) — set the %s_API_KEY environment variable",
			provName, req.Model, providerEnvPrefix(provName))
	}

	// 1c. Passthrough: infer provider from model name prefix for unknown/newer models.
	// This allows routing of model names not explicitly in config.yaml (e.g. "gpt-4.2",
	// "claude-opus-5-20261001") without requiring a config change.
	if prov, passthroughErr := r.passthroughProvider(req.Model, allowedProviders, rule); passthroughErr == nil {
		r.lb.RecordRequest(prov.Name())
		slog.Info("passthrough routing by model name prefix",
			"model", req.Model,
			"provider", prov.Name(),
		)
		return prov, req.Model, nil
	}

	// 2. Smart routing based on complexity (or preferred tier)
	if prov, model, err := r.pickFromTier(targetTier, allowedProviders, rule); err == nil {
		return prov, model, nil
	}

	// 3. Fallback: try all tiers from cheapest to most expensive
	for _, tier := range []string{"light", "medium", "heavy"} {
		if tier == targetTier {
			continue // already tried
		}
		if prov, model, err := r.pickFromTier(tier, allowedProviders, rule); err == nil {
			return prov, model, nil
		}
	}

	return nil, "", fmt.Errorf("all providers are down or filtered by routing rules")
}

// Forward routes the request and forwards to the selected provider.
// The optional RoutingRule is applied to filter providers/models.
// Uses retry with exponential backoff on the primary provider before
// falling back to an alternative provider.
func (r *SmartRouter) Forward(ctx context.Context, req *providers.ProxyRequest, rule *RoutingRule) (*providers.ProxyResponse, error) {
	prov, model, err := r.Route(req, rule)
	if err != nil {
		return nil, err
	}

	// Override the model in the request body to match what we selected
	originalModel := req.Model
	req.Model = model

	// ─── Try primary provider with retry ──────────────────────
	retryCfg := fallback.RetryConfig{
		MaxRetries:     2,
		BaseDelay:      100 * time.Millisecond,
		MaxDelay:       2 * time.Second,
		BackoffFactor:  2.0,
		RetryableCodes: []int{500, 502, 503, 504, 429},
	}

	var resp *providers.ProxyResponse
	_, retryErr := fallback.WithRetry(ctx, retryCfg, "forward-"+prov.Name(), func(ctx context.Context, attempt int) (int, error) {
		// Close any previous response body from a failed attempt to prevent leaks.
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
			resp = nil
		}
		var fwdErr error
		resp, fwdErr = prov.Forward(ctx, req)
		if fwdErr != nil {
			return 0, fwdErr
		}
		return resp.StatusCode, nil
	})

	if retryErr == nil {
		return resp, nil
	}

	// ─── Primary failed after retries — try fallback ──────────
	slog.Warn("provider failed after retries, trying fallback",
		"provider", prov.Name(),
		"model", model,
		"error", retryErr,
	)

	req.Model = originalModel
	fallbackProv, fallbackModel, fbErr := r.fallback(prov.Name(), req, rule)
	if fbErr != nil {
		return nil, fmt.Errorf("all providers failed: primary=%w", retryErr)
	}

	req.Model = fallbackModel
	// Close the primary provider's last response body (if any) before fallback.
	if resp != nil && resp.Body != nil {
		resp.Body.Close()
	}
	resp = nil

	// Retry on fallback provider too
	_, fbRetryErr := fallback.WithRetry(ctx, retryCfg, "fallback-"+fallbackProv.Name(), func(ctx context.Context, attempt int) (int, error) {
		// Close any previous response body from a failed attempt to prevent leaks.
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
			resp = nil
		}
		var fwdErr error
		resp, fwdErr = fallbackProv.Forward(ctx, req)
		if fwdErr != nil {
			return 0, fwdErr
		}
		return resp.StatusCode, nil
	})

	if fbRetryErr != nil {
		return nil, fmt.Errorf("fallback provider also failed: %w", fbRetryErr)
	}

	if resp != nil {
		resp.WasFallback = true
	}
	return resp, nil
}

// pickFromTier selects a healthy model from the given tier, respecting
// allowed providers and model restrictions, using load balancing.
func (r *SmartRouter) pickFromTier(tier string, allowedProviders []string, rule *RoutingRule) (providers.Provider, string, error) {
	models, ok := r.tierModels[tier]
	if !ok || len(models) == 0 {
		return nil, "", fmt.Errorf("no models in tier %s", tier)
	}

	allowedSet := toSet(allowedProviders)

	// Collect healthy candidates that pass the filters
	var candidates []string                       // model names
	candidateProviders := make(map[string]string) // model → provider name
	for _, model := range models {
		entry := r.modelMap[model]
		provName := entry.Provider.Name()
		if !entry.Provider.IsHealthy() {
			continue
		}
		if len(allowedSet) > 0 && !allowedSet[provName] {
			continue
		}
		if !r.re.IsModelAllowed(rule, model) {
			continue
		}
		candidates = append(candidates, model)
		candidateProviders[model] = provName
	}

	if len(candidates) == 0 {
		return nil, "", fmt.Errorf("no healthy allowed providers in tier %s", tier)
	}

	// Use LoadBalancer to pick among the candidate providers
	provNames := uniqueProviderNames(candidates, candidateProviders)
	selectedProvider := r.lb.Pick(provNames)

	// Pick the cheapest model from the selected provider (candidates are already cost-sorted)
	for _, model := range candidates {
		if candidateProviders[model] == selectedProvider {
			prov := r.modelMap[model].Provider
			slog.Debug("picked model via load balancer",
				"model", model,
				"provider", selectedProvider,
				"tier", tier,
			)
			return prov, model, nil
		}
	}

	return nil, "", fmt.Errorf("no healthy allowed providers in tier %s", tier)
}

// fallback tries to find an alternative provider, excluding the failed one,
// while respecting routing rules and using load balancing.
func (r *SmartRouter) fallback(failedProvider string, req *providers.ProxyRequest, rule *RoutingRule) (providers.Provider, string, error) {
	targetTier := complexityToTier(req.Complexity)
	if prefTier := r.re.GetPreferredTier(rule); prefTier != "" {
		targetTier = prefTier
	}

	allProviderNames := r.providerNames()
	_, allowedProviders, _ := r.re.Evaluate(rule, allProviderNames)

	// Remove the failed provider from allowed list
	var filtered []string
	for _, p := range allowedProviders {
		if p != failedProvider {
			filtered = append(filtered, p)
		}
	}

	// Try same tier first, then escalate
	for _, tier := range []string{targetTier, "medium", "heavy", "light"} {
		prov, model, err := r.pickFromTier(tier, filtered, rule)
		if err == nil {
			slog.Info("falling back to alternative provider",
				"provider", prov.Name(),
				"model", model,
				"tier", tier,
			)
			return prov, model, nil
		}
	}

	return nil, "", fmt.Errorf("no fallback provider available")
}

// bestModelForProvider returns the best model from a specific provider
// for the given tier and rule. Falls back to any model from that provider.
func (r *SmartRouter) bestModelForProvider(provName, tier string, rule *RoutingRule) string {
	// Try the target tier first
	if models, ok := r.tierModels[tier]; ok {
		for _, model := range models {
			entry := r.modelMap[model]
			if entry.Provider.Name() == provName && r.re.IsModelAllowed(rule, model) {
				return model
			}
		}
	}
	// Fall back to any tier
	for _, tier := range []string{"light", "medium", "heavy"} {
		if models, ok := r.tierModels[tier]; ok {
			for _, model := range models {
				entry := r.modelMap[model]
				if entry.Provider.Name() == provName && r.re.IsModelAllowed(rule, model) {
					return model
				}
			}
		}
	}
	return ""
}

// providerNames returns a sorted list of all provider names.
func (r *SmartRouter) providerNames() []string {
	names := make([]string, 0, len(r.providers))
	for name := range r.providers {
		names = append(names, name)
	}
	return names
}

// toSet converts a slice to a map for O(1) lookups.
func toSet(items []string) map[string]bool {
	if len(items) == 0 {
		return nil
	}
	s := make(map[string]bool, len(items))
	for _, item := range items {
		s[item] = true
	}
	return s
}

// uniqueProviderNames returns deduplicated provider names from candidates.
func uniqueProviderNames(candidates []string, candidateProviders map[string]string) []string {
	seen := make(map[string]bool, len(candidates))
	var names []string
	for _, model := range candidates {
		prov := candidateProviders[model]
		if !seen[prov] {
			seen[prov] = true
			names = append(names, prov)
		}
	}
	return names
}

// providerEnvPrefix returns the uppercase env var prefix for a provider name.
func providerEnvPrefix(provName string) string {
	switch provName {
	case "openai":
		return "OPENAI"
	case "anthropic":
		return "ANTHROPIC"
	case "google":
		return "GOOGLE"
	case "mistral":
		return "MISTRAL"
	case "azure":
		return "AZURE"
	default:
		return strings.ToUpper(provName)
	}
}

// complexityToTier maps classifier complexity to model tier.
func complexityToTier(complexity string) string {
	switch complexity {
	case "simple":
		return "light"
	case "medium":
		return "medium"
	case "complex":
		return "heavy"
	default:
		return "light" // default to cheapest
	}
}

// ─── Passthrough routing ──────────────────────────────────────────────────────

// passthroughProvider infers the correct provider for an *unknown* model name
// by matching well-known model name prefixes. This enables transparent routing
// of newer or custom model variants (e.g. "gpt-4.2", "claude-opus-5-20261001")
// without requiring explicit entries in config.yaml.
//
// Returns an error (and nil provider) when:
//   - the prefix does not match any known provider
//   - the inferred provider is excluded by routing rules
//   - the inferred provider is not configured on this instance
//   - the inferred provider is currently unhealthy
func (r *SmartRouter) passthroughProvider(modelName string, allowedProviders []string, rule *RoutingRule) (providers.Provider, error) {
	var provName string
	switch {
	case strings.HasPrefix(modelName, "gpt-"),
		strings.HasPrefix(modelName, "o1"),
		strings.HasPrefix(modelName, "o3"),
		strings.HasPrefix(modelName, "o4"),
		strings.HasPrefix(modelName, "chatgpt-"):
		provName = "openai"
	case strings.HasPrefix(modelName, "claude-"):
		provName = "anthropic"
	case strings.HasPrefix(modelName, "gemini-"),
		strings.HasPrefix(modelName, "learnlm-"):
		provName = "google"
	case strings.HasPrefix(modelName, "mistral-"),
		strings.HasPrefix(modelName, "codestral-"),
		strings.HasPrefix(modelName, "open-mistral-"),
		strings.HasPrefix(modelName, "open-mixtral-"),
		strings.HasPrefix(modelName, "ministral-"):
		provName = "mistral"
	default:
		return nil, fmt.Errorf("model %q: cannot infer provider from name prefix", modelName)
	}

	// Respect routing rule provider restrictions
	if !r.re.IsProviderAllowed(rule, provName) {
		return nil, fmt.Errorf("model %q: inferred provider %q is not allowed by routing rules", modelName, provName)
	}

	// Respect the evaluated allowed-providers list (from rule evaluation)
	if len(allowedProviders) > 0 {
		found := false
		for _, p := range allowedProviders {
			if p == provName {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("model %q: inferred provider %q not in allowed providers %v", modelName, provName, allowedProviders)
		}
	}

	prov, ok := r.providers[provName]
	if !ok {
		return nil, fmt.Errorf("model %q: provider %q is not configured on this instance (set %s_API_KEY)", modelName, provName, providerEnvPrefix(provName))
	}
	if !prov.IsHealthy() {
		return nil, fmt.Errorf("model %q: provider %q is currently unhealthy", modelName, provName)
	}
	return prov, nil
}

// ─── Model listing ────────────────────────────────────────────────────────────

// ModelPricing exposes per-model cost in USD per 1M tokens.
type ModelPricing struct {
	InputPerMillion  float64 `json:"input_per_million"`
	OutputPerMillion float64 `json:"output_per_million"`
	Currency         string  `json:"currency"` // always "USD"
}

// ModelInfo describes a model known to the router, used for the /v1/models response.
type ModelInfo struct {
	ID        string        `json:"id"`
	Provider  string        `json:"provider"`
	Tier      string        `json:"tier,omitempty"`
	Available bool          `json:"available"`
	Pricing   *ModelPricing `json:"pricing,omitempty"`
}

// SetPricingManager injects a live pricing manager into the router.
func (r *SmartRouter) SetPricingManager(m *pricing.Manager) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pricingMgr = m
}

// ListModels returns all models the router knows about:
//   - configured and available (provider initialized with a healthy API key)
//   - configured but unavailable (provider key missing or init failed)
//
// Note: passthrough-capable model names (inferred from prefixes) are not
// enumerated here since they are unbounded. Use the /v1/models endpoint
// response to discover explicitly supported models.
func (r *SmartRouter) ListModels() []ModelInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	models := make([]ModelInfo, 0, len(r.modelMap)+len(r.unavailableModels))

	for name, entry := range r.modelMap {
		info := ModelInfo{
			ID:        name,
			Provider:  entry.Provider.Name(),
			Tier:      entry.Tier,
			Available: entry.Provider.IsHealthy(),
		}
		if r.pricingMgr != nil {
			if p, ok := r.pricingMgr.Get(name); ok {
				info.Pricing = &ModelPricing{
					InputPerMillion:  p.InputPerMillion,
					OutputPerMillion: p.OutputPerMillion,
					Currency:         "USD",
				}
			}
		}
		models = append(models, info)
	}
	for name, provName := range r.unavailableModels {
		info := ModelInfo{
			ID:        name,
			Provider:  provName,
			Available: false,
		}
		if r.pricingMgr != nil {
			if p, ok := r.pricingMgr.Get(name); ok {
				info.Pricing = &ModelPricing{
					InputPerMillion:  p.InputPerMillion,
					OutputPerMillion: p.OutputPerMillion,
					Currency:         "USD",
				}
			}
		}
		models = append(models, info)
	}

	// Append the four virtual styx:* models so clients discover them via /v1/models.
	virtual := []ModelInfo{
		{ID: "styx:auto", Provider: "styx", Tier: "auto", Available: true},
		{ID: "styx:fast", Provider: "styx", Tier: "light", Available: true},
		{ID: "styx:balanced", Provider: "styx", Tier: "medium", Available: true},
		{ID: "styx:frontier", Provider: "styx", Tier: "heavy", Available: true},
	}
	models = append(models, virtual...)

	return models
}

// PickTier is the exported counterpart of pickFromTier, used by the proxy handler
// to resolve a virtual styx:* model to a real provider+model pair.
func (r *SmartRouter) PickTier(tier string, allowedProviders []string, rule *RoutingRule) (providers.Provider, string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.pickFromTier(tier, allowedProviders, rule)
}
