package proxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/styx/router/internal/config"
)

func TestIsAllowedPath(t *testing.T) {
	tests := []struct {
		path    string
		allowed bool
	}{
		{"/v1/chat/completions", true},
		{"/v1/completions", true},
		{"/v1/embeddings", true},
		{"/v1/models", true},
		{"/v1/chat/completions/extra", false},  // exact match only
		{"/v2/chat/completions", false},
		{"/health", false},
		{"/", false},
		{"/v1/images/generate", false},
		{"/admin/users", false},
		{"/v1/models/../admin", false},          // path traversal blocked
		{"/v1/models/..", false},                 // path traversal blocked
		{"/v1/chat/completions/", true},          // trailing slash cleaned by filepath.Clean
	}

	for _, tc := range tests {
		got := isAllowedPath(tc.path)
		if got != tc.allowed {
			t.Errorf("isAllowedPath(%q) = %v, want %v", tc.path, got, tc.allowed)
		}
	}
}

func TestParseUsage(t *testing.T) {
	tests := []struct {
		name       string
		provider   string
		body       string
		wantInput  int
		wantOutput int
	}{
		// ─── OpenAI format (also Mistral, Azure) ─────────────────
		{
			name:       "openai/standard response",
			provider:   "openai",
			body:       `{"choices":[],"usage":{"prompt_tokens":150,"completion_tokens":42,"total_tokens":192}}`,
			wantInput:  150,
			wantOutput: 42,
		},
		{
			name:       "mistral/standard response",
			provider:   "mistral",
			body:       `{"choices":[],"usage":{"prompt_tokens":88,"completion_tokens":200}}`,
			wantInput:  88,
			wantOutput: 200,
		},
		{
			name:       "azure/standard response",
			provider:   "azure",
			body:       `{"choices":[],"usage":{"prompt_tokens":500,"completion_tokens":1024,"total_tokens":1524}}`,
			wantInput:  500,
			wantOutput: 1024,
		},

		// ─── Anthropic format ────────────────────────────────────
		{
			name:       "anthropic/claude response",
			provider:   "anthropic",
			body:       `{"id":"msg_01","type":"message","role":"assistant","content":[{"type":"text","text":"Hello"}],"model":"claude-3-5-sonnet","usage":{"input_tokens":25,"output_tokens":103}}`,
			wantInput:  25,
			wantOutput: 103,
		},
		{
			name:       "anthropic/large token counts",
			provider:   "anthropic",
			body:       `{"usage":{"input_tokens":12000,"output_tokens":4096}}`,
			wantInput:  12000,
			wantOutput: 4096,
		},

		// ─── Google Gemini format ─────────────────────────────────
		{
			name:       "google/gemini response",
			provider:   "google",
			body:       `{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}],"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":75,"totalTokenCount":105}}`,
			wantInput:  30,
			wantOutput: 75,
		},
		{
			name:       "google/gemini large tokens",
			provider:   "google",
			body:       `{"usageMetadata":{"promptTokenCount":8192,"candidatesTokenCount":2048,"totalTokenCount":10240}}`,
			wantInput:  8192,
			wantOutput: 2048,
		},

		// ─── Fallback behavior ───────────────────────────────────
		{
			name:       "openai/falls back to anthropic field names",
			provider:   "openai",
			body:       `{"usage":{"input_tokens":50,"output_tokens":30}}`,
			wantInput:  50,
			wantOutput: 30,
		},
		{
			name:       "anthropic/falls back to openai field names",
			provider:   "anthropic",
			body:       `{"usage":{"prompt_tokens":100,"completion_tokens":200}}`,
			wantInput:  100,
			wantOutput: 200,
		},
		{
			name:       "google/falls back to openai fields when no usageMetadata",
			provider:   "google",
			body:       `{"usage":{"prompt_tokens":44,"completion_tokens":88}}`,
			wantInput:  44,
			wantOutput: 88,
		},
		{
			name:       "unknown provider/uses openai format",
			provider:   "some_future_provider",
			body:       `{"usage":{"prompt_tokens":10,"completion_tokens":20}}`,
			wantInput:  10,
			wantOutput: 20,
		},

		// ─── Edge cases ──────────────────────────────────────────
		{
			name:       "empty body",
			provider:   "openai",
			body:       ``,
			wantInput:  0,
			wantOutput: 0,
		},
		{
			name:       "invalid json",
			provider:   "openai",
			body:       `{invalid}`,
			wantInput:  0,
			wantOutput: 0,
		},
		{
			name:       "no usage field at all",
			provider:   "openai",
			body:       `{"choices":[],"model":"gpt-4o"}`,
			wantInput:  0,
			wantOutput: 0,
		},
		{
			name:       "zero token counts/openai",
			provider:   "openai",
			body:       `{"usage":{"prompt_tokens":0,"completion_tokens":0}}`,
			wantInput:  0,
			wantOutput: 0,
		},
		{
			name:       "zero token counts/anthropic",
			provider:   "anthropic",
			body:       `{"usage":{"input_tokens":0,"output_tokens":0}}`,
			wantInput:  0,
			wantOutput: 0,
		},
		{
			name:       "zero token counts/google",
			provider:   "google",
			body:       `{"usageMetadata":{"promptTokenCount":0,"candidatesTokenCount":0,"totalTokenCount":0}}`,
			wantInput:  0,
			wantOutput: 0,
		},
		{
			name:       "google/only prompt tokens (no output yet)",
			provider:   "google",
			body:       `{"usageMetadata":{"promptTokenCount":500,"candidatesTokenCount":0,"totalTokenCount":500}}`,
			wantInput:  500,
			wantOutput: 0,
		},
		{
			name:       "anthropic/input only (still streaming)",
			provider:   "anthropic",
			body:       `{"usage":{"input_tokens":200,"output_tokens":0}}`,
			wantInput:  200,
			wantOutput: 0,
		},
		{
			name:       "empty provider string defaults to openai format",
			provider:   "",
			body:       `{"usage":{"prompt_tokens":7,"completion_tokens":13}}`,
			wantInput:  7,
			wantOutput: 13,
		},
		{
			name:       "both openai and anthropic fields present/anthropic provider picks anthropic",
			provider:   "anthropic",
			body:       `{"usage":{"prompt_tokens":10,"completion_tokens":20,"input_tokens":100,"output_tokens":200}}`,
			wantInput:  100,
			wantOutput: 200,
		},
		{
			name:       "both openai and anthropic fields present/openai provider picks openai",
			provider:   "openai",
			body:       `{"usage":{"prompt_tokens":10,"completion_tokens":20,"input_tokens":100,"output_tokens":200}}`,
			wantInput:  10,
			wantOutput: 20,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			input, output := parseUsage([]byte(tc.body), tc.provider)
			if input != tc.wantInput || output != tc.wantOutput {
				t.Errorf("parseUsage(body, %q) = (%d, %d), want (%d, %d)",
					tc.provider, input, output, tc.wantInput, tc.wantOutput)
			}
		})
	}
}

func TestExtractPrompt(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		expected string
	}{
		{
			name:     "single user message",
			body:     `{"model":"gpt-4o","messages":[{"role":"user","content":"hello world"}]}`,
			expected: "hello world",
		},
		{
			name:     "system + user messages",
			body:     `{"model":"gpt-4o","messages":[{"role":"system","content":"you are helpful"},{"role":"user","content":"tell me a joke"}]}`,
			expected: "tell me a joke",
		},
		{
			name:     "multiple user messages takes last",
			body:     `{"model":"gpt-4o","messages":[{"role":"user","content":"first"},{"role":"assistant","content":"response"},{"role":"user","content":"second"}]}`,
			expected: "second",
		},
		{
			name:     "no messages",
			body:     `{"model":"gpt-4o"}`,
			expected: "",
		},
		{
			name:     "invalid json",
			body:     `not json`,
			expected: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractPrompt([]byte(tc.body))
			if got != tc.expected {
				t.Errorf("extractPrompt() = %q, want %q", got, tc.expected)
			}
		})
	}
}

func TestComputeCostCents(t *testing.T) {
	h := &Handler{
		modelCosts: map[string]config.ModelConfig{
			"gpt-4o": {
				InputCostPer1K:  0.25,
				OutputCostPer1K: 1.0,
			},
			"gpt-4o-mini": {
				InputCostPer1K:  0.015,
				OutputCostPer1K: 0.06,
			},
		},
	}

	tests := []struct {
		name         string
		model        string
		inputTokens  int
		outputTokens int
		expected     int
	}{
		{
			name:         "gpt-4o 1000 tokens each",
			model:        "gpt-4o",
			inputTokens:  1000,
			outputTokens: 1000,
			expected:     2, // ceil(0.25 + 1.0) = 2
		},
		{
			name:         "gpt-4o-mini 500 tokens each",
			model:        "gpt-4o-mini",
			inputTokens:  500,
			outputTokens: 500,
			expected:     1, // ceil(0.0075 + 0.03) = 1
		},
		{
			name:         "unknown model",
			model:        "unknown",
			inputTokens:  1000,
			outputTokens: 1000,
			expected:     0,
		},
		{
			name:         "zero tokens",
			model:        "gpt-4o",
			inputTokens:  0,
			outputTokens: 0,
			expected:     0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := h.computeCostCents(tc.model, tc.inputTokens, tc.outputTokens)
			if got != tc.expected {
				t.Errorf("computeCostCents(%q, %d, %d) = %d, want %d",
					tc.model, tc.inputTokens, tc.outputTokens, got, tc.expected)
			}
		})
	}
}

func TestCopyHeaders(t *testing.T) {
	src := http.Header{
		"Content-Type": {"application/json"},
		"X-Custom":     {"value1", "value2"},
		"Connection":   {"keep-alive"},
		"Keep-Alive":   {"timeout=5"},
		"X-Request-Id": {"abc123"},
	}

	dst := http.Header{}
	copyHeaders(dst, src)

	// Regular headers should be copied
	if dst.Get("Content-Type") != "application/json" {
		t.Error("Content-Type should be copied")
	}
	if dst.Get("X-Custom") != "value1" {
		t.Error("X-Custom should be copied")
	}
	if dst.Get("X-Request-Id") != "abc123" {
		t.Error("X-Request-Id should be copied")
	}

	// Hop-by-hop headers should NOT be copied
	if dst.Get("Connection") != "" {
		t.Error("Connection header should not be copied")
	}
	if dst.Get("Keep-Alive") != "" {
		t.Error("Keep-Alive header should not be copied")
	}
}

func TestGenerateRequestID(t *testing.T) {
	id1 := generateRequestID()
	id2 := generateRequestID()

	if id1 == "" {
		t.Error("request ID should not be empty")
	}
	if id1 == id2 {
		t.Error("request IDs should be unique")
	}
	if len(id1) < 32 {
		t.Errorf("request ID too short: %s", id1)
	}
}

func TestWriteError(t *testing.T) {
	rr := httptest.NewRecorder()
	writeError(rr, http.StatusBadRequest, "invalid_request", "test error")

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rr.Code)
	}

	if rr.Header().Get("Content-Type") != "application/json" {
		t.Error("expected Content-Type application/json")
	}

	var resp errorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp.Error.Type != "invalid_request" {
		t.Errorf("expected error type invalid_request, got %s", resp.Error.Type)
	}
	if resp.Error.Message != "test error" {
		t.Errorf("expected error message 'test error', got %s", resp.Error.Message)
	}
}

func TestSecurityMiddleware(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := SecurityMiddleware(inner)
	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	// Check security headers
	securityHeaders := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
	}

	for header, expected := range securityHeaders {
		got := rr.Header().Get(header)
		if got != expected {
			t.Errorf("expected %s=%s, got %s", header, expected, got)
		}
	}

	// Check request ID was set
	if rr.Header().Get("X-Request-ID") == "" {
		t.Error("expected X-Request-ID to be set")
	}
}

func TestServeHTTP_MethodNotAllowed(t *testing.T) {
	h := &Handler{}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/v1/chat/completions", nil)

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected status 405, got %d", rr.Code)
	}
}

func TestServeHTTP_PathNotAllowed(t *testing.T) {
	h := &Handler{}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/invalid", strings.NewReader(`{"model":"gpt-4o"}`))

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", rr.Code)
	}
}

func TestServeHTTP_EmptyBody(t *testing.T) {
	h := &Handler{}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(""))

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rr.Code)
	}
}

func TestServeHTTP_InvalidJSON(t *testing.T) {
	h := &Handler{}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader("{not json}"))

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rr.Code)
	}
}

func TestServeHTTP_MissingModel(t *testing.T) {
	h := &Handler{}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"messages":[]}`))

	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", rr.Code)
	}
}
