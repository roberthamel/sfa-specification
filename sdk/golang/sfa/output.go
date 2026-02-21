package sfa

import (
	"encoding/json"
	"fmt"
	"os"
)

// writeResult writes the agent's result to stdout in the specified format.
func writeResult(result any, format OutputFormat) {
	switch format {
	case OutputJSON:
		data, err := json.Marshal(result)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: failed to marshal result: %v\n", err)
			os.Exit(ExitFailure)
		}
		fmt.Fprintln(os.Stdout, string(data))
	default:
		// Text mode — stringify the result
		switch v := result.(type) {
		case string:
			fmt.Fprintln(os.Stdout, v)
		case map[string]any:
			data, _ := json.MarshalIndent(v, "", "  ")
			fmt.Fprintln(os.Stdout, string(data))
		default:
			data, err := json.Marshal(v)
			if err != nil {
				fmt.Fprintln(os.Stdout, fmt.Sprintf("%v", v))
			} else {
				fmt.Fprintln(os.Stdout, string(data))
			}
		}
	}
}

// writeDiagnostic writes a diagnostic message to stderr.
func writeDiagnostic(message string) {
	fmt.Fprintln(os.Stderr, message)
}

// exitWithError writes an error message to stderr and exits with the given code.
func exitWithError(message string, code int) {
	fmt.Fprintf(os.Stderr, "error: %s\n", message)
	os.Exit(code)
}

// emitProgress writes a progress message to stderr in the SFA format.
func emitProgress(agentName, message string) {
	fmt.Fprintf(os.Stderr, "[agent:%s] %s\n", agentName, message)
}
