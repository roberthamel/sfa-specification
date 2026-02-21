package sfa

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// runSetup handles the --setup interactive flow for environment variables.
func runSetup(agentName string, declarations []EnvDef, nonInteractive bool) {
	if nonInteractive {
		exitWithError("setup requires interactive mode (remove --non-interactive)", ExitInvalidUsage)
	}

	if len(declarations) == 0 {
		fmt.Println("No environment variables declared for this agent.")
		os.Exit(ExitSuccess)
	}

	// Load current config
	config := loadConfig()

	// Ensure agents namespace exists
	if config["agents"] == nil {
		config["agents"] = map[string]any{}
	}
	agents := config["agents"].(map[string]any)
	if agents[agentName] == nil {
		agents[agentName] = map[string]any{}
	}
	agentNS := agents[agentName].(map[string]any)
	if agentNS["env"] == nil {
		agentNS["env"] = map[string]any{}
	}
	envMap := agentNS["env"].(map[string]any)

	reader := bufio.NewReader(os.Stdin)

	fmt.Printf("Setup for %s\n\n", agentName)

	for _, decl := range declarations {
		// Show current value
		current := ""
		if v, ok := envMap[decl.Name]; ok {
			current = fmt.Sprintf("%v", v)
		}
		if current == "" {
			current = os.Getenv(decl.Name)
		}

		prompt := decl.Name
		if decl.Description != "" {
			prompt += fmt.Sprintf(" (%s)", decl.Description)
		}

		if current != "" {
			display := current
			if decl.Secret {
				display = "***"
			}
			prompt += fmt.Sprintf(" [current: %s]", display)
		} else if decl.Default != "" {
			prompt += fmt.Sprintf(" [default: %s]", decl.Default)
		}

		req := ""
		if decl.Required {
			req = " (required)"
		}

		fmt.Printf("%s%s: ", prompt, req)
		input, _ := reader.ReadString('\n')
		input = strings.TrimSpace(input)

		if input != "" {
			envMap[decl.Name] = input
		}
	}

	// Save config
	if err := saveConfig(config); err != nil {
		exitWithError(fmt.Sprintf("failed to save config: %v", err), ExitFailure)
	}

	fmt.Println("\nConfiguration saved.")
	os.Exit(ExitSuccess)
}
