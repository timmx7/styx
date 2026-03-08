package proxy

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// validSecurityRequestID validates X-Request-ID format in the SecurityMiddleware.
// Only allows alphanumeric characters and hyphens, max 64 chars (R-C2).
var validSecurityRequestID = regexp.MustCompile(`^[a-zA-Z0-9-]{1,64}$`)

// MaxRequestBodyBytes is the maximum allowed request body size (10 MB).
const MaxRequestBodyBytes int64 = 10 * 1024 * 1024

// SecurityMiddleware adds security headers, request-ID injection,
// and request body size limits to incoming requests.
func SecurityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// ─── Request ID ─────────────────────────────────────────
		// Validate X-Request-ID: only allow alphanumeric + hyphens, max 64 chars.
		// If invalid, generate a new one to prevent log injection (R-C2).
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" || !validSecurityRequestID.MatchString(requestID) {
			b := make([]byte, 16)
			if _, err := rand.Read(b); err != nil {
				requestID = fmt.Sprintf("fallback-%d", time.Now().UnixNano())
			} else {
				requestID = hex.EncodeToString(b)
			}
		}
		w.Header().Set("X-Request-ID", requestID)
		r.Header.Set("X-Request-ID", requestID)

		// ─── Request body size limit ────────────────────────────
		if r.ContentLength > MaxRequestBodyBytes {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			w.Write([]byte(`{"error":{"type":"request_too_large","message":"Request body exceeds ` +
				strconv.FormatInt(MaxRequestBodyBytes/(1024*1024), 10) +
				` MB limit","code":413}}`))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBodyBytes)

		// ─── Security response headers ──────────────────────────
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// ─── Prevent caching of API responses ───────────────────
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		w.Header().Set("Pragma", "no-cache")

		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware adds CORS headers for browser-based API clients.
// Origins are configured via the CORS_ORIGINS environment variable
// (comma-separated list). If empty, CORS is disabled.
func CORSMiddleware(next http.Handler) http.Handler {
	originsEnv := os.Getenv("CORS_ORIGINS")
	if originsEnv == "" {
		return next // CORS disabled
	}

	allowedOrigins := make(map[string]bool)
	for _, origin := range strings.Split(originsEnv, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			allowedOrigins[origin] = true
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID, X-Styx-Provider, X-Styx-Model, X-Styx-Cache, X-Styx-Latency-Ms, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset")
			w.Header().Set("Access-Control-Max-Age", "3600")
			w.Header().Set("Vary", "Origin")
		}

		// Handle preflight requests
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
