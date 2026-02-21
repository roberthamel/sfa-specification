package sfa

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestResolveLoggingConfigSuppressed(t *testing.T) {
	config := resolveLoggingConfig(map[string]any{}, true)
	if !config.Suppressed {
		t.Error("expected suppressed when noLogFlag=true")
	}
}

func TestResolveLoggingConfigSuppressedByEnv(t *testing.T) {
	os.Setenv("SFA_NO_LOG", "1")
	defer os.Unsetenv("SFA_NO_LOG")

	config := resolveLoggingConfig(map[string]any{}, false)
	if !config.Suppressed {
		t.Error("expected suppressed when SFA_NO_LOG=1")
	}
}

func TestResolveLoggingConfigFromEnv(t *testing.T) {
	os.Setenv("SFA_LOG_FILE", "/tmp/test.jsonl")
	os.Unsetenv("SFA_NO_LOG")
	defer os.Unsetenv("SFA_LOG_FILE")

	config := resolveLoggingConfig(map[string]any{}, false)
	if config.FilePath != "/tmp/test.jsonl" {
		t.Errorf("expected /tmp/test.jsonl, got %s", config.FilePath)
	}
}

func TestResolveLoggingConfigDefaults(t *testing.T) {
	os.Unsetenv("SFA_LOG_FILE")
	os.Unsetenv("SFA_NO_LOG")

	config := resolveLoggingConfig(map[string]any{}, false)
	if !strings.Contains(config.FilePath, "executions.jsonl") {
		t.Errorf("expected default path with executions.jsonl, got %s", config.FilePath)
	}
	if config.MaxSizeBytes != defaultMaxLogSize {
		t.Errorf("expected default max size, got %d", config.MaxSizeBytes)
	}
	if config.RetainCount != defaultRetainCount {
		t.Errorf("expected default retain count, got %d", config.RetainCount)
	}
}

func TestCreateLogEntry(t *testing.T) {
	start := time.Now().Add(-100 * time.Millisecond)
	entry := createLogEntry("test-agent", "1.0.0", 0, start, 0,
		[]string{"test-agent"}, "session-1", "input data", "output data")

	if entry.Agent != "test-agent" {
		t.Errorf("expected agent test-agent, got %s", entry.Agent)
	}
	if entry.ExitCode != 0 {
		t.Errorf("expected exit code 0, got %d", entry.ExitCode)
	}
	if entry.DurationMs < 100 {
		t.Errorf("expected at least 100ms duration, got %d", entry.DurationMs)
	}
	if entry.InputSummary != "input data" {
		t.Errorf("expected 'input data', got %q", entry.InputSummary)
	}
}

func TestCreateLogEntryTruncation(t *testing.T) {
	longInput := strings.Repeat("a", 1000)
	entry := createLogEntry("test", "1.0", 0, time.Now(), 0, nil, "", longInput, "")

	if len(entry.InputSummary) != 500 {
		t.Errorf("expected truncated to 500, got %d", len(entry.InputSummary))
	}
}

func TestWriteLogEntry(t *testing.T) {
	tmpDir := t.TempDir()
	logPath := filepath.Join(tmpDir, "test.jsonl")

	config := &LoggingConfig{
		FilePath:     logPath,
		MaxSizeBytes: defaultMaxLogSize,
		RetainCount:  defaultRetainCount,
	}

	entry := &LogEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Agent:     "test-agent",
		Version:   "1.0.0",
		ExitCode:  0,
		SessionID: "sess-1",
	}

	writeLogEntry(entry, config)

	// Verify file was written
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("failed to read log: %v", err)
	}

	var parsed LogEntry
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("failed to parse log entry: %v", err)
	}
	if parsed.Agent != "test-agent" {
		t.Errorf("expected test-agent, got %s", parsed.Agent)
	}
}

func TestWriteLogEntrySuppressed(t *testing.T) {
	tmpDir := t.TempDir()
	logPath := filepath.Join(tmpDir, "test.jsonl")

	config := &LoggingConfig{
		FilePath:   logPath,
		Suppressed: true,
	}

	writeLogEntry(&LogEntry{Agent: "test"}, config)

	// File should not exist
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Error("expected no log file when suppressed")
	}
}
