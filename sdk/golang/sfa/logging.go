package sfa

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// LogEntry is a single JSONL log entry for an agent execution.
type LogEntry struct {
	Timestamp     string         `json:"timestamp"`
	Agent         string         `json:"agent"`
	Version       string         `json:"version"`
	ExitCode      int            `json:"exitCode"`
	DurationMs    int64          `json:"durationMs"`
	Depth         int            `json:"depth"`
	CallChain     []string       `json:"callChain"`
	InputSummary  string         `json:"inputSummary"`
	OutputSummary string         `json:"outputSummary"`
	SessionID     string         `json:"sessionId"`
	Meta          map[string]any `json:"meta,omitempty"`
}

// LoggingConfig controls execution log behavior.
type LoggingConfig struct {
	FilePath     string
	Suppressed   bool
	MaxSizeBytes int64
	RetainCount  int
}

const (
	defaultMaxLogSize  = 50 * 1024 * 1024 // 50 MB
	defaultRetainCount = 5
)

// resolveLoggingConfig determines logging configuration from env, config, and flags.
func resolveLoggingConfig(config map[string]any, noLogFlag bool) *LoggingConfig {
	lc := &LoggingConfig{
		MaxSizeBytes: defaultMaxLogSize,
		RetainCount:  defaultRetainCount,
	}

	// Check suppression
	if noLogFlag || os.Getenv("SFA_NO_LOG") == "1" {
		lc.Suppressed = true
		return lc
	}

	// Resolve file path
	if p := os.Getenv("SFA_LOG_FILE"); p != "" {
		lc.FilePath = p
	} else if logging, ok := config["logging"]; ok {
		if lm, ok := logging.(map[string]any); ok {
			if f, ok := lm["file"].(string); ok {
				lc.FilePath = f
			}
			if ms, ok := lm["maxSize"].(float64); ok {
				lc.MaxSizeBytes = int64(ms) * 1024 * 1024
			}
			if rc, ok := lm["retainFiles"].(float64); ok {
				lc.RetainCount = int(rc)
			}
		}
	}

	if lc.FilePath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			lc.Suppressed = true
			return lc
		}
		lc.FilePath = filepath.Join(home, ".local", "share", "single-file-agents", "logs", "executions.jsonl")
	}

	return lc
}

// createLogEntry builds a log entry from execution data.
func createLogEntry(agent, version string, exitCode int, startTime time.Time,
	depth int, chain []string, sessionID, input, output string) *LogEntry {
	return &LogEntry{
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		Agent:         agent,
		Version:       version,
		ExitCode:      exitCode,
		DurationMs:    time.Since(startTime).Milliseconds(),
		Depth:         depth,
		CallChain:     chain,
		InputSummary:  truncate(input, 500),
		OutputSummary: truncate(output, 500),
		SessionID:     sessionID,
	}
}

// writeLogEntry appends a log entry to the log file.
// Best-effort: failures are warned to stderr but don't affect the exit code.
func writeLogEntry(entry *LogEntry, config *LoggingConfig) {
	if config.Suppressed {
		return
	}

	// Create log directory
	dir := filepath.Dir(config.FilePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to create log directory: %v\n", err)
		return
	}

	// Check if rotation is needed
	if info, err := os.Stat(config.FilePath); err == nil {
		if info.Size() >= config.MaxSizeBytes {
			rotateLog(config)
		}
	}

	// Marshal entry
	data, err := json.Marshal(entry)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to marshal log entry: %v\n", err)
		return
	}
	data = append(data, '\n')

	// Append to file. O_APPEND writes are atomic at the kernel level for
	// sizes under PIPE_BUF (typically 4KB), which JSONL entries always are.
	f, err := os.OpenFile(config.FilePath, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to open log file: %v\n", err)
		return
	}
	defer f.Close()

	if _, err := f.Write(data); err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to write log entry: %v\n", err)
	}
}

// rotateLog rotates the log file, keeping up to retainCount old files.
func rotateLog(config *LoggingConfig) {
	dir := filepath.Dir(config.FilePath)
	base := filepath.Base(config.FilePath)
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)

	// Find existing rotated files
	pattern := filepath.Join(dir, name+".*.jsonl")
	matches, _ := filepath.Glob(pattern)

	// Sort and remove excess
	if len(matches) >= config.RetainCount {
		sort.Strings(matches)
		for i := 0; i <= len(matches)-config.RetainCount; i++ {
			os.Remove(matches[i])
		}
	}

	// Rename current log
	ts := time.Now().UTC().Format("20060102T150405")
	rotated := filepath.Join(dir, fmt.Sprintf("%s.%s%s", name, ts, ext))
	os.Rename(config.FilePath, rotated)
}

// truncate shortens a string to maxLen characters.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}
