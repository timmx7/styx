// Package proxy — autoroute.go
// Pure-Go 9-signal complexity scorer and virtual model resolver for styx:auto routing.
// No network calls: runs entirely in-process on every auto-routed request.
package proxy

import (
	"encoding/json"
	"strings"
)

// autoModelTier maps virtual styx:* model names to a forced tier.
// Empty string means "score the request and pick dynamically".
var autoModelTier = map[string]string{
	"styx:auto":     "",         // dynamic: scored by ScoreRequest
	"styx:fast":     "light",    // always picks cheapest / fastest
	"styx:balanced": "medium",   // always picks balanced
	"styx:frontier": "heavy",    // always picks most powerful
}

// IsAutoModel reports whether model is a virtual styx:* name.
// If ok is true, forcedTier is the tier to use (empty = score dynamically).
func IsAutoModel(model string) (forcedTier string, ok bool) {
	tier, ok := autoModelTier[model]
	return tier, ok
}

// scoreRequest applies 9 heuristic signals to the raw JSON request body and
// returns a score in [0, 100] and the corresponding tier string.
//
// Scoring bands:
//
//	0–29  → "light"   (cheap, fast)
//	30–59 → "medium"  (balanced)
//	60+   → "heavy"   (powerful)
func ScoreRequest(body []byte) (score int, tier string) {
	// Parse just the fields we need — ignores unknown fields cheaply.
	var req struct {
		Model     string `json:"model"`
		MaxTokens int    `json:"max_tokens"`
		Messages  []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		ResponseFormat struct {
			Type string `json:"type"`
		} `json:"response_format"`
	}
	_ = json.Unmarshal(body, &req)

	// Collect the full prompt text across all messages.
	var sb strings.Builder
	hasSystem := false
	for _, m := range req.Messages {
		if m.Role == "system" {
			hasSystem = true
		}
		sb.WriteString(m.Content)
		sb.WriteByte(' ')
	}
	prompt := strings.ToLower(sb.String())

	// ── Signal 1: raw body size as token proxy ────────────────────────────
	// ~4 bytes ≈ 1 token (GPT tokeniser rough average)
	switch {
	case len(body) >= 8000: // ≈2000 tokens
		score += 30
	case len(body) >= 2000: // ≈500 tokens
		score += 15
	}

	// ── Signal 2: multi-turn conversation ────────────────────────────────
	if len(req.Messages) > 3 {
		score += 20
	}

	// ── Signal 3: system prompt present ──────────────────────────────────
	if hasSystem {
		score += 10
	}

	// ── Signal 4: code-generation keywords ───────────────────────────────
	codeKeywords := []string{
		"def ", "function ", "class ", " = ", "import ", "return ",
		"```", "algorithm", "implement", "refactor", "debug",
	}
	codeHits := 0
	for _, kw := range codeKeywords {
		if strings.Contains(prompt, kw) {
			codeHits++
		}
	}
	if codeHits >= 2 {
		score += 15
	}

	// ── Signal 5: math / reasoning markers ───────────────────────────────
	mathKeywords := []string{
		"solve", "prove", "equation", "formula", "theorem",
		"∑", "∫", "derivative", "integral", "calculus",
		"logic", "deduce", "infer",
	}
	mathHits := 0
	for _, kw := range mathKeywords {
		if strings.Contains(prompt, kw) {
			mathHits++
		}
	}
	if mathHits >= 1 {
		score += 15
	}

	// ── Signal 6: structured output requested ────────────────────────────
	bodyLower := strings.ToLower(string(body))
	if req.ResponseFormat.Type == "json_object" ||
		strings.Contains(bodyLower, `"schema"`) ||
		strings.Contains(bodyLower, `"json_schema"`) {
		score += 10
	}

	// ── Signal 7: long max_tokens ─────────────────────────────────────────
	switch {
	case req.MaxTokens >= 2000:
		score += 15
	case req.MaxTokens >= 1000:
		score += 8
	}

	// ── Signal 8: explicit complexity signals in prompt ───────────────────
	complexSignals := []string{
		"step by step", "step-by-step", "detailed", "comprehensive",
		"in-depth", "thorough", "exhaustive", "explain everything",
		"complete guide", "full solution",
	}
	for _, s := range complexSignals {
		if strings.Contains(prompt, s) {
			score += 10
			break // only count once
		}
	}

	// ── Signal 9: question depth (chained questions) ──────────────────────
	questionCount := strings.Count(prompt, "?")
	if questionCount >= 3 {
		score += 5
	}

	// ── Cap at 100 ────────────────────────────────────────────────────────
	if score > 100 {
		score = 100
	}

	// ── Map score to tier ─────────────────────────────────────────────────
	switch {
	case score >= 60:
		tier = "heavy"
	case score >= 30:
		tier = "medium"
	default:
		tier = "light"
	}
	return score, tier
}

// rewriteModel replaces the "model" field in a JSON request body.
// Returns the original body unchanged if parsing fails.
func rewriteModel(body []byte, model string) []byte {
	var req map[string]interface{}
	if err := json.Unmarshal(body, &req); err != nil {
		return body
	}
	req["model"] = model
	out, err := json.Marshal(req)
	if err != nil {
		return body
	}
	return out
}
