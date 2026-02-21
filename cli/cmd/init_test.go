package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestToKebabCase(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Code Reviewer", "code-reviewer"},
		{"myAgent", "my-agent"},
		{"MyAgent", "my-agent"},
		{"hello_world", "hello-world"},
		{"already-kebab", "already-kebab"},
		{"  spaces  ", "spaces"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := toKebabCase(tt.input)
			if result != tt.expected {
				t.Errorf("toKebabCase(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestTypeScriptScaffolderSDKTargetDir(t *testing.T) {
	s := &TypeScriptScaffolder{}
	dir := s.SDKTargetDir()
	if dir != filepath.Join("@sfa", "sdk") {
		t.Errorf("expected @sfa/sdk, got %s", dir)
	}
}

func TestTypeScriptScaffolderGenerateAgent(t *testing.T) {
	s := &TypeScriptScaffolder{}

	t.Run("default sdk path", func(t *testing.T) {
		agent := s.GenerateAgent("my-agent", "My Agent", filepath.Join("@sfa", "sdk"))
		if !strings.Contains(agent, `from "./@sfa/sdk"`) {
			t.Error("expected default import path ./@sfa/sdk")
		}
		if !strings.Contains(agent, `name: "my-agent"`) {
			t.Error("expected agent name in scaffold")
		}
		if !strings.Contains(agent, `description: "My Agent"`) {
			t.Error("expected display name in scaffold")
		}
	})

	t.Run("custom sdk path", func(t *testing.T) {
		agent := s.GenerateAgent("my-agent", "My Agent", "packages/@sfa/sdk")
		if !strings.Contains(agent, `from "./packages/@sfa/sdk"`) {
			t.Errorf("expected custom import path, got:\n%s", agent)
		}
	})
}

func TestTypeScriptScaffolderAdditionalFiles(t *testing.T) {
	s := &TypeScriptScaffolder{}
	files := s.AdditionalFiles("test-agent", "@sfa/sdk")
	if files != nil {
		t.Error("TypeScript scaffolder should return nil additional files")
	}
}

func TestRunInitCreatesProject(t *testing.T) {
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "test-agent")

	// Reset flags
	initName = ""
	initLanguage = "typescript"
	initSDKPath = ""

	err := runInit(nil, []string{projectDir})
	if err != nil {
		t.Fatalf("runInit failed: %v", err)
	}

	// Check agent.ts exists
	agentPath := filepath.Join(projectDir, "agent.ts")
	if _, err := os.Stat(agentPath); os.IsNotExist(err) {
		t.Error("agent.ts not created")
	}

	// Check README.md exists
	readmePath := filepath.Join(projectDir, "README.md")
	if _, err := os.Stat(readmePath); os.IsNotExist(err) {
		t.Error("README.md not created")
	}

	// Check SDK directory exists with files
	sdkDir := filepath.Join(projectDir, "@sfa", "sdk")
	if _, err := os.Stat(filepath.Join(sdkDir, "index.ts")); os.IsNotExist(err) {
		t.Error("SDK index.ts not extracted")
	}

	// Check types subdirectory is extracted (requires recursive embed)
	if _, err := os.Stat(filepath.Join(sdkDir, "types", "index.ts")); os.IsNotExist(err) {
		t.Error("SDK types/index.ts not extracted — embed directive may not recurse into subdirectories")
	}

	// Check VERSION injected into SDK dir
	if _, err := os.Stat(filepath.Join(sdkDir, "VERSION")); os.IsNotExist(err) {
		t.Error("VERSION not injected into SDK directory")
	}

	// Check CHANGELOG.md injected into SDK dir
	if _, err := os.Stat(filepath.Join(sdkDir, "CHANGELOG.md")); os.IsNotExist(err) {
		t.Error("CHANGELOG.md not injected into SDK directory")
	}

	// Check .sfa marker
	markerPath := filepath.Join(projectDir, ".sfa")
	markerData, err := os.ReadFile(markerPath)
	if err != nil {
		t.Fatalf("failed to read .sfa: %v", err)
	}
	var marker sfaMarker
	if err := json.Unmarshal(markerData, &marker); err != nil {
		t.Fatalf("failed to parse .sfa: %v", err)
	}
	if marker.Language != "typescript" {
		t.Errorf("expected language typescript, got %s", marker.Language)
	}
	if marker.SDKPath != "@sfa/sdk/" {
		t.Errorf("expected sdkPath @sfa/sdk/, got %s", marker.SDKPath)
	}
}

func TestRunInitWithCustomSDKPath(t *testing.T) {
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "custom-agent")

	initName = ""
	initLanguage = "typescript"
	initSDKPath = "packages/@sfa/sdk"

	err := runInit(nil, []string{projectDir})
	if err != nil {
		t.Fatalf("runInit failed: %v", err)
	}

	// Check SDK is at custom path
	sdkDir := filepath.Join(projectDir, "packages", "@sfa", "sdk")
	if _, err := os.Stat(filepath.Join(sdkDir, "index.ts")); os.IsNotExist(err) {
		t.Error("SDK not extracted to custom path")
	}

	// Check agent.ts uses custom import path
	agentData, err := os.ReadFile(filepath.Join(projectDir, "agent.ts"))
	if err != nil {
		t.Fatalf("failed to read agent.ts: %v", err)
	}
	if !strings.Contains(string(agentData), `"./packages/@sfa/sdk"`) {
		t.Error("agent.ts does not use custom SDK path")
	}

	// Check .sfa marker has custom path
	markerData, err := os.ReadFile(filepath.Join(projectDir, ".sfa"))
	if err != nil {
		t.Fatalf("failed to read .sfa: %v", err)
	}
	var marker sfaMarker
	if err := json.Unmarshal(markerData, &marker); err != nil {
		t.Fatalf("failed to parse .sfa: %v", err)
	}
	if marker.SDKPath != "packages/@sfa/sdk/" {
		t.Errorf("expected sdkPath packages/@sfa/sdk/, got %s", marker.SDKPath)
	}

	// Reset
	initSDKPath = ""
}

func TestRunInitUnsupportedLanguage(t *testing.T) {
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "bad-agent")

	initName = ""
	initLanguage = "rust"
	initSDKPath = ""

	err := runInit(nil, []string{projectDir})
	if err == nil {
		t.Fatal("expected error for unsupported language")
	}
	if !strings.Contains(err.Error(), "unsupported language") {
		t.Errorf("expected unsupported language error, got: %v", err)
	}

	// Reset
	initLanguage = "typescript"
}

func TestRunInitExistingNonEmptyDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "existing")
	os.MkdirAll(projectDir, 0755)
	os.WriteFile(filepath.Join(projectDir, "file.txt"), []byte("exists"), 0644)

	initName = ""
	initLanguage = "typescript"
	initSDKPath = ""

	err := runInit(nil, []string{projectDir})
	if err == nil {
		t.Fatal("expected error for non-empty directory")
	}
	if !strings.Contains(err.Error(), "not empty") {
		t.Errorf("expected non-empty directory error, got: %v", err)
	}
}

// --- Go Scaffolding Tests ---

func TestGolangScaffolderSDKTargetDir(t *testing.T) {
	s := &GolangScaffolder{}
	if s.SDKTargetDir() != "sfa" {
		t.Errorf("expected sfa, got %s", s.SDKTargetDir())
	}
}

func TestGolangScaffolderGenerateAgent(t *testing.T) {
	s := &GolangScaffolder{}

	t.Run("default sdk path", func(t *testing.T) {
		agent := s.GenerateAgent("my-agent", "My Agent", "sfa")
		if !strings.Contains(agent, `"my-agent/sfa"`) {
			t.Error("expected import path my-agent/sfa")
		}
		if !strings.Contains(agent, `Name:        "my-agent"`) {
			t.Error("expected agent name in scaffold")
		}
		if !strings.Contains(agent, `Description: "My Agent"`) {
			t.Error("expected display name in scaffold")
		}
		if !strings.Contains(agent, "sfa.DefineAgent") {
			t.Error("expected sfa.DefineAgent call")
		}
	})

	t.Run("custom sdk path", func(t *testing.T) {
		agent := s.GenerateAgent("my-agent", "My Agent", "lib/sfa")
		if !strings.Contains(agent, `"my-agent/lib/sfa"`) {
			t.Errorf("expected custom import path, got:\n%s", agent)
		}
	})
}

func TestGolangScaffolderAdditionalFiles(t *testing.T) {
	s := &GolangScaffolder{}

	t.Run("default sdk path", func(t *testing.T) {
		files := s.AdditionalFiles("my-agent", "sfa")
		if files["go.mod"] == "" {
			t.Error("expected go.mod")
		}
		if !strings.Contains(files["go.mod"], "module my-agent") {
			t.Error("expected module my-agent in go.mod")
		}
		if !strings.Contains(files["go.mod"], "my-agent/sfa") {
			t.Error("expected require my-agent/sfa in go.mod")
		}
		if !strings.Contains(files["go.mod"], "replace my-agent/sfa => ./sfa") {
			t.Error("expected replace directive in go.mod")
		}

		sdkMod := files[filepath.Join("sfa", "go.mod")]
		if sdkMod == "" {
			t.Error("expected sfa/go.mod")
		}
		if !strings.Contains(sdkMod, "module my-agent/sfa") {
			t.Error("expected module my-agent/sfa in sfa/go.mod")
		}

		sdkSum := files[filepath.Join("sfa", "go.sum")]
		if sdkSum == "" {
			t.Error("expected sfa/go.sum")
		}
	})

	t.Run("custom sdk path", func(t *testing.T) {
		files := s.AdditionalFiles("my-agent", "lib/sfa")
		if !strings.Contains(files["go.mod"], "my-agent/lib/sfa") {
			t.Error("expected require my-agent/lib/sfa in go.mod")
		}
		if !strings.Contains(files["go.mod"], "replace my-agent/lib/sfa => ./lib/sfa") {
			t.Error("expected replace directive with custom path")
		}

		sdkMod := files[filepath.Join("lib", "sfa", "go.mod")]
		if sdkMod == "" {
			t.Error("expected lib/sfa/go.mod")
		}
		if !strings.Contains(sdkMod, "module my-agent/lib/sfa") {
			t.Error("expected module my-agent/lib/sfa")
		}
	})
}

func TestRunInitGolangProject(t *testing.T) {
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "my-go-agent")

	initName = ""
	initLanguage = "golang"
	initSDKPath = ""

	err := runInit(nil, []string{projectDir})
	if err != nil {
		t.Fatalf("runInit failed: %v", err)
	}

	// Check agent.go exists
	if _, err := os.Stat(filepath.Join(projectDir, "agent.go")); os.IsNotExist(err) {
		t.Error("agent.go not created")
	}

	// Check go.mod exists
	if _, err := os.Stat(filepath.Join(projectDir, "go.mod")); os.IsNotExist(err) {
		t.Error("go.mod not created")
	}

	// Check SDK directory exists with files
	sdkDir := filepath.Join(projectDir, "sfa")
	if _, err := os.Stat(filepath.Join(sdkDir, "agent.go")); os.IsNotExist(err) {
		t.Error("SDK agent.go not extracted")
	}
	if _, err := os.Stat(filepath.Join(sdkDir, "types.go")); os.IsNotExist(err) {
		t.Error("SDK types.go not extracted")
	}

	// Check VERSION injected
	if _, err := os.Stat(filepath.Join(sdkDir, "VERSION")); os.IsNotExist(err) {
		t.Error("VERSION not injected into SDK directory")
	}

	// Check .sfa marker
	markerData, err := os.ReadFile(filepath.Join(projectDir, ".sfa"))
	if err != nil {
		t.Fatalf("failed to read .sfa: %v", err)
	}
	var marker sfaMarker
	if err := json.Unmarshal(markerData, &marker); err != nil {
		t.Fatalf("failed to parse .sfa: %v", err)
	}
	if marker.Language != "golang" {
		t.Errorf("expected language golang, got %s", marker.Language)
	}
	if marker.SDKPath != "sfa/" {
		t.Errorf("expected sdkPath sfa/, got %s", marker.SDKPath)
	}

	// Reset
	initLanguage = "typescript"
}

func TestRunInitGolangCustomSDKPath(t *testing.T) {
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "custom-go")

	initName = ""
	initLanguage = "golang"
	initSDKPath = "lib/sfa"

	err := runInit(nil, []string{projectDir})
	if err != nil {
		t.Fatalf("runInit failed: %v", err)
	}

	// Check SDK at custom path
	if _, err := os.Stat(filepath.Join(projectDir, "lib", "sfa", "agent.go")); os.IsNotExist(err) {
		t.Error("SDK not extracted to custom path")
	}

	// Check go.mod has correct replace directive
	goMod, _ := os.ReadFile(filepath.Join(projectDir, "go.mod"))
	if !strings.Contains(string(goMod), "replace custom-go/lib/sfa => ./lib/sfa") {
		t.Errorf("go.mod missing custom replace directive, got:\n%s", string(goMod))
	}

	// Reset
	initLanguage = "typescript"
	initSDKPath = ""
}
