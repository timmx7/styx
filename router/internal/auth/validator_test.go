package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ---------- ExtractAPIKey tests ----------

func TestExtractAPIKey_BearerToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer sk_styx_test123")
	got := ExtractAPIKey(req)
	if got != "sk_styx_test123" {
		t.Errorf("expected sk_styx_test123, got %q", got)
	}
}

func TestExtractAPIKey_PlainToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "sk_styx_test123")
	got := ExtractAPIKey(req)
	if got != "sk_styx_test123" {
		t.Errorf("expected sk_styx_test123, got %q", got)
	}
}

func TestExtractAPIKey_Empty(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	got := ExtractAPIKey(req)
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

func TestExtractAPIKey_BearerOnly(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer ")
	got := ExtractAPIKey(req)
	if got != "" {
		t.Errorf("expected empty string after 'Bearer ', got %q", got)
	}
}

// ---------- GetKeyInfo / WithKeyInfo tests ----------

func TestGetKeyInfo_Empty(t *testing.T) {
	ctx := context.Background()
	info := GetKeyInfo(ctx)
	if info != nil {
		t.Error("expected nil for empty context")
	}
}

func TestWithKeyInfo_RoundTrip(t *testing.T) {
	orig := &KeyInfo{
		Valid:       true,
		ProjectID:   "proj-123",
		TeamID:      "team-456",
		Permissions: []string{"chat", "embeddings"},
		RateLimit:   100,
	}

	ctx := WithKeyInfo(context.Background(), orig)
	got := GetKeyInfo(ctx)

	if got == nil {
		t.Fatal("expected non-nil KeyInfo from context")
	}
	if got.ProjectID != "proj-123" {
		t.Errorf("expected ProjectID=proj-123, got %s", got.ProjectID)
	}
	if got.TeamID != "team-456" {
		t.Errorf("expected TeamID=team-456, got %s", got.TeamID)
	}
	if got.RateLimit != 100 {
		t.Errorf("expected RateLimit=100, got %d", got.RateLimit)
	}
	if len(got.Permissions) != 2 {
		t.Errorf("expected 2 permissions, got %d", len(got.Permissions))
	}
}

// ---------- Middleware tests ----------

func TestMiddleware_MissingKey_Returns401(t *testing.T) {
	validator := NewValidator("http://fake-backend:8000")

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("inner handler should not be called")
	})

	handler := validator.Middleware(inner)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	errObj, ok := resp["error"].(map[string]interface{})
	if !ok {
		t.Fatal("response should have 'error' object")
	}
	if errObj["type"] != "missing_api_key" {
		t.Errorf("expected error type missing_api_key, got %v", errObj["type"])
	}
}

func TestMiddleware_InvalidKey_Returns401(t *testing.T) {
	// Mock backend that returns valid=false
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(KeyInfo{Valid: false})
	}))
	defer backend.Close()

	validator := NewValidator(backend.URL)

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("inner handler should not be called for invalid key")
	})

	handler := validator.Middleware(inner)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer sk_styx_invalid")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	errObj := resp["error"].(map[string]interface{})
	if errObj["type"] != "invalid_api_key" {
		t.Errorf("expected invalid_api_key, got %v", errObj["type"])
	}
}

func TestMiddleware_ValidKey_InjectsContext(t *testing.T) {
	// Mock backend that returns a valid key with rate_limit
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify the backend receives the key as POST body
		var reqBody validateKeyRequest
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			t.Errorf("backend should receive valid JSON: %v", err)
		}
		if reqBody.Key != "sk_styx_valid_key" {
			t.Errorf("backend should receive the API key, got %q", reqBody.Key)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(KeyInfo{
			Valid:       true,
			ProjectID:   "proj-test",
			TeamID:      "team-test",
			Permissions: []string{"chat"},
			RateLimit:   200,
		})
	}))
	defer backend.Close()

	validator := NewValidator(backend.URL)

	// Inner handler verifies the context has KeyInfo
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := GetKeyInfo(r.Context())
		if info == nil {
			t.Fatal("KeyInfo should be in context")
		}
		if info.ProjectID != "proj-test" {
			t.Errorf("expected ProjectID=proj-test, got %s", info.ProjectID)
		}
		if info.RateLimit != 200 {
			t.Errorf("expected RateLimit=200, got %d", info.RateLimit)
		}
		w.WriteHeader(http.StatusOK)
	})

	handler := validator.Middleware(inner)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer sk_styx_valid_key")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestMiddleware_BackendDown_Returns502(t *testing.T) {
	// Point to a non-existent backend
	validator := NewValidator("http://127.0.0.1:1") // port 1 = will fail immediately

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("inner handler should not be called when backend is down")
	})

	handler := validator.Middleware(inner)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer sk_styx_test")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", rr.Code)
	}
}

func TestMiddleware_Backend500_Returns502(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer backend.Close()

	validator := NewValidator(backend.URL)

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("inner handler should not be called on backend 500")
	})

	handler := validator.Middleware(inner)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer sk_styx_test")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", rr.Code)
	}
}

// ---------- writeAuthError tests ----------

func TestWriteAuthError_Format(t *testing.T) {
	rr := httptest.NewRecorder()
	writeAuthError(rr, http.StatusForbidden, "forbidden", "Access denied")

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
	if rr.Header().Get("Content-Type") != "application/json" {
		t.Error("expected Content-Type application/json")
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("response should be valid JSON: %v", err)
	}
	errObj := resp["error"].(map[string]interface{})
	if errObj["type"] != "forbidden" {
		t.Errorf("expected type=forbidden, got %v", errObj["type"])
	}
	if errObj["message"] != "Access denied" {
		t.Errorf("expected message=Access denied, got %v", errObj["message"])
	}
}

// ---------- Validate() tests ----------

func TestValidate_Success(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify POST method
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		// Verify path
		if r.URL.Path != "/internal/validate-key" {
			t.Errorf("expected /internal/validate-key, got %s", r.URL.Path)
		}
		// Verify Content-Type
		if r.Header.Get("Content-Type") != "application/json" {
			t.Error("expected Content-Type application/json")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(KeyInfo{
			Valid:     true,
			ProjectID: "proj-1",
			RateLimit: 500,
		})
	}))
	defer backend.Close()

	v := NewValidator(backend.URL)
	info, err := v.Validate(context.Background(), "sk_styx_test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !info.Valid {
		t.Error("expected valid=true")
	}
	if info.ProjectID != "proj-1" {
		t.Errorf("expected proj-1, got %s", info.ProjectID)
	}
	if info.RateLimit != 500 {
		t.Errorf("expected rate_limit=500, got %d", info.RateLimit)
	}
}

func TestValidate_InternalSecretSent(t *testing.T) {
	t.Setenv("INTERNAL_SECRET", "supersecret42")

	var gotSecret string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSecret = r.Header.Get("X-Internal-Secret")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(KeyInfo{Valid: true})
	}))
	defer backend.Close()

	v := NewValidator(backend.URL)
	v.internalSecret = "supersecret42" // inject for this test
	_, err := v.Validate(context.Background(), "key")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotSecret != "supersecret42" {
		t.Errorf("expected X-Internal-Secret=supersecret42, got %q", gotSecret)
	}
}

func TestValidate_KeySentInBody_NotURL(t *testing.T) {
	var gotBody validateKeyRequest
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&gotBody)
		// Verify key is NOT in URL query params
		if r.URL.Query().Get("key") != "" {
			t.Error("API key should NOT be in URL query params (security risk)")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(KeyInfo{Valid: true})
	}))
	defer backend.Close()

	v := NewValidator(backend.URL)
	v.Validate(context.Background(), "sk_styx_secret_key")

	if gotBody.Key != "sk_styx_secret_key" {
		t.Errorf("key should be in POST body, got %q", gotBody.Key)
	}
}
