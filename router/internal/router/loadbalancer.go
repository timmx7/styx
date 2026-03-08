package router

import (
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

// LoadBalancer distributes requests across providers using round-robin
// with windowed counters that automatically reset to prevent unbounded growth.
type LoadBalancer struct {
	mu       sync.RWMutex
	counters map[string]*atomic.Uint64 // provider name → request counter

	// windowDuration controls how often counters auto-reset.
	// After each window, all counters are reset to zero so that
	// the load balancer reflects recent traffic, not all-time totals.
	windowDuration time.Duration
	stopCh         chan struct{}
	closeOnce      sync.Once // prevents double-close panic on Stop() (R-H2)
}

// NewLoadBalancer creates a new LoadBalancer with a 5-minute counter window.
// Counters automatically reset every windowDuration to prevent unbounded growth
// and to ensure the balancer adapts to recent traffic patterns.
func NewLoadBalancer() *LoadBalancer {
	lb := &LoadBalancer{
		counters:       make(map[string]*atomic.Uint64),
		windowDuration: 5 * time.Minute,
		stopCh:         make(chan struct{}),
	}
	go lb.autoReset()
	return lb
}

// autoReset periodically resets all counters at the end of each window.
// This prevents uint64 overflow on long-running processes and ensures
// the load balancer reflects recent traffic, not cumulative history.
func (lb *LoadBalancer) autoReset() {
	ticker := time.NewTicker(lb.windowDuration)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			lb.Reset()
			slog.Debug("load balancer counters reset (window elapsed)",
				"window_duration", lb.windowDuration)
		case <-lb.stopCh:
			return
		}
	}
}

// Stop stops the automatic counter reset goroutine.
// Call this during graceful shutdown.
// Safe to call multiple times; uses sync.Once to prevent double-close panic (R-H2).
func (lb *LoadBalancer) Stop() {
	lb.closeOnce.Do(func() { close(lb.stopCh) })
}

// Pick selects the next provider from the candidates list using round-robin.
// If candidates is empty, returns an empty string.
func (lb *LoadBalancer) Pick(candidates []string) string {
	if len(candidates) == 0 {
		return ""
	}
	if len(candidates) == 1 {
		lb.RecordRequest(candidates[0])
		return candidates[0]
	}

	// Find the candidate with the fewest requests (weighted round-robin)
	lb.mu.RLock()
	minCount := uint64(^uint64(0)) // max uint64
	selected := candidates[0]
	for _, c := range candidates {
		counter, ok := lb.counters[c]
		if !ok {
			// Never used — select this one
			lb.mu.RUnlock()
			lb.RecordRequest(c)
			return c
		}
		count := counter.Load()
		if count < minCount {
			minCount = count
			selected = c
		}
	}
	lb.mu.RUnlock()

	lb.RecordRequest(selected)
	return selected
}

// RecordRequest increments the request counter for a provider.
func (lb *LoadBalancer) RecordRequest(provider string) {
	lb.mu.RLock()
	counter, ok := lb.counters[provider]
	lb.mu.RUnlock()

	if !ok {
		lb.mu.Lock()
		// Double-check
		if counter, ok = lb.counters[provider]; !ok {
			counter = &atomic.Uint64{}
			lb.counters[provider] = counter
		}
		lb.mu.Unlock()
	}

	counter.Add(1)
}

// GetCounts returns the current request counts per provider (for monitoring).
func (lb *LoadBalancer) GetCounts() map[string]uint64 {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	counts := make(map[string]uint64, len(lb.counters))
	for name, counter := range lb.counters {
		counts[name] = counter.Load()
	}
	return counts
}

// Reset resets all counters (e.g., at the start of a new monitoring window).
func (lb *LoadBalancer) Reset() {
	lb.mu.Lock()
	defer lb.mu.Unlock()

	for _, counter := range lb.counters {
		counter.Store(0)
	}
}
