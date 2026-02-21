package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/sfa/cli/embedded"
	"github.com/spf13/cobra"
)

// Scaffolder defines the interface for language-specific project scaffolding.
type Scaffolder interface {
	// GenerateAgent returns the content for the main agent file.
	GenerateAgent(name, displayName, sdkPath string) string
	// GenerateReadme returns the content for the README.md file.
	GenerateReadme(name string) string
	// AdditionalFiles returns a map of relative file path → content for extra files
	// the language needs (e.g., go.mod for Go).
	AdditionalFiles(name string) map[string]string
	// SDKTargetDir returns the default vendored SDK directory name (e.g., "@sfa/sdk" or "sfa").
	SDKTargetDir() string
}

var scaffolders = map[string]Scaffolder{
	"typescript": &TypeScriptScaffolder{},
}

var (
	initName     string
	initLanguage string
	initSDKPath  string
)

var initCmd = &cobra.Command{
	Use:   "init <directory>",
	Short: "Scaffold a new single-file agent project",
	Long:  "Create a new agent project directory with a vendored SDK, agent scaffold, and README.",
	Args:  cobra.ExactArgs(1),
	RunE:  runInit,
}

func init() {
	initCmd.Flags().StringVar(&initName, "name", "", "Custom display name for the agent (e.g. \"Code Reviewer\")")
	initCmd.Flags().StringVar(&initLanguage, "language", "typescript", "SDK language (typescript, golang)")
	initCmd.Flags().StringVar(&initSDKPath, "sdk-path", "", "Override the default SDK vendoring location")
}

// sfaMarker is the content written to .sfa in scaffolded projects.
type sfaMarker struct {
	Language string `json:"language"`
	SDKPath  string `json:"sdkPath"`
}

func runInit(cmd *cobra.Command, args []string) error {
	dir := args[0]

	// Validate language
	scaffolder, ok := scaffolders[initLanguage]
	if !ok {
		supported := make([]string, 0, len(scaffolders))
		for lang := range scaffolders {
			supported = append(supported, lang)
		}
		return fmt.Errorf("unsupported language %q (supported: %s)", initLanguage, strings.Join(supported, ", "))
	}

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

	// Determine SDK target directory
	sdkPath := scaffolder.SDKTargetDir()
	if initSDKPath != "" {
		sdkPath = initSDKPath
	}

	sdkDir := filepath.Join(dir, sdkPath)
	if err := os.MkdirAll(sdkDir, 0755); err != nil {
		return fmt.Errorf("failed to create SDK directory: %w", err)
	}

	// Extract embedded SDK files
	if err := embedded.ExtractSDK(initLanguage, sdkDir); err != nil {
		return fmt.Errorf("failed to extract SDK: %w", err)
	}

	// Inject VERSION and CHANGELOG.md into vendored SDK directory
	if err := embedded.InjectVersionFiles(sdkDir); err != nil {
		return fmt.Errorf("failed to inject version files: %w", err)
	}

	// Write main agent file
	agentContent := scaffolder.GenerateAgent(agentName, displayName, sdkPath)
	agentFile := "agent.ts"
	if initLanguage == "golang" {
		agentFile = "agent.go"
	}
	if err := os.WriteFile(filepath.Join(dir, agentFile), []byte(agentContent), 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", agentFile, err)
	}

	// Write README.md
	readme := scaffolder.GenerateReadme(agentName)
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte(readme), 0644); err != nil {
		return fmt.Errorf("failed to write README.md: %w", err)
	}

	// Write additional files (e.g., go.mod for Go)
	for relPath, content := range scaffolder.AdditionalFiles(agentName) {
		absPath := filepath.Join(dir, relPath)
		if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
			return fmt.Errorf("failed to create directory for %s: %w", relPath, err)
		}
		if err := os.WriteFile(absPath, []byte(content), 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", relPath, err)
		}
	}

	// Write .sfa marker file
	// Ensure sdkPath ends with /
	markerSDKPath := sdkPath
	if !strings.HasSuffix(markerSDKPath, "/") {
		markerSDKPath += "/"
	}
	marker := sfaMarker{
		Language: initLanguage,
		SDKPath:  markerSDKPath,
	}
	markerData, err := json.MarshalIndent(marker, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal .sfa marker: %w", err)
	}
	markerData = append(markerData, '\n')
	if err := os.WriteFile(filepath.Join(dir, ".sfa"), markerData, 0644); err != nil {
		return fmt.Errorf("failed to write .sfa: %w", err)
	}

	// Print success message
	fmt.Printf("Created %s agent project in %s/\n", initLanguage, dir)
	fmt.Println()

	switch initLanguage {
	case "typescript":
		fmt.Println("  Quick start:")
		fmt.Printf("    cd %s\n", dir)
		fmt.Println("    bun agent.ts --help")
		fmt.Println()
		fmt.Println("  Compile:")
		fmt.Printf("    bun build --compile agent.ts --outfile %s\n", agentName)
		fmt.Println()
		fmt.Println("  Validate:")
		fmt.Println("    sfa validate ./agent.ts")
	case "golang":
		fmt.Println("  Quick start:")
		fmt.Printf("    cd %s\n", dir)
		fmt.Printf("    go build -o %s . && ./%s --help\n", agentName, agentName)
		fmt.Println()
		fmt.Println("  Validate:")
		fmt.Printf("    sfa validate ./%s\n", agentName)
	}

	return nil
}

func toKebabCase(s string) string {
	re := regexp.MustCompile(`([a-z])([A-Z])`)
	s = re.ReplaceAllString(s, "${1}-${2}")
	s = strings.NewReplacer(" ", "-", "_", "-").Replace(s)
	s = strings.ToLower(s)
	re = regexp.MustCompile(`-+`)
	s = re.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// --- TypeScriptScaffolder ---

type TypeScriptScaffolder struct{}

func (t *TypeScriptScaffolder) SDKTargetDir() string {
	return filepath.Join("@sfa", "sdk")
}

func (t *TypeScriptScaffolder) GenerateAgent(name, displayName, sdkPath string) string {
	importPath := "./" + filepath.ToSlash(sdkPath)
	return fmt.Sprintf(`import { defineAgent } from %q;

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
`, importPath, name, displayName, name)
}

func (t *TypeScriptScaffolder) GenerateReadme(name string) string {
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
sfa validate ./agent.ts
`+"```"+`
`, name, name)
}

func (t *TypeScriptScaffolder) AdditionalFiles(name string) map[string]string {
	return nil
}
