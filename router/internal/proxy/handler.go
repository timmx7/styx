package proxy

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	mrand "math/rand"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/styx/router/internal/auth"
	"github.com/styx/router/internal/budget"
	"github.com/styx/router/internal/cache"
	"github.com/styx/router/internal/classifier"
	"github.com/styx/router/internal/config"
	"github.com/styx/router/internal/metrics"
	"github.com/styx/router/internal/providers"
	"github.com/styx/router/internal/router"
)

// validModelName validates that a model name only contains safe characters.
// This prevents injection via the model field (used in logs, headers, and provider URLs).
// Note: "/" is allowed for model families (e.g. "google/gemini-pro") but ".." sequences
// are explicitly blocked below to prevent path traversal attacks.
var validModelName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$`)

// validRequestID validates that a client-supplied X-Request-ID contains only
// alphanumeric characters and hyphens, with a maximum length of 64 characters.
// This prevents log injection attacks via crafted request IDs.
var validRequestID = regexp.MustCompile(`^[a-zA-Z0-9-]{1,64}$`)

// piiEmailRegex matches email addresses for PII redaction.
// Compiled at package level to avoid recompilation on every request (R-C1).
var piiEmailRegex = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)

// piiPhoneRegex matches phone numbers for PII redaction.
// Compiled at package level to avoid recompilation on every request (R-C1).
var piiPhoneRegex = regexp.MustCompile(`(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}`)

// piiCardRegex matches credit card numbers for PII redaction.
// Compiled at package level to avoid recompilation on every request (R-C1).
var piiCardRegex = regexp.MustCompile(`\b(?:\d[ -]*?){13,16}\b`)

// allowedPaths is the set of URL paths accepted by the proxy.
// Allocated once at package level to avoid per-request map allocation (R-H6).
var allowedPaths = map[string]bool{
	"/v1/chat/completions": true,
	"/v1/completions":      true,
	"/v1/embeddings":       true,
	"/v1/models":           true,
	"/v1/messages":         true, // Anthropic native path
}

// maxResponseSize is the upper bound for accumulated streaming response data (50 MB).
// Prevents unbounded memory growth from extremely long streaming responses (R-H5).
const maxResponseSize = 50 * 1024 * 1024

// generateRequestID creates a UUID v4 string without external dependencies.
func generateRequestID() string {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		// Fallback to timestamp-based ID if crypto/rand fails
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// Handler is the main HTTP handler that receives client requests,
// checks the semantic cache, classifies them, routes to the best provider,
// stores the response in cache, and logs usage.
type Handler struct {
	router         *router.SmartRouter
	classifier     *classifier.Client
	cache          *cache.Client
	budget         *budget.Client
	metrics        *metrics.Metrics
	backendURL     string
	internalSecret string
	logClient      *http.Client
	modelCosts     map[string]config.ModelConfig // model name → cost config

	// backgroundWg tracks all fire-and-forget goroutines (cache store, log usage)
	// so they can be drained on graceful shutdown.
	backgroundWg sync.WaitGroup

	// backgroundSem limits concurrent background goroutines to prevent
	// unbounded growth if cache/logging services are slow.
	backgroundSem chan struct{}
}

// NewHandler creates a new proxy handler with smart routing, caching, and budget checks.
func NewHandler(r *router.SmartRouter, cl *classifier.Client, cc *cache.Client, bc *budget.Client, backendURL string, providerConfigs map[string]config.ProviderConfig, appMetrics *metrics.Metrics) *Handler {
	// Build a flat lookup of model → cost info
	costs := make(map[string]config.ModelConfig)
	for _, prov := range providerConfigs {
		for _, m := range prov.Models {
			costs[m.Name] = m
		}
	}

	return &Handler{
		router:         r,
		classifier:     cl,
		cache:          cc,
		budget:         bc,
		metrics:        appMetrics,
		backendURL:     strings.TrimRight(backendURL, "/"),
		internalSecret: os.Getenv("INTERNAL_SECRET"),
		logClient:      &http.Client{Timeout: 5 * time.Second},
		modelCosts:     costs,
		backgroundSem:  make(chan struct{}, 256), // max 256 concurrent background tasks
	}
}

// Shutdown waits for all background goroutines to complete.
// Call this during graceful shutdown to ensure cache stores and usage
// logs are flushed before the process exits.
func (h *Handler) Shutdown(timeout time.Duration) {
	done := make(chan struct{})
	go func() {
		h.backgroundWg.Wait()
		close(done)
	}()
	select {
	case <-done:
		slog.Info("all background tasks completed")
	case <-time.After(timeout):
		slog.Warn("background tasks did not complete within timeout", "timeout", timeout)
	}
}

// runBackground executes fn in a bounded goroutine pool.
// It tracks the goroutine with backgroundWg and limits concurrency
// with backgroundSem to prevent unbounded goroutine growth.
func (h *Handler) runBackground(name string, fn func()) {
	h.backgroundWg.Add(1)
	select {
	case h.backgroundSem <- struct{}{}:
		go func() {
			defer h.backgroundWg.Done()
			defer func() { <-h.backgroundSem }()
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic in background task", "task", name, "error", r)
				}
			}()
			fn()
		}()
	default:
		// Semaphore full — all 256 slots busy. Drop this task rather than
		// blocking the request goroutine or growing unbounded.
		h.backgroundWg.Done()
		slog.Warn("background task dropped, pool full", "task", name)
	}
}

// requestBody is used to extract fields from the incoming JSON body.
type requestBody struct {
	Model     string `json:"model"`
	Stream    bool   `json:"stream"`
	MaxTokens int    `json:"max_tokens,omitempty"`
}

// estimateRequestCost estimates the cost in cents for an incoming request
// BEFORE it is forwarded to a provider. This is used to pre-check budget.
//
// Estimation strategy:
//   - Input tokens ≈ body length / 4 (rough chars-to-tokens ratio)
//   - Output tokens = max_tokens if specified, else default per complexity
//   - Cost = (input * inputCostPer1K + output * outputCostPer1K) / 1000
//
// Returns 0 if the model is unknown (fail-open: don't block unknown models).
func (h *Handler) estimateRequestCost(model string, bodyLen int, maxTokens int, complexity string) int {
	mc, ok := h.modelCosts[model]
	if !ok {
		return 0 // unknown model — don't block
	}

	// Estimate input tokens from request body size
	inputTokens := bodyLen / 4
	if inputTokens < 10 {
		inputTokens = 10
	}

	// Estimate output tokens from max_tokens or complexity
	outputTokens := maxTokens
	if outputTokens <= 0 {
		switch complexity {
		case "complex":
			outputTokens = 4000
		case "medium":
			outputTokens = 1500
		default: // "simple" or unknown
			outputTokens = 500
		}
	}

	inputCost := float64(inputTokens) / 1000.0 * mc.InputCostPer1K
	outputCost := float64(outputTokens) / 1000.0 * mc.OutputCostPer1K
	totalCents := inputCost + outputCost
	return int(math.Ceil(totalCents))
}

// ─── Multi-provider token usage parsing ────────────────────────────
//
// Each AI provider returns token counts in a different JSON shape:
//
//   OpenAI / Mistral / Azure:
//     {"usage": {"prompt_tokens": X, "completion_tokens": Y}}
//
//   Anthropic:
//     {"usage": {"input_tokens": X, "output_tokens": Y}}
//
//   Google Gemini:
//     {"usageMetadata": {"promptTokenCount": X, "candidatesTokenCount": Y}}

// openAIUsage handles OpenAI, Mistral, and Azure responses.
type openAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

// anthropicUsage handles Anthropic Claude responses.
type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// geminiUsageMetadata handles Google Gemini responses.
type geminiUsageMetadata struct {
	PromptTokenCount     int `json:"promptTokenCount"`
	CandidatesTokenCount int `json:"candidatesTokenCount"`
	TotalTokenCount      int `json:"totalTokenCount"`
}

// multiProviderResponse is a union struct that captures usage data from
// any supported provider.  JSON unmarshalling fills whichever fields
// match the response shape; all others remain zero-valued.
type multiProviderResponse struct {
	// OpenAI / Mistral / Azure
	Usage struct {
		openAIUsage
		anthropicUsage
	} `json:"usage"`

	// Google Gemini
	UsageMetadata geminiUsageMetadata `json:"usageMetadata"`
}

// errorResponse is the standard error format returned to clients.
type errorResponse struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Code    int    `json:"code"`
}

func writeError(w http.ResponseWriter, code int, errType, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(errorResponse{
		Error: errorDetail{
			Type:    errType,
			Message: message,
			Code:    code,
		},
	})
}

// computeCostCents calculates the real cost in cents based on token counts and model pricing.
func (h *Handler) computeCostCents(model string, inputTokens, outputTokens int) int {
	mc, ok := h.modelCosts[model]
	if !ok {
		return 0
	}
	// Costs are per 1K tokens, prices in cents of a dollar
	inputCost := float64(inputTokens) / 1000.0 * mc.InputCostPer1K
	outputCost := float64(outputTokens) / 1000.0 * mc.OutputCostPer1K
	totalCents := inputCost + outputCost
	return int(math.Ceil(totalCents))
}

// parseUsage extracts (inputTokens, outputTokens) from a provider response body.
//
// The provider name is used to select the extraction strategy:
//
//   - "openai", "mistral", "azure": usage.prompt_tokens / completion_tokens
//   - "anthropic":                  usage.input_tokens / output_tokens
//   - "google":                     usageMetadata.promptTokenCount / candidatesTokenCount
//
// If the provider-specific fields are zero, the function falls back to
// trying the other formats.  This handles edge cases like a future
// provider adopting the OpenAI format, or unexpected response shapes.
//
// Returns (0, 0) on parse error — never panics.
func parseUsage(body []byte, provider string) (int, int) {
	var parsed multiProviderResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return 0, 0
	}

	switch provider {
	case "anthropic":
		// Primary: Anthropic's native field names
		if parsed.Usage.InputTokens > 0 || parsed.Usage.OutputTokens > 0 {
			return parsed.Usage.InputTokens, parsed.Usage.OutputTokens
		}
		// Fallback to OpenAI-compatible fields (some Anthropic wrappers emit them)
		return parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens

	case "google":
		// Primary: Gemini's usageMetadata
		if parsed.UsageMetadata.PromptTokenCount > 0 || parsed.UsageMetadata.CandidatesTokenCount > 0 {
			return parsed.UsageMetadata.PromptTokenCount, parsed.UsageMetadata.CandidatesTokenCount
		}
		// Fallback to OpenAI-compatible fields
		return parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens

	default:
		// OpenAI, Mistral, Azure, and any unknown provider
		if parsed.Usage.PromptTokens > 0 || parsed.Usage.CompletionTokens > 0 {
			return parsed.Usage.PromptTokens, parsed.Usage.CompletionTokens
		}
		// Fallback to Anthropic field names (some proxies unify on these)
		if parsed.Usage.InputTokens > 0 || parsed.Usage.OutputTokens > 0 {
			return parsed.Usage.InputTokens, parsed.Usage.OutputTokens
		}
		return 0, 0
	}
}

// ServeHTTP handles incoming proxy requests.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// ─── Correlation ID ──────────────────────────────────────────
	// Validate X-Request-ID: only allow alphanumeric + hyphens, max 64 chars.
	// This prevents log injection via crafted request IDs (R-C2).
	requestID := r.Header.Get("X-Request-ID")
	if requestID == "" || !validRequestID.MatchString(requestID) {
		requestID = generateRequestID()
	}
	w.Header().Set("X-Request-ID", requestID)

	// Only allow POST for completions endpoints
	if r.Method != http.MethodPost {
		if r.Method == http.MethodGet && r.URL.Path == "/v1/models" {
			// Allow model listing — handle separately or proxy through
			// For now, return a basic model list response
			writeError(w, http.StatusNotImplemented, "not_implemented", "Model listing not yet implemented")
			return
		}
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Only POST is allowed")
		return
	}

	// Validate path
	if !isAllowedPath(r.URL.Path) {
		writeError(w, http.StatusNotFound, "not_found", "Endpoint not found")
		return
	}

	// Limit request body size to 10 MB to prevent abuse.
	// http.MaxBytesReader handles both Content-Length and chunked encoding —
	// it counts bytes as they are read regardless of transfer encoding.
	const maxBodySize = 10 * 1024 * 1024 // 10 MB
	r.Body = http.MaxBytesReader(w, r.Body, maxBodySize)
	defer r.Body.Close()

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		// MaxBytesReader returns a *http.MaxBytesError when the limit is exceeded
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "request_too_large",
				fmt.Sprintf("Request body exceeds maximum allowed size of %d bytes", maxBodySize))
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_request", "Failed to read request body")
		return
	}

	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "Request body is empty")
		return
	}

	// Parse model and stream from body
	var reqBody requestBody
	if err := json.Unmarshal(body, &reqBody); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON in request body")
		return
	}

	if reqBody.Stream {
		var fullReq map[string]interface{}
		if err := json.Unmarshal(body, &fullReq); err == nil {
			if _, exists := fullReq["stream_options"]; !exists {
				fullReq["stream_options"] = map[string]interface{}{
					"include_usage": true,
				}
				if newBody, err := json.Marshal(fullReq); err == nil {
					body = newBody
				}
			}
		}
	}

	if reqBody.Model == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "Missing 'model' field in request body")
		return
	}

	// Validate model name format to prevent injection via logs, headers, and provider URLs.
	// Block path traversal sequences ("..") that could manipulate provider URLs.
	if !validModelName.MatchString(reqBody.Model) || strings.Contains(reqBody.Model, "..") {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid model name format")
		return
	}

	// Get key info from context (set by auth middleware)
	keyInfo := auth.GetKeyInfo(r.Context())
	projectID := ""
	if keyInfo != nil {
		projectID = keyInfo.ProjectID
	}
	endUserID := r.Header.Get("X-End-User-Id")
	if endUserID != "" && !validRequestID.MatchString(endUserID) {
		endUserID = ""
	}

	// ─── styx:auto Intelligent Routing ───────────────────────────────────────
	// Detect virtual styx:* model names and resolve to a real provider+model
	// before any caching or forwarding. Runs entirely in-process.
	var autoRouteOriginal string
	var autoRouteTier string
	var autoRouteScore int
	if forcedTier, ok := IsAutoModel(reqBody.Model); ok {
		autoRouteOriginal = reqBody.Model
		tier := forcedTier
		if tier == "" { // styx:auto → score request complexity
			autoRouteScore, tier = ScoreRequest(body)
		}
		autoRouteTier = tier

		var allowedProviders []string
		if keyInfo != nil {
			allowedProviders = keyInfo.AllowedProviders
		}
		_, realModel, pickErr := h.router.PickTier(tier, allowedProviders, nil)
		if pickErr != nil {
			slog.Warn("styx:auto tier pick failed",
				"request_id", requestID,
				"virtual_model", autoRouteOriginal,
				"tier", tier,
				"error", pickErr,
			)
			writeError(w, http.StatusServiceUnavailable, "provider_not_configured",
				fmt.Sprintf("No healthy provider available for tier %q (virtual model %q)", tier, autoRouteOriginal))
			return
		}

		body = rewriteModel(body, realModel)
		reqBody.Model = realModel

		slog.Info("styx:auto resolved",
			"request_id", requestID,
			"virtual_model", autoRouteOriginal,
			"resolved_model", realModel,
			"tier", tier,
			"score", autoRouteScore,
		)
	}

	// Extract prompt text for classifier and cache
	promptText := extractPrompt(body)
	hasSystemPrompt := strings.Contains(string(body), `"role":"system"`) ||
		strings.Contains(string(body), `"role": "system"`)

	// ─── Semantic Cache Check ──────────────────────────────────
	// Only check cache for non-streaming requests (can't cache streams) and if project enabled it
	if !reqBody.Stream && h.cache.Enabled() && keyInfo != nil && keyInfo.SemanticCacheEnabled && promptText != "" {
		cacheResult, _ := h.cache.Check(r.Context(), promptText, projectID, reqBody.Model, requestID)
		if cacheResult != nil && cacheResult.Hit && cacheResult.Response != nil {
			// Cache HIT — return cached response immediately
			totalLatency := time.Since(start).Milliseconds()

			slog.Info("cache hit, returning cached response",
				"request_id", requestID,
				"similarity", cacheResult.SimilarityScore,
				"latency_ms", totalLatency,
				"project_id", projectID,
			)

			h.metrics.RecordCacheHit()

			cachedJSON, err := cache.CachedResponseToJSON(cacheResult.Response)
			if err == nil {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-Styx-Cache", "HIT")
				w.Header().Set("X-Styx-Cache-Score", fmt.Sprintf("%.4f", cacheResult.SimilarityScore))
				w.Header().Set("X-Styx-Latency-Ms", fmt.Sprintf("%d", totalLatency))
				w.WriteHeader(http.StatusOK)
				w.Write(cachedJSON)

				// Log as cache hit
				h.runBackground("log-cache-hit", func() {
					h.logUsage(requestID, projectID, "cache", reqBody.Model, "cached", int(totalLatency), 200, true, false, 0, 0, 0, endUserID, "", "")
				})
				return
			}
			// If marshal fails, fall through to normal flow
			slog.Warn("failed to serialize cached response, falling through", "request_id", requestID, "error", err)
		}
	}

	// Record cache miss if cache is enabled and we got here.
	// Only count it for non-streaming requests, since streaming requests
	// skip the cache check entirely (no cache lookup was performed).
	if !reqBody.Stream && h.cache.Enabled() && keyInfo != nil && keyInfo.SemanticCacheEnabled {
		h.metrics.RecordCacheMiss()
	}

	// ─── Budget Check ─────────────────────────────────────────
	// TOCTOU NOTE: There is an inherent race between checking the budget here
	// and the request actually incurring cost at the provider. Two concurrent
	// requests could both pass the budget check and together exceed the budget.
	// This is acceptable because:
	//   1. The backend's Redis Lua script (INCRBY + compare) performs the
	//      actual spend recording atomically, so the real spend counter is
	//      always accurate.
	//   2. The pre-flight estimate here is a best-effort guard, not a hard
	//      guarantee. Over-budget by one request is tolerable.
	//   3. Making this fully atomic would require holding a distributed lock
	//      across the entire provider round-trip, adding unacceptable latency
	//      to the critical path.
	if projectID != "" {
		budgetResult, _ := h.budget.Check(r.Context(), projectID, requestID)
		if budgetResult != nil && !budgetResult.Allowed {
			slog.Warn("budget exceeded, blocking request",
				"request_id", requestID,
				"project_id", projectID,
				"spent_cents", budgetResult.SpentCents,
				"pct_used", budgetResult.PctUsed,
			)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": map[string]interface{}{
					"type":    "budget_exceeded",
					"message": fmt.Sprintf("Monthly budget exceeded (%.0f%% used)", budgetResult.PctUsed),
					"code":    429,
					"metadata": map[string]interface{}{
						"budget_cents": budgetResult.BudgetCents,
						"spent_cents":  budgetResult.SpentCents,
						"project_id":   projectID,
					},
				},
			})
			return
		}

		// ─── Pre-flight cost estimation ───────────────────────
		// Even if the budget check passed, estimate the cost of THIS request
		// and block if it would push spending over the budget.
		if budgetResult != nil && budgetResult.BudgetCents != nil && *budgetResult.BudgetCents > 0 {
			estimatedCost := h.estimateRequestCost(reqBody.Model, len(body), reqBody.MaxTokens, "")
			budgetVal := *budgetResult.BudgetCents
			remaining := budgetVal - budgetResult.SpentCents
			if remaining < 0 {
				remaining = 0
			}
			if estimatedCost > 0 && budgetResult.SpentCents+estimatedCost > budgetVal {
				slog.Warn("estimated cost would exceed budget, blocking request",
					"request_id", requestID,
					"project_id", projectID,
					"estimated_cost_cents", estimatedCost,
					"spent_cents", budgetResult.SpentCents,
					"budget_cents", budgetVal,
				)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": map[string]interface{}{
						"type":    "budget_would_exceed",
						"message": fmt.Sprintf("Estimated request cost (%d cents) would exceed remaining budget (%d cents)", estimatedCost, remaining),
						"code":    429,
						"metadata": map[string]interface{}{
							"estimated_cost_cents": estimatedCost,
							"budget_cents":         budgetVal,
							"spent_cents":          budgetResult.SpentCents,
							"remaining_cents":      remaining,
							"project_id":           projectID,
						},
					},
				})
				return
			}
		}
	}

	// ─── Billing quota / balance pre-check ─────────────────────
	// Charon (BYOK): hard quota on request count per billing period.
	// Achilles (Managed): prepaid credit balance must be positive.
	// Legacy users (nil billing_mode) skip this check entirely.
	if keyInfo != nil && keyInfo.BillingMode != nil {
		switch *keyInfo.BillingMode {
		case "charon":
			if keyInfo.RequestsUsed != nil && keyInfo.RequestsLimit != nil && *keyInfo.RequestsLimit > 0 {
				if *keyInfo.RequestsUsed >= *keyInfo.RequestsLimit {
					slog.Warn("charon quota exceeded",
						"request_id", requestID,
						"user_id", ptrStr(keyInfo.OwnerUserID),
						"requests_used", *keyInfo.RequestsUsed,
						"requests_limit", *keyInfo.RequestsLimit,
					)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusTooManyRequests)
					json.NewEncoder(w).Encode(map[string]interface{}{
						"error": map[string]interface{}{
							"type":    "quota_exceeded",
							"message": fmt.Sprintf("Monthly request quota exceeded (%d/%d). Upgrade your plan for more requests.", *keyInfo.RequestsUsed, *keyInfo.RequestsLimit),
							"code":    429,
						},
					})
					return
				}
			}
		case "achilles":
			if keyInfo.BalanceCents != nil && *keyInfo.BalanceCents <= 0 {
				slog.Warn("achilles insufficient credits",
					"request_id", requestID,
					"user_id", ptrStr(keyInfo.OwnerUserID),
					"balance_cents", *keyInfo.BalanceCents,
				)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusPaymentRequired)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": map[string]interface{}{
						"type":    "insufficient_credits",
						"message": "Insufficient credit balance. Please purchase more credits to continue.",
						"code":    402,
					},
				})
				return
			}
		}
	}

	// ─── Classify request complexity ───────────────────────────
	var complexity string
	classifyResult, err := h.classifier.Classify(r.Context(), promptText, reqBody.MaxTokens, hasSystemPrompt)
	if err != nil {
		slog.Warn("classification failed, defaulting to simple", "request_id", requestID, "error", err)
		complexity = "simple"
	} else {
		complexity = classifyResult.Complexity
	}

	// Build the proxy request.
	// Clean Styx-specific headers, hop-by-hop headers, and the client's
	// Authorization header so they are not forwarded to upstream providers.
	// Each provider adapter sets its own auth credentials.
	cleanedHeaders := CleanStyxHeaders(r.Header)

	// Inject BYOK provider keys if the project has them.
	// These are decrypted by the backend and passed through KeyInfo.
	var providerKeys map[string]string
	var systemPrompt *string
	var piiRedactionEnabled bool
	var guardrailsConfig *auth.GuardrailsConfig
	if keyInfo != nil {
		if len(keyInfo.ProviderKeys) > 0 {
			providerKeys = keyInfo.ProviderKeys
		}
		systemPrompt = keyInfo.SystemPrompt
		piiRedactionEnabled = keyInfo.PIIRedactionEnabled
		guardrailsConfig = keyInfo.GuardrailsConfig
	}

	var experimentID, variantID string
	if keyInfo != nil && keyInfo.ActiveABTest != nil && len(keyInfo.ActiveABTest.Variants) > 0 {
		experimentID = keyInfo.ActiveABTest.ID
		totalWeight := 0
		for _, v := range keyInfo.ActiveABTest.Variants {
			totalWeight += v.Weight
		}
		if totalWeight <= 0 {
			totalWeight = 1
		}
		rVal := mrand.Intn(totalWeight)
		sum := 0
		for _, v := range keyInfo.ActiveABTest.Variants {
			sum += v.Weight
			if rVal < sum {
				// Variant selected
				variantID = v.ID
				reqBody.Model = v.Model
				if v.SystemPrompt != nil && *v.SystemPrompt != "" {
					systemPrompt = v.SystemPrompt
				}

				// Force the router to use this variation's provider
				// We'll apply this to the routingRule below
				break
			}
		}
		if variantID == "" {
			// Fallback if weights are misconfigured
			v := keyInfo.ActiveABTest.Variants[0]
			variantID = v.ID
			reqBody.Model = v.Model
			if v.SystemPrompt != nil && *v.SystemPrompt != "" {
				systemPrompt = v.SystemPrompt
			}
		}

		slog.Debug("ab test routing active",
			"experiment_id", experimentID,
			"variant_id", variantID,
			"model", reqBody.Model,
		)
	}

	proxyReq := &providers.ProxyRequest{
		Method:              r.Method,
		Path:                r.URL.Path,
		Headers:             cleanedHeaders,
		Body:                body,
		Model:               reqBody.Model,
		Stream:              reqBody.Stream,
		ProjectID:           projectID,
		Complexity:          complexity,
		ProviderKeys:        providerKeys,
		SystemPrompt:        systemPrompt,
		PIIRedactionEnabled: piiRedactionEnabled,
		Guardrails:          guardrailsConfig,
	}

	// ─── Apply PII Redaction if Enabled ──────────────────────────
	if piiRedactionEnabled && len(proxyReq.Body) > 0 {
		beforeLen := len(proxyReq.Body)
		bodyStr := string(proxyReq.Body)

		// Use package-level compiled regexes for PII redaction (R-C1).
		// In a real enterprise app, this would use a more sophisticated NLP scanner
		// or a dedicated package like Presidio, but regex is fast enough for MVP.
		bodyStr = piiEmailRegex.ReplaceAllString(bodyStr, "<EMAIL>")
		bodyStr = piiPhoneRegex.ReplaceAllString(bodyStr, "<PHONE>")
		bodyStr = piiCardRegex.ReplaceAllString(bodyStr, "<CREDIT_CARD>")

		proxyReq.Body = []byte(bodyStr)

		slog.Debug("pii redaction applied",
			"project_id", projectID,
			"original_len", beforeLen,
			"redacted_len", len(proxyReq.Body),
		)
	}

	// ─── Apply Guardrails (Pre-Generation) ───────────────────────
	if guardrailsConfig != nil {
		bodyStr := string(proxyReq.Body)
		// Check for forbidden words in the user's prompt
		if len(guardrailsConfig.ForbiddenWords) > 0 {
			lowerBody := strings.ToLower(bodyStr)
			for _, word := range guardrailsConfig.ForbiddenWords {
				if strings.Contains(lowerBody, strings.ToLower(word)) {
					// Log the specific word for internal debugging but do NOT expose it to the client (R-H4).
					slog.Warn("guardrail blocked request containing forbidden word",
						"request_id", requestID,
						"project_id", projectID,
						"word", word,
					)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]interface{}{
						"error": map[string]interface{}{
							"type":    "guardrail_violation",
							"message": "Request blocked by content policy",
							"code":    400,
						},
					})
					return
				}
			}
		}

		// Toxicity check
		if guardrailsConfig.ToxicityThreshold > 0 && classifyResult != nil {
			if classifyResult.Toxicity >= guardrailsConfig.ToxicityThreshold {
				// Log specific values for internal debugging but do NOT expose thresholds to the client (R-H4).
				slog.Warn("guardrail blocked request due to high toxicity",
					"request_id", requestID,
					"project_id", projectID,
					"toxicity", classifyResult.Toxicity,
					"threshold", guardrailsConfig.ToxicityThreshold,
				)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": map[string]interface{}{
						"type":    "guardrail_violation",
						"message": "Request blocked by content policy",
						"code":    400,
					},
				})
				return
			}
		}
	}

	slog.Info("incoming request",
		"request_id", requestID,
		"method", r.Method,
		"path", r.URL.Path,
		"model", reqBody.Model,
		"stream", reqBody.Stream,
		"complexity", complexity,
		"project_id", projectID,
	)

	// ─── Build routing rule from project settings ───────────────
	var routingRule *router.RoutingRule
	if keyInfo != nil && (len(keyInfo.AllowedProviders) > 0 || keyInfo.RoutingStrategy != "") {
		routingRule = &router.RoutingRule{
			AllowedProviders: keyInfo.AllowedProviders,
		}
		// Map routing_strategy to preferred tier or forced provider
		switch keyInfo.RoutingStrategy {
		case "cheapest":
			routingRule.PreferredTier = "light"
		case "best":
			routingRule.PreferredTier = "heavy"
		case "balanced":
			routingRule.PreferredTier = "medium"
		}
		// If only one provider is allowed, treat it as forced (for compliance)
		if len(keyInfo.AllowedProviders) == 1 {
			routingRule.ForcedProvider = keyInfo.AllowedProviders[0]
		}

		slog.Debug("routing rule built from project settings",
			"allowed_providers", keyInfo.AllowedProviders,
			"routing_strategy", keyInfo.RoutingStrategy,
			"preferred_tier", routingRule.PreferredTier,
			"forced_provider", routingRule.ForcedProvider,
		)
	}

	if variantID != "" && keyInfo.ActiveABTest != nil {
		if routingRule == nil {
			routingRule = &router.RoutingRule{}
		}
		// Find the selected variant to get its provider
		for _, v := range keyInfo.ActiveABTest.Variants {
			if v.ID == variantID {
				routingRule.ForcedProvider = v.Provider
				break
			}
		}
	}

	// Force anthropic for native Anthropic endpoints
	if r.URL.Path == "/v1/messages" {
		if routingRule == nil {
			routingRule = &router.RoutingRule{}
		}
		routingRule.ForcedProvider = "anthropic"
	}

	// ─── Forward via smart router ──────────────────────────────
	proxyResp, err := h.router.Forward(r.Context(), proxyReq, routingRule)
	if err != nil {
		errMsg := err.Error()
		// Distinguish "provider not configured" from "all providers down"
		if strings.Contains(errMsg, "is not configured") {
			slog.Warn("requested provider not configured",
				"request_id", requestID,
				"error", err,
			)
			writeError(w, http.StatusServiceUnavailable, "provider_not_configured", errMsg)
			return
		}
		slog.Error("all providers failed",
			"request_id", requestID,
			"error", err,
			"latency_ms", time.Since(start).Milliseconds(),
		)
		h.metrics.RecordProviderError("all", "all_failed")
		writeError(w, http.StatusBadGateway, "provider_error", "Failed to get response from any provider")
		return
	}
	defer proxyResp.Body.Close()

	// Add custom headers
	w.Header().Set("X-Styx-Provider", proxyResp.Provider)
	w.Header().Set("X-Styx-Model", proxyResp.Model)
	w.Header().Set("X-Styx-Complexity", complexity)
	w.Header().Set("X-Styx-Latency-Ms", fmt.Sprintf("%d", proxyResp.LatencyMs))
	w.Header().Set("X-Styx-Cache", "MISS")
	if autoRouteTier != "" {
		w.Header().Set("X-Styx-Auto-Original", autoRouteOriginal)
		w.Header().Set("X-Styx-Auto-Tier", autoRouteTier)
		w.Header().Set("X-Styx-Auto-Score", fmt.Sprintf("%d", autoRouteScore))
	}

	// Copy response headers to client, filtering sensitive provider headers
	copyHeaders(w.Header(), proxyResp.Headers)

	var inputTokens, outputTokens, costCents int
	if reqBody.Stream {
		// Streaming: pipe to client while extracting token usage from SSE chunks
		streamUsage := streamResponse(r.Context(), w, proxyResp, r.URL.Path)
		inputTokens = streamUsage.InputTokens
		outputTokens = streamUsage.OutputTokens
		costCents = h.computeCostCents(proxyResp.Model, inputTokens, outputTokens)

		if inputTokens > 0 || outputTokens > 0 {
			slog.Debug("streaming token usage extracted",
				"request_id", requestID,
				"input_tokens", inputTokens,
				"output_tokens", outputTokens,
				"cost_cents", costCents,
				"model", proxyResp.Model,
			)
		}
	} else {
		// Non-streaming: read body (limited to 100 MB to prevent OOM), then cache + parse tokens
		const maxRespSize = 100 * 1024 * 1024 // 100 MB
		respBody, readErr := io.ReadAll(io.LimitReader(proxyResp.Body, maxRespSize))
		if readErr != nil {
			// Drain remaining body to allow HTTP connection reuse (prevents pool starvation)
			io.Copy(io.Discard, proxyResp.Body)
			slog.Error("failed to read provider response", "request_id", requestID, "error", readErr)
			writeError(w, http.StatusBadGateway, "provider_error", "Failed to read provider response")
			return
		}

		// ─── Apply Guardrails (Post-Generation) ──────────────────────
		// Only apply post-generation guardrails to successful, non-streamed responses
		if proxyResp.StatusCode == http.StatusOK && guardrailsConfig != nil {
			if guardrailsConfig.JSONStrict || len(guardrailsConfig.RequiredFields) > 0 {
				content := extractResponseContent(respBody)
				if content != "" {
					var parsedJSON map[string]interface{}
					err := json.Unmarshal([]byte(content), &parsedJSON)

					if guardrailsConfig.JSONStrict && err != nil {
						slog.Warn("guardrail blocked response: invalid JSON",
							"request_id", requestID,
							"project_id", projectID,
						)
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusBadRequest)
						json.NewEncoder(w).Encode(map[string]interface{}{
							"error": map[string]interface{}{
								"type":    "guardrail_violation",
								"message": "Response blocked by guardrails: output is not valid JSON",
								"code":    400,
							},
						})
						return
					}

					if err == nil && len(guardrailsConfig.RequiredFields) > 0 {
						for _, field := range guardrailsConfig.RequiredFields {
							if _, exists := parsedJSON[field]; !exists {
								slog.Warn("guardrail blocked response: missing required JSON field",
									"request_id", requestID,
									"project_id", projectID,
									"field", field,
								)
								w.Header().Set("Content-Type", "application/json")
								w.WriteHeader(http.StatusBadRequest)
								json.NewEncoder(w).Encode(map[string]interface{}{
									"error": map[string]interface{}{
										"type":    "guardrail_violation",
										"message": fmt.Sprintf("Response blocked by guardrails: missing required JSON field '%s'", field),
										"code":    400,
									},
								})
								return
							}
						}
					}
				}
			}
		}

		w.WriteHeader(proxyResp.StatusCode)
		w.Write(respBody)

		uncompressedBody := respBody
		if proxyResp.Headers.Get("Content-Encoding") == "gzip" {
			if gz, err := gzip.NewReader(bytes.NewReader(respBody)); err == nil {
				if decompressed, err2 := io.ReadAll(gz); err2 == nil {
					uncompressedBody = decompressed
				}
				gz.Close()
			}
		}

		// ─── Parse token usage from response ────────────────
		if proxyResp.StatusCode == http.StatusOK {
			inputTokens, outputTokens = parseUsage(uncompressedBody, proxyResp.Provider)
			costCents = h.computeCostCents(proxyResp.Model, inputTokens, outputTokens)

			slog.Debug("token usage parsed",
				"request_id", requestID,
				"input_tokens", inputTokens,
				"output_tokens", outputTokens,
				"cost_cents", costCents,
				"model", proxyResp.Model,
			)
		}

		// ─── Cache Store (fire-and-forget) ─────────────────────
		// Only cache successful non-streaming responses if project enabled it
		if proxyResp.StatusCode == http.StatusOK && h.cache.Enabled() && keyInfo != nil && keyInfo.SemanticCacheEnabled && promptText != "" {
			bodyCopy := make([]byte, len(uncompressedBody))
			copy(bodyCopy, uncompressedBody)
			h.runBackground("cache-store", func() {
				var respMap map[string]interface{}
				if err := json.Unmarshal(bodyCopy, &respMap); err == nil {
					h.cache.Store(promptText, projectID, proxyResp.Model, respMap)
				}
			})
		}
	}

	totalLatency := time.Since(start).Milliseconds()

	slog.Info("request completed",
		"request_id", requestID,
		"provider", proxyResp.Provider,
		"model", proxyResp.Model,
		"status", proxyResp.StatusCode,
		"complexity", complexity,
		"latency_ms", totalLatency,
		"input_tokens", inputTokens,
		"output_tokens", outputTokens,
		"cost_cents", costCents,
	)

	h.metrics.RecordRequest(proxyResp.Provider, proxyResp.Model, proxyResp.StatusCode, int(totalLatency))

	// Log usage to backend (fire-and-forget)
	h.runBackground("log-usage", func() {
		h.logUsage(requestID, projectID, proxyResp.Provider, proxyResp.Model, complexity, int(totalLatency), proxyResp.StatusCode, false, proxyResp.WasFallback, inputTokens, outputTokens, costCents, endUserID, experimentID, variantID)
	})

	// ─── Billing post-request: increment quota or deduct credits ──
	if keyInfo != nil && keyInfo.BillingMode != nil && keyInfo.OwnerUserID != nil && proxyResp.StatusCode == http.StatusOK {
		ownerID := *keyInfo.OwnerUserID
		switch *keyInfo.BillingMode {
		case "charon":
			h.runBackground("billing-increment", func() {
				h.billingIncrement(requestID, ownerID)
			})
		case "achilles":
			h.runBackground("billing-deduct", func() {
				h.billingDeductCredits(requestID, ownerID, proxyResp.Provider, proxyResp.Model, inputTokens, outputTokens)
			})
		}
	}
}

// extractPrompt extracts the last user message content from the request body.
func extractPrompt(body []byte) string {
	var parsed struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return ""
	}
	for i := len(parsed.Messages) - 1; i >= 0; i-- {
		if parsed.Messages[i].Role == "user" {
			return parsed.Messages[i].Content
		}
	}
	return ""
}

// extractResponseContent extracts the content message from the provider response body.
func extractResponseContent(body []byte) string {
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil && len(parsed.Choices) > 0 {
		return parsed.Choices[0].Message.Content
	}
	return ""
}

type usageLogEntry struct {
	ProjectID    string `json:"project_id"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	Complexity   string `json:"complexity"`
	LatencyMs    int    `json:"latency_ms"`
	StatusCode   int    `json:"status_code"`
	CacheHit     bool   `json:"cache_hit"`
	WasFallback  bool   `json:"was_fallback"`
	InputTokens  int    `json:"input_tokens"`
	OutputTokens int    `json:"output_tokens"`
	CostCents    int    `json:"cost_cents"`
	EndUserID    string `json:"end_user_id,omitempty"`
	ExperimentID string `json:"experiment_id,omitempty"`
	VariantID    string `json:"variant_id,omitempty"`
}

func (h *Handler) logUsage(requestID, projectID, provider, model, complexity string, latencyMs, statusCode int, cacheHit, wasFallback bool, inputTokens, outputTokens, costCents int, endUserID, experimentID, variantID string) {
	if projectID == "" {
		return
	}
	entry := usageLogEntry{
		ProjectID:    projectID,
		Provider:     provider,
		Model:        model,
		Complexity:   complexity,
		LatencyMs:    latencyMs,
		StatusCode:   statusCode,
		CacheHit:     cacheHit,
		WasFallback:  wasFallback,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		CostCents:    costCents,
		EndUserID:    endUserID,
		ExperimentID: experimentID,
		VariantID:    variantID,
	}
	body, err := json.Marshal(entry)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.backendURL+"/internal/log-usage", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	if h.internalSecret != "" {
		req.Header.Set("X-Internal-Secret", h.internalSecret)
	}
	resp, err := h.logClient.Do(req)
	if err != nil {
		slog.Debug("failed to log usage", "request_id", requestID, "error", err)
		return
	}
	resp.Body.Close()
}

// billingIncrement tells the backend to increment the Charon user's monthly
// request counter. This is fire-and-forget: failures are logged but don't
// affect the response already sent to the client.
func (h *Handler) billingIncrement(requestID, userID string) {
	// Use url.PathEscape for user-provided values to prevent URL path injection (R-C4).
	reqURL := fmt.Sprintf("%s/internal/increment-request?user_id=%s", h.backendURL, url.QueryEscape(userID))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("X-Request-ID", requestID)
	if h.internalSecret != "" {
		req.Header.Set("X-Internal-Secret", h.internalSecret)
	}
	resp, err := h.logClient.Do(req)
	if err != nil {
		slog.Debug("billing increment failed", "request_id", requestID, "user_id", userID, "error", err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		slog.Warn("billing increment non-200", "request_id", requestID, "user_id", userID, "status", resp.StatusCode)
	}
}

// billingDeductCredits tells the backend to deduct Achilles credits based on
// actual token usage. The backend looks up model_pricing and computes cost.
func (h *Handler) billingDeductCredits(requestID, userID, provider, model string, inputTokens, outputTokens int) {
	// Use url.QueryEscape for user-provided values to prevent URL injection (R-C4).
	reqURL := fmt.Sprintf("%s/internal/deduct-credits?user_id=%s&provider=%s&model=%s&input_tokens=%d&output_tokens=%d",
		h.backendURL, url.QueryEscape(userID), url.QueryEscape(provider), url.QueryEscape(model), inputTokens, outputTokens)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("X-Request-ID", requestID)
	if h.internalSecret != "" {
		req.Header.Set("X-Internal-Secret", h.internalSecret)
	}
	resp, err := h.logClient.Do(req)
	if err != nil {
		slog.Debug("billing deduct failed", "request_id", requestID, "user_id", userID, "error", err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		slog.Warn("billing deduct non-200", "request_id", requestID, "user_id", userID, "status", resp.StatusCode)
	}
}

// ptrStr safely dereferences a *string for logging, returning "" if nil.
func ptrStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func isAllowedPath(p string) bool {
	// Clean the path to prevent traversal attacks (e.g., "/v1/models/../admin").
	// Use path.Clean (POSIX-only) instead of filepath.Clean for OS-independent behavior (R-H1).
	cleaned := path.Clean(p)
	// Use the package-level allowedPaths map to avoid per-request allocation (R-H6).
	return allowedPaths[cleaned]
}

// blockedHeaders is the set of hop-by-hop headers that should not be copied
// from the provider response to the client.
// Allocated once at package level to avoid per-request allocation.
var blockedHeaders = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailers":            true,
	"transfer-encoding":   true,
	"upgrade":             true,
}

// sensitiveHeaders is the set of headers that could leak credentials or internal
// details to the client.
// Allocated once at package level to avoid per-request allocation.
var sensitiveHeaders = map[string]bool{
	"authorization":     true,
	"x-api-key":         true,
	"api-key":           true,
	"x-goog-api-key":    true,
	"x-internal-secret": true,
	"set-cookie":        true,
}

func copyHeaders(dst, src http.Header) {
	for key, values := range src {
		lowerKey := strings.ToLower(key)
		if blockedHeaders[lowerKey] {
			continue
		}
		if sensitiveHeaders[lowerKey] {
			continue
		}
		for _, v := range values {
			dst.Add(key, v)
		}
	}
}
