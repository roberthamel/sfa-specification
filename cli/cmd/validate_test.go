package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRunner(t *testing.T) {
	tests := []struct {
		name     string
		agent    string
		expected []string
	}{
		{"TypeScript agent uses bun", "my-agent.ts", []string{"bun", "my-agent.ts"}},
		{"Binary agent runs directly", "./my-agent", []string{"./my-agent"}},
		{"Absolute path runs directly", "/usr/local/bin/my-agent", []string{"/usr/local/bin/my-agent"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := resolveRunner(tt.agent)
			if len(result) != len(tt.expected) {
				t.Errorf("expected %v, got %v", tt.expected, result)
				return
			}
			for i, v := range result {
				if v != tt.expected[i] {
					t.Errorf("expected[%d] = %q, got %q", i, tt.expected[i], v)
				}
			}
		})
	}
}

func TestCheckHelpWithCompliantAgent(t *testing.T) {
	// Create a minimal compliant agent script
	tmpDir := t.TempDir()
	agentPath := filepath.Join(tmpDir, "compliant-agent.ts")

	agentCode := `
import { defineAgent } from "` + findSDKPath() + `";

defineAgent({
  name: "compliant-agent",
  version: "1.0.0",
  description: "A compliant test agent",
  execute: async () => ({ result: "ok" }),
});
`
	if err := os.WriteFile(agentPath, []byte(agentCode), 0o755); err != nil {
		t.Fatalf("failed to write agent: %v", err)
	}

	runner := resolveRunner(agentPath)
	result := checkHelp(runner)

	if !result.passed {
		t.Errorf("compliant agent --help should pass, got: %s", result.message)
	}
}

func TestCheckVersionWithCompliantAgent(t *testing.T) {
	tmpDir := t.TempDir()
	agentPath := filepath.Join(tmpDir, "compliant-agent.ts")

	agentCode := `
import { defineAgent } from "` + findSDKPath() + `";

defineAgent({
  name: "compliant-agent",
  version: "1.0.0",
  description: "A compliant test agent",
  execute: async () => ({ result: "ok" }),
});
`
	if err := os.WriteFile(agentPath, []byte(agentCode), 0o755); err != nil {
		t.Fatalf("failed to write agent: %v", err)
	}

	runner := resolveRunner(agentPath)
	result := checkVersion(runner)

	if !result.passed {
		t.Errorf("compliant agent --version should pass, got: %s", result.message)
	}
}

func TestCheckDescribeWithCompliantAgent(t *testing.T) {
	tmpDir := t.TempDir()
	agentPath := filepath.Join(tmpDir, "compliant-agent.ts")

	agentCode := `
import { defineAgent } from "` + findSDKPath() + `";

defineAgent({
  name: "compliant-agent",
  version: "1.0.0",
  description: "A compliant test agent",
  trustLevel: "sandboxed",
  env: [
    { name: "API_KEY", required: true, secret: true, description: "API Key" },
  ],
  execute: async () => ({ result: "ok" }),
});
`
	if err := os.WriteFile(agentPath, []byte(agentCode), 0o755); err != nil {
		t.Fatalf("failed to write agent: %v", err)
	}

	runner := resolveRunner(agentPath)

	// First verify we get valid JSON
	output, exitCode, err := runAgent(runner, "--describe")
	if err != nil {
		t.Fatalf("failed to run agent: %v", err)
	}
	if exitCode != 0 {
		t.Fatalf("expected exit code 0, got %d", exitCode)
	}

	var desc map[string]interface{}
	if err := json.Unmarshal([]byte(output), &desc); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}

	// Check required fields
	requiredFields := []string{"name", "version", "description", "trustLevel"}
	for _, field := range requiredFields {
		if _, ok := desc[field]; !ok {
			t.Errorf("missing required field: %s", field)
		}
	}

	// Check env declarations
	envRaw, ok := desc["env"]
	if !ok {
		t.Fatal("missing env field")
	}
	envArr, ok := envRaw.([]interface{})
	if !ok {
		t.Fatalf("env should be array, got %T", envRaw)
	}
	if len(envArr) != 1 {
		t.Fatalf("expected 1 env declaration, got %d", len(envArr))
	}

	envEntry := envArr[0].(map[string]interface{})
	if envEntry["name"] != "API_KEY" {
		t.Errorf("expected env name API_KEY, got %v", envEntry["name"])
	}
	if envEntry["required"] != true {
		t.Errorf("expected required=true, got %v", envEntry["required"])
	}
	if envEntry["secret"] != true {
		t.Errorf("expected secret=true, got %v", envEntry["secret"])
	}

	// Check mcpSupported is boolean
	mcpVal, ok := desc["mcpSupported"]
	if ok {
		if _, isBool := mcpVal.(bool); !isBool {
			t.Errorf("mcpSupported should be boolean, got %T", mcpVal)
		}
	}

	// Run the full describe check and verify all pass
	results := checkDescribe(runner)
	for _, r := range results {
		if !r.passed {
			t.Errorf("check %q failed: %s", r.check, r.message)
		}
	}
}

func TestCheckDescribeNonCompliantAgent(t *testing.T) {
	tmpDir := t.TempDir()
	agentPath := filepath.Join(tmpDir, "bad-agent.ts")

	// Agent that outputs invalid JSON for --describe
	agentCode := `
if (process.argv.includes("--describe")) {
  process.stdout.write("not json\\n");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  process.stdout.write("help\\n");
  process.exit(0);
}
if (process.argv.includes("--version")) {
  process.stdout.write("1.0.0\\n");
  process.exit(0);
}
`
	if err := os.WriteFile(agentPath, []byte(agentCode), 0o755); err != nil {
		t.Fatalf("failed to write agent: %v", err)
	}

	runner := resolveRunner(agentPath)
	results := checkDescribe(runner)

	// Should have at least one failure (invalid JSON)
	hasFailure := false
	for _, r := range results {
		if !r.passed {
			hasFailure = true
			break
		}
	}
	if !hasFailure {
		t.Error("non-compliant agent should have at least one describe check failure")
	}
}

// findSDKPath returns the SDK import path relative to test tmp dirs.
// In practice the test agents resolve the SDK via the project structure.
func findSDKPath() string {
	// Walk up to find the project root
	dir, _ := os.Getwd()
	for {
		sdkPath := filepath.Join(dir, "sdk", "typescript", "@sfa", "sdk", "index")
		if _, err := os.Stat(filepath.Join(dir, "sdk", "typescript", "@sfa", "sdk", "index.ts")); err == nil {
			return sdkPath
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// Fallback — assume typical project layout
	return "../../sdk/typescript/@sfa/sdk/index"
}
