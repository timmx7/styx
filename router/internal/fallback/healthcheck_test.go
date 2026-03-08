package fallback

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// ─── healthEndpoint tests ──────────────────────

func TestHealthEndpoint_OpenAI(t *testing.T) {
	got := healthEndpoint("openai", "https://api.openai.com")
	expected := "https://api.openai.com/v1/models"
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

func TestHealthEndpoint_Anthropic(t *testing.T) {
	got := healthEndpoint("anthropic", "https://api.anthropic.com")
	expected := "https://api.anthropic.com/v1/messages"
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

func TestHealthEndpoint_Google(t *testing.T) {
	got := healthEndpoint("google", "https://generativelanguage.googleapis.com")
	expected := "https://generativelanguage.googleapis.com/v1beta/models"
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

func TestHealthEndpoint_Mistral(t *testing.T) {
	got := healthEndpoint("mistral", "https://api.mistral.ai")
	expected := "https://api.mistral.ai/v1/models"
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

func TestHealthEndpoint_Azure(t *testing.T) {
	got := healthEndpoint("azure", "https://myresource.openai.azure.com")
	expected := "https://myresource.openai.azure.com/openai/models?api-version=2024-02-01"
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

func TestHealthEndpoint_Unknown(t *testing.T) {
	got := healthEndpoint("custom", "https://custom-api.example.com")
	expected := "https://custom-api.example.com"
	if got != expected {
		t.Errorf("expected %q, got %q", expected, got)
	}
}

// ─── checkProvider tests (with mock servers) ───

func TestCheckProvider_Healthy200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"models":[]}`))
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL, AuthHeader: "", AuthPrefix: "", APIKeyEnv: ""},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	if !hc.IsHealthy("test") {
		t.Error("200 response should be healthy")
	}

	health := hc.GetHealth()
	if !health["test"].Healthy {
		t.Error("health map should show healthy")
	}
	if health["test"].Error != "" {
		t.Errorf("should have no error, got %q", health["test"].Error)
	}
}

func TestCheckProvider_ServerError500(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	if hc.IsHealthy("test") {
		t.Error("500 response should be unhealthy")
	}
}

func TestCheckProvider_ServerError503(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	if hc.IsHealthy("test") {
		t.Error("503 response should be unhealthy")
	}
}

func TestCheckProvider_Auth401_StillHealthy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL, AuthHeader: "Authorization", AuthPrefix: "Bearer ", APIKeyEnv: "FAKE_KEY"},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	// 401 means the provider is reachable — treat as healthy
	if !hc.IsHealthy("test") {
		t.Error("401 should still be treated as healthy (provider is reachable)")
	}
}

func TestCheckProvider_Auth403_StillHealthy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	if !hc.IsHealthy("test") {
		t.Error("403 should still be treated as healthy")
	}
}

func TestCheckProvider_RateLimit429_StillHealthy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	if !hc.IsHealthy("test") {
		t.Error("429 should be treated as healthy (provider is reachable)")
	}
}

func TestCheckProvider_ConnectionRefused_Unhealthy(t *testing.T) {
	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: "http://127.0.0.1:1"}, // port 1 = will refuse
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	if hc.IsHealthy("test") {
		t.Error("connection refused should be unhealthy")
	}
}

// ─── AUTH HEADER TESTS (the main fix) ──────────

func TestCheckProvider_SendsAuthHeader_Bearer(t *testing.T) {
	t.Setenv("TEST_OPENAI_KEY", "sk-test-key-12345")

	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"openai": {
				BaseURL:    server.URL,
				AuthHeader: "Authorization",
				AuthPrefix: "Bearer ",
				APIKeyEnv:  "TEST_OPENAI_KEY",
			},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("openai", hc.probes["openai"])

	if gotAuth != "Bearer sk-test-key-12345" {
		t.Errorf("expected 'Bearer sk-test-key-12345', got %q", gotAuth)
	}
}

func TestCheckProvider_SendsAuthHeader_XApiKey(t *testing.T) {
	t.Setenv("TEST_ANTHROPIC_KEY", "sk-ant-test-key")

	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("x-api-key")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"anthropic": {
				BaseURL:    server.URL,
				AuthHeader: "x-api-key",
				AuthPrefix: "",
				APIKeyEnv:  "TEST_ANTHROPIC_KEY",
			},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("anthropic", hc.probes["anthropic"])

	if gotAuth != "sk-ant-test-key" {
		t.Errorf("expected 'sk-ant-test-key', got %q", gotAuth)
	}
}

func TestCheckProvider_SendsAuthHeader_AzureApiKey(t *testing.T) {
	t.Setenv("TEST_AZURE_KEY", "azure-key-123")

	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("api-key")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"azure": {
				BaseURL:    server.URL,
				AuthHeader: "api-key",
				AuthPrefix: "",
				APIKeyEnv:  "TEST_AZURE_KEY",
			},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("azure", hc.probes["azure"])

	if gotAuth != "azure-key-123" {
		t.Errorf("expected 'azure-key-123', got %q", gotAuth)
	}
}

func TestCheckProvider_Google_SendsHeaderAuth(t *testing.T) {
	t.Setenv("TEST_GOOGLE_KEY", "google-key-xyz")

	var gotKeyHeader string
	var gotKeyParam string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKeyHeader = r.Header.Get("x-goog-api-key")
		gotKeyParam = r.URL.Query().Get("key")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"google": {
				BaseURL:    server.URL,
				AuthHeader: "x-goog-api-key",
				AuthPrefix: "",
				APIKeyEnv:  "TEST_GOOGLE_KEY",
			},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("google", hc.probes["google"])

	// Google should use header-based auth, NOT query parameter
	if gotKeyHeader != "google-key-xyz" {
		t.Errorf("expected Google key in x-goog-api-key header, got %q", gotKeyHeader)
	}
	if gotKeyParam != "" {
		t.Errorf("Google key should NOT be in query param (security risk), got %q", gotKeyParam)
	}
}

func TestCheckProvider_NoKey_NoAuthHeader(t *testing.T) {
	// When API key env var is not set, no auth header should be sent
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"openai": {
				BaseURL:    server.URL,
				AuthHeader: "Authorization",
				AuthPrefix: "Bearer ",
				APIKeyEnv:  "NONEXISTENT_KEY_VAR_12345",
			},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("openai", hc.probes["openai"])

	if gotAuth != "" {
		t.Errorf("should not send auth header when key env is not set, got %q", gotAuth)
	}
}

// ─── IsHealthy + circuit breaker integration ───

func TestIsHealthy_WithCircuitBreaker_Open(t *testing.T) {
	cb := NewCircuitBreaker("test", 1, 10*time.Second)
	cb.RecordFailure() // trip

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		map[string]*CircuitBreaker{"test": cb},
		time.Minute,
	)

	// Probe says healthy, but CB is open
	hc.checkProvider("test", hc.probes["test"])

	if hc.IsHealthy("test") {
		t.Error("should be unhealthy when circuit breaker is open, even if probe says healthy")
	}
}

func TestIsHealthy_UnknownProvider(t *testing.T) {
	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{},
		nil,
		time.Minute,
	)

	if hc.IsHealthy("nonexistent") {
		t.Error("unknown provider should not be healthy")
	}
}

// ─── State change logging ──────────────────────

func TestHealthChecker_StateChangeTracking(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		nil,
		time.Minute,
	)

	// Initial state: healthy (assumed at creation)
	if !hc.IsHealthy("test") {
		t.Error("should start healthy")
	}

	// Check — should stay healthy
	hc.checkProvider("test", hc.probes["test"])
	if !hc.IsHealthy("test") {
		t.Error("should still be healthy after 200")
	}

	// Manually set unhealthy then recover
	hc.setHealth("test", false, 0, "simulated error")
	if hc.IsHealthy("test") {
		t.Error("should be unhealthy after setHealth(false)")
	}

	hc.checkProvider("test", hc.probes["test"])
	if !hc.IsHealthy("test") {
		t.Error("should recover after successful probe")
	}
}

// ─── checkAll parallelism ──────────────────────

func TestCheckAll_AllProvidersConcurrently(t *testing.T) {
	var callCount atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	probes := map[string]ProviderProbeConfig{
		"provider1": {BaseURL: server.URL},
		"provider2": {BaseURL: server.URL},
		"provider3": {BaseURL: server.URL},
	}

	hc := NewHealthChecker(probes, nil, time.Minute)
	hc.checkAll()

	if callCount.Load() != 3 {
		t.Errorf("expected 3 probes, got %d", callCount.Load())
	}

	// All should be healthy
	for name := range probes {
		if !hc.IsHealthy(name) {
			t.Errorf("provider %s should be healthy", name)
		}
	}
}

// ─── GetHealth returns copies ──────────────────

func TestGetHealth_ReturnsCopy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	health1 := hc.GetHealth()
	health2 := hc.GetHealth()

	// Modifying one should not affect the other
	health1["test"] = ProviderHealth{Healthy: false}

	if !health2["test"].Healthy {
		t.Error("GetHealth should return independent copies")
	}
}

// ─── Start/Stop lifecycle ──────────────────────

func TestHealthChecker_StartStop(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		nil,
		50*time.Millisecond,
	)

	hc.Start()
	time.Sleep(120 * time.Millisecond) // let at least 2 ticks happen
	hc.Stop()

	// Should not panic or hang
	if !hc.IsHealthy("test") {
		t.Error("should be healthy after periodic checks")
	}
}

func TestHealthChecker_Latency_Recorded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(10 * time.Millisecond) // small delay
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	hc := NewHealthChecker(
		map[string]ProviderProbeConfig{
			"test": {BaseURL: server.URL},
		},
		nil,
		time.Minute,
	)

	hc.checkProvider("test", hc.probes["test"])

	health := hc.GetHealth()
	if health["test"].Latency < 10*time.Millisecond {
		t.Errorf("latency should be >= 10ms, got %v", health["test"].Latency)
	}
	if health["test"].LastCheck.IsZero() {
		t.Error("LastCheck should be set")
	}
}
