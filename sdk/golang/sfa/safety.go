package sfa

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// SafetyState tracks invocation depth, call chain, and session identity.
type SafetyState struct {
	Depth     int
	MaxDepth  int
	CallChain []string
	SessionID string
}

// initSafety reads SFA_* safety env vars, performs loop detection, and propagates state.
func initSafety(agentName string, maxDepthFlag int) (*SafetyState, error) {
	depth := parseInt(os.Getenv("SFA_DEPTH"), 0)
	maxDepth := parseInt(os.Getenv("SFA_MAX_DEPTH"), maxDepthFlag)

	// Parse call chain
	chainStr := os.Getenv("SFA_CALL_CHAIN")
	var chain []string
	if chainStr != "" {
		chain = strings.Split(chainStr, ",")
	}

	// Loop detection — check if this agent is already in the call chain
	for _, name := range chain {
		if name == agentName {
			chain = append(chain, agentName)
			return nil, fmt.Errorf("loop detected: %s", strings.Join(chain, " → "))
		}
	}

	// Append current agent to call chain
	chain = append(chain, agentName)

	// Session ID — generate if top-level
	sessionID := os.Getenv("SFA_SESSION_ID")
	if sessionID == "" {
		sessionID = generateUUID()
	}

	safety := &SafetyState{
		Depth:     depth,
		MaxDepth:  maxDepth,
		CallChain: chain,
		SessionID: sessionID,
	}

	// Propagate to process environment
	os.Setenv("SFA_DEPTH", fmt.Sprintf("%d", depth))
	os.Setenv("SFA_MAX_DEPTH", fmt.Sprintf("%d", maxDepth))
	os.Setenv("SFA_CALL_CHAIN", strings.Join(chain, ","))
	os.Setenv("SFA_SESSION_ID", sessionID)

	return safety, nil
}

// checkDepthLimit returns an error if depth+1 would exceed maxDepth.
func checkDepthLimit(safety *SafetyState) error {
	if safety.Depth+1 >= safety.MaxDepth {
		return fmt.Errorf("depth limit reached: current depth %d, max depth %d", safety.Depth, safety.MaxDepth)
	}
	return nil
}

// checkLoop returns an error if the target agent is already in the call chain.
func checkLoop(safety *SafetyState, targetAgent string) error {
	for _, name := range safety.CallChain {
		if name == targetAgent {
			chain := append(safety.CallChain, targetAgent)
			return fmt.Errorf("loop detected: %s", strings.Join(chain, " → "))
		}
	}
	return nil
}

// buildSubagentSafetyEnv returns env vars with incremented depth for subagent invocation.
func buildSubagentSafetyEnv(safety *SafetyState) map[string]string {
	return map[string]string{
		"SFA_DEPTH":      fmt.Sprintf("%d", safety.Depth+1),
		"SFA_MAX_DEPTH":  fmt.Sprintf("%d", safety.MaxDepth),
		"SFA_CALL_CHAIN": strings.Join(safety.CallChain, ","),
		"SFA_SESSION_ID": safety.SessionID,
	}
}

// setupTimeout returns a context with a timeout and a cancel function.
func setupTimeout(agentName string, timeoutSeconds int) (context.Context, context.CancelFunc) {
	if timeoutSeconds <= 0 {
		return context.WithCancel(context.Background())
	}
	return context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
}

// setupSignalHandlers installs SIGINT and SIGTERM handlers that cancel the context.
// Returns a cleanup function that removes the signal handlers.
func setupSignalHandlers(agentName string, cancel context.CancelFunc) func() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		cancel()

		switch sig {
		case syscall.SIGINT:
			emitProgress(agentName, "interrupted (SIGINT)")
			// Give a moment for cleanup, then exit
			time.Sleep(100 * time.Millisecond)
			os.Exit(ExitSIGINT)
		case syscall.SIGTERM:
			emitProgress(agentName, "terminated (SIGTERM)")
			time.Sleep(5 * time.Second) // grace period
			os.Exit(ExitSIGTERM)
		}
	}()

	return func() {
		signal.Stop(sigCh)
		close(sigCh)
	}
}

// generateUUID produces a UUID v4 string.
func generateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 2
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
