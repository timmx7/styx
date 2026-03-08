package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_ValidConfig(t *testing.T) {
	configYAML := `
server:
  port: 9090
  read_timeout_seconds: 15
  write_timeout_seconds: 60
backend:
  url: "http://mybackend:3000"
classifier:
  url: "http://myclassifier:5000"
cache:
  url: "http://mycache:6000"
  enabled: true
fallback:
  circuit_breaker_max_failures: 10
  circuit_breaker_recovery_seconds: 60
  health_check_interval_seconds: 30
providers:
  openai:
    name: "openai"
    base_url: "https://api.openai.com"
    api_key_env: "OPENAI_API_KEY"
    auth_header: "Authorization"
    auth_prefix: "Bearer "
    models:
      - name: "gpt-4o"
        input_cost_per_1k: 0.25
        output_cost_per_1k: 1.0
        tier: "heavy"
      - name: "gpt-4o-mini"
        input_cost_per_1k: 0.015
        output_cost_per_1k: 0.06
        tier: "light"
logging:
  level: "debug"
`
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(configYAML), 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Server.Port != 9090 {
		t.Errorf("expected port 9090, got %d", cfg.Server.Port)
	}
	if cfg.Server.ReadTimeoutSeconds != 15 {
		t.Errorf("expected read timeout 15, got %d", cfg.Server.ReadTimeoutSeconds)
	}
	if cfg.Server.WriteTimeoutSeconds != 60 {
		t.Errorf("expected write timeout 60, got %d", cfg.Server.WriteTimeoutSeconds)
	}
	if cfg.Backend.URL != "http://mybackend:3000" {
		t.Errorf("expected backend URL http://mybackend:3000, got %s", cfg.Backend.URL)
	}
	if cfg.Classifier.URL != "http://myclassifier:5000" {
		t.Errorf("expected classifier URL http://myclassifier:5000, got %s", cfg.Classifier.URL)
	}
	if cfg.Cache.URL != "http://mycache:6000" {
		t.Errorf("expected cache URL http://mycache:6000, got %s", cfg.Cache.URL)
	}
	if !cfg.Cache.Enabled {
		t.Error("expected cache enabled")
	}
	if cfg.Fallback.CircuitBreakerMaxFailures != 10 {
		t.Errorf("expected cb max failures 10, got %d", cfg.Fallback.CircuitBreakerMaxFailures)
	}
	if cfg.Logging.Level != "debug" {
		t.Errorf("expected log level debug, got %s", cfg.Logging.Level)
	}

	// Check providers
	openai, ok := cfg.Providers["openai"]
	if !ok {
		t.Fatal("expected openai provider")
	}
	if len(openai.Models) != 2 {
		t.Errorf("expected 2 models, got %d", len(openai.Models))
	}
	if openai.Models[0].Name != "gpt-4o" {
		t.Errorf("expected first model gpt-4o, got %s", openai.Models[0].Name)
	}
	if openai.Models[0].Tier != "heavy" {
		t.Errorf("expected tier heavy, got %s", openai.Models[0].Tier)
	}
}

func TestLoad_Defaults(t *testing.T) {
	configYAML := `
providers: {}
`
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")
	if err := os.WriteFile(configPath, []byte(configYAML), 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Server.Port != 8080 {
		t.Errorf("expected default port 8080, got %d", cfg.Server.Port)
	}
	if cfg.Server.ReadTimeoutSeconds != 30 {
		t.Errorf("expected default read timeout 30, got %d", cfg.Server.ReadTimeoutSeconds)
	}
	if cfg.Server.WriteTimeoutSeconds != 120 {
		t.Errorf("expected default write timeout 120, got %d", cfg.Server.WriteTimeoutSeconds)
	}
	if cfg.Backend.URL != "http://backend:8000" {
		t.Errorf("expected default backend URL, got %s", cfg.Backend.URL)
	}
	if cfg.Classifier.URL != "http://classifier:8001" {
		t.Errorf("expected default classifier URL, got %s", cfg.Classifier.URL)
	}
	if cfg.Cache.URL != "http://cache-service:8002" {
		t.Errorf("expected default cache URL, got %s", cfg.Cache.URL)
	}
	if cfg.Logging.Level != "info" {
		t.Errorf("expected default log level info, got %s", cfg.Logging.Level)
	}
	if cfg.Fallback.CircuitBreakerMaxFailures != 5 {
		t.Errorf("expected default cb max failures 5, got %d", cfg.Fallback.CircuitBreakerMaxFailures)
	}
}

func TestLoad_InvalidFile(t *testing.T) {
	_, err := Load("/nonexistent/config.yaml")
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestLoad_InvalidYAML(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("{{invalid yaml"), 0644); err != nil {
		t.Fatal(err)
	}

	_, err := Load(configPath)
	if err == nil {
		t.Error("expected error for invalid YAML")
	}
}

func TestServerConfig_Timeouts(t *testing.T) {
	cfg := ServerConfig{
		ReadTimeoutSeconds:  30,
		WriteTimeoutSeconds: 120,
	}

	if cfg.ReadTimeout().Seconds() != 30 {
		t.Errorf("expected 30s read timeout, got %v", cfg.ReadTimeout())
	}
	if cfg.WriteTimeout().Seconds() != 120 {
		t.Errorf("expected 120s write timeout, got %v", cfg.WriteTimeout())
	}
}
