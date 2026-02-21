package sfa

import (
	"os"
	"strings"
	"testing"
)

func TestResolveEnvFromProcessEnv(t *testing.T) {
	os.Setenv("TEST_API_KEY", "from-env")
	defer os.Unsetenv("TEST_API_KEY")

	decls := []EnvDef{
		{Name: "TEST_API_KEY", Required: true},
	}

	resolved := resolveEnv(decls, "test-agent", map[string]any{})

	if resolved.Values["TEST_API_KEY"] != "from-env" {
		t.Errorf("expected from-env, got %q", resolved.Values["TEST_API_KEY"])
	}
}

func TestResolveEnvFromAgentConfig(t *testing.T) {
	os.Unsetenv("TEST_CONFIG_KEY")

	decls := []EnvDef{
		{Name: "TEST_CONFIG_KEY", Required: true},
	}
	config := map[string]any{
		"agents": map[string]any{
			"test-agent": map[string]any{
				"env": map[string]any{
					"TEST_CONFIG_KEY": "from-config",
				},
			},
		},
	}

	resolved := resolveEnv(decls, "test-agent", config)

	if resolved.Values["TEST_CONFIG_KEY"] != "from-config" {
		t.Errorf("expected from-config, got %q", resolved.Values["TEST_CONFIG_KEY"])
	}
}

func TestResolveEnvFromDefault(t *testing.T) {
	os.Unsetenv("TEST_DEFAULT_KEY")

	decls := []EnvDef{
		{Name: "TEST_DEFAULT_KEY", Default: "default-val"},
	}

	resolved := resolveEnv(decls, "test-agent", map[string]any{})

	if resolved.Values["TEST_DEFAULT_KEY"] != "default-val" {
		t.Errorf("expected default-val, got %q", resolved.Values["TEST_DEFAULT_KEY"])
	}
}

func TestResolveEnvPrecedence(t *testing.T) {
	os.Setenv("PREC_KEY", "from-env")
	defer os.Unsetenv("PREC_KEY")

	decls := []EnvDef{
		{Name: "PREC_KEY", Default: "from-default"},
	}
	config := map[string]any{
		"agents": map[string]any{
			"test-agent": map[string]any{
				"env": map[string]any{
					"PREC_KEY": "from-config",
				},
			},
		},
	}

	resolved := resolveEnv(decls, "test-agent", config)

	// Process env should win
	if resolved.Values["PREC_KEY"] != "from-env" {
		t.Errorf("expected from-env (highest precedence), got %q", resolved.Values["PREC_KEY"])
	}
}

func TestResolveEnvSecrets(t *testing.T) {
	decls := []EnvDef{
		{Name: "SECRET_KEY", Secret: true, Default: "s3cr3t"},
	}

	resolved := resolveEnv(decls, "test-agent", map[string]any{})

	if !resolved.Secrets["SECRET_KEY"] {
		t.Error("expected SECRET_KEY to be marked as secret")
	}
}

func TestValidateEnvMissing(t *testing.T) {
	os.Unsetenv("MISSING_KEY")

	decls := []EnvDef{
		{Name: "MISSING_KEY", Required: true, Description: "Required key"},
		{Name: "OPTIONAL_KEY", Required: false},
	}

	resolved := resolveEnv(decls, "test-agent", map[string]any{})
	missing := validateEnv(decls, resolved)

	if len(missing) != 1 {
		t.Fatalf("expected 1 missing, got %d", len(missing))
	}
	if missing[0].Name != "MISSING_KEY" {
		t.Errorf("expected MISSING_KEY, got %s", missing[0].Name)
	}
}

func TestValidateEnvAllPresent(t *testing.T) {
	os.Setenv("PRESENT_KEY", "value")
	defer os.Unsetenv("PRESENT_KEY")

	decls := []EnvDef{
		{Name: "PRESENT_KEY", Required: true},
	}

	resolved := resolveEnv(decls, "test-agent", map[string]any{})
	missing := validateEnv(decls, resolved)

	if len(missing) != 0 {
		t.Errorf("expected 0 missing, got %d", len(missing))
	}
}

func TestMaskSecrets(t *testing.T) {
	resolved := &ResolvedEnv{
		Values:  map[string]string{"API_KEY": "supersecret"},
		Secrets: map[string]bool{"API_KEY": true},
	}

	text := "The key is supersecret in this message"
	masked := maskSecrets(text, resolved)

	if strings.Contains(masked, "supersecret") {
		t.Error("expected secret to be masked")
	}
	if !strings.Contains(masked, "***") {
		t.Error("expected *** in masked output")
	}
}

func TestBuildSubagentEnv(t *testing.T) {
	os.Setenv("SFA_DEPTH", "1")
	os.Setenv("SFA_SESSION_ID", "test-session")
	os.Setenv("MY_CUSTOM_VAR", "should-not-appear")
	defer func() {
		os.Unsetenv("SFA_DEPTH")
		os.Unsetenv("SFA_SESSION_ID")
		os.Unsetenv("MY_CUSTOM_VAR")
	}()

	env := buildSubagentEnv()

	if env["SFA_DEPTH"] != "1" {
		t.Errorf("expected SFA_DEPTH=1, got %q", env["SFA_DEPTH"])
	}
	if env["SFA_SESSION_ID"] != "test-session" {
		t.Errorf("expected SFA_SESSION_ID=test-session, got %q", env["SFA_SESSION_ID"])
	}
	if _, exists := env["MY_CUSTOM_VAR"]; exists {
		t.Error("custom vars should not be in subagent env")
	}
	// PATH should be forwarded
	if env["PATH"] == "" {
		t.Error("expected PATH to be forwarded")
	}
}

func TestFormatMissingEnvError(t *testing.T) {
	missing := []EnvDef{
		{Name: "API_KEY", Description: "Your API key"},
		{Name: "DB_URL", Description: "Database URL"},
	}

	msg := formatMissingEnvError("test-agent", missing)

	if !strings.Contains(msg, "API_KEY") {
		t.Error("expected API_KEY in error message")
	}
	if !strings.Contains(msg, "DB_URL") {
		t.Error("expected DB_URL in error message")
	}
	if !strings.Contains(msg, "--setup") {
		t.Error("expected --setup suggestion")
	}
}
