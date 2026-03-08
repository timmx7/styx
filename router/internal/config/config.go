package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server     ServerConfig              `yaml:"server"`
	Backend    BackendConfig             `yaml:"backend"`
	Classifier ClassifierConfig          `yaml:"classifier"`
	Cache      CacheConfig               `yaml:"cache"`
	Fallback   FallbackConfig            `yaml:"fallback"`
	Providers  map[string]ProviderConfig `yaml:"providers"`
	Logging    LoggingConfig             `yaml:"logging"`
}

type BackendConfig struct {
	URL string `yaml:"url"`
}

type ClassifierConfig struct {
	URL            string `yaml:"url"`
	TimeoutSeconds int    `yaml:"timeout_seconds"` // 0 = default 3s
}

type CacheConfig struct {
	URL            string `yaml:"url"`
	Enabled        bool   `yaml:"enabled"`
	TimeoutSeconds int    `yaml:"timeout_seconds"` // 0 = default 5s
}

type FallbackConfig struct {
	CircuitBreakerMaxFailures     int `yaml:"circuit_breaker_max_failures"`
	CircuitBreakerRecoverySeconds int `yaml:"circuit_breaker_recovery_seconds"`
	HealthCheckIntervalSeconds    int `yaml:"health_check_interval_seconds"`
}

type ServerConfig struct {
	Port                int `yaml:"port"`
	ReadTimeoutSeconds  int `yaml:"read_timeout_seconds"`
	WriteTimeoutSeconds int `yaml:"write_timeout_seconds"`
}

func (s ServerConfig) ReadTimeout() time.Duration {
	return time.Duration(s.ReadTimeoutSeconds) * time.Second
}

func (s ServerConfig) WriteTimeout() time.Duration {
	return time.Duration(s.WriteTimeoutSeconds) * time.Second
}

type ProviderConfig struct {
	Name       string        `yaml:"name"`
	BaseURL    string        `yaml:"base_url"`
	APIKeyEnv  string        `yaml:"api_key_env"`
	AuthHeader string        `yaml:"auth_header"`
	AuthPrefix string        `yaml:"auth_prefix"`
	Models     []ModelConfig `yaml:"models"`
}

type ModelConfig struct {
	Name            string  `yaml:"name"`
	InputCostPer1K  float64 `yaml:"input_cost_per_1k"`
	OutputCostPer1K float64 `yaml:"output_cost_per_1k"`
	Tier            string  `yaml:"tier"`
}

type LoggingConfig struct {
	Level string `yaml:"level"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config file: %w", err)
	}

	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.ReadTimeoutSeconds == 0 {
		cfg.Server.ReadTimeoutSeconds = 30
	}
	if cfg.Server.WriteTimeoutSeconds == 0 {
		cfg.Server.WriteTimeoutSeconds = 120
	}
	if cfg.Logging.Level == "" {
		cfg.Logging.Level = "info"
	}
	if cfg.Backend.URL == "" {
		cfg.Backend.URL = "http://backend:8000"
	}
	if cfg.Classifier.URL == "" {
		cfg.Classifier.URL = "http://classifier:8001"
	}
	if cfg.Cache.URL == "" {
		cfg.Cache.URL = "http://cache-service:8002"
	}
	if cfg.Fallback.CircuitBreakerMaxFailures == 0 {
		cfg.Fallback.CircuitBreakerMaxFailures = 5
	}
	if cfg.Fallback.CircuitBreakerRecoverySeconds == 0 {
		cfg.Fallback.CircuitBreakerRecoverySeconds = 30
	}
	if cfg.Fallback.HealthCheckIntervalSeconds == 0 {
		cfg.Fallback.HealthCheckIntervalSeconds = 15
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config validation: %w", err)
	}

	return &cfg, nil
}

// Validate checks that the config has all required fields and values are sensible.
func (cfg *Config) Validate() error {
	if cfg.Server.Port < 0 || cfg.Server.Port > 65535 {
		return fmt.Errorf("server.port must be between 0 and 65535, got %d", cfg.Server.Port)
	}
	if cfg.Server.ReadTimeoutSeconds <= 0 {
		return fmt.Errorf("server.read_timeout_seconds must be positive, got %d", cfg.Server.ReadTimeoutSeconds)
	}
	if cfg.Server.WriteTimeoutSeconds <= 0 {
		return fmt.Errorf("server.write_timeout_seconds must be positive, got %d", cfg.Server.WriteTimeoutSeconds)
	}
	if cfg.Backend.URL == "" {
		return fmt.Errorf("backend.url is required")
	}

	// Validate providers
	for name, prov := range cfg.Providers {
		if prov.BaseURL == "" {
			return fmt.Errorf("provider %q: base_url is required", name)
		}
		if prov.APIKeyEnv == "" {
			return fmt.Errorf("provider %q: api_key_env is required", name)
		}
		for i, m := range prov.Models {
			if m.Name == "" {
				return fmt.Errorf("provider %q: model[%d].name is required", name, i)
			}
			if m.Tier == "" {
				return fmt.Errorf("provider %q: model %q: tier is required", name, m.Name)
			}
			validTiers := map[string]bool{"light": true, "medium": true, "heavy": true}
			if !validTiers[m.Tier] {
				return fmt.Errorf("provider %q: model %q: tier must be light/medium/heavy, got %q", name, m.Name, m.Tier)
			}
			if m.InputCostPer1K < 0 {
				return fmt.Errorf("provider %q: model %q: input_cost_per_1k must be non-negative", name, m.Name)
			}
			if m.OutputCostPer1K < 0 {
				return fmt.Errorf("provider %q: model %q: output_cost_per_1k must be non-negative", name, m.Name)
			}
		}
	}

	return nil
}
