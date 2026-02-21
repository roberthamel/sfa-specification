package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/sfa/cli/embedded"
	"github.com/spf13/cobra"
)

var initName string

var initCmd = &cobra.Command{
	Use:   "init <directory>",
	Short: "Scaffold a new single-file agent project",
	Long:  "Create a new agent project directory with a vendored SDK, agent scaffold, and README.",
	Args:  cobra.ExactArgs(1),
	RunE:  runInit,
}

func init() {
	initCmd.Flags().StringVar(&initName, "name", "", "Custom display name for the agent (e.g. \"Code Reviewer\")")
}

func runInit(cmd *cobra.Command, args []string) error {
	dir := args[0]

	// Guard: refuse if directory exists and is non-empty
	if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
		return fmt.Errorf("directory %q already exists and is not empty; use an empty directory or a different name", dir)
	}

	// Derive agent name from directory or --name flag
	agentName := filepath.Base(dir)
	displayName := agentName
	if initName != "" {
		displayName = initName
		agentName = toKebabCase(initName)
	}

	// Create directory structure
	sdkDir := filepath.Join(dir, "@sfa", "sdk")
	if err := os.MkdirAll(sdkDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Extract embedded SDK files
	if err := embedded.ExtractSDK("typescript", sdkDir); err != nil {
		return fmt.Errorf("failed to extract SDK: %w", err)
	}

	// Write agent.ts scaffold
	agentTS := generateAgentScaffold(agentName, displayName)
	if err := os.WriteFile(filepath.Join(dir, "agent.ts"), []byte(agentTS), 0644); err != nil {
		return fmt.Errorf("failed to write agent.ts: %w", err)
	}

	// Write README.md
	readme := generateReadme(agentName)
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte(readme), 0644); err != nil {
		return fmt.Errorf("failed to write README.md: %w", err)
	}

	fmt.Printf("Created agent project in %s/\n", dir)
	fmt.Println()
	fmt.Println("  Quick start:")
	fmt.Printf("    cd %s\n", dir)
	fmt.Println("    bun agent.ts --help")
	fmt.Println()
	fmt.Println("  Compile:")
	fmt.Printf("    bun build --compile agent.ts --outfile %s\n", agentName)
	fmt.Println()
	fmt.Println("  Validate:")
	fmt.Printf("    sfa validate ./agent.ts\n")

	return nil
}

func toKebabCase(s string) string {
	// Insert hyphens before uppercase letters (camelCase/PascalCase)
	re := regexp.MustCompile(`([a-z])([A-Z])`)
	s = re.ReplaceAllString(s, "${1}-${2}")
	// Replace spaces and underscores with hyphens
	s = strings.NewReplacer(" ", "-", "_", "-").Replace(s)
	// Lowercase and collapse multiple hyphens
	s = strings.ToLower(s)
	re = regexp.MustCompile(`-+`)
	s = re.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func generateAgentScaffold(name, displayName string) string {
	return fmt.Sprintf(`import { defineAgent } from "./@sfa/sdk";

export default defineAgent({
  name: %q,
  version: "0.1.0",
  description: %q,
  trustLevel: "sandboxed",
  execute: async (ctx) => {
    const input = ctx.input;
    ctx.progress("Processing...");

    // TODO: implement your agent logic here

    return { result: "Hello from %s!" };
  },
});
`, name, displayName, name)
}

func generateReadme(name string) string {
	return fmt.Sprintf(`# %s

A single-file agent built with the [SFA SDK](https://github.com/sfa/sdk).

## Quick Start

`+"```"+`sh
# Run in development mode
bun agent.ts --help
bun agent.ts --describe

# Run the agent
echo "input" | bun agent.ts

# Compile to a standalone binary
bun build --compile agent.ts --outfile %s

# Validate spec compliance
sfa validate ./%s
`+"```"+`
`, name, name, name)
}
