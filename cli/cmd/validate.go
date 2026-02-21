package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/sfa/cli/embedded"
	"github.com/spf13/cobra"
)

var validateCmd = &cobra.Command{
	Use:   "validate <agent>",
	Short: "Validate an agent's spec compliance",
	Long:  "Invoke the agent with --help, --version, and --describe to verify SFA spec compliance.",
	Args:  cobra.ExactArgs(1),
	RunE:  runValidate,
}

type validationResult struct {
	check   string
	passed  bool
	message string
}

func runValidate(cmd *cobra.Command, args []string) error {
	agent := args[0]

	// Check the agent exists and is executable
	if _, err := os.Stat(agent); os.IsNotExist(err) {
		return fmt.Errorf("agent not found: %s", agent)
	}

	var results []validationResult

	// Determine how to run the agent
	runner := resolveRunner(agent)

	// Check --help
	results = append(results, checkHelp(runner))

	// Check --version
	results = append(results, checkVersion(runner))

	// Check --describe
	describeResults := checkDescribe(runner)
	results = append(results, describeResults...)

	// Report results
	failures := 0
	for _, r := range results {
		if r.passed {
			fmt.Printf("  ✓ %s\n", r.check)
		} else {
			fmt.Printf("  ✗ %s: %s\n", r.check, r.message)
			failures++
		}
	}

	fmt.Println()
	if failures > 0 {
		fmt.Printf("%d/%d checks failed\n", failures, len(results))
		os.Exit(1)
	}

	fmt.Printf("All %d checks passed\n", len(results))

	// SDK version warning (non-fatal)
	checkSDKVersion()

	return nil
}

func resolveRunner(agent string) []string {
	// If agent ends in .ts, run with bun
	if strings.HasSuffix(agent, ".ts") {
		return []string{"bun", agent}
	}
	return []string{agent}
}

func runAgent(runner []string, flag string) (string, int, error) {
	args := append(runner, flag)
	c := exec.Command(args[0], args[1:]...)
	out, err := c.CombinedOutput()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return string(out), -1, err
		}
	}

	return string(out), exitCode, nil
}

func checkHelp(runner []string) validationResult {
	_, exitCode, err := runAgent(runner, "--help")
	if err != nil {
		return validationResult{"--help exits with code 0", false, fmt.Sprintf("failed to run: %v", err)}
	}
	if exitCode != 0 {
		return validationResult{"--help exits with code 0", false, fmt.Sprintf("exit code %d", exitCode)}
	}
	return validationResult{"--help exits with code 0", true, ""}
}

func checkVersion(runner []string) validationResult {
	output, exitCode, err := runAgent(runner, "--version")
	if err != nil {
		return validationResult{"--version exits with code 0", false, fmt.Sprintf("failed to run: %v", err)}
	}
	if exitCode != 0 {
		return validationResult{"--version exits with code 0", false, fmt.Sprintf("exit code %d", exitCode)}
	}
	output = strings.TrimSpace(output)
	if output == "" {
		return validationResult{"--version outputs version string", false, "no output on stdout"}
	}
	return validationResult{"--version exits with code 0 and outputs version", true, ""}
}

func checkDescribe(runner []string) []validationResult {
	var results []validationResult

	output, exitCode, err := runAgent(runner, "--describe")
	if err != nil {
		results = append(results, validationResult{"--describe exits with code 0", false, fmt.Sprintf("failed to run: %v", err)})
		return results
	}
	if exitCode != 0 {
		results = append(results, validationResult{"--describe exits with code 0", false, fmt.Sprintf("exit code %d", exitCode)})
		return results
	}

	results = append(results, validationResult{"--describe exits with code 0", true, ""})

	// Parse JSON
	var desc map[string]interface{}
	if err := json.Unmarshal([]byte(output), &desc); err != nil {
		results = append(results, validationResult{"--describe outputs valid JSON", false, fmt.Sprintf("invalid JSON: %v", err)})
		return results
	}

	results = append(results, validationResult{"--describe outputs valid JSON", true, ""})

	// Check required fields
	requiredFields := []string{"name", "version", "description", "trustLevel"}
	for _, field := range requiredFields {
		if _, ok := desc[field]; !ok {
			results = append(results, validationResult{fmt.Sprintf("--describe has required field %q", field), false, "field missing"})
		} else {
			results = append(results, validationResult{fmt.Sprintf("--describe has required field %q", field), true, ""})
		}
	}

	// Check mcpSupported is boolean if present
	if val, ok := desc["mcpSupported"]; ok {
		if _, isBool := val.(bool); !isBool {
			results = append(results, validationResult{"mcpSupported is boolean", false, fmt.Sprintf("got %T", val)})
		} else {
			results = append(results, validationResult{"mcpSupported is boolean", true, ""})
		}
	}

	// Validate env declarations if present
	if envRaw, ok := desc["env"]; ok {
		envArr, isArr := envRaw.([]interface{})
		if !isArr {
			results = append(results, validationResult{"env is an array", false, fmt.Sprintf("got %T", envRaw)})
		} else {
			results = append(results, validationResult{"env is an array", true, ""})
			for i, entry := range envArr {
				entryMap, isMap := entry.(map[string]interface{})
				if !isMap {
					results = append(results, validationResult{fmt.Sprintf("env[%d] is an object", i), false, "not an object"})
					continue
				}
				if _, ok := entryMap["name"]; !ok {
					results = append(results, validationResult{fmt.Sprintf("env[%d] has name", i), false, "missing"})
				}
				if _, ok := entryMap["required"]; !ok {
					results = append(results, validationResult{fmt.Sprintf("env[%d] has required", i), false, "missing"})
				}
			}
			if len(envArr) > 0 {
				results = append(results, validationResult{"env declarations have name and required", true, ""})
			}
		}
	}

	return results
}

// checkSDKVersion prints a warning if the vendored SDK is outdated.
func checkSDKVersion() {
	language, sdkPath, err := detectProject("")
	if err != nil {
		return // no SDK found, skip silently
	}

	versionPath := filepath.Join(sdkPath, "VERSION")
	data, err := os.ReadFile(versionPath)
	if err != nil {
		return // no VERSION file, skip silently
	}

	vendored := strings.TrimSpace(string(data))
	current := embedded.SDKVersion()

	if vendored != current {
		fmt.Printf("\n  ⚠ SDK outdated: %s → %s (run `sfa update` to upgrade, language=%s)\n", vendored, current, language)
	}
}
