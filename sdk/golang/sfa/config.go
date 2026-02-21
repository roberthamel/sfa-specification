package sfa

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// getConfigPath returns the shared config file path.
// Priority: SFA_CONFIG env > ~/.config/single-file-agents/config.json.
func getConfigPath() string {
	if p := os.Getenv("SFA_CONFIG"); p != "" {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", "single-file-agents", "config.json")
}

// loadConfig reads and parses the shared config file.
// Returns an empty map if the file doesn't exist or can't be parsed.
func loadConfig() map[string]any {
	path := getConfigPath()
	if path == "" {
		return make(map[string]any)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return make(map[string]any)
	}

	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		return make(map[string]any)
	}

	return config
}

// saveConfig writes the config to the shared config file.
func saveConfig(config map[string]any) error {
	path := getConfigPath()
	if path == "" {
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	return os.WriteFile(path, data, 0644)
}

// mergeConfig returns a merged config from defaults and the agent namespace.
// Agent values override shared defaults. The "env" key is excluded.
func mergeConfig(config map[string]any, agentName string) map[string]any {
	merged := make(map[string]any)

	// Start with defaults
	if defaults, ok := config["defaults"]; ok {
		if dm, ok := defaults.(map[string]any); ok {
			for k, v := range dm {
				if k != "env" {
					merged[k] = v
				}
			}
		}
	}

	// Override with agent namespace
	if agents, ok := config["agents"]; ok {
		if am, ok := agents.(map[string]any); ok {
			if ns, ok := am[agentName]; ok {
				if nm, ok := ns.(map[string]any); ok {
					for k, v := range nm {
						if k != "env" {
							merged[k] = v
						}
					}
				}
			}
		}
	}

	return merged
}
