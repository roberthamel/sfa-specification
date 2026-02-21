package sfa

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfigMissingFile(t *testing.T) {
	os.Setenv("SFA_CONFIG", "/nonexistent/config.json")
	defer os.Unsetenv("SFA_CONFIG")

	config := loadConfig()
	if config == nil {
		t.Fatal("expected non-nil config")
	}
	if len(config) != 0 {
		t.Errorf("expected empty config, got %d keys", len(config))
	}
}

func TestLoadConfigFromFile(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	data := map[string]any{
		"defaults": map[string]any{"timeout": 30.0},
		"agents": map[string]any{
			"test-agent": map[string]any{
				"env": map[string]any{"KEY": "value"},
			},
		},
	}
	jsonData, _ := json.Marshal(data)
	os.WriteFile(configPath, jsonData, 0644)

	os.Setenv("SFA_CONFIG", configPath)
	defer os.Unsetenv("SFA_CONFIG")

	config := loadConfig()

	if config["defaults"] == nil {
		t.Error("expected defaults in config")
	}
	defaults := config["defaults"].(map[string]any)
	if defaults["timeout"] != 30.0 {
		t.Errorf("expected timeout 30, got %v", defaults["timeout"])
	}
}

func TestSaveAndLoadConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.json")

	os.Setenv("SFA_CONFIG", configPath)
	defer os.Unsetenv("SFA_CONFIG")

	config := map[string]any{
		"defaults": map[string]any{"timeout": 60.0},
	}

	if err := saveConfig(config); err != nil {
		t.Fatalf("failed to save: %v", err)
	}

	loaded := loadConfig()
	defaults := loaded["defaults"].(map[string]any)
	if defaults["timeout"] != 60.0 {
		t.Errorf("expected timeout 60, got %v", defaults["timeout"])
	}
}

func TestMergeConfig(t *testing.T) {
	config := map[string]any{
		"defaults": map[string]any{
			"timeout": 30.0,
			"model":   "default-model",
			"env":     map[string]any{"should": "be excluded"},
		},
		"agents": map[string]any{
			"my-agent": map[string]any{
				"model": "agent-model",
				"env":   map[string]any{"also": "excluded"},
			},
		},
	}

	merged := mergeConfig(config, "my-agent")

	// Agent model should override default
	if merged["model"] != "agent-model" {
		t.Errorf("expected agent-model, got %v", merged["model"])
	}
	// Default timeout should be kept
	if merged["timeout"] != 30.0 {
		t.Errorf("expected timeout 30, got %v", merged["timeout"])
	}
	// env keys should be excluded
	if _, ok := merged["env"]; ok {
		t.Error("env should be excluded from merged config")
	}
}

func TestMergeConfigNoAgent(t *testing.T) {
	config := map[string]any{
		"defaults": map[string]any{
			"timeout": 30.0,
		},
	}

	merged := mergeConfig(config, "nonexistent-agent")

	if merged["timeout"] != 30.0 {
		t.Errorf("expected timeout 30, got %v", merged["timeout"])
	}
}

func TestGetConfigPathFromEnv(t *testing.T) {
	os.Setenv("SFA_CONFIG", "/custom/config.json")
	defer os.Unsetenv("SFA_CONFIG")

	path := getConfigPath()
	if path != "/custom/config.json" {
		t.Errorf("expected /custom/config.json, got %s", path)
	}
}
