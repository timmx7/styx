package ratelimit

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/styx/router/internal/auth"
	"github.com/redis/go-redis/v9"
)

// Limiter implements Redis-backed sliding window rate limiting.
type Limiter struct {
	rdb           *redis.Client
	defaultPerMin int
}

// New creates a new Redis-backed rate limiter.
func New() *Limiter {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://redis:6379"
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Warn("failed to parse REDIS_URL for rate limiter, using default", "error", err)
		opt = &redis.Options{Addr: "redis:6379"}
	}

	rdb := redis.NewClient(opt)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Warn("Redis not available for rate limiting, will retry on requests", "error", err)
	} else {
		slog.Info("rate limiter connected to Redis")
	}

	return &Limiter{
		rdb:           rdb,
		defaultPerMin: 60,
	}
}

// NewWithClient creates a Limiter with an injected Redis client (for testing).
func NewWithClient(rdb *redis.Client, defaultPerMin int) *Limiter {
	return &Limiter{
		rdb:           rdb,
		defaultPerMin: defaultPerMin,
	}
}

// rateLimitScript is a Lua script that atomically checks the rate limit
// and only adds the request if it's within the limit. This prevents
// the ZADD from executing on rejected requests, which would inflate
// the window counter and cause subsequent requests to be incorrectly rejected.
var rateLimitScript = redis.NewScript(`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '0', tostring(now - window))
local count = redis.call('ZCARD', key)

if count < limit then
    redis.call('ZADD', key, now, member)
    redis.call('EXPIRE', key, math.ceil(window / 1000))
    return {1, limit - count - 1}
else
    redis.call('EXPIRE', key, math.ceil(window / 1000))
    return {0, 0}
end
`)

// Allow checks if a request is allowed using a Redis sliding window.
// key is the unique identifier (e.g., API key ID).
// maxPerMinute is the per-key limit from the backend.
// Uses a Lua script to atomically check-then-add, preventing rejected
// requests from inflating the window counter.
func (l *Limiter) Allow(ctx context.Context, key string, maxPerMinute int) (bool, int64) {
	if l.rdb == nil {
		return true, 0
	}

	now := time.Now()
	windowKey := fmt.Sprintf("ratelimit:%s", key)
	windowMs := int64(60 * 1000) // 60 seconds in milliseconds
	member := fmt.Sprintf("%d", now.UnixNano())

	result, err := rateLimitScript.Run(ctx, l.rdb, []string{windowKey},
		now.UnixMilli(), windowMs, maxPerMinute, member,
	).Int64Slice()
	if err != nil {
		slog.Debug("rate limit Redis error, allowing request", "error", err)
		return true, 0 // fail open
	}

	allowed := result[0] == 1
	remaining := result[1]
	if remaining < 0 {
		remaining = 0
	}
	return allowed, remaining
}

// Middleware returns an HTTP middleware that enforces rate limiting.
//
// It reads the authenticated KeyInfo from the request context (set by
// auth.Validator.Middleware) and uses the per-key rate_limit value.
// If no KeyInfo is present (unauthenticated request), the request is
// passed through without rate limiting — the auth middleware will
// reject it anyway.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Read key info from context (set by auth middleware upstream)
		keyInfo := auth.GetKeyInfo(r.Context())
		if keyInfo == nil {
			// No auth context → let auth middleware handle rejection.
			// This should never happen if auth middleware runs first,
			// but we fail open rather than crashing.
			next.ServeHTTP(w, r)
			return
		}

		// Determine the per-key rate limit.
		// The backend returns rate_limit from the api_keys table.
		// If 0 or negative, use the server default.
		maxPerMinute := keyInfo.RateLimit
		if maxPerMinute <= 0 {
			maxPerMinute = l.defaultPerMin
		}

		// Use the unique API key ID as the rate limit key.
		// This ensures rate limits are truly per-key (not per-project or per-team).
		// Falls back to ProjectID:TeamID if KeyID is not available (backward compat).
		var rateLimitKey string
		if keyInfo.KeyID != "" {
			rateLimitKey = keyInfo.KeyID
		} else {
			rateLimitKey = fmt.Sprintf("%s:%s", keyInfo.ProjectID, keyInfo.TeamID)
		}

		allowed, remaining := l.Allow(r.Context(), rateLimitKey, maxPerMinute)

		// Always set rate limit headers so clients can track usage
		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", maxPerMinute))
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
		w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", time.Now().Add(60*time.Second).Unix()))

		if !allowed {
			slog.Warn("rate limit exceeded",
				"project_id", keyInfo.ProjectID,
				"team_id", keyInfo.TeamID,
				"limit", maxPerMinute,
			)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":{"type":"rate_limit_exceeded","message":"Rate limit exceeded. Please retry after a moment.","code":429}}`))
			return
		}

		// Enforce End-User Rate Limiting if configured and X-End-User-Id is provided
		endUserID := r.Header.Get("X-End-User-Id")
		if keyInfo.EndUserRateLimit > 0 && endUserID != "" {
			endUserLimitKey := fmt.Sprintf("%s:user:%s", rateLimitKey, endUserID)
			userAllowed, userRemaining := l.Allow(r.Context(), endUserLimitKey, keyInfo.EndUserRateLimit)

			w.Header().Set("X-End-User-RateLimit-Limit", fmt.Sprintf("%d", keyInfo.EndUserRateLimit))
			w.Header().Set("X-End-User-RateLimit-Remaining", fmt.Sprintf("%d", userRemaining))

			if !userAllowed {
				slog.Warn("end user rate limit exceeded",
					"project_id", keyInfo.ProjectID,
					"end_user_id", endUserID,
					"limit", keyInfo.EndUserRateLimit,
				)
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(`{"error":{"type":"rate_limit_exceeded","message":"End-user rate limit exceeded.","code":429}}`))
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
