package proxy

import (
	"encoding/json"
	"testing"
)

// ── IsAutoModel ──────────────────────────────────────────────────────────────

func TestIsAutoModel(t *testing.T) {
	tests := []struct {
		model       string
		wantOK      bool
		wantTier    string // empty = dynamic scoring
	}{
		{"styx:auto", true, ""},
		{"styx:fast", true, "light"},
		{"styx:balanced", true, "medium"},
		{"styx:frontier", true, "heavy"},
		// Real models are NOT virtual
		{"gpt-4o", false, ""},
		{"claude-3-5-sonnet-20241022", false, ""},
		{"gemini-2.5-pro", false, ""},
		{"mistral-large-latest", false, ""},
		// Invalid / partial names
		{"styx:", false, ""},
		{"styx", false, ""},
		{"", false, ""},
	}

	for _, tc := range tests {
		t.Run(tc.model, func(t *testing.T) {
			tier, ok := IsAutoModel(tc.model)
			if ok != tc.wantOK {
				t.Errorf("IsAutoModel(%q) ok=%v, want %v", tc.model, ok, tc.wantOK)
			}
			if ok && tier != tc.wantTier {
				t.Errorf("IsAutoModel(%q) tier=%q, want %q", tc.model, tier, tc.wantTier)
			}
		})
	}
}

// ── ScoreRequest ─────────────────────────────────────────────────────────────

func buildBody(t *testing.T, v map[string]interface{}) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return b
}

func TestScoreRequest_SimpleTier(t *testing.T) {
	body := buildBody(t, map[string]interface{}{
		"model": "styx:auto",
		"messages": []map[string]interface{}{
			{"role": "user", "content": "Hi"},
		},
	})
	score, tier := ScoreRequest(body)
	if tier != "light" {
		t.Errorf("simple greeting: got tier=%q (score=%d), want light", tier, score)
	}
	if score >= 30 {
		t.Errorf("simple greeting: score=%d, want <30", score)
	}
}

func TestScoreRequest_ComplexTier(t *testing.T) {
	// Hits: system (+10), math (+15), complexity signal (+10), max_tokens≥2000 (+15),
	// code keywords like "implement" (+15) → 65 total → heavy
	body := buildBody(t, map[string]interface{}{
		"model": "styx:auto",
		"messages": []map[string]interface{}{
			{"role": "system", "content": "You are an expert mathematician."},
			{"role": "user", "content": "Prove the Riemann hypothesis step by step with detailed mathematical reasoning. Implement a numerical verification in Python using the equation for zeta function zeros."},
		},
		"max_tokens": 4096,
	})
	score, tier := ScoreRequest(body)
	if tier != "heavy" {
		t.Errorf("complex math+code prompt: got tier=%q (score=%d), want heavy", tier, score)
	}
	if score < 60 {
		t.Errorf("complex math+code prompt: score=%d, want ≥60", score)
	}
}

func TestScoreRequest_MediumMathPrompt(t *testing.T) {
	// System prompt + math + complexity signal + long max_tokens = 50 → medium
	body := buildBody(t, map[string]interface{}{
		"model": "styx:auto",
		"messages": []map[string]interface{}{
			{"role": "system", "content": "You are an expert mathematician."},
			{"role": "user", "content": "Prove the Riemann hypothesis step by step with detailed mathematical reasoning and equations."},
		},
		"max_tokens": 4096,
	})
	score, tier := ScoreRequest(body)
	if tier == "light" {
		t.Errorf("math prompt with system+max_tokens: got tier=light (score=%d), expected medium or heavy", score)
	}
}

func TestScoreRequest_MediumTier(t *testing.T) {
	body := buildBody(t, map[string]interface{}{
		"model": "styx:auto",
		"messages": []map[string]interface{}{
			{"role": "user", "content": "Summarize this article for me in a few paragraphs."},
			{"role": "assistant", "content": "Sure, here is a summary."},
			{"role": "user", "content": "Now make it more detailed."},
			{"role": "assistant", "content": "Here is a more detailed version."},
			{"role": "user", "content": "One more expansion please."},
		},
	})
	score, tier := ScoreRequest(body)
	// Multi-turn (>3 messages) alone gives +20 → medium territory
	if tier == "light" {
		t.Errorf("medium multi-turn prompt: got tier=light (score=%d), expected medium or heavy", score)
	}
}

func TestScoreRequest_CodeTier(t *testing.T) {
	body := buildBody(t, map[string]interface{}{
		"model": "styx:auto",
		"messages": []map[string]interface{}{
			{"role": "user", "content": "Implement a binary search tree in Python with a class definition, insert function, search function, and delete function. Include docstrings."},
		},
		"max_tokens": 2000,
	})
	score, tier := ScoreRequest(body)
	if tier == "light" {
		t.Errorf("code generation prompt: got tier=light (score=%d), expected medium or heavy", score)
	}
	_ = score
}

func TestScoreRequest_JSONOutputRequested(t *testing.T) {
	body := buildBody(t, map[string]interface{}{
		"model": "styx:auto",
		"messages": []map[string]interface{}{
			{"role": "user", "content": "Extract key entities"},
		},
		"response_format": map[string]string{"type": "json_object"},
	})
	score, _ := ScoreRequest(body)
	// JSON output adds +10
	if score < 10 {
		t.Errorf("json_object response_format: score=%d, want ≥10", score)
	}
}

func TestScoreRequest_ScoreCappedAt100(t *testing.T) {
	// A maximally complex request should not exceed 100
	var msgs []map[string]interface{}
	msgs = append(msgs, map[string]interface{}{"role": "system", "content": "You are a senior research scientist."})
	for i := 0; i < 10; i++ {
		msgs = append(msgs, map[string]interface{}{
			"role":    "user",
			"content": "Prove the theorem step by step. Implement the algorithm in Python. Solve the equation. Derive the integral formula.",
		})
		msgs = append(msgs, map[string]interface{}{"role": "assistant", "content": "Here is the detailed comprehensive solution..."})
	}
	body := buildBody(t, map[string]interface{}{
		"model":      "styx:auto",
		"messages":   msgs,
		"max_tokens": 8192,
		"response_format": map[string]string{"type": "json_object"},
	})
	score, tier := ScoreRequest(body)
	if score > 100 {
		t.Errorf("score cap: score=%d, want ≤100", score)
	}
	if tier != "heavy" {
		t.Errorf("maximally complex request: got tier=%q, want heavy", tier)
	}
}

// ── rewriteModel ─────────────────────────────────────────────────────────────

func TestRewriteModel(t *testing.T) {
	original := []byte(`{"model":"styx:auto","messages":[{"role":"user","content":"Hi"}],"temperature":0.7}`)
	rewritten := rewriteModel(original, "gpt-4o-mini")

	var result map[string]interface{}
	if err := json.Unmarshal(rewritten, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result["model"] != "gpt-4o-mini" {
		t.Errorf("model=%q, want gpt-4o-mini", result["model"])
	}
	// Other fields preserved
	if result["temperature"] != 0.7 {
		t.Errorf("temperature=%v, want 0.7", result["temperature"])
	}
}

func TestRewriteModel_InvalidJSON(t *testing.T) {
	bad := []byte(`{invalid json`)
	out := rewriteModel(bad, "gpt-4o")
	// Should return original body unchanged
	if string(out) != string(bad) {
		t.Errorf("invalid JSON: expected original body returned, got %q", out)
	}
}
