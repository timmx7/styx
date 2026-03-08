package proxy

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/styx/router/internal/providers"
)

// ─── parseStreamChunk tests ──────────────────────────────────────

func TestParseStreamChunk_OpenAI(t *testing.T) {
	// OpenAI final chunk with usage (when stream_options.include_usage=true)
	data := `{"id":"chatcmpl-abc","choices":[],"usage":{"prompt_tokens":150,"completion_tokens":42,"total_tokens":192}}`
	input, output := parseStreamChunk([]byte(data), "openai")

	if input != 150 || output != 42 {
		t.Errorf("openai chunk: got (%d, %d), want (150, 42)", input, output)
	}
}

func TestParseStreamChunk_OpenAI_NoUsage(t *testing.T) {
	// Regular streaming chunk (no usage)
	data := `{"id":"chatcmpl-abc","choices":[{"delta":{"content":"Hello"}}]}`
	input, output := parseStreamChunk([]byte(data), "openai")

	if input != 0 || output != 0 {
		t.Errorf("openai chunk without usage: got (%d, %d), want (0, 0)", input, output)
	}
}

func TestParseStreamChunk_Anthropic_MessageStart(t *testing.T) {
	// Anthropic message_start event with input_tokens
	data := `{"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet","usage":{"input_tokens":250,"output_tokens":0}}}`
	input, output := parseStreamChunk([]byte(data), "anthropic")

	if input != 250 {
		t.Errorf("anthropic message_start: input got %d, want 250", input)
	}
	if output != 0 {
		t.Errorf("anthropic message_start: output got %d, want 0", output)
	}
}

func TestParseStreamChunk_Anthropic_MessageDelta(t *testing.T) {
	// Anthropic message_delta event with output_tokens
	data := `{"type":"message_delta","usage":{"output_tokens":103}}`
	input, output := parseStreamChunk([]byte(data), "anthropic")

	if input != 0 {
		t.Errorf("anthropic message_delta: input got %d, want 0", input)
	}
	if output != 103 {
		t.Errorf("anthropic message_delta: output got %d, want 103", output)
	}
}

func TestParseStreamChunk_Google(t *testing.T) {
	// Gemini streaming chunk with usageMetadata
	data := `{"candidates":[{"content":{"parts":[{"text":"Hi"}]}}],"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":75,"totalTokenCount":105}}`
	input, output := parseStreamChunk([]byte(data), "google")

	if input != 30 || output != 75 {
		t.Errorf("google chunk: got (%d, %d), want (30, 75)", input, output)
	}
}

func TestParseStreamChunk_Mistral(t *testing.T) {
	// Mistral uses OpenAI-compatible format
	data := `{"usage":{"prompt_tokens":88,"completion_tokens":200}}`
	input, output := parseStreamChunk([]byte(data), "mistral")

	if input != 88 || output != 200 {
		t.Errorf("mistral chunk: got (%d, %d), want (88, 200)", input, output)
	}
}

func TestParseStreamChunk_Azure(t *testing.T) {
	data := `{"usage":{"prompt_tokens":500,"completion_tokens":1024}}`
	input, output := parseStreamChunk([]byte(data), "azure")

	if input != 500 || output != 1024 {
		t.Errorf("azure chunk: got (%d, %d), want (500, 1024)", input, output)
	}
}

func TestParseStreamChunk_InvalidJSON(t *testing.T) {
	data := `not json at all`
	input, output := parseStreamChunk([]byte(data), "openai")

	if input != 0 || output != 0 {
		t.Errorf("invalid json: got (%d, %d), want (0, 0)", input, output)
	}
}

func TestParseStreamChunk_EmptyData(t *testing.T) {
	input, output := parseStreamChunk([]byte{}, "openai")

	if input != 0 || output != 0 {
		t.Errorf("empty data: got (%d, %d), want (0, 0)", input, output)
	}
}

// ─── extractStreamUsage tests ────────────────────────────────────

func TestExtractStreamUsage_DataPrefix(t *testing.T) {
	usage := StreamUsage{}
	extractStreamUsage(`data: {"usage":{"prompt_tokens":100,"completion_tokens":50}}`, "openai", &usage)

	if usage.InputTokens != 100 || usage.OutputTokens != 50 {
		t.Errorf("got (%d, %d), want (100, 50)", usage.InputTokens, usage.OutputTokens)
	}
}

func TestExtractStreamUsage_NonDataLine(t *testing.T) {
	usage := StreamUsage{}

	// Event lines, empty lines, comments — should all be ignored
	extractStreamUsage("event: message_start", "anthropic", &usage)
	extractStreamUsage("", "openai", &usage)
	extractStreamUsage(": comment", "openai", &usage)

	if usage.InputTokens != 0 || usage.OutputTokens != 0 {
		t.Errorf("non-data lines should not extract usage, got (%d, %d)", usage.InputTokens, usage.OutputTokens)
	}
}

func TestExtractStreamUsage_DoneLine(t *testing.T) {
	usage := StreamUsage{}
	extractStreamUsage("data: [DONE]", "openai", &usage)

	if usage.InputTokens != 0 || usage.OutputTokens != 0 {
		t.Errorf("[DONE] should not extract usage, got (%d, %d)", usage.InputTokens, usage.OutputTokens)
	}
}

func TestExtractStreamUsage_KeepsMaxValues(t *testing.T) {
	usage := StreamUsage{}

	// First: Anthropic message_start with input_tokens
	extractStreamUsage(
		`data: {"type":"message_start","message":{"usage":{"input_tokens":250,"output_tokens":0}}}`,
		"anthropic", &usage,
	)

	if usage.InputTokens != 250 {
		t.Errorf("after message_start: input got %d, want 250", usage.InputTokens)
	}

	// Second: content blocks (no usage)
	extractStreamUsage(
		`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}`,
		"anthropic", &usage,
	)

	// Third: message_delta with output_tokens
	extractStreamUsage(
		`data: {"type":"message_delta","usage":{"output_tokens":103}}`,
		"anthropic", &usage,
	)

	if usage.InputTokens != 250 || usage.OutputTokens != 103 {
		t.Errorf("after all chunks: got (%d, %d), want (250, 103)", usage.InputTokens, usage.OutputTokens)
	}
}

func TestExtractStreamUsage_LargerValuesOverwrite(t *testing.T) {
	usage := StreamUsage{}

	// Google sends usageMetadata in multiple chunks, last has the complete count
	extractStreamUsage(
		`data: {"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":10}}`,
		"google", &usage,
	)
	extractStreamUsage(
		`data: {"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":50}}`,
		"google", &usage,
	)
	extractStreamUsage(
		`data: {"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":75}}`,
		"google", &usage,
	)

	if usage.InputTokens != 30 || usage.OutputTokens != 75 {
		t.Errorf("should keep max: got (%d, %d), want (30, 75)", usage.InputTokens, usage.OutputTokens)
	}
}

// ─── Full streamResponse integration test ────────────────────────

func TestStreamResponse_OpenAI_WithUsage(t *testing.T) {
	// Simulate an OpenAI streaming response with usage in the final chunk
	sseBody := strings.Join([]string{
		`data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"}}]}`,
		``,
		`data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}`,
		``,
		`data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}`,
		``,
		`data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":25,"completion_tokens":8,"total_tokens":33}}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")

	resp := &providers.ProxyResponse{
		StatusCode: 200,
		Headers:    http.Header{},
		Body:       io.NopCloser(strings.NewReader(sseBody)),
		Provider:   "openai",
		Model:      "gpt-4o",
	}

	rr := httptest.NewRecorder()
	usage := streamResponse(context.Background(), rr, resp, "/v1/chat/completions")

	// Verify usage was extracted
	if usage.InputTokens != 25 {
		t.Errorf("input tokens: got %d, want 25", usage.InputTokens)
	}
	if usage.OutputTokens != 8 {
		t.Errorf("output tokens: got %d, want 8", usage.OutputTokens)
	}

	// Verify the response was still streamed to the client
	body := rr.Body.String()
	if !strings.Contains(body, "Hello") {
		t.Error("response body should contain 'Hello'")
	}
	if !strings.Contains(body, "[DONE]") {
		t.Error("response body should contain '[DONE]'")
	}

	// Verify SSE headers
	if rr.Header().Get("Content-Type") != "text/event-stream" {
		t.Errorf("expected Content-Type text/event-stream, got %s", rr.Header().Get("Content-Type"))
	}
}

func TestStreamResponse_Anthropic_WithUsage(t *testing.T) {
	sseBody := strings.Join([]string{
		`event: message_start`,
		`data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet","usage":{"input_tokens":200,"output_tokens":0}}}`,
		``,
		`event: content_block_start`,
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		``,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello world"}}`,
		``,
		`event: message_delta`,
		`data: {"type":"message_delta","usage":{"output_tokens":85}}`,
		``,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
		``,
	}, "\n")

	resp := &providers.ProxyResponse{
		StatusCode: 200,
		Headers:    http.Header{},
		Body:       io.NopCloser(strings.NewReader(sseBody)),
		Provider:   "anthropic",
		Model:      "claude-3-5-sonnet-20241022",
	}

	rr := httptest.NewRecorder()
	usage := streamResponse(context.Background(), rr, resp, "/v1/chat/completions")

	if usage.InputTokens != 200 {
		t.Errorf("anthropic input tokens: got %d, want 200", usage.InputTokens)
	}
	if usage.OutputTokens != 85 {
		t.Errorf("anthropic output tokens: got %d, want 85", usage.OutputTokens)
	}
}

func TestStreamResponse_Google_WithUsage(t *testing.T) {
	sseBody := strings.Join([]string{
		`data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}],"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":5,"totalTokenCount":35}}`,
		``,
		`data: {"candidates":[{"content":{"parts":[{"text":" there"}]}}],"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":12,"totalTokenCount":42}}`,
		``,
	}, "\n")

	resp := &providers.ProxyResponse{
		StatusCode: 200,
		Headers:    http.Header{},
		Body:       io.NopCloser(strings.NewReader(sseBody)),
		Provider:   "google",
		Model:      "gemini-1.5-pro",
	}

	rr := httptest.NewRecorder()
	usage := streamResponse(context.Background(), rr, resp, "/v1/chat/completions")

	if usage.InputTokens != 30 {
		t.Errorf("google input tokens: got %d, want 30", usage.InputTokens)
	}
	if usage.OutputTokens != 12 {
		t.Errorf("google output tokens: got %d, want 12", usage.OutputTokens)
	}
}

func TestStreamResponse_NoUsageData(t *testing.T) {
	// Stream with no usage chunks at all (older API or provider)
	sseBody := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"Hello"}}]}`,
		``,
		`data: {"choices":[{"delta":{"content":" world"}}]}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n")

	resp := &providers.ProxyResponse{
		StatusCode: 200,
		Headers:    http.Header{},
		Body:       io.NopCloser(strings.NewReader(sseBody)),
		Provider:   "openai",
		Model:      "gpt-4o",
	}

	rr := httptest.NewRecorder()
	usage := streamResponse(context.Background(), rr, resp, "/v1/chat/completions")

	if usage.InputTokens != 0 || usage.OutputTokens != 0 {
		t.Errorf("no usage chunks: got (%d, %d), want (0, 0)", usage.InputTokens, usage.OutputTokens)
	}

	// But the content should still be fully streamed
	body := rr.Body.String()
	if !strings.Contains(body, "Hello") || !strings.Contains(body, "world") {
		t.Error("response should still contain all content")
	}
}

func TestStreamResponse_EmptyBody(t *testing.T) {
	resp := &providers.ProxyResponse{
		StatusCode: 200,
		Headers:    http.Header{},
		Body:       io.NopCloser(strings.NewReader("")),
		Provider:   "openai",
		Model:      "gpt-4o",
	}

	rr := httptest.NewRecorder()
	usage := streamResponse(context.Background(), rr, resp, "/v1/chat/completions")

	if usage.InputTokens != 0 || usage.OutputTokens != 0 {
		t.Errorf("empty body: got (%d, %d), want (0, 0)", usage.InputTokens, usage.OutputTokens)
	}
}
