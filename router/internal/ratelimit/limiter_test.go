package ratelimit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/styx/router/internal/auth"
	"github.com/redis/go-redis/v9"
)

// ---------- helpers ----------

// newTestRedis returns a connected Redis client or skips the test.
func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("Redis not available, skipping: %v", err)
	}
	return rdb
}

// flushTestKeys removes rate limit keys from Redis.
func flushTestKeys(t *testing.T, rdb *redis.Client, patterns ...string) {
	t.Helper()
	ctx := context.Background()
	for _, p := range patterns {
		keys, _ := rdb.Keys(ctx, "ratelimit:"+p+"*").Result()
		if len(keys) > 0 {
			rdb.Del(ctx, keys...)
		}
	}
}

// requestWithKeyInfo creates an HTTP request with auth.KeyInfo injected in context.
func requestWithKeyInfo(info *auth.KeyInfo) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	if info != nil {
		ctx := auth.WithKeyInfo(req.Context(), info)
		req = req.WithContext(ctx)
	}
	return req
}

// okHandler is a simple handler that returns 200 OK.
var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
})

// ---------- Allow() unit tests ----------

func TestAllow_UnderLimit(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "test-allow-under")

	lim := NewWithClient(rdb, 60)
	ctx := context.Background()

	// First request: Lua script checks count=0, adds, returns remaining = limit - 0 - 1 = 9
	allowed, remaining := lim.Allow(ctx, "test-allow-under:key1", 10)
	if !allowed {
		t.Fatal("first request should be allowed")
	}
	// remaining = limit - count - 1 (after add) = 10 - 0 - 1 = 9
	if remaining != 9 {
		t.Errorf("remaining should be 9 on first call, got %d", remaining)
	}

	// Second request: count=1 before add, remaining = 10 - 1 - 1 = 8
	allowed2, remaining2 := lim.Allow(ctx, "test-allow-under:key1", 10)
	if !allowed2 {
		t.Fatal("second request should be allowed")
	}
	if remaining2 != 8 {
		t.Errorf("remaining should be 8 on second call, got %d", remaining2)
	}
}

func TestAllow_AtLimit(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "test-allow-at")

	lim := NewWithClient(rdb, 60)
	ctx := context.Background()

	limit := 5
	// Fill up to limit
	for i := 0; i < limit; i++ {
		allowed, _ := lim.Allow(ctx, "test-allow-at:key1", limit)
		if !allowed {
			t.Fatalf("request %d should be allowed (limit=%d)", i+1, limit)
		}
	}

	// Next request should be rejected
	allowed, remaining := lim.Allow(ctx, "test-allow-at:key1", limit)
	if allowed {
		t.Fatal("request beyond limit should be rejected")
	}
	if remaining != 0 {
		t.Errorf("remaining should be 0 when at limit, got %d", remaining)
	}
}

func TestAllow_DifferentKeys_Independent(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "test-allow-indep")

	lim := NewWithClient(rdb, 60)
	ctx := context.Background()

	// Fill key1 to limit
	for i := 0; i < 3; i++ {
		lim.Allow(ctx, "test-allow-indep:key1", 3)
	}
	// key1 should be blocked
	a1, _ := lim.Allow(ctx, "test-allow-indep:key1", 3)
	if a1 {
		t.Fatal("key1 should be blocked")
	}

	// key2 should still be allowed
	a2, _ := lim.Allow(ctx, "test-allow-indep:key2", 3)
	if !a2 {
		t.Fatal("key2 should be allowed (independent counter)")
	}
}

func TestAllow_NilRedis_FailsOpen(t *testing.T) {
	lim := &Limiter{rdb: nil, defaultPerMin: 60}
	ctx := context.Background()

	allowed, _ := lim.Allow(ctx, "any-key", 10)
	if !allowed {
		t.Fatal("nil Redis should fail open")
	}
}

// ---------- Middleware tests ----------

func TestMiddleware_NoKeyInfo_PassesThrough(t *testing.T) {
	rdb := newTestRedis(t)
	lim := NewWithClient(rdb, 60)

	// Request without KeyInfo in context
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	rr := httptest.NewRecorder()

	lim.Middleware(okHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 (pass-through), got %d", rr.Code)
	}
}

func TestMiddleware_WithKeyInfo_SetsHeaders(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "proj-hdr:team-hdr")

	lim := NewWithClient(rdb, 60)

	info := &auth.KeyInfo{
		Valid:     true,
		ProjectID: "proj-hdr",
		TeamID:    "team-hdr",
		RateLimit: 100,
	}
	req := requestWithKeyInfo(info)
	rr := httptest.NewRecorder()

	lim.Middleware(okHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}

	// Check standard rate limit response headers
	if rr.Header().Get("X-RateLimit-Limit") != "100" {
		t.Errorf("X-RateLimit-Limit should be 100, got %s", rr.Header().Get("X-RateLimit-Limit"))
	}
	if rr.Header().Get("X-RateLimit-Remaining") == "" {
		t.Error("X-RateLimit-Remaining should be set")
	}
	if rr.Header().Get("X-RateLimit-Reset") == "" {
		t.Error("X-RateLimit-Reset should be set")
	}
}

func TestMiddleware_RateLimitExceeded_Returns429(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "proj-429:team-429")

	lim := NewWithClient(rdb, 60)

	info := &auth.KeyInfo{
		Valid:     true,
		ProjectID: "proj-429",
		TeamID:    "team-429",
		RateLimit: 3, // Very low limit
	}

	handler := lim.Middleware(okHandler)

	// Exhaust the limit
	for i := 0; i < 3; i++ {
		req := requestWithKeyInfo(info)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d should be allowed, got %d", i+1, rr.Code)
		}
	}

	// Next request should be 429
	req := requestWithKeyInfo(info)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", rr.Code)
	}

	// Verify error body
	var errResp struct {
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
			Code    int    `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to parse error response: %v", err)
	}
	if errResp.Error.Type != "rate_limit_exceeded" {
		t.Errorf("expected error type rate_limit_exceeded, got %s", errResp.Error.Type)
	}
	if errResp.Error.Code != 429 {
		t.Errorf("expected error code 429, got %d", errResp.Error.Code)
	}

	// Check Retry-After header
	if rr.Header().Get("Retry-After") == "" {
		t.Error("Retry-After header should be set on 429")
	}
}

func TestMiddleware_ZeroRateLimit_UsesDefault(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "proj-def:team-def")

	defaultLimit := 5
	lim := NewWithClient(rdb, defaultLimit)

	info := &auth.KeyInfo{
		Valid:     true,
		ProjectID: "proj-def",
		TeamID:    "team-def",
		RateLimit: 0, // Zero → should use default
	}

	handler := lim.Middleware(okHandler)

	// Use up the default limit
	for i := 0; i < defaultLimit; i++ {
		req := requestWithKeyInfo(info)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d should pass with default limit, got %d", i+1, rr.Code)
		}
	}

	// Next request should hit the default limit
	req := requestWithKeyInfo(info)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 after exceeding default limit, got %d", rr.Code)
	}
}

func TestMiddleware_NegativeRateLimit_UsesDefault(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "proj-neg:team-neg")

	defaultLimit := 2
	lim := NewWithClient(rdb, defaultLimit)

	info := &auth.KeyInfo{
		Valid:     true,
		ProjectID: "proj-neg",
		TeamID:    "team-neg",
		RateLimit: -1, // Negative → should use default
	}

	handler := lim.Middleware(okHandler)

	// First 2 should pass
	for i := 0; i < defaultLimit; i++ {
		req := requestWithKeyInfo(info)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d should pass, got %d", i+1, rr.Code)
		}
	}

	// Third should be blocked
	req := requestWithKeyInfo(info)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", rr.Code)
	}
}

func TestMiddleware_DifferentProjects_IndependentLimits(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "projA:teamA", "projB:teamB")

	lim := NewWithClient(rdb, 60)

	infoA := &auth.KeyInfo{
		Valid:     true,
		ProjectID: "projA",
		TeamID:    "teamA",
		RateLimit: 2,
	}
	infoB := &auth.KeyInfo{
		Valid:     true,
		ProjectID: "projB",
		TeamID:    "teamB",
		RateLimit: 2,
	}

	handler := lim.Middleware(okHandler)

	// Exhaust project A
	for i := 0; i < 2; i++ {
		req := requestWithKeyInfo(infoA)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
	}

	// Project A should be blocked
	reqA := requestWithKeyInfo(infoA)
	rrA := httptest.NewRecorder()
	handler.ServeHTTP(rrA, reqA)
	if rrA.Code != http.StatusTooManyRequests {
		t.Error("project A should be rate limited")
	}

	// Project B should still work
	reqB := requestWithKeyInfo(infoB)
	rrB := httptest.NewRecorder()
	handler.ServeHTTP(rrB, reqB)
	if rrB.Code != http.StatusOK {
		t.Error("project B should NOT be rate limited")
	}
}

// ---------- Integration: auth → rate limit chain ----------

func TestAuthThenRateLimit_FullChain(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "chain-proj:chain-team")

	lim := NewWithClient(rdb, 60)

	// Simulate what the auth middleware does: inject KeyInfo into context
	info := &auth.KeyInfo{
		Valid:       true,
		ProjectID:   "chain-proj",
		TeamID:      "chain-team",
		RateLimit:   2,
		Permissions: []string{"chat"},
	}

	// Build the full chain: auth context → rate limit → handler
	fullChain := lim.Middleware(okHandler)

	// Request 1: allowed
	req1 := requestWithKeyInfo(info)
	rr1 := httptest.NewRecorder()
	fullChain.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Errorf("request 1: expected 200, got %d", rr1.Code)
	}
	if rr1.Header().Get("X-RateLimit-Limit") != "2" {
		t.Errorf("X-RateLimit-Limit should reflect key rate_limit=2, got %s", rr1.Header().Get("X-RateLimit-Limit"))
	}

	// Request 2: allowed
	req2 := requestWithKeyInfo(info)
	rr2 := httptest.NewRecorder()
	fullChain.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Errorf("request 2: expected 200, got %d", rr2.Code)
	}

	// Request 3: rate limited
	req3 := requestWithKeyInfo(info)
	rr3 := httptest.NewRecorder()
	fullChain.ServeHTTP(rr3, req3)
	if rr3.Code != http.StatusTooManyRequests {
		t.Errorf("request 3: expected 429, got %d", rr3.Code)
	}

	// Verify the 429 response is JSON with proper error format
	var errBody map[string]interface{}
	if err := json.Unmarshal(rr3.Body.Bytes(), &errBody); err != nil {
		t.Fatalf("429 response should be valid JSON: %v", err)
	}
	errObj, ok := errBody["error"].(map[string]interface{})
	if !ok {
		t.Fatal("response should have 'error' object")
	}
	if errObj["type"] != "rate_limit_exceeded" {
		t.Errorf("error type should be rate_limit_exceeded, got %v", errObj["type"])
	}
}

// ---------- Edge cases ----------

func TestMiddleware_NilRedisClient_FailsOpen(t *testing.T) {
	lim := &Limiter{rdb: nil, defaultPerMin: 60}

	info := &auth.KeyInfo{
		Valid:     true,
		ProjectID: "proj-nil",
		TeamID:    "team-nil",
		RateLimit: 1,
	}

	req := requestWithKeyInfo(info)
	rr := httptest.NewRecorder()

	lim.Middleware(okHandler).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("nil Redis should fail open (allow), got %d", rr.Code)
	}
}

func TestMiddleware_HighRateLimit_AllRequestsPass(t *testing.T) {
	rdb := newTestRedis(t)
	defer flushTestKeys(t, rdb, "proj-high:team-high")

	lim := NewWithClient(rdb, 60)

	info := &auth.KeyInfo{
		Valid:     true,
		ProjectID: "proj-high",
		TeamID:    "team-high",
		RateLimit: 10000, // Very high
	}

	handler := lim.Middleware(okHandler)

	// Send 50 requests — all should pass
	for i := 0; i < 50; i++ {
		req := requestWithKeyInfo(info)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d should pass with high limit, got %d", i+1, rr.Code)
		}
	}
}
