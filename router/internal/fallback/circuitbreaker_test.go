package fallback

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// ─── State basics ──────────────────────────────

func TestCircuitBreaker_InitialState(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 3, 10*time.Second)

	if !cb.Allow() {
		t.Error("new circuit breaker should allow requests")
	}
	if !cb.IsAvailable() {
		t.Error("new circuit breaker should be available")
	}
	if cb.GetState() != StateClosed {
		t.Errorf("expected StateClosed, got %v", cb.GetState())
	}
	if cb.Failures() != 0 {
		t.Errorf("expected 0 failures, got %d", cb.Failures())
	}
}

func TestCircuitBreaker_StateString(t *testing.T) {
	tests := []struct {
		state    State
		expected string
	}{
		{StateClosed, "closed"},
		{StateOpen, "open"},
		{StateHalfOpen, "half-open"},
		{State(99), "unknown"},
	}

	for _, tc := range tests {
		got := tc.state.String()
		if got != tc.expected {
			t.Errorf("State(%d).String() = %q, want %q", tc.state, got, tc.expected)
		}
	}
}

// ─── Closed state ──────────────────────────────

func TestCircuitBreaker_StaysClosedBelowThreshold(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 5, 10*time.Second)

	cb.RecordFailure()
	cb.RecordFailure()

	if cb.GetState() != StateClosed {
		t.Error("should stay closed below threshold")
	}
	if !cb.Allow() {
		t.Error("should allow requests when below threshold")
	}
	if cb.Failures() != 2 {
		t.Errorf("expected 2 failures, got %d", cb.Failures())
	}
}

func TestCircuitBreaker_SuccessResetsFailureCount(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 3, 10*time.Second)

	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordSuccess() // should reset counter

	if cb.Failures() != 0 {
		t.Errorf("expected 0 failures after success reset, got %d", cb.Failures())
	}

	// After reset, need 3 more failures to trip
	cb.RecordFailure()
	cb.RecordFailure()

	if cb.GetState() != StateClosed {
		t.Error("success should have reset counter — should still be closed")
	}
}

// ─── Transition Closed → Open ──────────────────

func TestCircuitBreaker_OpensAfterMaxFailures(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 3, 10*time.Second)

	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()

	if cb.GetState() != StateOpen {
		t.Errorf("expected StateOpen after 3 failures, got %v", cb.GetState())
	}
	if cb.Allow() {
		t.Error("open circuit breaker should not allow requests")
	}
	if cb.IsAvailable() {
		t.Error("open circuit breaker (within recovery) should not be available")
	}
}

func TestCircuitBreaker_OpensAtExactThreshold(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 1, 10*time.Second)

	cb.RecordFailure() // threshold=1, should trip immediately

	if cb.GetState() != StateOpen {
		t.Errorf("expected StateOpen with threshold=1, got %v", cb.GetState())
	}
}

// ─── Transition Open → HalfOpen ────────────────

func TestCircuitBreaker_HalfOpenAfterRecoveryTimeout(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 1, 50*time.Millisecond)

	cb.RecordFailure() // trips immediately

	if cb.GetState() != StateOpen {
		t.Fatal("expected StateOpen")
	}

	// Before recovery timeout: should stay open
	if cb.Allow() {
		t.Error("should not allow before recovery timeout")
	}
	if cb.IsAvailable() {
		t.Error("should not be available before recovery timeout")
	}

	// Wait for recovery timeout
	time.Sleep(80 * time.Millisecond)

	// IsAvailable should return true (ready for half-open)
	if !cb.IsAvailable() {
		t.Error("should be available after recovery timeout (ready for half-open)")
	}

	// Allow() should transition to half-open and allow the test request
	if !cb.Allow() {
		t.Error("should allow one test request after recovery timeout")
	}
	if cb.GetState() != StateHalfOpen {
		t.Errorf("expected StateHalfOpen, got %v", cb.GetState())
	}
}

// ─── HalfOpen: only ONE request passes ─────────

func TestCircuitBreaker_HalfOpen_OnlyOneRequest(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 1, 50*time.Millisecond)

	cb.RecordFailure()
	time.Sleep(80 * time.Millisecond)

	// First Allow() → true (test request)
	if !cb.Allow() {
		t.Fatal("first Allow() should return true (test request)")
	}

	// Second Allow() → false (test in flight)
	if cb.Allow() {
		t.Error("second Allow() should return false (test request in flight)")
	}

	// Third Allow() → still false
	if cb.Allow() {
		t.Error("third Allow() should also return false")
	}
}

// BUG FIX TEST: IsAvailable() must return true in HalfOpen
// so the router can select this provider for the test request.
func TestCircuitBreaker_HalfOpen_IsAvailableReturnsTrue(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 1, 50*time.Millisecond)

	cb.RecordFailure()
	time.Sleep(80 * time.Millisecond)

	cb.Allow() // transition to half-open

	if cb.GetState() != StateHalfOpen {
		t.Fatal("expected StateHalfOpen")
	}

	// CRITICAL: IsAvailable must be true in half-open!
	// Otherwise the router won't route to this provider, and the
	// circuit breaker will be stuck in half-open forever.
	if !cb.IsAvailable() {
		t.Error("IsAvailable() MUST return true in HalfOpen state so the router can route to this provider")
	}
}

// ─── HalfOpen → Closed (success) ───────────────

func TestCircuitBreaker_HalfOpenSuccess_ClosesCircuit(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 1, 50*time.Millisecond)

	cb.RecordFailure() // trip
	time.Sleep(80 * time.Millisecond)
	cb.Allow() // transition to half-open

	cb.RecordSuccess() // test request succeeded → close

	if cb.GetState() != StateClosed {
		t.Errorf("expected StateClosed after success in half-open, got %v", cb.GetState())
	}
	if !cb.Allow() {
		t.Error("should allow requests after circuit closes")
	}
	if cb.Failures() != 0 {
		t.Errorf("failures should be reset to 0, got %d", cb.Failures())
	}
}

// ─── HalfOpen → Open (failure) ─────────────────

func TestCircuitBreaker_HalfOpenFailure_ReopensCircuit(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 1, 50*time.Millisecond)

	cb.RecordFailure() // trip
	time.Sleep(80 * time.Millisecond)
	cb.Allow() // transition to half-open

	cb.RecordFailure() // test request failed → re-open

	if cb.GetState() != StateOpen {
		t.Errorf("expected StateOpen after failure in half-open, got %v", cb.GetState())
	}
}

// BUG FIX TEST: After half-open failure, failures counter should
// be reset to maxFailures (not incremented beyond).
func TestCircuitBreaker_HalfOpenFailure_FailuresCountClean(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 3, 50*time.Millisecond)

	// Trip with exactly 3 failures
	cb.RecordFailure()
	cb.RecordFailure()
	cb.RecordFailure()

	if cb.Failures() != 3 {
		t.Fatalf("expected 3 failures, got %d", cb.Failures())
	}

	time.Sleep(80 * time.Millisecond)
	cb.Allow() // half-open

	cb.RecordFailure() // test request failed

	// Failures should be maxFailures (3), NOT 4
	if cb.Failures() != 3 {
		t.Errorf("after half-open failure, failures should be %d (maxFailures), got %d", 3, cb.Failures())
	}
}

// ─── HalfOpen timeout (hung test request) ──────

func TestCircuitBreaker_HalfOpen_TestRequestTimeout(t *testing.T) {
	// Use very short recovery and half-open timeout for testing.
	// halfOpenTimeout is min 5s by default, so we manually set it.
	cb := &CircuitBreaker{
		state:           StateClosed,
		maxFailures:     1,
		recoveryTimeout: 20 * time.Millisecond,
		halfOpenTimeout: 50 * time.Millisecond, // short for test
		provider:        "test-timeout",
	}

	cb.RecordFailure() // trip to open
	time.Sleep(30 * time.Millisecond)

	// Transition to half-open
	if !cb.Allow() {
		t.Fatal("should allow test request")
	}
	if cb.GetState() != StateHalfOpen {
		t.Fatal("expected StateHalfOpen")
	}

	// Simulate test request hanging — wait past halfOpenTimeout
	time.Sleep(60 * time.Millisecond)

	// Next Allow() should detect timeout and re-open
	if cb.Allow() {
		t.Error("should not allow — timed-out half-open should re-open")
	}
	if cb.GetState() != StateOpen {
		t.Errorf("expected StateOpen after half-open timeout, got %v", cb.GetState())
	}
}

// ─── Full lifecycle ────────────────────────────

func TestCircuitBreaker_FullLifecycle(t *testing.T) {
	cb := NewCircuitBreaker("lifecycle-test", 2, 50*time.Millisecond)

	// Phase 1: Closed → requests pass
	if !cb.Allow() {
		t.Fatal("phase 1: should allow")
	}

	// Phase 2: Trip to open
	cb.RecordFailure()
	cb.RecordFailure()
	if cb.GetState() != StateOpen {
		t.Fatal("phase 2: should be open")
	}
	if cb.Allow() {
		t.Fatal("phase 2: should block")
	}

	// Phase 3: Wait for recovery → half-open
	time.Sleep(80 * time.Millisecond)
	if !cb.Allow() {
		t.Fatal("phase 3: should allow test request")
	}
	if cb.GetState() != StateHalfOpen {
		t.Fatal("phase 3: should be half-open")
	}

	// Phase 4: Test fails → back to open
	cb.RecordFailure()
	if cb.GetState() != StateOpen {
		t.Fatal("phase 4: should be open again")
	}

	// Phase 5: Wait again → half-open again
	time.Sleep(80 * time.Millisecond)
	if !cb.Allow() {
		t.Fatal("phase 5: should allow test request again")
	}

	// Phase 6: Test succeeds → closed
	cb.RecordSuccess()
	if cb.GetState() != StateClosed {
		t.Fatal("phase 6: should be closed")
	}

	// Phase 7: Requests flow normally
	if !cb.Allow() {
		t.Fatal("phase 7: should allow after close")
	}
	if cb.Failures() != 0 {
		t.Fatalf("phase 7: failures should be 0, got %d", cb.Failures())
	}
}

// ─── Router integration: IsAvailable + Allow ───

// This test simulates what happens in the real router:
// 1. Router calls IsAvailable() to filter providers
// 2. Router calls Allow() on the selected provider
// 3. Provider calls RecordSuccess/RecordFailure after the request
//
// The old code had a bug where IsAvailable() returned false in
// HalfOpen, causing the router to NEVER select the provider,
// so the circuit breaker was stuck in half-open forever.
func TestCircuitBreaker_RouterIntegration_HalfOpenFlow(t *testing.T) {
	cb := NewCircuitBreaker("openai", 2, 50*time.Millisecond)

	// Trip the circuit
	cb.RecordFailure()
	cb.RecordFailure()

	// Wait for recovery
	time.Sleep(80 * time.Millisecond)

	// Step 1: Router checks IsAvailable (should be true — ready for half-open)
	if !cb.IsAvailable() {
		t.Fatal("step 1: IsAvailable should be true after recovery timeout")
	}

	// Step 2: Router selects this provider, calls Forward() which calls Allow()
	if !cb.Allow() {
		t.Fatal("step 2: Allow should return true (test request)")
	}

	// Step 3: While test is in flight, IsAvailable still true but Allow blocks others
	if !cb.IsAvailable() {
		t.Fatal("step 3: IsAvailable should still be true in half-open")
	}
	if cb.Allow() {
		t.Fatal("step 3: Allow should block concurrent requests")
	}

	// Step 4: Test request succeeds
	cb.RecordSuccess()

	// Step 5: Back to normal
	if cb.GetState() != StateClosed {
		t.Fatal("step 5: should be closed")
	}
	if !cb.IsAvailable() {
		t.Fatal("step 5: should be available")
	}
	if !cb.Allow() {
		t.Fatal("step 5: should allow")
	}
}

// ─── Concurrency tests ────────────────────────

func TestCircuitBreaker_ConcurrentAccess_NoRace(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 100, 10*time.Second)

	var wg sync.WaitGroup
	const goroutines = 100

	// Concurrent reads and writes
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			cb.Allow()
			cb.IsAvailable()
			cb.GetState()
			cb.Failures()
			if n%2 == 0 {
				cb.RecordFailure()
			} else {
				cb.RecordSuccess()
			}
		}(i)
	}

	wg.Wait()
}

// In half-open, exactly ONE goroutine should get Allow()=true
func TestCircuitBreaker_ConcurrentHalfOpen_ExactlyOne(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 1, 20*time.Millisecond)

	cb.RecordFailure()
	time.Sleep(40 * time.Millisecond)

	var allowed atomic.Int32
	var wg sync.WaitGroup

	// 50 goroutines race to get the test request
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if cb.Allow() {
				allowed.Add(1)
			}
		}()
	}

	wg.Wait()

	if allowed.Load() != 1 {
		t.Errorf("exactly 1 goroutine should get Allow()=true, got %d", allowed.Load())
	}
}

// ─── Edge cases ────────────────────────────────

func TestCircuitBreaker_SuccessWhileOpen_StillCloses(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 2, 10*time.Second)

	cb.RecordFailure()
	cb.RecordFailure() // open

	// An unexpected success while open should still reset
	cb.RecordSuccess()

	if cb.GetState() != StateClosed {
		t.Error("RecordSuccess should always close the circuit")
	}
}

func TestCircuitBreaker_ManyFailuresInClosed_CountsAccurately(t *testing.T) {
	cb := NewCircuitBreaker("test-provider", 100, 10*time.Second)

	for i := 0; i < 50; i++ {
		cb.RecordFailure()
	}

	if cb.Failures() != 50 {
		t.Errorf("expected 50 failures, got %d", cb.Failures())
	}
	if cb.GetState() != StateClosed {
		t.Error("should still be closed (threshold=100)")
	}
}

func TestCircuitBreaker_HalfOpenTimeout_Config(t *testing.T) {
	// With small recovery timeout, halfOpenTimeout should be at least 5s
	cb := NewCircuitBreaker("test-provider", 1, 100*time.Millisecond)
	if cb.halfOpenTimeout < 5*time.Second {
		t.Errorf("halfOpenTimeout should be >= 5s, got %v", cb.halfOpenTimeout)
	}

	// With large recovery timeout, halfOpenTimeout should be capped at 30s
	cb2 := NewCircuitBreaker("test-provider", 1, 60*time.Second)
	if cb2.halfOpenTimeout > 30*time.Second {
		t.Errorf("halfOpenTimeout should be <= 30s, got %v", cb2.halfOpenTimeout)
	}

	// With 10s recovery, halfOpenTimeout should be 20s
	cb3 := NewCircuitBreaker("test-provider", 1, 10*time.Second)
	if cb3.halfOpenTimeout != 20*time.Second {
		t.Errorf("halfOpenTimeout should be 20s, got %v", cb3.halfOpenTimeout)
	}
}
