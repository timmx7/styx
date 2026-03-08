package cache

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// CheckRequest is sent to the Python cache service.
type CheckRequest struct {
	Prompt    string `json:"prompt"`
	ProjectID string `json:"project_id"`
	Model     string `json:"model"`
}

// CheckResponse is returned by the Python cache service.
type CheckResponse struct {
	Hit             bool                   `json:"hit"`
	Response        map[string]interface{} `json:"response,omitempty"`
	SimilarityScore float64                `json:"similarity_score"`
}

// StoreRequest is sent to store a response in the cache.
type StoreRequest struct {
	Prompt    string                 `json:"prompt"`
	ProjectID string                `json:"project_id"`
	Model     string                 `json:"model"`
	Response  map[string]interface{} `json:"response"`
}

// StoreResponse is returned after storing.
type StoreResponse struct {
	Stored  bool   `json:"stored"`
	PointID string `json:"point_id"`
}

// Client talks to the Python semantic cache microservice.
type Client struct {
	baseURL        string
	httpClient     *http.Client
	enabled        bool
	internalSecret string
}

// NewClient creates a cache client.
// If baseURL is empty, caching is disabled.
// timeoutSeconds of 0 defaults to 5 seconds.
func NewClient(baseURL string, timeoutSeconds ...int) *Client {
	enabled := baseURL != ""
	if enabled {
		baseURL = strings.TrimRight(baseURL, "/")
	}

	timeout := 5 * time.Second
	if len(timeoutSeconds) > 0 && timeoutSeconds[0] > 0 {
		timeout = time.Duration(timeoutSeconds[0]) * time.Second
	}

	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		enabled:        enabled,
		internalSecret: os.Getenv("INTERNAL_SECRET"),
	}
}

// Check queries the cache for a semantically similar prompt.
// Returns (hit, cachedResponseJSON, error).
// On any error, returns (false, nil, nil) — cache miss is non-blocking.
// requestID is propagated as X-Request-ID header for correlation.
func (c *Client) Check(ctx context.Context, prompt, projectID, model string, requestID ...string) (*CheckResponse, error) {
	if !c.enabled || prompt == "" {
		return &CheckResponse{Hit: false}, nil
	}

	body, err := json.Marshal(CheckRequest{
		Prompt:    prompt,
		ProjectID: projectID,
		Model:     model,
	})
	if err != nil {
		return &CheckResponse{Hit: false}, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/cache/check", bytes.NewReader(body))
	if err != nil {
		return &CheckResponse{Hit: false}, nil
	}
	req.Header.Set("Content-Type", "application/json")
	if c.internalSecret != "" {
		req.Header.Set("X-Internal-Secret", c.internalSecret)
	}
	if len(requestID) > 0 && requestID[0] != "" {
		req.Header.Set("X-Request-ID", requestID[0])
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Debug("cache check failed (service unreachable)", "error", err)
		return &CheckResponse{Hit: false}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Debug("cache check returned error", "status", resp.StatusCode)
		return &CheckResponse{Hit: false}, nil
	}

	var result CheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		slog.Debug("cache check decode error", "error", err)
		return &CheckResponse{Hit: false}, nil
	}

	return &result, nil
}

// Store saves a prompt→response pair in the semantic cache.
// Fire-and-forget: errors are logged but don't affect the request.
// requestID is propagated as X-Request-ID header for correlation.
func (c *Client) Store(prompt, projectID, model string, response map[string]interface{}, requestID ...string) {
	if !c.enabled || prompt == "" {
		return
	}

	body, err := json.Marshal(StoreRequest{
		Prompt:    prompt,
		ProjectID: projectID,
		Model:     model,
		Response:  response,
	})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/cache/store", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if c.internalSecret != "" {
		req.Header.Set("X-Internal-Secret", c.internalSecret)
	}
	if len(requestID) > 0 && requestID[0] != "" {
		req.Header.Set("X-Request-ID", requestID[0])
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Debug("cache store failed", "error", err)
		return
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Debug("cache store returned error", "status", resp.StatusCode)
	} else {
		slog.Debug("response cached", "model", model, "project", projectID)
	}
}

// Enabled returns whether caching is active.
func (c *Client) Enabled() bool {
	return c.enabled
}

// CachedResponseToJSON converts the cached response map to a JSON byte slice
// suitable for writing directly to the HTTP response.
func CachedResponseToJSON(resp map[string]interface{}) ([]byte, error) {
	data, err := json.Marshal(resp)
	if err != nil {
		return nil, fmt.Errorf("marshaling cached response: %w", err)
	}
	return data, nil
}
