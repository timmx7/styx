package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

// mockOpenAIBody returns a standard OpenAI-format request body.
func mockOpenAIBody(model string, stream bool) []byte {
	body := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": "You are a helpful assistant."},
			{"role": "user", "content": "Say hello"},
		},
		"max_tokens":  100,
		"temperature": 0.7,
		"stream":      stream,
	}
	b, _ := json.Marshal(body)
	return b
}

// mockOpenAIResponse returns a standard OpenAI-format response.
func mockOpenAIResponse() string {
	return `{"id":"chatcmpl-test","object":"chat.completion","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"Hello!"},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":5,"total_tokens":25}}`
}

// ═══════════════════════════════════════════════════════════════════
// OpenAI Adapter Tests
// ═══════════════════════════════════════════════════════════════════

func TestOpenAI_Forward_PassesBody(t *testing.T) {
	var capturedBody []byte
	var capturedAuth string
	var capturedPath string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		capturedAuth = r.Header.Get("Authorization")
		capturedPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write([]byte(mockOpenAIResponse()))
	}))
	defer ts.Close()

	os.Setenv("TEST_OPENAI_KEY", "sk-test-key")
	defer os.Unsetenv("TEST_OPENAI_KEY")

	prov, err := NewOpenAI(ts.URL, "TEST_OPENAI_KEY", []string{"gpt-4o"})
	if err != nil {
		t.Fatalf("NewOpenAI: %v", err)
	}

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{"Content-Type": {"application/json"}},
		Body:    mockOpenAIBody("gpt-4o", false),
		Model:   "gpt-4o",
		Stream:  false,
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	// Verify passthrough
	if capturedPath != "/v1/chat/completions" {
		t.Errorf("path = %q, want /v1/chat/completions", capturedPath)
	}
	if capturedAuth != "Bearer sk-test-key" {
		t.Errorf("auth = %q, want 'Bearer sk-test-key'", capturedAuth)
	}
	if resp.Provider != "openai" {
		t.Errorf("provider = %q, want 'openai'", resp.Provider)
	}
	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	// Body should be passed through (with model intact)
	var parsed map[string]interface{}
	json.Unmarshal(capturedBody, &parsed)
	if parsed["model"] != "gpt-4o" {
		t.Errorf("model = %v, want gpt-4o", parsed["model"])
	}
}

func TestOpenAI_Forward_BYOK(t *testing.T) {
	var capturedAuth string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		w.WriteHeader(200)
		w.Write([]byte(mockOpenAIResponse()))
	}))
	defer ts.Close()

	os.Setenv("TEST_OPENAI_KEY", "sk-default")
	defer os.Unsetenv("TEST_OPENAI_KEY")

	prov, _ := NewOpenAI(ts.URL, "TEST_OPENAI_KEY", []string{"gpt-4o"})

	req := &ProxyRequest{
		Method:       "POST",
		Path:         "/v1/chat/completions",
		Headers:      http.Header{},
		Body:         mockOpenAIBody("gpt-4o", false),
		Model:        "gpt-4o",
		ProviderKeys: map[string]string{"openai": "sk-byok-customer-key"},
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	if capturedAuth != "Bearer sk-byok-customer-key" {
		t.Errorf("BYOK key not used, auth = %q", capturedAuth)
	}
}

func TestOpenAI_Forward_SystemPromptInjection(t *testing.T) {
	var capturedBody []byte

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(200)
		w.Write([]byte(mockOpenAIResponse()))
	}))
	defer ts.Close()

	os.Setenv("TEST_OPENAI_KEY", "sk-test")
	defer os.Unsetenv("TEST_OPENAI_KEY")

	prov, _ := NewOpenAI(ts.URL, "TEST_OPENAI_KEY", []string{"gpt-4o"})

	overridePrompt := "You are a pirate."
	req := &ProxyRequest{
		Method:       "POST",
		Path:         "/v1/chat/completions",
		Headers:      http.Header{},
		Body:         mockOpenAIBody("gpt-4o", false),
		Model:        "gpt-4o",
		SystemPrompt: &overridePrompt,
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	// The system prompt should be replaced
	var parsed struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	json.Unmarshal(capturedBody, &parsed)

	if len(parsed.Messages) < 2 {
		t.Fatalf("expected at least 2 messages, got %d", len(parsed.Messages))
	}
	if parsed.Messages[0].Role != "system" {
		t.Errorf("first message role = %q, want 'system'", parsed.Messages[0].Role)
	}
	if parsed.Messages[0].Content != "You are a pirate." {
		t.Errorf("system prompt = %q, want 'You are a pirate.'", parsed.Messages[0].Content)
	}
}

func TestOpenAI_Forward_CircuitBreakerTrips(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte(`{"error":"internal server error"}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_OPENAI_KEY", "sk-test")
	defer os.Unsetenv("TEST_OPENAI_KEY")

	prov, _ := NewOpenAI(ts.URL, "TEST_OPENAI_KEY", []string{"gpt-4o"})

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    mockOpenAIBody("gpt-4o", false),
		Model:   "gpt-4o",
	}

	// Should succeed (returns 500 but doesn't error)
	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward should not return error even on 500: %v", err)
	}
	resp.Body.Close()

	if resp.StatusCode != 500 {
		t.Errorf("status = %d, want 500", resp.StatusCode)
	}
}

// ═══════════════════════════════════════════════════════════════════
// Anthropic Adapter Tests
// ═══════════════════════════════════════════════════════════════════

func TestAnthropic_Forward_TransformsFormat(t *testing.T) {
	var capturedBody []byte
	var capturedHeaders http.Header

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		capturedHeaders = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write([]byte(`{"id":"msg_01","type":"message","role":"assistant","content":[{"type":"text","text":"Hello!"}],"model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":25,"output_tokens":5}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_ANTHROPIC_KEY", "sk-ant-test-key")
	defer os.Unsetenv("TEST_ANTHROPIC_KEY")

	prov, err := NewAnthropic(ts.URL, "TEST_ANTHROPIC_KEY", []string{"claude-3-5-sonnet-20241022"})
	if err != nil {
		t.Fatalf("NewAnthropic: %v", err)
	}

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    mockOpenAIBody("claude-3-5-sonnet-20241022", false),
		Model:   "claude-3-5-sonnet-20241022",
		Stream:  false,
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	// Verify headers
	if capturedHeaders.Get("x-api-key") != "sk-ant-test-key" {
		t.Errorf("x-api-key = %q, want 'sk-ant-test-key'", capturedHeaders.Get("x-api-key"))
	}
	if capturedHeaders.Get("anthropic-version") != "2023-06-01" {
		t.Errorf("anthropic-version = %q, want '2023-06-01'", capturedHeaders.Get("anthropic-version"))
	}
	if capturedHeaders.Get("Content-Type") != "application/json" {
		t.Errorf("Content-Type = %q, want 'application/json'", capturedHeaders.Get("Content-Type"))
	}

	// Verify body transformation: OpenAI → Anthropic format
	var antReq anthropicRequest
	if err := json.Unmarshal(capturedBody, &antReq); err != nil {
		t.Fatalf("unmarshal Anthropic request: %v", err)
	}

	// System prompt should be extracted to top-level field
	if antReq.System != "You are a helpful assistant." {
		t.Errorf("system = %q, want 'You are a helpful assistant.'", antReq.System)
	}

	// Model should be set
	if antReq.Model != "claude-3-5-sonnet-20241022" {
		t.Errorf("model = %q, want 'claude-3-5-sonnet-20241022'", antReq.Model)
	}

	// Max tokens should be set (100 from request body)
	if antReq.MaxTokens != 100 {
		t.Errorf("max_tokens = %d, want 100", antReq.MaxTokens)
	}

	// Messages should only contain user/assistant (no system)
	if len(antReq.Messages) != 1 {
		t.Fatalf("expected 1 message (user only), got %d", len(antReq.Messages))
	}
	if antReq.Messages[0].Role != "user" {
		t.Errorf("message[0].role = %q, want 'user'", antReq.Messages[0].Role)
	}
	if antReq.Messages[0].Content != "Say hello" {
		t.Errorf("message[0].content = %q, want 'Say hello'", antReq.Messages[0].Content)
	}

	// Temperature should be forwarded
	if antReq.Temperature == nil || *antReq.Temperature != 0.7 {
		t.Errorf("temperature not forwarded correctly")
	}

	// Verify response metadata
	if resp.Provider != "anthropic" {
		t.Errorf("provider = %q, want 'anthropic'", resp.Provider)
	}
	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestAnthropic_Forward_DefaultMaxTokens(t *testing.T) {
	var capturedBody []byte

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(200)
		w.Write([]byte(`{"id":"msg_01","type":"message","usage":{"input_tokens":10,"output_tokens":5}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_ANTHROPIC_KEY", "sk-ant-test")
	defer os.Unsetenv("TEST_ANTHROPIC_KEY")

	prov, _ := NewAnthropic(ts.URL, "TEST_ANTHROPIC_KEY", []string{"claude-3-5-sonnet-20241022"})

	// Request WITHOUT max_tokens — Anthropic adapter should default to 4096
	body := `{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"hi"}]}`
	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    []byte(body),
		Model:   "claude-3-5-sonnet-20241022",
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	var antReq anthropicRequest
	json.Unmarshal(capturedBody, &antReq)

	if antReq.MaxTokens != 4096 {
		t.Errorf("max_tokens = %d, want 4096 (default)", antReq.MaxTokens)
	}
}

func TestAnthropic_Forward_BYOK(t *testing.T) {
	var capturedKey string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedKey = r.Header.Get("x-api-key")
		w.WriteHeader(200)
		w.Write([]byte(`{"id":"msg_01","type":"message","usage":{"input_tokens":10,"output_tokens":5}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_ANTHROPIC_KEY", "sk-ant-default")
	defer os.Unsetenv("TEST_ANTHROPIC_KEY")

	prov, _ := NewAnthropic(ts.URL, "TEST_ANTHROPIC_KEY", []string{"claude-3-5-sonnet-20241022"})

	req := &ProxyRequest{
		Method:       "POST",
		Path:         "/v1/chat/completions",
		Headers:      http.Header{},
		Body:         []byte(`{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"hi"}]}`),
		Model:        "claude-3-5-sonnet-20241022",
		ProviderKeys: map[string]string{"anthropic": "sk-ant-byok-customer"},
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	if capturedKey != "sk-ant-byok-customer" {
		t.Errorf("BYOK not used, x-api-key = %q", capturedKey)
	}
}

func TestAnthropic_Forward_Endpoint(t *testing.T) {
	var capturedPath string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		w.WriteHeader(200)
		w.Write([]byte(`{"id":"msg_01","type":"message","usage":{"input_tokens":10,"output_tokens":5}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_ANTHROPIC_KEY", "sk-ant-test")
	defer os.Unsetenv("TEST_ANTHROPIC_KEY")

	prov, _ := NewAnthropic(ts.URL, "TEST_ANTHROPIC_KEY", []string{"claude-3-5-sonnet-20241022"})

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    []byte(`{"model":"claude-3-5-sonnet-20241022","messages":[{"role":"user","content":"hi"}]}`),
		Model:   "claude-3-5-sonnet-20241022",
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	// Anthropic uses a hardcoded /v1/messages endpoint, NOT the incoming path
	if capturedPath != "/v1/messages" {
		t.Errorf("path = %q, want '/v1/messages'", capturedPath)
	}
}

func TestAnthropic_Forward_Streaming(t *testing.T) {
	var capturedBody []byte

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(200)
		w.Write([]byte(`{"id":"msg_01","type":"message","usage":{"input_tokens":10,"output_tokens":5}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_ANTHROPIC_KEY", "sk-ant-test")
	defer os.Unsetenv("TEST_ANTHROPIC_KEY")

	prov, _ := NewAnthropic(ts.URL, "TEST_ANTHROPIC_KEY", []string{"claude-3-5-sonnet-20241022"})

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    mockOpenAIBody("claude-3-5-sonnet-20241022", true),
		Model:   "claude-3-5-sonnet-20241022",
		Stream:  true,
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	var antReq anthropicRequest
	json.Unmarshal(capturedBody, &antReq)

	if !antReq.Stream {
		t.Error("stream should be true in Anthropic request")
	}
}

// ═══════════════════════════════════════════════════════════════════
// Google (Gemini) Adapter Tests
// ═══════════════════════════════════════════════════════════════════

func TestGoogle_Forward_TransformsFormat(t *testing.T) {
	var capturedBody []byte
	var capturedPath string
	var capturedHeaders http.Header

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		capturedPath = r.URL.Path
		capturedHeaders = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"Hello!"}]}}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":5,"totalTokenCount":25}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_GOOGLE_KEY", "AIza-test-key")
	defer os.Unsetenv("TEST_GOOGLE_KEY")

	prov, err := NewGoogle(ts.URL, "TEST_GOOGLE_KEY", []string{"gemini-1.5-pro"})
	if err != nil {
		t.Fatalf("NewGoogle: %v", err)
	}

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    mockOpenAIBody("gemini-1.5-pro", false),
		Model:   "gemini-1.5-pro",
		Stream:  false,
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	// Verify URL format: /v1beta/models/{model}:generateContent
	if capturedPath != "/v1beta/models/gemini-1.5-pro:generateContent" {
		t.Errorf("path = %q, want '/v1beta/models/gemini-1.5-pro:generateContent'", capturedPath)
	}

	// Verify auth header (not query param)
	if capturedHeaders.Get("x-goog-api-key") != "AIza-test-key" {
		t.Errorf("x-goog-api-key = %q, want 'AIza-test-key'", capturedHeaders.Get("x-goog-api-key"))
	}

	// Verify body transformation
	var gemReq geminiRequest
	if err := json.Unmarshal(capturedBody, &gemReq); err != nil {
		t.Fatalf("unmarshal Gemini request: %v", err)
	}

	// System instruction should be extracted
	if gemReq.SystemInstruction == nil {
		t.Fatal("systemInstruction should not be nil")
	}
	if len(gemReq.SystemInstruction.Parts) != 1 || gemReq.SystemInstruction.Parts[0].Text != "You are a helpful assistant." {
		t.Errorf("systemInstruction = %+v, want 'You are a helpful assistant.'", gemReq.SystemInstruction)
	}

	// Contents should have only user messages (no system)
	if len(gemReq.Contents) != 1 {
		t.Fatalf("expected 1 content (user only), got %d", len(gemReq.Contents))
	}
	if gemReq.Contents[0].Role != "user" {
		t.Errorf("content[0].role = %q, want 'user'", gemReq.Contents[0].Role)
	}
	if len(gemReq.Contents[0].Parts) != 1 || gemReq.Contents[0].Parts[0].Text != "Say hello" {
		t.Errorf("content[0].parts = %+v, want [{Text: 'Say hello'}]", gemReq.Contents[0].Parts)
	}

	// Generation config should carry max_tokens and temperature
	if gemReq.GenerationConfig == nil {
		t.Fatal("generationConfig should not be nil")
	}
	if gemReq.GenerationConfig.MaxOutputTokens != 100 {
		t.Errorf("maxOutputTokens = %d, want 100", gemReq.GenerationConfig.MaxOutputTokens)
	}
	if gemReq.GenerationConfig.Temperature == nil || *gemReq.GenerationConfig.Temperature != 0.7 {
		t.Errorf("temperature not forwarded correctly")
	}

	// Verify response metadata
	if resp.Provider != "google" {
		t.Errorf("provider = %q, want 'google'", resp.Provider)
	}
}

func TestGoogle_Forward_AssistantToModel(t *testing.T) {
	var capturedBody []byte

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(200)
		w.Write([]byte(`{"candidates":[],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_GOOGLE_KEY", "AIza-test")
	defer os.Unsetenv("TEST_GOOGLE_KEY")

	prov, _ := NewGoogle(ts.URL, "TEST_GOOGLE_KEY", []string{"gemini-1.5-pro"})

	// OpenAI uses "assistant", Gemini uses "model"
	body := `{"model":"gemini-1.5-pro","messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"},{"role":"user","content":"how are you?"}]}`
	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    []byte(body),
		Model:   "gemini-1.5-pro",
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	var gemReq geminiRequest
	json.Unmarshal(capturedBody, &gemReq)

	if len(gemReq.Contents) != 3 {
		t.Fatalf("expected 3 contents, got %d", len(gemReq.Contents))
	}

	// "assistant" should be mapped to "model"
	if gemReq.Contents[1].Role != "model" {
		t.Errorf("assistant role mapped to %q, want 'model'", gemReq.Contents[1].Role)
	}
}

func TestGoogle_Forward_StreamingURL(t *testing.T) {
	var capturedPath string
	var capturedQuery string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedQuery = r.URL.RawQuery
		w.WriteHeader(200)
		w.Write([]byte(`{"candidates":[]}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_GOOGLE_KEY", "AIza-test")
	defer os.Unsetenv("TEST_GOOGLE_KEY")

	prov, _ := NewGoogle(ts.URL, "TEST_GOOGLE_KEY", []string{"gemini-1.5-flash"})

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    []byte(`{"model":"gemini-1.5-flash","messages":[{"role":"user","content":"hi"}]}`),
		Model:   "gemini-1.5-flash",
		Stream:  true,
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	// Streaming should use streamGenerateContent with alt=sse
	expectedPath := "/v1beta/models/gemini-1.5-flash:streamGenerateContent"
	if capturedPath != expectedPath {
		t.Errorf("path = %q, want %q", capturedPath, expectedPath)
	}
	if capturedQuery != "alt=sse" {
		t.Errorf("query = %q, want 'alt=sse'", capturedQuery)
	}
}

func TestGoogle_Forward_BYOK(t *testing.T) {
	var capturedKey string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedKey = r.Header.Get("x-goog-api-key")
		w.WriteHeader(200)
		w.Write([]byte(`{"candidates":[]}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_GOOGLE_KEY", "AIza-default")
	defer os.Unsetenv("TEST_GOOGLE_KEY")

	prov, _ := NewGoogle(ts.URL, "TEST_GOOGLE_KEY", []string{"gemini-1.5-pro"})

	req := &ProxyRequest{
		Method:       "POST",
		Path:         "/v1/chat/completions",
		Headers:      http.Header{},
		Body:         []byte(`{"model":"gemini-1.5-pro","messages":[{"role":"user","content":"hi"}]}`),
		Model:        "gemini-1.5-pro",
		ProviderKeys: map[string]string{"google": "AIza-byok-customer"},
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	if capturedKey != "AIza-byok-customer" {
		t.Errorf("BYOK not used, x-goog-api-key = %q", capturedKey)
	}
}

func TestGoogle_Forward_NoMaxTokens(t *testing.T) {
	var capturedBody []byte

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(200)
		w.Write([]byte(`{"candidates":[]}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_GOOGLE_KEY", "AIza-test")
	defer os.Unsetenv("TEST_GOOGLE_KEY")

	prov, _ := NewGoogle(ts.URL, "TEST_GOOGLE_KEY", []string{"gemini-1.5-pro"})

	// No max_tokens, no temperature → generationConfig should be nil
	body := `{"model":"gemini-1.5-pro","messages":[{"role":"user","content":"hi"}]}`
	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    []byte(body),
		Model:   "gemini-1.5-pro",
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	var gemReq geminiRequest
	json.Unmarshal(capturedBody, &gemReq)

	if gemReq.GenerationConfig != nil {
		t.Errorf("generationConfig should be nil when no max_tokens/temperature, got %+v", gemReq.GenerationConfig)
	}
}

// ═══════════════════════════════════════════════════════════════════
// Mistral Adapter Tests
// ═══════════════════════════════════════════════════════════════════

func TestMistral_Forward_PassesThrough(t *testing.T) {
	var capturedBody []byte
	var capturedAuth string
	var capturedPath string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		capturedAuth = r.Header.Get("Authorization")
		capturedPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write([]byte(`{"id":"cmpl-test","choices":[{"message":{"role":"assistant","content":"Bonjour!"}}],"usage":{"prompt_tokens":15,"completion_tokens":3}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_MISTRAL_KEY", "mist-test-key")
	defer os.Unsetenv("TEST_MISTRAL_KEY")

	prov, err := NewMistral(ts.URL, "TEST_MISTRAL_KEY", []string{"mistral-large-latest"})
	if err != nil {
		t.Fatalf("NewMistral: %v", err)
	}

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{"Content-Type": {"application/json"}},
		Body:    mockOpenAIBody("mistral-large-latest", false),
		Model:   "mistral-large-latest",
		Stream:  false,
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	// Mistral is OpenAI-compatible: path and body pass through
	if capturedPath != "/v1/chat/completions" {
		t.Errorf("path = %q, want '/v1/chat/completions'", capturedPath)
	}
	if capturedAuth != "Bearer mist-test-key" {
		t.Errorf("auth = %q, want 'Bearer mist-test-key'", capturedAuth)
	}

	// Body should be identical to input (OpenAI-compatible)
	var parsed map[string]interface{}
	json.Unmarshal(capturedBody, &parsed)
	if parsed["model"] != "mistral-large-latest" {
		t.Errorf("model = %v, want 'mistral-large-latest'", parsed["model"])
	}

	if resp.Provider != "mistral" {
		t.Errorf("provider = %q, want 'mistral'", resp.Provider)
	}
}

func TestMistral_Forward_BYOK(t *testing.T) {
	var capturedAuth string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		w.WriteHeader(200)
		w.Write([]byte(`{"id":"cmpl-test","usage":{"prompt_tokens":10,"completion_tokens":5}}`))
	}))
	defer ts.Close()

	os.Setenv("TEST_MISTRAL_KEY", "mist-default")
	defer os.Unsetenv("TEST_MISTRAL_KEY")

	prov, _ := NewMistral(ts.URL, "TEST_MISTRAL_KEY", []string{"mistral-large-latest"})

	req := &ProxyRequest{
		Method:       "POST",
		Path:         "/v1/chat/completions",
		Headers:      http.Header{},
		Body:         []byte(`{"model":"mistral-large-latest","messages":[{"role":"user","content":"hi"}]}`),
		Model:        "mistral-large-latest",
		ProviderKeys: map[string]string{"mistral": "mist-byok-customer"},
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	if capturedAuth != "Bearer mist-byok-customer" {
		t.Errorf("BYOK not used, auth = %q", capturedAuth)
	}
}

// ═══════════════════════════════════════════════════════════════════
// Azure Adapter Tests
// ═══════════════════════════════════════════════════════════════════

func TestAzure_Forward_DeploymentURL(t *testing.T) {
	var capturedPath string
	var capturedQuery string
	var capturedKey string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedPath = r.URL.Path
		capturedQuery = r.URL.RawQuery
		capturedKey = r.Header.Get("api-key")
		w.WriteHeader(200)
		w.Write([]byte(mockOpenAIResponse()))
	}))
	defer ts.Close()

	os.Setenv("TEST_AZURE_KEY", "azure-test-key")
	defer os.Unsetenv("TEST_AZURE_KEY")

	prov, err := NewAzure(ts.URL, "TEST_AZURE_KEY", []string{"gpt-4o"})
	if err != nil {
		t.Fatalf("NewAzure: %v", err)
	}

	req := &ProxyRequest{
		Method:  "POST",
		Path:    "/v1/chat/completions",
		Headers: http.Header{},
		Body:    mockOpenAIBody("gpt-4o", false),
		Model:   "gpt-4o",
		Stream:  false,
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	// Azure uses deployment-based URL
	expectedPath := "/openai/deployments/gpt-4o/chat/completions"
	if capturedPath != expectedPath {
		t.Errorf("path = %q, want %q", capturedPath, expectedPath)
	}

	// API version in query string
	if !strings.Contains(capturedQuery, "api-version=2024-02-01") {
		t.Errorf("query = %q, want api-version=2024-02-01", capturedQuery)
	}

	// Azure uses api-key header (not Authorization)
	if capturedKey != "azure-test-key" {
		t.Errorf("api-key = %q, want 'azure-test-key'", capturedKey)
	}

	if resp.Provider != "azure" {
		t.Errorf("provider = %q, want 'azure'", resp.Provider)
	}
}

func TestAzure_Forward_BYOK(t *testing.T) {
	var capturedKey string

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedKey = r.Header.Get("api-key")
		w.WriteHeader(200)
		w.Write([]byte(mockOpenAIResponse()))
	}))
	defer ts.Close()

	os.Setenv("TEST_AZURE_KEY", "azure-default")
	defer os.Unsetenv("TEST_AZURE_KEY")

	prov, _ := NewAzure(ts.URL, "TEST_AZURE_KEY", []string{"gpt-4o"})

	req := &ProxyRequest{
		Method:       "POST",
		Path:         "/v1/chat/completions",
		Headers:      http.Header{},
		Body:         mockOpenAIBody("gpt-4o", false),
		Model:        "gpt-4o",
		ProviderKeys: map[string]string{"azure": "azure-byok-customer"},
	}

	resp, err := prov.Forward(context.Background(), req)
	if err != nil {
		t.Fatalf("Forward: %v", err)
	}
	defer resp.Body.Close()

	if capturedKey != "azure-byok-customer" {
		t.Errorf("BYOK not used, api-key = %q", capturedKey)
	}
}

// ═══════════════════════════════════════════════════════════════════
// Provider Interface & Metadata Tests
// ═══════════════════════════════════════════════════════════════════

func TestEstimateCostFromConfig(t *testing.T) {
	costs := map[string]ModelCostInfo{
		"gpt-4o": {InputCostPer1K: 0.25, OutputCostPer1K: 1.0},
	}

	tests := []struct {
		name           string
		model          string
		bodyLen        int
		defaultCost    float64
		expectedMinCnt int // at least this many cents
	}{
		{"known model small body", "gpt-4o", 100, 0.25, 1},
		{"known model large body", "gpt-4o", 40000, 0.25, 2},
		{"unknown model uses default", "unknown-model", 4000, 0.5, 1},
		{"very small body", "gpt-4o", 4, 0.25, 1}, // min 10 tokens
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cents := EstimateCostFromConfig(costs, tc.model, tc.bodyLen, tc.defaultCost)
			if cents < tc.expectedMinCnt {
				t.Errorf("EstimateCostFromConfig() = %d cents, want >= %d", cents, tc.expectedMinCnt)
			}
		})
	}
}

func TestProviderNames(t *testing.T) {
	os.Setenv("TEST_KEY", "test")
	defer os.Unsetenv("TEST_KEY")

	tests := []struct {
		name     string
		provider func() (interface{ Name() string }, error)
		expected string
	}{
		{"openai", func() (interface{ Name() string }, error) { return NewOpenAI("http://x", "TEST_KEY", nil) }, "openai"},
		{"anthropic", func() (interface{ Name() string }, error) { return NewAnthropic("http://x", "TEST_KEY", nil) }, "anthropic"},
		{"google", func() (interface{ Name() string }, error) { return NewGoogle("http://x", "TEST_KEY", nil) }, "google"},
		{"mistral", func() (interface{ Name() string }, error) { return NewMistral("http://x", "TEST_KEY", nil) }, "mistral"},
		{"azure", func() (interface{ Name() string }, error) { return NewAzure("http://x", "TEST_KEY", nil) }, "azure"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			prov, err := tc.provider()
			if err != nil {
				t.Fatalf("init: %v", err)
			}
			if prov.Name() != tc.expected {
				t.Errorf("Name() = %q, want %q", prov.Name(), tc.expected)
			}
		})
	}
}

func TestProvider_MissingEnvVar(t *testing.T) {
	os.Unsetenv("MISSING_KEY")

	_, err := NewOpenAI("http://x", "MISSING_KEY", nil)
	if err == nil {
		t.Error("NewOpenAI should fail with missing env var")
	}

	_, err = NewAnthropic("http://x", "MISSING_KEY", nil)
	if err == nil {
		t.Error("NewAnthropic should fail with missing env var")
	}

	_, err = NewGoogle("http://x", "MISSING_KEY", nil)
	if err == nil {
		t.Error("NewGoogle should fail with missing env var")
	}

	_, err = NewMistral("http://x", "MISSING_KEY", nil)
	if err == nil {
		t.Error("NewMistral should fail with missing env var")
	}

	_, err = NewAzure("http://x", "MISSING_KEY", nil)
	if err == nil {
		t.Error("NewAzure should fail with missing env var")
	}
}
