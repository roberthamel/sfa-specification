package sfa

import (
	"testing"
)

func TestParseArgsStandardFlags(t *testing.T) {
	args, err := parseArgs([]string{
		"--help",
	}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !args.Flags.Help {
		t.Error("expected --help to be true")
	}
}

func TestParseArgsVersion(t *testing.T) {
	args, err := parseArgs([]string{"--version"}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !args.Flags.Version {
		t.Error("expected --version to be true")
	}
}

func TestParseArgsDescribe(t *testing.T) {
	args, err := parseArgs([]string{"--describe"}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !args.Flags.Describe {
		t.Error("expected --describe to be true")
	}
}

func TestParseArgsAllStandardFlags(t *testing.T) {
	args, err := parseArgs([]string{
		"--verbose", "--quiet", "--output-format", "json",
		"--timeout", "60", "--setup", "--no-log",
		"--max-depth", "3", "--services-down", "--yes",
		"--non-interactive", "--mcp",
		"--context", "hello world",
		"--context-file", "/tmp/ctx.txt",
	}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !args.Flags.Verbose {
		t.Error("expected verbose")
	}
	if !args.Flags.Quiet {
		t.Error("expected quiet")
	}
	if args.Flags.OutputFormat != OutputJSON {
		t.Errorf("expected json, got %s", args.Flags.OutputFormat)
	}
	if args.Flags.Timeout != 60 {
		t.Errorf("expected timeout 60, got %d", args.Flags.Timeout)
	}
	if !args.Flags.Setup {
		t.Error("expected setup")
	}
	if !args.Flags.NoLog {
		t.Error("expected no-log")
	}
	if args.Flags.MaxDepth != 3 {
		t.Errorf("expected max-depth 3, got %d", args.Flags.MaxDepth)
	}
	if !args.Flags.ServicesDown {
		t.Error("expected services-down")
	}
	if !args.Flags.Yes {
		t.Error("expected yes")
	}
	if !args.Flags.NonInteractive {
		t.Error("expected non-interactive")
	}
	if !args.Flags.MCP {
		t.Error("expected mcp")
	}
	if args.Flags.Context != "hello world" {
		t.Errorf("expected context 'hello world', got %q", args.Flags.Context)
	}
	if args.Flags.ContextFile != "/tmp/ctx.txt" {
		t.Errorf("expected context-file /tmp/ctx.txt, got %q", args.Flags.ContextFile)
	}
}

func TestParseArgsDefaults(t *testing.T) {
	args, err := parseArgs([]string{}, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if args.Flags.Timeout != 120 {
		t.Errorf("expected default timeout 120, got %d", args.Flags.Timeout)
	}
	if args.Flags.MaxDepth != 5 {
		t.Errorf("expected default max-depth 5, got %d", args.Flags.MaxDepth)
	}
	if args.Flags.OutputFormat != OutputText {
		t.Errorf("expected default output-format text, got %s", args.Flags.OutputFormat)
	}
}

func TestParseArgsCustomStringOption(t *testing.T) {
	opts := []OptionDef{
		{Name: "model", Type: "string", Default: "gpt-4", Description: "Model to use"},
	}
	args, err := parseArgs([]string{"--model", "claude-3"}, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if args.Custom["model"] != "claude-3" {
		t.Errorf("expected model claude-3, got %v", args.Custom["model"])
	}
}

func TestParseArgsCustomBoolOption(t *testing.T) {
	opts := []OptionDef{
		{Name: "dry-run", Type: "boolean", Description: "Dry run mode"},
	}
	args, err := parseArgs([]string{"--dry-run"}, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if args.Custom["dry-run"] != true {
		t.Errorf("expected dry-run true, got %v", args.Custom["dry-run"])
	}
}

func TestParseArgsCustomNumberOption(t *testing.T) {
	opts := []OptionDef{
		{Name: "count", Type: "number", Default: 10, Description: "Count"},
	}
	args, err := parseArgs([]string{"--count", "42"}, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if args.Custom["count"] != 42 {
		t.Errorf("expected count 42, got %v", args.Custom["count"])
	}
}

func TestParseArgsCustomOptionWithAlias(t *testing.T) {
	opts := []OptionDef{
		{Name: "model", Alias: "m", Type: "string", Description: "Model"},
	}
	args, err := parseArgs([]string{"-m", "claude"}, opts)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if args.Custom["model"] != "claude" {
		t.Errorf("expected model claude, got %v", args.Custom["model"])
	}
}

func TestReadInputFromContext(t *testing.T) {
	input, err := readInput(StandardFlags{Context: "test data"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input != "test data" {
		t.Errorf("expected 'test data', got %q", input)
	}
}

func TestReadInputFromContextFile(t *testing.T) {
	tmpDir := t.TempDir()
	f := tmpDir + "/input.txt"
	if err := writeTestFile(f, "file content"); err != nil {
		t.Fatal(err)
	}

	input, err := readInput(StandardFlags{ContextFile: f})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input != "file content" {
		t.Errorf("expected 'file content', got %q", input)
	}
}

func TestReadInputNoInput(t *testing.T) {
	input, err := readInput(StandardFlags{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if input != "" {
		t.Errorf("expected empty input, got %q", input)
	}
}

func TestGenerateHelp(t *testing.T) {
	def := &AgentDef{
		Name:        "test-agent",
		Version:     "1.0.0",
		Description: "A test agent",
		Options: []OptionDef{
			{Name: "model", Alias: "m", Description: "Model to use"},
		},
		Env: []EnvDef{
			{Name: "API_KEY", Required: true, Description: "API key"},
		},
		Examples: []string{
			"echo 'hello' | test-agent",
		},
	}

	help := generateHelp(def)
	if help == "" {
		t.Error("expected non-empty help text")
	}

	// Check key sections exist
	for _, want := range []string{"test-agent v1.0.0", "USAGE:", "OPTIONS:", "AGENT OPTIONS:", "--model", "ENVIRONMENT VARIABLES:", "API_KEY", "EXAMPLES:"} {
		if !contains(help, want) {
			t.Errorf("help missing %q", want)
		}
	}
}

func TestGenerateDescribe(t *testing.T) {
	def := &AgentDef{
		Name:        "test-agent",
		Version:     "1.0.0",
		Description: "A test agent",
		TrustLevel:  TrustNetwork,
		Env: []EnvDef{
			{Name: "API_KEY", Required: true, Secret: true, Description: "API key"},
		},
	}
	env := map[string]string{"API_KEY": "secret123"}
	secrets := map[string]bool{"API_KEY": true}

	desc := generateDescribe(def, env, secrets)

	if desc["name"] != "test-agent" {
		t.Errorf("expected name test-agent, got %v", desc["name"])
	}
	if desc["trustLevel"] != "network" {
		t.Errorf("expected trustLevel network, got %v", desc["trustLevel"])
	}

	// Check secret masking in describe
	envList := desc["env"].([]map[string]any)
	if envList[0]["value"] != "***" {
		t.Errorf("expected secret value masked, got %v", envList[0]["value"])
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstr(s, substr))
}

func containsSubstr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
