package fallback

import (
	"log/slog"
	"sync"
	"time"
)

// State represents the circuit breaker state.
type State int

const (
	StateClosed   State = iota // Normal — requests flow through
	StateOpen                  // Tripped — requests are rejected
	StateHalfOpen              // Testing — allow one request through
)

func (s State) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

// CircuitBreaker implements the circuit breaker pattern per provider.
//
// States:
//   - Closed:   All requests pass through. Count consecutive failures.
//               When failures reach maxFailures → transition to Open.
//   - Open:     All requests fail fast. After recoveryTimeout elapses
//               since lastFail, transition to HalfOpen on the next Allow().
//   - HalfOpen: Exactly ONE test request is allowed through (the first caller
//               to Allow()). All subsequent callers are blocked until the
//               test request calls RecordSuccess (→ Closed) or RecordFailure
//               (→ Open). If the test request hangs, a halfOpenTimeout will
//               re-open the circuit so the system doesn't stay stuck.
type CircuitBreaker struct {
	mu sync.Mutex

	state    State
	failures int
	lastFail time.Time

	// halfOpenSince tracks when we entered half-open state.
	// If the test request takes too long, we re-open.
	halfOpenSince time.Time
	// testInFlight is true when a half-open test request is in progress.
	testInFlight bool

	// Config
	maxFailures     int           // failures before tripping
	recoveryTimeout time.Duration // how long to stay open before half-open
	halfOpenTimeout time.Duration // max time to wait for half-open test result
	provider        string        // for logging
}

// NewCircuitBreaker creates a circuit breaker for a specific provider.
func NewCircuitBreaker(provider string, maxFailures int, recoveryTimeout time.Duration) *CircuitBreaker {
	// Half-open timeout defaults to 2x the recovery timeout, capped at 30s.
	halfOpenTimeout := 2 * recoveryTimeout
	if halfOpenTimeout > 30*time.Second {
		halfOpenTimeout = 30 * time.Second
	}
	if halfOpenTimeout < 5*time.Second {
		halfOpenTimeout = 5 * time.Second
	}

	return &CircuitBreaker{
		state:           StateClosed,
		maxFailures:     maxFailures,
		recoveryTimeout: recoveryTimeout,
		halfOpenTimeout: halfOpenTimeout,
		provider:        provider,
	}
}

// Allow checks if a request should be allowed through.
// Returns true if the request can proceed.
//
// In HalfOpen state, only the FIRST caller gets true (the test request).
// All subsequent callers get false until the test request resolves.
func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		return true

	case StateOpen:
		// Check if recovery timeout has elapsed
		if time.Since(cb.lastFail) <= cb.recoveryTimeout {
			return false
		}
		// Transition to half-open and allow this one test request
		cb.state = StateHalfOpen
		cb.halfOpenSince = time.Now()
		cb.testInFlight = true
		slog.Info("circuit breaker half-open, allowing test request",
			"provider", cb.provider,
		)
		return true

	case StateHalfOpen:
		// A test request is already in flight — block everyone else.
		// But check if the test request has timed out (hung/leaked).
		if cb.testInFlight && time.Since(cb.halfOpenSince) > cb.halfOpenTimeout {
			// Test request timed out — re-open the circuit and allow
			// a new test request on the next recovery cycle.
			cb.state = StateOpen
			cb.lastFail = time.Now()
			cb.testInFlight = false
			slog.Warn("circuit breaker half-open test timed out, re-opening",
				"provider", cb.provider,
				"timeout", cb.halfOpenTimeout,
			)
			return false
		}
		return false
	}

	return false
}

// RecordSuccess records a successful request. Resets the circuit breaker.
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	prevState := cb.state
	prevFailures := cb.failures

	cb.failures = 0
	cb.state = StateClosed
	cb.testInFlight = false

	if prevState == StateHalfOpen || prevFailures > 0 {
		slog.Info("circuit breaker closing (success)",
			"provider", cb.provider,
			"previous_state", prevState.String(),
			"previous_failures", prevFailures,
		)
	}
}

// RecordFailure records a failed request. May trip the circuit breaker.
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.lastFail = time.Now()

	if cb.state == StateHalfOpen {
		// Test request failed — go back to open.
		// Reset failures to maxFailures (not increment beyond) so the
		// counter stays meaningful.
		cb.failures = cb.maxFailures
		cb.state = StateOpen
		cb.testInFlight = false
		slog.Warn("circuit breaker re-opened (half-open test failed)",
			"provider", cb.provider,
		)
		return
	}

	cb.failures++

	if cb.failures >= cb.maxFailures {
		cb.state = StateOpen
		slog.Warn("circuit breaker tripped",
			"provider", cb.provider,
			"failures", cb.failures,
			"recovery_timeout", cb.recoveryTimeout,
		)
	}
}

// GetState returns the current state.
func (cb *CircuitBreaker) GetState() State {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state
}

// Failures returns the current failure count.
func (cb *CircuitBreaker) Failures() int {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.failures
}

// IsAvailable reports whether the provider should be considered for routing.
//
// CRITICAL: This must be consistent with Allow(). If IsAvailable() returns
// false, the router won't select this provider, so Allow() will never be
// called, and the circuit breaker can never transition out of half-open.
//
// Rules:
//   - Closed  → always available
//   - Open    → available IF recovery timeout has elapsed (ready for half-open)
//   - HalfOpen → available (the test request needs to be routed here!)
func (cb *CircuitBreaker) IsAvailable() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		return true
	case StateOpen:
		return time.Since(cb.lastFail) > cb.recoveryTimeout
	case StateHalfOpen:
		// MUST return true so the router can select this provider
		// for the test request. Allow() will enforce the "only one
		// request" constraint.
		return true
	}
	return false
}
