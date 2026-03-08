package router

import (
	"log/slog"
	"strings"
)

// RoutingRule defines a configurable routing rule for a project.
type RoutingRule struct {
	// ForcedProvider overrides normal routing. Used for compliance (e.g., RGPD).
	ForcedProvider string `json:"forced_provider,omitempty" yaml:"forced_provider,omitempty"`

	// AllowedProviders restricts which providers can be used.
	AllowedProviders []string `json:"allowed_providers,omitempty" yaml:"allowed_providers,omitempty"`

	// AllowedModels restricts which models can be used.
	AllowedModels []string `json:"allowed_models,omitempty" yaml:"allowed_models,omitempty"`

	// PreferredTier overrides the classifier-based tier selection.
	PreferredTier string `json:"preferred_tier,omitempty" yaml:"preferred_tier,omitempty"`

	// MaxCostCentsPerRequest sets a cost ceiling per individual request.
	MaxCostCentsPerRequest int `json:"max_cost_cents_per_request,omitempty" yaml:"max_cost_cents_per_request,omitempty"`
}

// RuleEngine evaluates routing rules to filter providers and models.
type RuleEngine struct{}

// NewRuleEngine creates a new RuleEngine.
func NewRuleEngine() *RuleEngine {
	return &RuleEngine{}
}

// Evaluate applies routing rules and returns the filtered set of allowed
// provider names and an optional forced provider.
// Returns (forcedProvider, allowedProviders, allowedModels).
func (re *RuleEngine) Evaluate(rule *RoutingRule, availableProviders []string) (string, []string, []string) {
	if rule == nil {
		return "", availableProviders, nil
	}

	// 1. Check for forced provider (highest priority — compliance)
	if rule.ForcedProvider != "" {
		slog.Debug("routing rule: forced provider",
			"provider", rule.ForcedProvider,
		)
		return rule.ForcedProvider, []string{rule.ForcedProvider}, rule.AllowedModels
	}

	// 2. Filter by allowed providers
	allowed := availableProviders
	if len(rule.AllowedProviders) > 0 {
		allowed = filterProviders(availableProviders, rule.AllowedProviders)
		slog.Debug("routing rule: filtered providers",
			"available", availableProviders,
			"allowed", allowed,
		)
	}

	return "", allowed, rule.AllowedModels
}

// IsModelAllowed checks if a specific model is permitted by the rules.
func (re *RuleEngine) IsModelAllowed(rule *RoutingRule, model string) bool {
	if rule == nil || len(rule.AllowedModels) == 0 {
		return true // no restrictions
	}

	for _, m := range rule.AllowedModels {
		if strings.EqualFold(m, model) {
			return true
		}
	}
	return false
}

// IsProviderAllowed checks if a specific provider is permitted by the rules.
func (re *RuleEngine) IsProviderAllowed(rule *RoutingRule, provider string) bool {
	if rule == nil || len(rule.AllowedProviders) == 0 {
		return true // no restrictions
	}

	for _, p := range rule.AllowedProviders {
		if strings.EqualFold(p, provider) {
			return true
		}
	}
	return false
}

// GetPreferredTier returns the preferred tier if set, or empty string if not.
func (re *RuleEngine) GetPreferredTier(rule *RoutingRule) string {
	if rule == nil {
		return ""
	}
	return rule.PreferredTier
}

// filterProviders returns only providers that are in both available and allowed lists.
func filterProviders(available, allowed []string) []string {
	allowedSet := make(map[string]bool, len(allowed))
	for _, a := range allowed {
		allowedSet[strings.ToLower(a)] = true
	}

	var filtered []string
	for _, p := range available {
		if allowedSet[strings.ToLower(p)] {
			filtered = append(filtered, p)
		}
	}
	return filtered
}
