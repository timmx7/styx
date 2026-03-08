package ratelimit

import (
	"net/http"
	"sync"
	"time"
)

// PublicLimiter is a simple in-memory token bucket rate limiter
// for public endpoints like /health and /metrics.
// It limits the total request rate (not per-client) to prevent
// these endpoints from being used as DDoS amplifiers.
type PublicLimiter struct {
	mu         sync.Mutex
	tokens     float64
	maxTokens  float64
	refillRate float64 // tokens per second
	lastRefill time.Time
}

// NewPublicLimiter creates a rate limiter that allows `ratePerSecond` requests/sec
// with a burst capacity of 3x the rate.
func NewPublicLimiter(ratePerSecond float64) *PublicLimiter {
	return &PublicLimiter{
		tokens:     ratePerSecond * 3,
		maxTokens:  ratePerSecond * 3,
		refillRate: ratePerSecond,
		lastRefill: time.Now(),
	}
}

// Allow checks if a request is allowed and consumes a token if so.
func (l *PublicLimiter) Allow() bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(l.lastRefill).Seconds()
	l.tokens += elapsed * l.refillRate
	if l.tokens > l.maxTokens {
		l.tokens = l.maxTokens
	}
	l.lastRefill = now

	if l.tokens < 1 {
		return false
	}
	l.tokens--
	return true
}

// Middleware wraps an http.Handler with rate limiting.
func (l *PublicLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.Allow() {
			w.Header().Set("Retry-After", "1")
			http.Error(w, `{"error":{"type":"rate_limit_exceeded","message":"Too many requests to this endpoint","code":429}}`, http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
