package metrics

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// requestKey is a struct key for the requestsTotal map.
// Using a struct avoids fmt.Sprintf allocation on every request.
type requestKey struct {
	Provider string
	Model    string
	Status   int
}

// errorKey is a struct key for the providerErrors map.
type errorKey struct {
	Provider  string
	ErrorType string
}

// histogramBuckets defines the latency buckets (in milliseconds) for the
// Prometheus histogram. These cover the range from fast cache hits (10ms)
// to slow streaming completions (120s).
var histogramBuckets = []int{10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000}

// histogramKey is a struct key for per-provider, per-bucket counters.
type histogramKey struct {
	Provider string
	BucketMs int // upper bound in ms; -1 means +Inf
}

// Metrics collects Prometheus-style metrics for the Styx router.
// This is a lightweight implementation that exposes metrics in Prometheus
// text format without requiring the full prometheus/client_golang dependency.
type Metrics struct {
	mu sync.RWMutex

	// Counters — keyed by struct to avoid per-request fmt.Sprintf allocations
	requestsTotal    map[requestKey]*atomic.Int64
	providerErrors   map[errorKey]*atomic.Int64
	cacheHitsTotal   atomic.Int64
	cacheMissesTotal atomic.Int64

	// Summaries (track sum and count for average)
	latencySum   map[string]*atomic.Int64 // label: provider
	latencyCount map[string]*atomic.Int64 // label: provider

	// Histogram buckets for proper p50/p95/p99 alerting
	histogramBuckets map[histogramKey]*atomic.Int64
}

// New creates a new Metrics collector.
func New() *Metrics {
	return &Metrics{
		requestsTotal:    make(map[requestKey]*atomic.Int64),
		providerErrors:   make(map[errorKey]*atomic.Int64),
		latencySum:       make(map[string]*atomic.Int64),
		latencyCount:     make(map[string]*atomic.Int64),
		histogramBuckets: make(map[histogramKey]*atomic.Int64),
	}
}

// RecordRequest records a completed request with its provider, model, status code, and latency.
func (m *Metrics) RecordRequest(provider, model string, statusCode int, latencyMs int) {
	key := requestKey{Provider: provider, Model: model, Status: statusCode}

	m.mu.RLock()
	counter, ok := m.requestsTotal[key]
	m.mu.RUnlock()

	if !ok {
		m.mu.Lock()
		if counter, ok = m.requestsTotal[key]; !ok {
			counter = &atomic.Int64{}
			m.requestsTotal[key] = counter
		}
		m.mu.Unlock()
	}
	counter.Add(1)

	// Record latency
	m.recordLatency(provider, latencyMs)
}

// RecordProviderError records a provider error.
func (m *Metrics) RecordProviderError(provider, errorType string) {
	key := errorKey{Provider: provider, ErrorType: errorType}

	m.mu.RLock()
	counter, ok := m.providerErrors[key]
	m.mu.RUnlock()

	if !ok {
		m.mu.Lock()
		if counter, ok = m.providerErrors[key]; !ok {
			counter = &atomic.Int64{}
			m.providerErrors[key] = counter
		}
		m.mu.Unlock()
	}
	counter.Add(1)
}

// RecordCacheHit records a semantic cache hit.
func (m *Metrics) RecordCacheHit() {
	m.cacheHitsTotal.Add(1)
}

// RecordCacheMiss records a semantic cache miss.
func (m *Metrics) RecordCacheMiss() {
	m.cacheMissesTotal.Add(1)
}

func (m *Metrics) recordLatency(provider string, latencyMs int) {
	m.mu.RLock()
	sum, ok1 := m.latencySum[provider]
	count, ok2 := m.latencyCount[provider]
	m.mu.RUnlock()

	if !ok1 || !ok2 {
		m.mu.Lock()
		if sum, ok1 = m.latencySum[provider]; !ok1 {
			sum = &atomic.Int64{}
			m.latencySum[provider] = sum
		}
		if count, ok2 = m.latencyCount[provider]; !ok2 {
			count = &atomic.Int64{}
			m.latencyCount[provider] = count
		}
		m.mu.Unlock()
	}

	sum.Add(int64(latencyMs))
	count.Add(1)

	// Record histogram buckets (cumulative: each bucket counts values <= bound)
	for _, bound := range histogramBuckets {
		if latencyMs <= bound {
			m.getHistogramCounter(provider, bound).Add(1)
		}
	}
	// +Inf bucket always incremented
	m.getHistogramCounter(provider, -1).Add(1)
}

func (m *Metrics) getHistogramCounter(provider string, bucketMs int) *atomic.Int64 {
	key := histogramKey{Provider: provider, BucketMs: bucketMs}
	m.mu.RLock()
	c, ok := m.histogramBuckets[key]
	m.mu.RUnlock()
	if ok {
		return c
	}
	m.mu.Lock()
	if c, ok = m.histogramBuckets[key]; !ok {
		c = &atomic.Int64{}
		m.histogramBuckets[key] = c
	}
	m.mu.Unlock()
	return c
}

// Handler returns an HTTP handler that serves metrics in Prometheus text format.
func (m *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

		var sb strings.Builder

		// ─── styx_requests_total ─────────────────────────────
		sb.WriteString("# HELP styx_requests_total Total number of requests processed.\n")
		sb.WriteString("# TYPE styx_requests_total counter\n")

		m.mu.RLock()

		// Collect and sort request keys for deterministic output.
		// String formatting only happens here during /metrics scrape,
		// not on the hot path of every request.
		type requestEntry struct {
			sortKey string
			key     requestKey
			value   int64
		}
		reqEntries := make([]requestEntry, 0, len(m.requestsTotal))
		for k, v := range m.requestsTotal {
			sortKey := fmt.Sprintf("%s,%s,%d", k.Provider, k.Model, k.Status)
			reqEntries = append(reqEntries, requestEntry{sortKey: sortKey, key: k, value: v.Load()})
		}
		sort.Slice(reqEntries, func(i, j int) bool {
			return reqEntries[i].sortKey < reqEntries[j].sortKey
		})

		for _, e := range reqEntries {
			fmt.Fprintf(&sb, "styx_requests_total{provider=%q,model=%q,status=\"%d\"} %d\n",
				e.key.Provider, e.key.Model, e.key.Status, e.value)
		}

		// ─── styx_provider_errors_total ──────────────────────
		sb.WriteString("# HELP styx_provider_errors_total Total provider errors.\n")
		sb.WriteString("# TYPE styx_provider_errors_total counter\n")

		type errorEntry struct {
			sortKey string
			key     errorKey
			value   int64
		}
		errEntries := make([]errorEntry, 0, len(m.providerErrors))
		for k, v := range m.providerErrors {
			sortKey := k.Provider + "," + k.ErrorType
			errEntries = append(errEntries, errorEntry{sortKey: sortKey, key: k, value: v.Load()})
		}
		sort.Slice(errEntries, func(i, j int) bool {
			return errEntries[i].sortKey < errEntries[j].sortKey
		})

		for _, e := range errEntries {
			fmt.Fprintf(&sb, "styx_provider_errors_total{provider=%q,error_type=%q} %d\n",
				e.key.Provider, e.key.ErrorType, e.value)
		}

		// ─── styx_cache_hits_total ───────────────────────────
		sb.WriteString("# HELP styx_cache_hits_total Total semantic cache hits.\n")
		sb.WriteString("# TYPE styx_cache_hits_total counter\n")
		fmt.Fprintf(&sb, "styx_cache_hits_total %d\n", m.cacheHitsTotal.Load())

		// ─── styx_cache_misses_total ─────────────────────────
		sb.WriteString("# HELP styx_cache_misses_total Total semantic cache misses.\n")
		sb.WriteString("# TYPE styx_cache_misses_total counter\n")
		fmt.Fprintf(&sb, "styx_cache_misses_total %d\n", m.cacheMissesTotal.Load())

		// ─── styx_request_duration_seconds ───────────────────
		sb.WriteString("# HELP styx_request_duration_seconds Request duration in seconds.\n")
		sb.WriteString("# TYPE styx_request_duration_seconds summary\n")

		providerKeys := make([]string, 0, len(m.latencySum))
		for k := range m.latencySum {
			providerKeys = append(providerKeys, k)
		}
		sort.Strings(providerKeys)

		for _, provider := range providerKeys {
			sumVal := m.latencySum[provider].Load()
			countVal := m.latencyCount[provider].Load()
			sumSec := float64(sumVal) / 1000.0
			fmt.Fprintf(&sb, "styx_request_duration_seconds_sum{provider=%q} %.3f\n", provider, sumSec)
			fmt.Fprintf(&sb, "styx_request_duration_seconds_count{provider=%q} %d\n", provider, countVal)
		}

		// ─── styx_request_latency_seconds (histogram) ─────────
		sb.WriteString("# HELP styx_request_latency_seconds Request latency histogram for p50/p95/p99 alerting.\n")
		sb.WriteString("# TYPE styx_request_latency_seconds histogram\n")

		for _, provider := range providerKeys {
			for _, bound := range histogramBuckets {
				key := histogramKey{Provider: provider, BucketMs: bound}
				if c, ok := m.histogramBuckets[key]; ok {
					le := float64(bound) / 1000.0
					fmt.Fprintf(&sb, "styx_request_latency_seconds_bucket{provider=%q,le=\"%.3f\"} %d\n", provider, le, c.Load())
				}
			}
			// +Inf bucket
			infKey := histogramKey{Provider: provider, BucketMs: -1}
			if c, ok := m.histogramBuckets[infKey]; ok {
				fmt.Fprintf(&sb, "styx_request_latency_seconds_bucket{provider=%q,le=\"+Inf\"} %d\n", provider, c.Load())
			}
			sumVal := m.latencySum[provider].Load()
			countVal := m.latencyCount[provider].Load()
			fmt.Fprintf(&sb, "styx_request_latency_seconds_sum{provider=%q} %.3f\n", provider, float64(sumVal)/1000.0)
			fmt.Fprintf(&sb, "styx_request_latency_seconds_count{provider=%q} %d\n", provider, countVal)
		}

		m.mu.RUnlock()

		// ─── styx_up ────────────────────────────────────────
		sb.WriteString("# HELP styx_up Whether the Styx router is up.\n")
		sb.WriteString("# TYPE styx_up gauge\n")
		fmt.Fprintf(&sb, "styx_up %d\n", 1)

		// ─── styx_uptime_seconds ────────────────────────────
		sb.WriteString("# HELP styx_uptime_seconds Router uptime in seconds.\n")
		sb.WriteString("# TYPE styx_uptime_seconds gauge\n")
		fmt.Fprintf(&sb, "styx_uptime_seconds %.0f\n", time.Since(startTime).Seconds())

		w.Write([]byte(sb.String()))
	})
}

var startTime = time.Now()
