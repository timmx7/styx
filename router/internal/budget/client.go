package budget

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// CheckResponse from the backend budget endpoint.
type CheckResponse struct {
	Allowed     bool    `json:"allowed"`
	BudgetCents *int    `json:"budget_cents"`
	SpentCents  int     `json:"spent_cents"`
	PctUsed     float64 `json:"pct_used"`
}

// Client talks to the Python backend's budget check endpoint.
type Client struct {
	backendURL     string
	internalSecret string
	httpClient     *http.Client
}

// NewClient creates a budget check client.
func NewClient(backendURL string) *Client {
	return &Client{
		backendURL:     strings.TrimRight(backendURL, "/"),
		internalSecret: os.Getenv("INTERNAL_SECRET"),
		httpClient: &http.Client{
			Timeout: 3 * time.Second,
		},
	}
}

// Check queries the backend for the project's budget status.
// If the check fails (network error, etc), defaults to allowed=true
// so we don't block requests due to infrastructure issues.
// requestID is propagated as X-Request-ID header for correlation.
func (c *Client) Check(ctx context.Context, projectID string, requestID ...string) (*CheckResponse, error) {
	if projectID == "" {
		return &CheckResponse{Allowed: true}, nil
	}

	url := fmt.Sprintf("%s/internal/budget/%s", c.backendURL, url.PathEscape(projectID))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		slog.Debug("budget check request creation failed", "error", err)
		return &CheckResponse{Allowed: true}, nil
	}
	if c.internalSecret != "" {
		req.Header.Set("X-Internal-Secret", c.internalSecret)
	}
	if len(requestID) > 0 && requestID[0] != "" {
		req.Header.Set("X-Request-ID", requestID[0])
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Debug("budget check failed (service unreachable)", "error", err)
		return &CheckResponse{Allowed: true}, nil // fail open
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Debug("budget check returned error", "status", resp.StatusCode)
		return &CheckResponse{Allowed: true}, nil
	}

	var result CheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		slog.Debug("budget check decode error", "error", err)
		return &CheckResponse{Allowed: true}, nil
	}

	return &result, nil
}
