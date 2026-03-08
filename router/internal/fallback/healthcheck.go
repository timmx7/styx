package fallback

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

// ProviderHealth holds the health status of a single provider.
type ProviderHealth struct {
	Healthy   bool
	Latency   time.Duration
	LastCheck time.Time
	Error     string
}

// ProviderProbeConfig holds the info needed to probe a specific provider.
type ProviderProbeConfig struct {
	BaseURL    string // e.g., "https://api.openai.com"
	AuthHeader string // e.g., "Authorization" or "x-api-key" or "api-key"
	AuthPrefix string // e.g., "Bearer " or ""
	APIKeyEnv  string // e.g., "OPENAI_API_KEY"
}

// HealthChecker periodically probes each provider's health endpoint
// and reports status. Works in concert with circuit breakers.
//
// Each probe includes the provider's real API key so we get genuine
// 200 responses instead of 401s. A probe that returns 401/403 means
// the key is invalid — this is logged as a warning but still treated
// as "alive" (the provider is reachable).
type HealthChecker struct {
	mu sync.RWMutex

	healthMap map[string]*ProviderHealth     // provider name → health
	probes    map[string]ProviderProbeConfig // provider name → probe config
	breakers  map[string]*CircuitBreaker     // provider name → circuit breaker

	httpClient *http.Client
	interval   time.Duration
	stopCh     chan struct{}
	closeOnce  sync.Once // prevents double-close panic on Stop() (R-H2)
}

// NewHealthChecker creates a health checker.
// probes maps provider name → probe configuration (URL + auth info).
func NewHealthChecker(
	probes map[string]ProviderProbeConfig,
	breakers map[string]*CircuitBreaker,
	interval time.Duration,
) *HealthChecker {
	hm := make(map[string]*ProviderHealth, len(probes))
	for name := range probes {
		hm[name] = &ProviderHealth{Healthy: true} // assume healthy at start
	}

	return &HealthChecker{
		healthMap: hm,
		probes:    probes,
		breakers:  breakers,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			// Don't follow redirects — we just want connectivity check
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		interval: interval,
		stopCh:   make(chan struct{}),
	}
}

// Start begins the periodic health checking loop.
func (hc *HealthChecker) Start() {
	slog.Info("health checker started", "interval", hc.interval, "providers", len(hc.probes))
	go hc.loop()
}

// Stop halts the health checker.
// Safe to call multiple times; uses sync.Once to prevent double-close panic (R-H2).
func (hc *HealthChecker) Stop() {
	hc.closeOnce.Do(func() { close(hc.stopCh) })
}

func (hc *HealthChecker) loop() {
	ticker := time.NewTicker(hc.interval)
	defer ticker.Stop()

	// Initial check
	hc.checkAll()

	for {
		select {
		case <-ticker.C:
			hc.checkAll()
		case <-hc.stopCh:
			slog.Info("health checker stopped")
			return
		}
	}
}

func (hc *HealthChecker) checkAll() {
	var wg sync.WaitGroup
	for name, probe := range hc.probes {
		wg.Add(1)
		go func(name string, probe ProviderProbeConfig) {
			defer wg.Done()
			hc.checkProvider(name, probe)
		}(name, probe)
	}
	wg.Wait()
}

func (hc *HealthChecker) checkProvider(name string, probe ProviderProbeConfig) {
	probeURL := healthEndpoint(name, probe.BaseURL)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, nil)
	if err != nil {
		hc.setHealth(name, false, 0, fmt.Sprintf("request error: %v", err))
		return
	}

	// ─── Set provider-specific authentication ─────────────────
	// This is the KEY fix: without auth, providers return 401 which
	// we were accidentally treating as "healthy". Now we send real
	// credentials and get genuine 200 responses.
	apiKey := os.Getenv(probe.APIKeyEnv)
	if apiKey != "" && probe.AuthHeader != "" {
		req.Header.Set(probe.AuthHeader, probe.AuthPrefix+apiKey)
	}
	// Google: use header-based auth instead of URL query parameter to prevent
	// API key leakage in logs, CDN caches, and referrer headers.
	if name == "google" && apiKey != "" {
		req.Header.Set("x-goog-api-key", apiKey)
	}

	start := time.Now()
	resp, err := hc.httpClient.Do(req)
	latency := time.Since(start)

	if err != nil {
		hc.setHealth(name, false, latency, fmt.Sprintf("probe failed: %v", err))
		return
	}
	resp.Body.Close()

	// Interpret the response:
	//   2xx       → healthy (authenticated probe succeeded)
	//   401/403   → alive but auth issue (key invalid/expired)
	//              Log a warning but treat as healthy — the provider is
	//              reachable. We don't want a key rotation to trigger
	//              circuit breakers and cause a cascading outage.
	//   429       → alive, just rate limited (healthy)
	//   3xx       → alive, got redirect response (healthy)
	//   4xx other → alive but unexpected (healthy)
	//   5xx       → unhealthy (server error)
	switch {
	case resp.StatusCode >= 500:
		hc.setHealth(name, false, latency, fmt.Sprintf("server error: %d", resp.StatusCode))
	case resp.StatusCode == 401 || resp.StatusCode == 403:
		// Provider is reachable but our key is bad — still "healthy" from
		// a connectivity standpoint. Log so operators can fix the key.
		slog.Warn("health probe auth failed — provider reachable but API key may be invalid",
			"provider", name,
			"status", resp.StatusCode,
			"api_key_env", probe.APIKeyEnv,
		)
		hc.setHealth(name, true, latency, "")
	default:
		// 2xx, 3xx, 429, other 4xx → provider is reachable
		hc.setHealth(name, true, latency, "")
	}
}

func (hc *HealthChecker) setHealth(name string, healthy bool, latency time.Duration, errMsg string) {
	hc.mu.Lock()
	defer hc.mu.Unlock()

	prev, exists := hc.healthMap[name]
	wasHealthy := !exists || prev.Healthy

	hc.healthMap[name] = &ProviderHealth{
		Healthy:   healthy,
		Latency:   latency,
		LastCheck: time.Now(),
		Error:     errMsg,
	}

	// Log state changes
	if wasHealthy && !healthy {
		slog.Warn("provider became unhealthy",
			"provider", name,
			"error", errMsg,
			"latency", latency,
		)
	} else if !wasHealthy && healthy {
		slog.Info("provider recovered",
			"provider", name,
			"latency", latency,
		)
	}
}

// IsHealthy returns whether a provider is considered healthy.
// Combines health check probe + circuit breaker state.
func (hc *HealthChecker) IsHealthy(name string) bool {
	hc.mu.RLock()
	ph, ok := hc.healthMap[name]
	hc.mu.RUnlock()

	if !ok {
		return false
	}

	// If health probe says down, definitely not healthy
	if !ph.Healthy {
		return false
	}

	// Also check circuit breaker
	if cb, exists := hc.breakers[name]; exists {
		return cb.IsAvailable()
	}

	return true
}

// GetHealth returns a copy of all provider health statuses.
func (hc *HealthChecker) GetHealth() map[string]ProviderHealth {
	hc.mu.RLock()
	defer hc.mu.RUnlock()

	result := make(map[string]ProviderHealth, len(hc.healthMap))
	for k, v := range hc.healthMap {
		result[k] = *v
	}
	return result
}

// healthEndpoint returns a lightweight probe URL per provider.
// These endpoints are chosen to be fast, low-cost, and representative
// of the provider being operational.
func healthEndpoint(provider, baseURL string) string {
	switch provider {
	case "openai":
		// GET /v1/models — returns model list, fast, authenticated
		return baseURL + "/v1/models"
	case "anthropic":
		// Anthropic doesn't have a lightweight GET endpoint.
		// A GET to /v1/messages will return 405 Method Not Allowed,
		// which proves the server is alive and routing correctly.
		return baseURL + "/v1/messages"
	case "google":
		// GET /v1beta/models — returns model list, authenticated via query param
		return baseURL + "/v1beta/models"
	case "mistral":
		// GET /v1/models — same pattern as OpenAI
		return baseURL + "/v1/models"
	case "azure":
		// Azure: GET /openai/models — list available deployments
		return baseURL + "/openai/models?api-version=2024-02-01"
	default:
		return baseURL
	}
}
