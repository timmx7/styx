package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"syscall"
	"time"

	"github.com/styx/router/internal/auth"
	"github.com/styx/router/internal/budget"
	"github.com/styx/router/internal/cache"
	"github.com/styx/router/internal/classifier"
	"github.com/styx/router/internal/config"
	"github.com/styx/router/internal/fallback"
	"github.com/styx/router/internal/metrics"
	"github.com/styx/router/internal/pricing"
	"github.com/styx/router/internal/providers"
	"github.com/styx/router/internal/proxy"
	"github.com/styx/router/internal/ratelimit"
	"github.com/styx/router/internal/router"
)

func main() {
	// Determine config path
	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "config/config.yaml"
	}

	// Validate INTERNAL_SECRET is set (unless SKIP_AUTH mode)
	skipAuth := os.Getenv("SKIP_AUTH") == "true"
	if skipAuth {
		slog.Warn("⚠️  SKIP_AUTH=true — authentication is DISABLED. Do NOT use in production!")
		if os.Getenv("INTERNAL_SECRET") == "" {
			os.Setenv("INTERNAL_SECRET", "dev-skip-auth-secret")
		}
	} else if os.Getenv("INTERNAL_SECRET") == "" {
		slog.Error("FATAL: INTERNAL_SECRET environment variable is required for internal service authentication")
		os.Exit(1)
	}

	// Load configuration
	cfg, err := config.Load(configPath)
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Setup structured logging
	var logLevel slog.Level
	switch cfg.Logging.Level {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	default:
		logLevel = slog.LevelInfo
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	// ─── Initialize circuit breakers ────────────────────────────
	cbMaxFailures := cfg.Fallback.CircuitBreakerMaxFailures
	cbRecovery := time.Duration(cfg.Fallback.CircuitBreakerRecoverySeconds) * time.Second
	circuitBreakers := make(map[string]*fallback.CircuitBreaker)

	// ─── Initialize providers ────────────────────────────────────
	providerMap := make(map[string]providers.Provider)

	for name, provCfg := range cfg.Providers {
		modelNames := make([]string, len(provCfg.Models))
		for i, m := range provCfg.Models {
			modelNames[i] = m.Name
		}

		var prov providers.Provider
		var initErr error

		switch name {
		case "openai":
			prov, initErr = providers.NewOpenAI(provCfg.BaseURL, provCfg.APIKeyEnv, modelNames)
		case "anthropic":
			prov, initErr = providers.NewAnthropic(provCfg.BaseURL, provCfg.APIKeyEnv, modelNames)
		case "google":
			prov, initErr = providers.NewGoogle(provCfg.BaseURL, provCfg.APIKeyEnv, modelNames)
		case "mistral":
			prov, initErr = providers.NewMistral(provCfg.BaseURL, provCfg.APIKeyEnv, modelNames)
		case "azure":
			prov, initErr = providers.NewAzure(provCfg.BaseURL, provCfg.APIKeyEnv, modelNames)
		default:
			slog.Warn("unknown provider, skipping", "name", name)
			continue
		}

		if initErr != nil {
			slog.Warn("failed to initialize provider, skipping",
				"provider", name,
				"error", initErr,
			)
			continue
		}

		// Inject per-model cost configuration from config.yaml
		modelCosts := make(map[string]providers.ModelCostInfo, len(provCfg.Models))
		for _, m := range provCfg.Models {
			modelCosts[m.Name] = providers.ModelCostInfo{
				InputCostPer1K:  m.InputCostPer1K,
				OutputCostPer1K: m.OutputCostPer1K,
			}
		}
		prov.SetModelCosts(modelCosts)

		// Create and attach circuit breaker
		cb := fallback.NewCircuitBreaker(name, cbMaxFailures, cbRecovery)
		prov.SetCircuitBreaker(cb)
		circuitBreakers[name] = cb

		providerMap[name] = prov
		slog.Info("provider initialized",
			"provider", name,
			"models", modelNames,
		)
	}

	if len(providerMap) == 0 {
		if os.Getenv("DEBUG") == "true" || os.Getenv("ENVIRONMENT") == "development" {
			slog.Warn("no providers initialized — running in dev mode without providers (proxy will return 503)")
		} else {
			slog.Error("no providers initialized, at least one is required")
			os.Exit(1)
		}
	}

	// ─── Initialize health checker ──────────────────────────────
	healthProbes := make(map[string]fallback.ProviderProbeConfig, len(providerMap))
	for name := range providerMap {
		provCfg := cfg.Providers[name]
		healthProbes[name] = fallback.ProviderProbeConfig{
			BaseURL:    provCfg.BaseURL,
			AuthHeader: provCfg.AuthHeader,
			AuthPrefix: provCfg.AuthPrefix,
			APIKeyEnv:  provCfg.APIKeyEnv,
		}
	}

	healthInterval := time.Duration(cfg.Fallback.HealthCheckIntervalSeconds) * time.Second
	healthChecker := fallback.NewHealthChecker(healthProbes, circuitBreakers, healthInterval)
	healthChecker.Start()
	defer healthChecker.Stop()

	// ─── Initialize load balancer and rule engine ───────────────
	loadBalancer := router.NewLoadBalancer()
	ruleEngine := router.NewRuleEngine()
	slog.Info("load balancer and rule engine initialized")

	// ─── Initialize smart router ─────────────────────────────────
	smartRouter := router.New(providerMap, cfg.Providers, loadBalancer, ruleEngine)

	// ─── Initialize pricing manager ──────────────────────────────
	pricingPath := os.Getenv("PRICING_PATH")
	if pricingPath == "" {
		pricingPath = "config/model_pricing.json"
	}
	pricingMgr, err := pricing.New(pricingPath)
	if err != nil {
		slog.Warn("pricing manager init failed — costs will be unavailable", "error", err)
	} else {
		smartRouter.SetPricingManager(pricingMgr)
		// Refresh every 24 h; goroutine shuts down when ctx is cancelled.
		pricingMgr.StartRefresher(context.Background(), 24*time.Hour)
		slog.Info("pricing manager started", "path", pricingPath)
	}

	// ─── Initialize classifier client ────────────────────────────
	classifierURL := cfg.Classifier.URL
	classifierClient := classifier.NewClient(classifierURL, cfg.Classifier.TimeoutSeconds)
	slog.Info("classifier client initialized", "url", classifierURL, "timeout_s", cfg.Classifier.TimeoutSeconds)

	// ─── Initialize cache client ─────────────────────────────────
	var cacheClient *cache.Client
	if cfg.Cache.Enabled {
		cacheClient = cache.NewClient(cfg.Cache.URL, cfg.Cache.TimeoutSeconds)
		slog.Info("cache client initialized", "url", cfg.Cache.URL, "timeout_s", cfg.Cache.TimeoutSeconds)
	} else {
		cacheClient = cache.NewClient("") // disabled
		slog.Info("semantic cache disabled")
	}

	// ─── Initialize budget client ────────────────────────────────
	budgetClient := budget.NewClient(cfg.Backend.URL)
	slog.Info("budget client initialized", "backend_url", cfg.Backend.URL)

	// ─── Initialize auth validator ───────────────────────────────
	keyValidator := auth.NewValidator(cfg.Backend.URL)
	if skipAuth {
		keyValidator.SetSkipAuth(true)
	}
	slog.Info("auth validator initialized", "backend_url", cfg.Backend.URL, "skip_auth", skipAuth)

	// ─── Initialize rate limiter ─────────────────────────────────
	rateLimiter := ratelimit.New()
	slog.Info("rate limiter initialized")

	// ─── Initialize metrics ─────────────────────────────────────
	appMetrics := metrics.New()
	slog.Info("prometheus metrics initialized")

	// ─── Create the proxy handler ────────────────────────────────
	handler := proxy.NewHandler(smartRouter, classifierClient, cacheClient, budgetClient, cfg.Backend.URL, cfg.Providers, appMetrics)

	// ─── Setup routes ────────────────────────────────────────────
	mux := http.NewServeMux()

	// Global rate limiter for public endpoints (10 req/s burst)
	publicLimiter := ratelimit.NewPublicLimiter(10)

	// Health check endpoint (no auth required, rate-limited)
	mux.Handle("GET /health", publicLimiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		health := healthChecker.GetHealth()
		provHealth := make(map[string]interface{}, len(health))
		for name, h := range health {
			status := "healthy"
			if !h.Healthy {
				status = "unhealthy"
			}
			cbState := "closed"
			if cb, ok := circuitBreakers[name]; ok {
				cbState = cb.GetState().String()
			}
			provHealth[name] = map[string]interface{}{
				"status":          status,
				"circuit_breaker": cbState,
				"latency_ms":      h.Latency.Milliseconds(),
				"last_check":      h.LastCheck.Format(time.RFC3339),
			}
		}

		response := map[string]interface{}{
			"status":    "ok",
			"providers": provHealth,
		}
		json.NewEncoder(w).Encode(response)
	})))

	// Prometheus metrics endpoint (rate-limited)
	mux.Handle("GET /metrics", publicLimiter.Middleware(appMetrics.Handler()))

	// GET /v1/models — OpenAI-compatible model listing (auth required, rate-limited).
	// Returns all explicitly configured models plus passthrough note.
	// More specific than /v1/ so it takes precedence in Go 1.22+ ServeMux.
	mux.Handle("GET /v1/models", keyValidator.Middleware(publicLimiter.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		type pricingObj struct {
			InputPerMillion  float64 `json:"input_per_million"`
			OutputPerMillion float64 `json:"output_per_million"`
			Currency         string  `json:"currency"`
		}
		type modelObj struct {
			ID        string      `json:"id"`
			Object    string      `json:"object"`
			OwnedBy   string      `json:"owned_by"`
			Provider  string      `json:"provider"`
			Tier      string      `json:"tier,omitempty"`
			Available bool        `json:"available"`
			Pricing   *pricingObj `json:"pricing,omitempty"`
		}

		models := smartRouter.ListModels()

		// Sort deterministically: available first, then by provider, then by id
		sort.Slice(models, func(i, j int) bool {
			if models[i].Available != models[j].Available {
				return models[i].Available // available models first
			}
			if models[i].Provider != models[j].Provider {
				return models[i].Provider < models[j].Provider
			}
			return models[i].ID < models[j].ID
		})

		data := make([]modelObj, len(models))
		for i, m := range models {
			obj := modelObj{
				ID:        m.ID,
				Object:    "model",
				OwnedBy:   m.Provider,
				Provider:  m.Provider,
				Tier:      m.Tier,
				Available: m.Available,
			}
			if m.Pricing != nil {
				obj.Pricing = &pricingObj{
					InputPerMillion:  m.Pricing.InputPerMillion,
					OutputPerMillion: m.Pricing.OutputPerMillion,
					Currency:         m.Pricing.Currency,
				}
			}
			data[i] = obj
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"object":      "list",
			"data":        data,
			"passthrough": "Models with prefixes gpt-*, o1*/o3*/o4*, claude-*, gemini-*, mistral-*/codestral-* are auto-routed even if not listed here.",
		})
	}))))

	// Proxy all /v1/ routes — auth → rate limit → proxy handler
	mux.Handle("/v1/", keyValidator.Middleware(rateLimiter.Middleware(handler)))

	// Configure server
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	server := &http.Server{
		Addr:         addr,
		Handler:      proxy.CORSMiddleware(proxy.SecurityMiddleware(mux)),
		ReadTimeout:  cfg.Server.ReadTimeout(),
		WriteTimeout: cfg.Server.WriteTimeout(),
	}

	slog.Info("Styx router starting",
		"port", cfg.Server.Port,
		"backend", cfg.Backend.URL,
		"classifier", classifierURL,
		"cache", cfg.Cache.URL,
		"cache_enabled", cfg.Cache.Enabled,
		"providers", len(providerMap),
	)

	// ─── Graceful shutdown ──────────────────────────────────────
	// Start the server in a goroutine so we can listen for signals
	errCh := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	// Listen for SIGINT (Ctrl+C) or SIGTERM (docker stop, k8s)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		slog.Info("shutting down gracefully...", "signal", sig.String())
	case err := <-errCh:
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}

	// Give in-flight requests up to 30 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("forced shutdown", "error", err)
		os.Exit(1)
	}

	// Stop background goroutines
	loadBalancer.Stop()
	keyValidator.Stop()

	// Drain background goroutines (cache stores, usage logs)
	slog.Info("waiting for background tasks to complete...")
	handler.Shutdown(10 * time.Second)

	slog.Info("server stopped")
}
