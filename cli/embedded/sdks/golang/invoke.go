package sfa

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// invokeAgent spawns a subagent as a subprocess with proper env propagation and timeout.
func invokeAgent(agentName string, safety *SafetyState, parentCtx context.Context, opts *InvokeOpts) (*InvokeResult, error) {
	// Check depth limit
	if err := checkDepthLimit(safety); err != nil {
		return nil, err
	}

	// Check loop detection
	if err := checkLoop(safety, agentName); err != nil {
		return nil, err
	}

	// Build environment
	env := buildSubagentEnv()

	// Override with incremented safety env vars
	safetyEnv := buildSubagentSafetyEnv(safety)
	for k, v := range safetyEnv {
		env[k] = v
	}

	// Build env slice
	envSlice := make([]string, 0, len(env))
	for k, v := range env {
		envSlice = append(envSlice, fmt.Sprintf("%s=%s", k, v))
	}

	// Build command args
	args := []string{}
	if opts != nil && len(opts.Args) > 0 {
		args = append(args, opts.Args...)
	}

	// Determine timeout
	var ctx context.Context
	var cancel context.CancelFunc
	if opts != nil && opts.Timeout > 0 {
		ctx, cancel = context.WithTimeout(parentCtx, time.Duration(opts.Timeout)*time.Second)
	} else {
		// Use parent context (inherits parent timeout)
		ctx, cancel = context.WithCancel(parentCtx)
	}
	defer cancel()

	// Create command
	cmd := exec.CommandContext(ctx, agentName, args...)
	cmd.Env = envSlice

	// Pipe context to stdin if provided
	if opts != nil && opts.Context != "" {
		cmd.Stdin = strings.NewReader(opts.Context)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Set process group so we can kill the entire group
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	// Run
	err := cmd.Run()

	result := &InvokeResult{
		Output: stdout.String(),
		Stderr: stderr.String(),
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else if ctx.Err() == context.DeadlineExceeded {
			result.ExitCode = ExitTimeout
		} else {
			return nil, fmt.Errorf("failed to invoke %s: %w", agentName, err)
		}
	}

	result.OK = result.ExitCode == 0
	return result, nil
}
