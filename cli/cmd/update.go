package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/sfa/cli/embedded"
	"github.com/spf13/cobra"
)

var (
	updateLanguage string
	updateDryRun   bool
)

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the vendored SDK to the latest version",
	Long:  "Re-vendor the SDK in an existing agent project. Detects language and SDK path from .sfa marker or auto-detection.",
	Args:  cobra.NoArgs,
	RunE:  runUpdate,
}

func init() {
	updateCmd.Flags().StringVar(&updateLanguage, "language", "", "Override language detection (typescript, golang)")
	updateCmd.Flags().BoolVar(&updateDryRun, "dry-run", false, "Preview version change without modifying files")
}

func runUpdate(cmd *cobra.Command, args []string) error {
	// Detect language and SDK path
	language, sdkPath, err := detectProject(updateLanguage)
	if err != nil {
		return err
	}

	// Read vendored VERSION
	versionPath := filepath.Join(sdkPath, "VERSION")
	vendoredVersion := ""
	if data, err := os.ReadFile(versionPath); err == nil {
		vendoredVersion = strings.TrimSpace(string(data))
	}

	// Get embedded version
	embeddedVersion := embedded.SDKVersion()

	// Compare versions
	if vendoredVersion == embeddedVersion {
		fmt.Printf("SDK is already up to date (version %s)\n", embeddedVersion)
		return nil
	}

	if vendoredVersion != "" && vendoredVersion > embeddedVersion {
		fmt.Printf("Warning: vendored SDK (%s) is newer than CLI's embedded SDK (%s)\n", vendoredVersion, embeddedVersion)
		return nil
	}

	// Show what will change
	if vendoredVersion == "" {
		fmt.Printf("SDK version: (unknown) → %s\n", embeddedVersion)
	} else {
		fmt.Printf("SDK version: %s → %s\n", vendoredVersion, embeddedVersion)
	}

	// Show CHANGELOG entries between versions
	changelog := embedded.SDKChangelog()
	if vendoredVersion != "" && changelog != "" {
		entries := extractChangelogEntries(changelog, vendoredVersion, embeddedVersion)
		if entries != "" {
			fmt.Println()
			fmt.Println("Changes:")
			fmt.Println(entries)
		}
	}

	if updateDryRun {
		fmt.Println("\n(dry run — no files modified)")
		return nil
	}

	// For Go agents: preserve existing go.mod module path
	var goModulePath string
	if language == "golang" {
		goModPath := filepath.Join(sdkPath, "go.mod")
		if data, err := os.ReadFile(goModPath); err == nil {
			goModulePath = extractGoModulePath(string(data))
		}
	}

	// Delete vendored SDK directory
	if err := os.RemoveAll(sdkPath); err != nil {
		return fmt.Errorf("failed to remove old SDK: %w", err)
	}

	// Re-create directory
	if err := os.MkdirAll(sdkPath, 0755); err != nil {
		return fmt.Errorf("failed to create SDK directory: %w", err)
	}

	// Extract embedded SDK
	if err := embedded.ExtractSDK(language, sdkPath); err != nil {
		return fmt.Errorf("failed to extract SDK: %w", err)
	}

	// Inject VERSION and CHANGELOG
	if err := embedded.InjectVersionFiles(sdkPath); err != nil {
		return fmt.Errorf("failed to inject version files: %w", err)
	}

	// For Go agents: restore the go.mod module path
	if language == "golang" && goModulePath != "" {
		goModPath := filepath.Join(sdkPath, "go.mod")
		if data, err := os.ReadFile(goModPath); err == nil {
			content := string(data)
			// Replace the module line
			lines := strings.Split(content, "\n")
			for i, line := range lines {
				if strings.HasPrefix(line, "module ") {
					lines[i] = "module " + goModulePath
					break
				}
			}
			os.WriteFile(goModPath, []byte(strings.Join(lines, "\n")), 0644)
		}
	}

	if vendoredVersion == "" {
		fmt.Printf("\nUpdated SDK to %s\n", embeddedVersion)
	} else {
		fmt.Printf("\nUpdated SDK: %s → %s\n", vendoredVersion, embeddedVersion)
	}

	return nil
}

// detectProject determines the project language and SDK path.
func detectProject(languageOverride string) (string, string, error) {
	// Try .sfa marker first
	if data, err := os.ReadFile(".sfa"); err == nil {
		var marker sfaMarker
		if err := json.Unmarshal(data, &marker); err == nil {
			lang := marker.Language
			if languageOverride != "" {
				lang = languageOverride
			}
			return lang, strings.TrimSuffix(marker.SDKPath, "/"), nil
		}
	}

	// Fallback auto-detection
	if languageOverride != "" {
		switch languageOverride {
		case "typescript":
			return "typescript", filepath.Join("@sfa", "sdk"), nil
		case "golang":
			return "golang", "sfa", nil
		default:
			return "", "", fmt.Errorf("unsupported language: %s", languageOverride)
		}
	}

	// Auto-detect from directory patterns
	if _, err := os.Stat(filepath.Join("@sfa", "sdk")); err == nil {
		return "typescript", filepath.Join("@sfa", "sdk"), nil
	}

	// Check for Go SDK directory with .go files
	if entries, err := os.ReadDir("sfa"); err == nil {
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".go") {
				return "golang", "sfa", nil
			}
		}
	}

	return "", "", fmt.Errorf("no vendored SDK found. Use 'sfa init' to create a project, or specify --language")
}

// extractChangelogEntries extracts CHANGELOG entries between two versions.
func extractChangelogEntries(changelog, fromVersion, toVersion string) string {
	lines := strings.Split(changelog, "\n")
	var result []string
	capturing := false

	for _, line := range lines {
		// Look for version headers like "## [0.2.0]"
		if strings.HasPrefix(line, "## [") {
			ver := extractVersionFromHeader(line)
			if ver == toVersion || (capturing && ver != fromVersion) {
				capturing = true
			} else if ver == fromVersion {
				capturing = false
			}
		}
		if capturing {
			result = append(result, line)
		}
	}

	return strings.TrimSpace(strings.Join(result, "\n"))
}

// extractVersionFromHeader extracts the version from a CHANGELOG header like "## [0.2.0] - 2026-02-21".
func extractVersionFromHeader(header string) string {
	start := strings.Index(header, "[")
	end := strings.Index(header, "]")
	if start >= 0 && end > start {
		return header[start+1 : end]
	}
	return ""
}

// extractGoModulePath extracts the module path from a go.mod file content.
func extractGoModulePath(content string) string {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "module ") {
			return strings.TrimPrefix(line, "module ")
		}
	}
	return ""
}
