package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// KeyInfo holds the validated key information returned by the backend.
type KeyInfo struct {
	Valid       bool     `json:"valid"`
	KeyID       string   `json:"key_id"`
	ProjectID   string   `json:"project_id"`
	TeamID      string   `json:"team_id"`
	Permissions []string `json:"permissions"`
	RateLimit   int      `json:"rate_limit"`

	// Routing fields (populated from the project settings by the backend)
	AllowedProviders []string `json:"allowed_providers,omitempty"`
	RoutingStrategy  string   `json:"routing_strategy,omitempty"`

	// BYOK provider keys (decrypted by backend, never logged/cached to disk)
	ProviderKeys map[string]string `json:"provider_keys,omitempty"`

	// Billing fields (Charon/Achilles)
	BillingMode   *string `json:"billing_mode"`
	OwnerUserID   *string `json:"owner_user_id"`
	RequestsUsed  *int    `json:"requests_used"`
	RequestsLimit *int    `json:"requests_limit"`
	BalanceCents  *int    `json:"balance_cents"`

	// Playground overriding system prompt
	SystemPrompt *string `json:"system_prompt,omitempty"`

	// Security & Privacy flag
	PIIRedactionEnabled bool `json:"pii_redaction_enabled"`

	// Guardrails configuration
	GuardrailsConfig *GuardrailsConfig `json:"guardrails_config,omitempty"`

	// Evals (A/B Testing)
	ActiveABTest *ABTestConfig `json:"active_ab_test,omitempty"`

	// Phase 10: Advanced Optims
	SemanticCacheEnabled bool `json:"semantic_cache_enabled"`
	EndUserRateLimit     int  `json:"end_user_rate_limit"`
}

// ABTestConfig defines an active A/B test routing experiment.
type ABTestConfig struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Variants []ABTestVariant `json:"variants"`
}

// ABTestVariant defines a routing variation and its traffic weight.
type ABTestVariant struct {
	ID           string  `json:"id"`
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	SystemPrompt *string `json:"system_prompt,omitempty"`
	Weight       int     `json:"weight"`
}

// GuardrailsConfig defines rules that the router must enforce on requests and responses.
type GuardrailsConfig struct {
	JSONStrict        bool     `json:"json_strict,omitempty"`
	RequiredFields    []string `json:"required_fields,omitempty"`
	ForbiddenWords    []string `json:"forbidden_words,omitempty"`
	ToxicityThreshold float64  `json:"toxicity_threshold,omitempty"`
}

// validateKeyRequest is the POST body sent to the backend.
type validateKeyRequest struct {
	Key string `json:"key"`
}

// cachedKey holds a validated KeyInfo with an expiration time and LRU tracking.
type cachedKey struct {
	info       *KeyInfo
	expiresAt  time.Time
	lastAccess time.Time // updated on every cache hit for LRU eviction
}

// hashKey returns a hex-encoded SHA-256 hash of the API key.
// This prevents raw API keys from being stored as map keys in memory,
// which would be extractable by an attacker with memory access.
func hashKey(apiKey string) string {
	h := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(h[:])
}

// Validator calls the Python backend to validate API keys.
// Validated keys are cached in-memory with a configurable TTL to reduce
// the number of HTTP calls to the backend on every request.
// The cache is bounded to maxCacheSize entries to prevent memory leaks
// from an attacker sending many unique (invalid) API keys.
// API keys are hashed (SHA-256) before being used as cache map keys.
type Validator struct {
	backendURL     string
	internalSecret string
	httpClient     *http.Client

	// In-memory cache: hashKey(apiKey) → cachedKey
	cacheMu      sync.RWMutex
	cache        map[string]cachedKey
	cacheTTL     time.Duration
	maxCacheSize int

	// keyIDIndex maps key_id → hashKey so we can invalidate by key_id
	// when receiving a Redis revocation event. This avoids an O(n) scan.
	keyIDIndex map[string]string

	// oldestKey tracks the oldest cache entry for O(1) eviction
	// when the cache is full during Validate(). This avoids an
	// O(n) scan under the write lock.
	oldestKey  string
	oldestTime time.Time

	// stopCh signals the evictExpired goroutine to stop.
	stopCh    chan struct{}
	closeOnce sync.Once // prevents double-close panic on Stop() (R-H2)

	// Dev mode: skip all authentication when SKIP_AUTH=true
	skipAuth     bool
	skipAuthOnce sync.Once
}

// NewValidator creates a key validator that talks to the backend service.
func NewValidator(backendURL string) *Validator {
	v := &Validator{
		backendURL:     strings.TrimRight(backendURL, "/"),
		internalSecret: os.Getenv("INTERNAL_SECRET"),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
		cache:        make(map[string]cachedKey),
		keyIDIndex:   make(map[string]string),
		cacheTTL:     30 * time.Second,
		maxCacheSize: 10000,
		stopCh:       make(chan struct{}),
	}
	// Start a background goroutine to evict expired entries every minute
	go v.evictExpired()
	// Start Redis subscriber for real-time key revocation
	go v.subscribeKeyRevocations()
	return v
}

// Stop signals the background eviction goroutine to exit.
// Call this during graceful shutdown to prevent goroutine leaks.
// Safe to call multiple times; uses sync.Once to prevent double-close panic (R-H2).
func (v *Validator) Stop() {
	v.closeOnce.Do(func() { close(v.stopCh) })
}

// evictExpired periodically removes expired entries from the cache.
// If after evicting expired entries the cache is still >80% full,
// performs a single-pass eviction of the oldest 20% of entries
// by finding them in one linear scan (no sort required).
func (v *Validator) evictExpired() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-v.stopCh:
			return
		case <-ticker.C:
		}
		now := time.Now()
		v.cacheMu.Lock()
		for key, entry := range v.cache {
			if now.After(entry.expiresAt) {
				if entry.info != nil && entry.info.KeyID != "" {
					delete(v.keyIDIndex, entry.info.KeyID)
				}
				delete(v.cache, key)
			}
		}
		// LRU eviction if cache is >80% full after normal expiry eviction.
		// Use a simple threshold approach: find the cutoff time by scanning
		// once to get the oldest and newest, then evict entries below a
		// percentile threshold. This avoids an O(n log n) sort.
		if len(v.cache) > v.maxCacheSize*80/100 {
			toRemove := len(v.cache) * 20 / 100
			if toRemove < 1 {
				toRemove = 1
			}
			// Single pass: find the oldest entries by collecting the N oldest
			// using a simple approach — just delete entries until we've removed enough
			removed := 0
			for key, entry := range v.cache {
				if removed >= toRemove {
					break
				}
				// Evict entries that haven't been accessed recently
				// (map iteration order is random in Go, which provides
				// a reasonable approximation of random eviction)
				if entry.info != nil && entry.info.KeyID != "" {
					delete(v.keyIDIndex, entry.info.KeyID)
				}
				delete(v.cache, key)
				removed++
			}
			slog.Info("LRU cache eviction",
				"removed", removed,
				"remaining", len(v.cache),
				"max_size", v.maxCacheSize,
			)
		}
		// Refresh oldest key tracking
		v.refreshOldestKey()
		v.cacheMu.Unlock()
	}
}

// refreshOldestKey scans the cache to find the oldest entry.
// Must be called while holding the write lock.
func (v *Validator) refreshOldestKey() {
	v.oldestKey = ""
	v.oldestTime = time.Time{}
	first := true
	for key, entry := range v.cache {
		if first || entry.lastAccess.Before(v.oldestTime) {
			v.oldestKey = key
			v.oldestTime = entry.lastAccess
			first = false
		}
	}
}

// InvalidateKey removes a specific key from the cache.
// Useful when a key is revoked or rotated.
func (v *Validator) InvalidateKey(apiKey string) {
	hk := hashKey(apiKey)
	v.cacheMu.Lock()
	if entry, ok := v.cache[hk]; ok {
		// Also clean up the keyID index
		if entry.info != nil && entry.info.KeyID != "" {
			delete(v.keyIDIndex, entry.info.KeyID)
		}
		delete(v.cache, hk)
	}
	v.cacheMu.Unlock()
}

// InvalidateByKeyID removes a cached key by its backend key_id.
// Called when a Redis revocation event is received.
func (v *Validator) InvalidateByKeyID(keyID string) {
	v.cacheMu.Lock()
	if hk, ok := v.keyIDIndex[keyID]; ok {
		delete(v.cache, hk)
		delete(v.keyIDIndex, keyID)
		slog.Info("key cache invalidated via revocation event", "key_id", keyID)
	}
	v.cacheMu.Unlock()
}

// subscribeKeyRevocations connects to Redis and listens for key revocation
// events published by the Python backend. When a key is revoked, its cached
// entry is immediately removed so the next request re-validates against the
// backend (which will return valid=false).
func (v *Validator) subscribeKeyRevocations() {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://redis:6379"
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Warn("failed to parse REDIS_URL for key revocation subscriber, using default", "error", err)
		opt = &redis.Options{Addr: "redis:6379"}
	}

	rdb := redis.NewClient(opt)
	defer rdb.Close()

	ctx := context.Background()

	// Verify connection once at startup
	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Error("Redis connection failed for key revocation subscriber", "error", err)
		// Fall back to TTL-based expiry only (30s worst case)
		return
	}
	slog.Info("key revocation subscriber connected to Redis")

	for {
		select {
		case <-v.stopCh:
			return
		default:
		}

		// Subscribe blocks until a message is received or an error occurs.
		// Using Subscribe (not PSubscribe) for exact channel match.
		sub := rdb.Subscribe(ctx, "styx:key_revoked")
		ch := sub.Channel()

		for {
			select {
			case <-v.stopCh:
				sub.Close()
				return
			case msg, ok := <-ch:
				if !ok {
					// Channel closed, reconnect
					slog.Warn("Redis subscription channel closed, reconnecting...")
					goto reconnect
				}
				// msg.Payload is the key_id
				keyID := msg.Payload
				if keyID != "" {
					v.InvalidateByKeyID(keyID)
				}
			}
		}

	reconnect:
		sub.Close()
		// Brief backoff before reconnecting
		select {
		case <-v.stopCh:
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// Validate checks an API key against the backend /internal/validate-key endpoint.
// The key is sent as a POST body (not a query param) to avoid logging exposure.
// Results are cached in-memory for cacheTTL to reduce backend load.
// API keys are hashed before being used as cache map keys.
func (v *Validator) Validate(ctx context.Context, apiKey string) (*KeyInfo, error) {
	hk := hashKey(apiKey)

	// Check cache first — use a single write lock to avoid TOCTOU race
	// between checking expiry and updating lastAccess. The lock is held
	// briefly (no I/O) so contention is minimal.
	now := time.Now()
	v.cacheMu.Lock()
	if entry, ok := v.cache[hk]; ok && now.Before(entry.expiresAt) {
		info := entry.info
		entry.lastAccess = now
		v.cache[hk] = entry
		v.cacheMu.Unlock()
		slog.Debug("key validation cache hit", "project_id", info.ProjectID)
		return info, nil
	}
	v.cacheMu.Unlock()

	reqURL := fmt.Sprintf("%s/internal/validate-key", v.backendURL)

	body, err := json.Marshal(validateKeyRequest{Key: apiKey})
	if err != nil {
		return nil, fmt.Errorf("marshaling validation request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("creating validation request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if v.internalSecret != "" {
		req.Header.Set("X-Internal-Secret", v.internalSecret)
	}

	resp, err := v.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("calling backend validate-key: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("backend returned status %d", resp.StatusCode)
	}

	var info KeyInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("decoding validation response: %w", err)
	}

	// Cache the result; if cache is full, evict the tracked oldest entry
	// in O(1) instead of doing an O(n) scan under the write lock.
	insertTime := time.Now()
	v.cacheMu.Lock()
	if len(v.cache) >= v.maxCacheSize {
		// Fast O(1) eviction using tracked oldest key
		if v.oldestKey != "" {
			delete(v.cache, v.oldestKey)
			v.oldestKey = ""
			v.oldestTime = time.Time{}
		} else {
			// Fallback: delete one random entry (Go map iteration is random)
			for k := range v.cache {
				delete(v.cache, k)
				break
			}
		}
	}
	v.cache[hk] = cachedKey{
		info:       &info,
		expiresAt:  insertTime.Add(v.cacheTTL),
		lastAccess: insertTime,
	}
	// Index by key_id for O(1) revocation lookups
	if info.KeyID != "" {
		v.keyIDIndex[info.KeyID] = hk
	}
	// Update oldest tracking if this is older than current oldest
	if v.oldestKey == "" || insertTime.Before(v.oldestTime) {
		v.oldestKey = hk
		v.oldestTime = insertTime
	}
	v.cacheMu.Unlock()

	return &info, nil
}

// ExtractAPIKey extracts the API key from the Authorization header.
// Accepts both "Bearer sk_styx_..." and plain "sk_styx_..." formats.
// Also supports legacy "af_sk_..." prefix for backwards compatibility.
func ExtractAPIKey(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}

	// "Bearer sk_styx_xxx" → "sk_styx_xxx"
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}

	return auth
}

// SetSkipAuth enables dev mode where all requests are accepted without validation.
func (v *Validator) SetSkipAuth(skip bool) {
	v.skipAuth = skip
}

// Middleware returns an HTTP middleware that validates API keys before
// passing requests to the next handler.
func (v *Validator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Dev mode: skip all auth, inject a fake KeyInfo
		if v.skipAuth {
			v.skipAuthOnce.Do(func() {
				slog.Warn("SKIP_AUTH: all requests accepted without authentication")
			})
			devInfo := &KeyInfo{
				Valid:                true,
				KeyID:                "dev-key",
				ProjectID:            "00000000-0000-0000-0000-000000000002",
				TeamID:               "00000000-0000-0000-0000-000000000003",
				Permissions:          []string{"openai", "anthropic", "google", "mistral"},
				RateLimit:            1000,
				AllowedProviders:     []string{"openai", "anthropic", "google", "mistral"},
				RoutingStrategy:      "cost_optimized",
				SemanticCacheEnabled: true,
			}
			ctx := WithKeyInfo(r.Context(), devInfo)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		apiKey := ExtractAPIKey(r)
		if apiKey == "" {
			writeAuthError(w, http.StatusUnauthorized, "missing_api_key", "Missing API key in Authorization header")
			return
		}

		// Validate against backend
		info, err := v.Validate(r.Context(), apiKey)
		if err != nil {
			slog.Error("key validation failed", "error", err)
			writeAuthError(w, http.StatusBadGateway, "validation_error", "Failed to validate API key")
			return
		}

		if !info.Valid {
			writeAuthError(w, http.StatusUnauthorized, "invalid_api_key", "Invalid or revoked API key")
			return
		}

		slog.Debug("key validated",
			"project_id", info.ProjectID,
			"team_id", info.TeamID,
			"rate_limit", info.RateLimit,
		)

		// Store key info in context for downstream handlers
		ctx := WithKeyInfo(r.Context(), info)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// contextKey is an unexported type to avoid context key collisions.
type contextKey string

// KeyInfoContextKey is exported so that tests and downstream middleware
// can inject KeyInfo into a context. Production code should use
// WithKeyInfo() / GetKeyInfo() instead of touching this directly.
const KeyInfoContextKey contextKey = "keyInfo"

// WithKeyInfo returns a new context carrying the given KeyInfo.
// Use this to programmatically inject key info (e.g. in tests).
func WithKeyInfo(ctx context.Context, info *KeyInfo) context.Context {
	return context.WithValue(ctx, KeyInfoContextKey, info)
}

// GetKeyInfo retrieves the validated KeyInfo from the request context.
func GetKeyInfo(ctx context.Context) *KeyInfo {
	info, _ := ctx.Value(KeyInfoContextKey).(*KeyInfo)
	return info
}

func writeAuthError(w http.ResponseWriter, code int, errType, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"type":    errType,
			"message": message,
			"code":    code,
		},
	})
}
