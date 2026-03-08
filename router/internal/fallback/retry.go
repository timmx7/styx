package fallback

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand"
	"time"
)

// RetryConfig holds configuration for retry behavior.
type RetryConfig struct {
	MaxRetries     int           // Maximum number of retry attempts
	BaseDelay      time.Duration // Initial delay before first retry
	MaxDelay       time.Duration // Maximum delay between retries
	BackoffFactor  float64       // Multiplier for exponential backoff
	RetryableCodes []int         // HTTP status codes that should trigger a retry
}

// DefaultRetryConfig returns sensible defaults for retry behavior.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:     3,
		BaseDelay:      100 * time.Millisecond,
		MaxDelay:       5 * time.Second,
		BackoffFactor:  2.0,
		RetryableCodes: []int{500, 502, 503, 504},
	}
}

// RetryFunc is a function that should be retried.
// It returns a status code and an error.
type RetryFunc func(ctx context.Context, attempt int) (statusCode int, err error)

// WithRetry executes the given function with exponential backoff retry logic.
// Returns the last status code and error.
func WithRetry(ctx context.Context, cfg RetryConfig, operation string, fn RetryFunc) (int, error) {
	var lastStatus int
	var lastErr error

	for attempt := 0; attempt <= cfg.MaxRetries; attempt++ {
		if attempt > 0 {
			delay := calculateDelay(attempt, cfg)

			slog.Debug("retrying operation",
				"operation", operation,
				"attempt", attempt,
				"delay", delay,
				"last_status", lastStatus,
			)

			select {
			case <-ctx.Done():
				return lastStatus, fmt.Errorf("context cancelled during retry: %w", ctx.Err())
			case <-time.After(delay):
			}
		}

		lastStatus, lastErr = fn(ctx, attempt)
		if lastErr == nil && !isRetryable(lastStatus, cfg.RetryableCodes) {
			return lastStatus, nil
		}

		if lastErr != nil {
			slog.Debug("attempt failed",
				"operation", operation,
				"attempt", attempt,
				"error", lastErr,
			)
		}
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("retryable status code %d", lastStatus)
	}
	return lastStatus, fmt.Errorf("all %d retries exhausted for %s: %w", cfg.MaxRetries, operation, lastErr)
}

// calculateDelay computes the backoff delay for a given attempt.
// Adds +/-25% jitter to prevent thundering herd when multiple
// clients retry simultaneously after a provider outage.
func calculateDelay(attempt int, cfg RetryConfig) time.Duration {
	delay := float64(cfg.BaseDelay) * math.Pow(cfg.BackoffFactor, float64(attempt-1))
	if delay > float64(cfg.MaxDelay) {
		delay = float64(cfg.MaxDelay)
	}
	// Add +/-25% jitter
	jitter := delay * 0.25 * (2*rand.Float64() - 1)
	delay += jitter
	if delay < 0 {
		delay = float64(cfg.BaseDelay)
	}
	return time.Duration(delay)
}

// isRetryable checks if a status code should trigger a retry.
func isRetryable(statusCode int, retryableCodes []int) bool {
	for _, code := range retryableCodes {
		if statusCode == code {
			return true
		}
	}
	return false
}
