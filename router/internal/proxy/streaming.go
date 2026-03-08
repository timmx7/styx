package proxy

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/styx/router/internal/providers"
)

// readDeadlineReader wraps an io.ReadCloser to enforce a per-read timeout.
// If no data is received within the deadline, the read returns a timeout error.
// This prevents the proxy from hanging indefinitely if a provider stops sending data.
type readDeadlineReader struct {
	inner    io.ReadCloser
	timeout  time.Duration
	timer    *time.Timer
	timedOut bool // tracks whether a timeout has occurred
	done     chan struct{}
}

func newReadDeadlineReader(r io.ReadCloser, timeout time.Duration) *readDeadlineReader {
	return &readDeadlineReader{
		inner:   r,
		timeout: timeout,
		timer:   time.NewTimer(timeout),
		done:    make(chan struct{}),
	}
}

func (r *readDeadlineReader) Read(p []byte) (int, error) {
	// If a previous read timed out, the inner reader may have a leaked
	// goroutine still blocked on Read. Don't start another one.
	if r.timedOut {
		return 0, &net.OpError{
			Op:  "read",
			Net: "tcp",
			Err: &timeoutError{},
		}
	}

	// Reset the timer for each read
	if !r.timer.Stop() {
		select {
		case <-r.timer.C:
		default:
		}
	}
	r.timer.Reset(r.timeout)

	type result struct {
		n   int
		err error
	}

	// Use a private buffer so that the goroutine never writes into the
	// caller's slice after a timeout (the caller may reuse p immediately).
	// We use a plain allocation here instead of bufPool because on timeout
	// the goroutine may still be blocked on Read holding a reference to
	// this buffer. A pool buffer would never be returned in that case,
	// defeating the purpose of the pool and leaking the buffer.
	buf := make([]byte, len(p))
	ch := make(chan result, 1)
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				ch <- result{0, fmt.Errorf("read panic: %v", rec)}
			}
		}()
		n, err := r.inner.Read(buf)
		ch <- result{n, err}
	}()

	select {
	case res := <-ch:
		copy(p[:res.n], buf[:res.n])
		return res.n, res.err
	case <-r.timer.C:
		r.timedOut = true
		// Close the inner reader to unblock the goroutine stuck on Read.
		// For TCP-backed HTTP response bodies, closing the underlying
		// connection will cause the blocked Read to return with an error,
		// allowing the goroutine to exit. This is acceptable behavior for
		// HTTP bodies since the connection is no longer usable after a
		// stream timeout anyway.
		r.inner.Close()
		return 0, &net.OpError{
			Op:  "read",
			Net: "tcp",
			Err: &timeoutError{},
		}
	case <-r.done:
		return 0, &net.OpError{
			Op:  "read",
			Net: "tcp",
			Err: &timeoutError{},
		}
	}
}

func (r *readDeadlineReader) Close() error {
	r.timer.Stop()
	// Signal any in-flight Read goroutine to stop waiting on the timer.
	select {
	case <-r.done:
		// Already closed
	default:
		close(r.done)
	}
	return r.inner.Close()
}

// timeoutError implements net.Error for deadline exceeded.
type timeoutError struct{}

func (e *timeoutError) Error() string   { return "stream read timeout: no data received within deadline" }
func (e *timeoutError) Timeout() bool   { return true }
func (e *timeoutError) Temporary() bool { return true }

// StreamUsage holds the token usage extracted from a streaming response.
type StreamUsage struct {
	InputTokens  int
	OutputTokens int
	FullResponse string
}

// streamResponse handles SSE streaming responses from the provider to the client.
// It transparently passes all chunks to the client while extracting token usage
// from the stream data.
//
// Token extraction strategy:
//
//   - Each SSE "data: {...}" line is parsed for usage information.
//   - We keep the maximum values seen, because the final chunk typically
//     contains the complete totals (OpenAI, Mistral, Azure, Anthropic, Google).
//   - The scan is zero-copy for the client: every line is forwarded immediately.
//
// Provider-specific streaming formats:
//
//	OpenAI / Mistral / Azure (with stream_options.include_usage):
//	  data: {"usage":{"prompt_tokens":X,"completion_tokens":Y}}
//
//	Anthropic:
//	  event: message_start → data: {"message":{"usage":{"input_tokens":X}}}
//	  event: message_delta → data: {"usage":{"output_tokens":Y}}
//
//	Google Gemini:
//	  data: {"usageMetadata":{"promptTokenCount":X,"candidatesTokenCount":Y}}
func streamResponse(ctx context.Context, w http.ResponseWriter, resp *providers.ProxyResponse, reqPath string) StreamUsage {
	flusher, ok := w.(http.Flusher)
	if !ok {
		slog.Error("response writer does not support flushing, falling back to buffered response")
		w.WriteHeader(resp.StatusCode)
		return StreamUsage{}
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering
	w.WriteHeader(resp.StatusCode)
	flusher.Flush()

	var usage StreamUsage
	var responseBuilder strings.Builder
	provider := resp.Provider

	// Wrap the response body with a read deadline to prevent hanging
	// if the provider stops sending data mid-stream. Each individual read
	// must complete within 2 minutes; the overall stream can run longer.
	deadlineBody := newReadDeadlineReader(resp.Body, 2*time.Minute)
	defer deadlineBody.Close()

	scanner := bufio.NewScanner(deadlineBody)
	// Increase scanner buffer for large chunks
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		// Check if client context is cancelled (client disconnected)
		select {
		case <-ctx.Done():
			slog.Debug("client context cancelled during streaming")
			usage.FullResponse = responseBuilder.String()
			return usage
		default:
		}

		line := scanner.Text()

		// Try to extract usage from data lines (using the original provider format)
		extractStreamUsage(line, provider, &usage)

		outLine := line
		// Convert Anthropic format to OpenAI compatible format
		if provider == "anthropic" && reqPath == "/v1/chat/completions" {
			outLine = convertAnthropicStreamLineToOpenAI(line, resp.Model)
			if outLine == "" {
				continue // Skip lines that don't map to OpenAI
			}
			// When we convert a data chunk successfully, we MUST append an extra newline
			// because we skipped the provider's original empty lines!
			outLine = outLine + "\n"
		}

		// Write the line followed by newline (SSE format)
		_, err := w.Write([]byte(outLine + "\n"))
		if err != nil {
			slog.Debug("client disconnected during streaming", "error", err)
			usage.FullResponse = responseBuilder.String()
			return usage
		}
		flusher.Flush()

		responseBuilder.WriteString(outLine)
		responseBuilder.WriteString("\n")
	}

	if err := scanner.Err(); err != nil {
		slog.Error("error reading stream from provider", "error", err)
	}

	usage.FullResponse = responseBuilder.String()
	return usage
}

// extractStreamUsage attempts to parse token usage from a single SSE line.
// It updates the usage struct with the maximum values found.
//
// We keep max values because:
//   - Some providers send partial counts early, then full counts at the end
//   - Anthropic sends input_tokens in message_start and output_tokens in message_delta
//   - OpenAI sends the full usage in the final chunk (before [DONE])
func extractStreamUsage(line, provider string, usage *StreamUsage) {
	// SSE data lines start with "data: "
	if !strings.HasPrefix(line, "data: ") {
		return
	}

	data := strings.TrimPrefix(line, "data: ")

	// Skip the termination signal
	if data == "[DONE]" {
		return
	}

	// Try parsing the JSON chunk for usage data
	input, output := parseStreamChunk([]byte(data), provider)

	// Keep the maximum values seen (final chunk has complete totals)
	if input > usage.InputTokens {
		usage.InputTokens = input
	}
	if output > usage.OutputTokens {
		usage.OutputTokens = output
	}
}

// ─── Stream chunk parsing (multi-provider) ───────────────────────────
//
// Each provider nests usage in a different location within stream chunks.
// We use a union struct approach (same as parseUsage for non-streaming).

// streamChunk is a union struct that can capture usage from any provider's
// streaming format. JSON unmarshalling fills whichever fields match.
type streamChunk struct {
	// OpenAI / Mistral / Azure — final chunk
	// {"usage":{"prompt_tokens":X,"completion_tokens":Y}}
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		InputTokens      int `json:"input_tokens"`
		OutputTokens     int `json:"output_tokens"`
	} `json:"usage"`

	// Anthropic — message_start event
	// {"type":"message_start","message":{"usage":{"input_tokens":X}}}
	Message *struct {
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	} `json:"message,omitempty"`

	// Google Gemini — every chunk may contain usageMetadata
	// {"usageMetadata":{"promptTokenCount":X,"candidatesTokenCount":Y}}
	UsageMetadata struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
	} `json:"usageMetadata"`
}

// parseStreamChunk extracts (inputTokens, outputTokens) from a single stream chunk.
// Returns (0, 0) if no usage data is found — never panics.
func parseStreamChunk(data []byte, provider string) (int, int) {
	var chunk streamChunk
	if err := json.Unmarshal(data, &chunk); err != nil {
		return 0, 0
	}

	switch provider {
	case "anthropic":
		// Anthropic sends input_tokens in message_start, output_tokens in message_delta
		input, output := 0, 0

		// Check message.usage (message_start event)
		if chunk.Message != nil {
			input = chunk.Message.Usage.InputTokens
			output = chunk.Message.Usage.OutputTokens
		}

		// Check top-level usage (message_delta event)
		if chunk.Usage.InputTokens > input {
			input = chunk.Usage.InputTokens
		}
		if chunk.Usage.OutputTokens > output {
			output = chunk.Usage.OutputTokens
		}

		return input, output

	case "google":
		// Gemini uses usageMetadata
		if chunk.UsageMetadata.PromptTokenCount > 0 || chunk.UsageMetadata.CandidatesTokenCount > 0 {
			return chunk.UsageMetadata.PromptTokenCount, chunk.UsageMetadata.CandidatesTokenCount
		}
		// Fallback to OpenAI-compatible fields
		return chunk.Usage.PromptTokens, chunk.Usage.CompletionTokens

	default:
		// OpenAI, Mistral, Azure — usage in the final chunk
		if chunk.Usage.PromptTokens > 0 || chunk.Usage.CompletionTokens > 0 {
			return chunk.Usage.PromptTokens, chunk.Usage.CompletionTokens
		}
		// Fallback to anthropic field names
		if chunk.Usage.InputTokens > 0 || chunk.Usage.OutputTokens > 0 {
			return chunk.Usage.InputTokens, chunk.Usage.OutputTokens
		}
		return 0, 0
	}
}

// ─── Stream Conversion (Anthropic -> OpenAI) ──────────────────────

func convertAnthropicStreamLineToOpenAI(line string, model string) string {
	if line == "" || strings.HasPrefix(line, "event:") {
		// Ignore empty lines and event declarations
		return ""
	}
	if !strings.HasPrefix(line, "data: ") {
		return ""
	}
	dataStr := strings.TrimSpace(strings.TrimPrefix(line, "data: "))
	if dataStr == "[DONE]" {
		return line
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(dataStr), &parsed); err != nil {
		return ""
	}

	evtType, _ := parsed["type"].(string)

	switch evtType {
	case "content_block_delta":
		delta, ok := parsed["delta"].(map[string]interface{})
		if !ok {
			return ""
		}
		text, _ := delta["text"].(string)

		oaiChunk := map[string]interface{}{
			"id":      "chatcmpl-stream",
			"object":  "chat.completion.chunk",
			"created": time.Now().Unix(),
			"model":   model,
			"choices": []map[string]interface{}{
				{
					"index": 0,
					"delta": map[string]interface{}{
						"content": text,
					},
					"finish_reason": nil,
				},
			},
		}
		b, _ := json.Marshal(oaiChunk)
		return "data: " + string(b)

	case "message_delta":
		delta, ok := parsed["delta"].(map[string]interface{})
		if !ok {
			return ""
		}
		stopReason, _ := delta["stop_reason"].(string)
		if stopReason == "end_turn" {
			stopReason = "stop"
		} else if stopReason == "max_tokens" {
			stopReason = "length"
		}

		if stopReason != "" {
			oaiChunk := map[string]interface{}{
				"id":      "chatcmpl-stream",
				"object":  "chat.completion.chunk",
				"created": time.Now().Unix(),
				"model":   model,
				"choices": []map[string]interface{}{
					{
						"index":         0,
						"delta":         map[string]interface{}{},
						"finish_reason": stopReason,
					},
				},
			}
			b, _ := json.Marshal(oaiChunk)
			return "data: " + string(b)
		}
		return ""
	default:
		// Skip message_start, message_stop, content_block_start, content_block_stop
		return ""
	}
}
