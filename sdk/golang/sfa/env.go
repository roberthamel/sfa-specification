package sfa

import (
	"fmt"
	"os"
	"strings"
)

// ResolvedEnv holds environment variable values and the set of secret var names.
type ResolvedEnv struct {
	Values  map[string]string
	Secrets map[string]bool
}

// resolveEnv resolves environment variables using the SFA precedence order:
// process env > agent config namespace > shared config defaults > definition defaults.
func resolveEnv(declarations []EnvDef, agentName string, config map[string]any) *ResolvedEnv {
	resolved := &ResolvedEnv{
		Values:  make(map[string]string),
		Secrets: make(map[string]bool),
	}

	// Extract agent-specific env from config
	agentEnv := make(map[string]string)
	if agents, ok := config["agents"]; ok {
		if agentsMap, ok := agents.(map[string]any); ok {
			if ns, ok := agentsMap[agentName]; ok {
				if nsMap, ok := ns.(map[string]any); ok {
					if envMap, ok := nsMap["env"]; ok {
						if em, ok := envMap.(map[string]any); ok {
							for k, v := range em {
								agentEnv[k] = fmt.Sprintf("%v", v)
							}
						}
					}
				}
			}
		}
	}

	// Extract global defaults env from config
	globalEnv := make(map[string]string)
	if defaults, ok := config["defaults"]; ok {
		if dm, ok := defaults.(map[string]any); ok {
			if envMap, ok := dm["env"]; ok {
				if em, ok := envMap.(map[string]any); ok {
					for k, v := range em {
						globalEnv[k] = fmt.Sprintf("%v", v)
					}
				}
			}
		}
	}

	for _, decl := range declarations {
		if decl.Secret {
			resolved.Secrets[decl.Name] = true
		}

		// Precedence: process env > agent config > global defaults > definition default
		if val := os.Getenv(decl.Name); val != "" {
			resolved.Values[decl.Name] = val
			continue
		}
		if val, ok := agentEnv[decl.Name]; ok {
			resolved.Values[decl.Name] = val
			continue
		}
		if val, ok := globalEnv[decl.Name]; ok {
			resolved.Values[decl.Name] = val
			continue
		}
		if decl.Default != "" {
			resolved.Values[decl.Name] = decl.Default
			continue
		}
	}

	return resolved
}

// validateEnv checks for missing required environment variables.
// Returns a list of missing variable names.
func validateEnv(declarations []EnvDef, resolved *ResolvedEnv) []EnvDef {
	var missing []EnvDef
	for _, decl := range declarations {
		if decl.Required {
			if val, ok := resolved.Values[decl.Name]; !ok || val == "" {
				missing = append(missing, decl)
			}
		}
	}
	return missing
}

// injectEnv sets resolved values into the process environment (only if not already set).
func injectEnv(resolved *ResolvedEnv) {
	for name, val := range resolved.Values {
		if os.Getenv(name) == "" {
			os.Setenv(name, val)
		}
	}
}

// maskSecrets replaces secret values with "***" in the given text.
func maskSecrets(text string, resolved *ResolvedEnv) string {
	for name := range resolved.Secrets {
		if val, ok := resolved.Values[name]; ok && val != "" {
			text = strings.ReplaceAll(text, val, "***")
		}
	}
	return text
}

// buildSubagentEnv returns environment variables suitable for subagent processes.
// Only SFA_* protocol variables and essential system vars are included.
func buildSubagentEnv() map[string]string {
	env := make(map[string]string)

	// Forward SFA_* protocol vars
	for _, kv := range os.Environ() {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) == 2 && strings.HasPrefix(parts[0], "SFA_") {
			env[parts[0]] = parts[1]
		}
	}

	// Forward essential system vars
	systemVars := []string{"PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL"}
	for _, name := range systemVars {
		if val := os.Getenv(name); val != "" {
			env[name] = val
		}
	}

	return env
}

// formatMissingEnvError creates a user-friendly error message for missing env vars.
func formatMissingEnvError(agentName string, missing []EnvDef) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("Missing required environment variables for %s:\n", agentName))
	for _, m := range missing {
		desc := ""
		if m.Description != "" {
			desc = fmt.Sprintf(" — %s", m.Description)
		}
		b.WriteString(fmt.Sprintf("  • %s%s\n", m.Name, desc))
	}
	b.WriteString(fmt.Sprintf("\nRun '%s --setup' to configure interactively.", agentName))
	return b.String()
}
