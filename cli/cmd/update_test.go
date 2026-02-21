package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDetectProjectFromSfaMarker(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	marker := sfaMarker{Language: "golang", SDKPath: "sfa/"}
	data, _ := json.Marshal(marker)
	os.WriteFile(".sfa", data, 0644)

	lang, sdkPath, err := detectProject("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if lang != "golang" {
		t.Errorf("expected golang, got %s", lang)
	}
	if sdkPath != "sfa" {
		t.Errorf("expected sfa, got %s", sdkPath)
	}
}

func TestDetectProjectFromSfaMarkerWithOverride(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	marker := sfaMarker{Language: "golang", SDKPath: "sfa/"}
	data, _ := json.Marshal(marker)
	os.WriteFile(".sfa", data, 0644)

	lang, _, err := detectProject("typescript")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if lang != "typescript" {
		t.Errorf("expected typescript override, got %s", lang)
	}
}

func TestDetectProjectAutoDetectTypeScript(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	os.MkdirAll(filepath.Join("@sfa", "sdk"), 0755)

	lang, sdkPath, err := detectProject("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if lang != "typescript" {
		t.Errorf("expected typescript, got %s", lang)
	}
	if sdkPath != filepath.Join("@sfa", "sdk") {
		t.Errorf("expected @sfa/sdk, got %s", sdkPath)
	}
}

func TestDetectProjectAutoDetectGolang(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	os.MkdirAll("sfa", 0755)
	os.WriteFile(filepath.Join("sfa", "agent.go"), []byte("package sfa"), 0644)

	lang, sdkPath, err := detectProject("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if lang != "golang" {
		t.Errorf("expected golang, got %s", lang)
	}
	if sdkPath != "sfa" {
		t.Errorf("expected sfa, got %s", sdkPath)
	}
}

func TestDetectProjectNoSDK(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	os.Chdir(tmpDir)
	defer os.Chdir(origDir)

	_, _, err := detectProject("")
	if err == nil {
		t.Fatal("expected error for no SDK")
	}
	if !strings.Contains(err.Error(), "no vendored SDK") {
		t.Errorf("expected 'no vendored SDK' error, got: %v", err)
	}
}

func TestExtractChangelogEntries(t *testing.T) {
	changelog := `# Changelog

## [0.2.0] - 2026-03-01

### Added
- Go SDK support
- Multi-language init

## [0.1.0] - 2026-02-21

### Added
- Initial release
`

	entries := extractChangelogEntries(changelog, "0.1.0", "0.2.0")
	if !strings.Contains(entries, "Go SDK support") {
		t.Errorf("expected 0.2.0 entries, got:\n%s", entries)
	}
	if strings.Contains(entries, "Initial release") {
		t.Error("should not include 0.1.0 entries")
	}
}

func TestExtractGoModulePath(t *testing.T) {
	content := `module my-agent/sfa

go 1.22

require github.com/spf13/pflag v1.0.9
`
	path := extractGoModulePath(content)
	if path != "my-agent/sfa" {
		t.Errorf("expected my-agent/sfa, got %s", path)
	}
}

func TestExtractVersionFromHeader(t *testing.T) {
	tests := []struct {
		header string
		want   string
	}{
		{"## [0.2.0] - 2026-03-01", "0.2.0"},
		{"## [1.0.0]", "1.0.0"},
		{"## No version", ""},
	}
	for _, tt := range tests {
		got := extractVersionFromHeader(tt.header)
		if got != tt.want {
			t.Errorf("extractVersionFromHeader(%q) = %q, want %q", tt.header, got, tt.want)
		}
	}
}
