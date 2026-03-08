// Package pricing manages per-model cost data.
//
// At startup the Manager loads prices from a local JSON file.
// A background goroutine then refreshes prices every 24 h by fetching the
// public OpenRouter catalog (no API key required).  If the remote fetch fails
// the previous prices remain valid and a warning is logged.
//
// OpenRouter model IDs use the format "provider/model-name".
// Styx uses bare model names, so the provider prefix is stripped on import.
package pricing

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// ModelPrice holds the cost of one model in USD per 1 million tokens.
type ModelPrice struct {
	InputPerMillion  float64 `json:"input"`
	OutputPerMillion float64 `json:"output"`
}

// Manager holds the current price map and keeps it up-to-date.
type Manager struct {
	mu         sync.RWMutex
	prices     map[string]ModelPrice
	pricingPath string
	httpClient  *http.Client
}

// New creates a Manager and loads the initial prices from pricingPath.
// It does NOT start the background refresher; call StartRefresher for that.
func New(pricingPath string) (*Manager, error) {
	m := &Manager{
		prices:      make(map[string]ModelPrice),
		pricingPath: pricingPath,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
	}
	if err := m.loadFromFile(); err != nil {
		// Non-fatal: log and continue with empty prices.
		slog.Warn("pricing: could not load pricing file", "path", pricingPath, "error", err)
	}
	return m, nil
}

// Get returns the price for a model ID.  Returns zero-value and false if unknown.
func (m *Manager) Get(modelID string) (ModelPrice, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, ok := m.prices[modelID]
	return p, ok
}

// All returns a copy of the current price map.
func (m *Manager) All() map[string]ModelPrice {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string]ModelPrice, len(m.prices))
	for k, v := range m.prices {
		out[k] = v
	}
	return out
}

// StartRefresher spawns a goroutine that refreshes prices from OpenRouter
// every refreshInterval.  The goroutine stops when ctx is cancelled.
func (m *Manager) StartRefresher(ctx context.Context, refreshInterval time.Duration) {
	go func() {
		// First refresh immediately at startup (after a short delay so the
		// server can finish booting before making outbound requests).
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
		m.refreshFromOpenRouter()

		ticker := time.NewTicker(refreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.refreshFromOpenRouter()
			}
		}
	}()
}

// ─── internal helpers ─────────────────────────────────────────────────────────

// loadFromFile reads the JSON pricing file and populates m.prices.
// The file may contain a "_comment" key which is silently ignored.
func (m *Manager) loadFromFile() error {
	data, err := os.ReadFile(m.pricingPath)
	if err != nil {
		return fmt.Errorf("reading pricing file: %w", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parsing pricing file: %w", err)
	}

	newPrices := make(map[string]ModelPrice, len(raw))
	for key, val := range raw {
		if key == "_comment" {
			continue
		}
		var p ModelPrice
		if err := json.Unmarshal(val, &p); err != nil {
			slog.Warn("pricing: skipping malformed entry", "model", key, "error", err)
			continue
		}
		newPrices[key] = p
	}

	m.mu.Lock()
	m.prices = newPrices
	m.mu.Unlock()

	slog.Info("pricing: loaded from file", "path", m.pricingPath, "models", len(newPrices))
	return nil
}

// openRouterResponse is the subset of the OpenRouter /v1/models response we care about.
type openRouterResponse struct {
	Data []openRouterModel `json:"data"`
}

type openRouterModel struct {
	ID      string                 `json:"id"`      // e.g. "openai/gpt-4o"
	Pricing openRouterModelPricing `json:"pricing"` // per-token prices as strings
}

type openRouterModelPricing struct {
	Prompt     string `json:"prompt"`     // USD per token (string)
	Completion string `json:"completion"` // USD per token (string)
}

// refreshFromOpenRouter fetches the OpenRouter catalog, parses pricing, and
// merges new data into m.prices.  Existing entries are updated; models not
// present in the OpenRouter catalog keep their current prices.
// On any error the current prices remain unchanged.
func (m *Manager) refreshFromOpenRouter() {
	const url = "https://openrouter.ai/api/v1/models"

	slog.Info("pricing: refreshing from OpenRouter", "url", url)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		slog.Warn("pricing: failed to build OpenRouter request", "error", err)
		return
	}
	req.Header.Set("User-Agent", "styx-router/1.0")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		slog.Warn("pricing: OpenRouter fetch failed — keeping existing prices", "error", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("pricing: OpenRouter returned non-200 — keeping existing prices",
			"status", resp.StatusCode)
		return
	}

	var orResp openRouterResponse
	if err := json.NewDecoder(resp.Body).Decode(&orResp); err != nil {
		slog.Warn("pricing: failed to decode OpenRouter response — keeping existing prices",
			"error", err)
		return
	}

	updated := 0
	m.mu.Lock()
	for _, model := range orResp.Data {
		// Strip provider prefix: "openai/gpt-4o" → "gpt-4o"
		modelID := stripProviderPrefix(model.ID)

		inputPerToken := parseFloat(model.Pricing.Prompt)
		outputPerToken := parseFloat(model.Pricing.Completion)

		if inputPerToken == 0 && outputPerToken == 0 {
			continue // free or unknown — don't overwrite our defaults
		}

		// Convert per-token to per-million-tokens.
		m.prices[modelID] = ModelPrice{
			InputPerMillion:  inputPerToken * 1_000_000,
			OutputPerMillion: outputPerToken * 1_000_000,
		}
		updated++
	}
	m.mu.Unlock()

	slog.Info("pricing: refresh complete", "updated_models", updated, "total_models", len(orResp.Data))

	// Persist updated prices back to the file so they survive restarts.
	if err := m.saveToFile(); err != nil {
		slog.Warn("pricing: could not persist updated prices", "error", err)
	}
}

// saveToFile writes the current price map back to the JSON file.
func (m *Manager) saveToFile() error {
	m.mu.RLock()
	snapshot := make(map[string]ModelPrice, len(m.prices))
	for k, v := range m.prices {
		snapshot[k] = v
	}
	m.mu.RUnlock()

	// Preserve the human-readable comment.
	type fileFormat struct {
		Comment string                `json:"_comment"`
		Prices  map[string]ModelPrice `json:"-"`
	}

	// Marshal as a flat map with the comment key first.
	raw := make(map[string]interface{}, len(snapshot)+1)
	raw["_comment"] = "Prices in USD per 1M tokens. Auto-refreshed from OpenRouter every 24h."
	for k, v := range snapshot {
		raw[k] = v
	}

	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling prices: %w", err)
	}

	if err := os.WriteFile(m.pricingPath, data, 0644); err != nil {
		return fmt.Errorf("writing pricing file: %w", err)
	}
	return nil
}

// stripProviderPrefix removes the "provider/" prefix from OpenRouter model IDs.
// "openai/gpt-4o" → "gpt-4o"
// "gpt-4o" → "gpt-4o" (no-op)
func stripProviderPrefix(id string) string {
	if idx := strings.Index(id, "/"); idx >= 0 {
		return id[idx+1:]
	}
	return id
}

// parseFloat converts a string like "0.0000025" to float64.
func parseFloat(s string) float64 {
	if s == "" {
		return 0
	}
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}
