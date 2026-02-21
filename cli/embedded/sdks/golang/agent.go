package sfa

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Agent is the configured agent ready to run.
type Agent struct {
	def *AgentDef
}

// DefineAgent creates a new Agent from the given definition.
func DefineAgent(def AgentDef) *Agent {
	// Apply defaults
	if def.TrustLevel == "" {
		def.TrustLevel = TrustSandboxed
	}
	if def.ServiceLifecycle == "" {
		def.ServiceLifecycle = ServicePersistent
	}
	return &Agent{def: &def}
}

// Run executes the agent lifecycle: CLI parsing, config, env, safety, services, execute.
func (a *Agent) Run() {
	startTime := time.Now()

	// Parse CLI arguments
	args, err := parseArgs(os.Args[1:], a.def.Options)
	if err != nil {
		exitWithError(err.Error(), ExitInvalidUsage)
	}

	// Warn about unknown flags
	if len(args.Unknown) > 0 {
		for _, u := range args.Unknown {
			writeDiagnostic(fmt.Sprintf("warning: unknown flag %s", u))
		}
	}

	// --help
	if args.Flags.Help {
		fmt.Print(generateHelp(a.def))
		os.Exit(ExitSuccess)
	}

	// --version
	if args.Flags.Version {
		fmt.Println(a.def.Version)
		os.Exit(ExitSuccess)
	}

	// Load and merge config
	config := loadConfig()
	mergedConfig := mergeConfig(config, a.def.Name)

	// Resolve environment variables
	resolved := resolveEnv(a.def.Env, a.def.Name, config)
	injectEnv(resolved)

	// --describe
	if args.Flags.Describe {
		desc := generateDescribe(a.def, resolved.Values, resolved.Secrets)
		data, _ := json.MarshalIndent(desc, "", "  ")
		fmt.Println(string(data))
		os.Exit(ExitSuccess)
	}

	// Validate required custom options
	for _, opt := range a.def.Options {
		if opt.Required {
			val, exists := args.Custom[opt.Name]
			if !exists {
				exitWithError(fmt.Sprintf("required option --%s is missing", opt.Name), ExitInvalidUsage)
			}
			if s, ok := val.(string); ok && s == "" {
				exitWithError(fmt.Sprintf("required option --%s is missing", opt.Name), ExitInvalidUsage)
			}
		}
	}

	// --setup
	if args.Flags.Setup {
		runSetup(a.def.Name, a.def.Env, args.Flags.NonInteractive)
		return // runSetup calls os.Exit
	}

	// --services-down
	if args.Flags.ServicesDown {
		handleServicesDown(a.def.Name)
		return // handleServicesDown calls os.Exit
	}

	// Validate required env vars
	missing := validateEnv(a.def.Env, resolved)
	if len(missing) > 0 {
		exitWithError(formatMissingEnvError(a.def.Name, missing), ExitInvalidUsage)
	}

	// Safety: depth, loop detection, session
	safety, err := initSafety(a.def.Name, args.Flags.MaxDepth)
	if err != nil {
		exitWithError(err.Error(), ExitFailure)
	}

	// Setup timeout and signals
	ctx, cancel := setupTimeout(a.def.Name, args.Flags.Timeout)
	defer cancel()
	cleanupSignals := setupSignalHandlers(a.def.Name, cancel)
	defer cleanupSignals()

	// Resolve logging config
	logConfig := resolveLoggingConfig(config, args.Flags.NoLog)

	// Resolve context store
	contextStorePath := resolveContextStorePath(config)

	// Start services if declared
	if len(a.def.Services) > 0 {
		emitProgress(a.def.Name, "starting services...")
		if err := startServices(a.def.Name, a.def.Version, a.def.Services, resolved); err != nil {
			exitWithError(err.Error(), ExitFailure)
		}
		emitProgress(a.def.Name, "services ready")
	}

	// Read input
	input, err := readInput(args.Flags)
	if err != nil {
		exitWithError(err.Error(), ExitInvalidUsage)
	}

	// Check context required
	if a.def.ContextRequired && input == "" {
		exitWithError("this agent requires context input (pipe data or use --context/--context-file)", ExitInvalidUsage)
	}

	// Emit starting
	emitProgress(a.def.Name, "starting")

	// Build execute context
	execCtx := &ExecuteContext{
		Input:        input,
		Options:      args.Custom,
		Env:          resolved.Values,
		Config:       mergedConfig,
		Ctx:          ctx,
		Depth:        safety.Depth,
		SessionID:    safety.SessionID,
		AgentName:    a.def.Name,
		AgentVersion: a.def.Version,
		Progress: func(message string) {
			emitProgress(a.def.Name, message)
		},
		Invoke: func(agentName string, opts *InvokeOpts) (*InvokeResult, error) {
			return invokeAgent(agentName, safety, ctx, opts)
		},
		WriteContext: func(entry ContextEntry) (string, error) {
			return writeContextEntry(entry, a.def.Name, safety.SessionID, contextStorePath)
		},
		SearchContext: func(query ContextQuery) ([]ContextResult, error) {
			return searchContextEntries(query, contextStorePath)
		},
	}

	// Execute
	result, execErr := a.def.Execute(execCtx)

	// Determine exit code
	exitCode := ExitSuccess
	var outputStr string

	if execErr != nil {
		if ctx.Err() != nil {
			exitCode = ExitTimeout
			emitProgress(a.def.Name, "timeout exceeded")
		} else {
			exitCode = ExitFailure
		}
		writeDiagnostic(fmt.Sprintf("error: %v", execErr))
	}

	// Stop services if ephemeral
	if len(a.def.Services) > 0 {
		stopServices(a.def.Name, a.def.ServiceLifecycle, a.def.Services)
	}

	// Format output
	if result != nil {
		switch v := result.(type) {
		case AgentResult:
			if v.Error != "" && exitCode == ExitSuccess {
				exitCode = ExitFailure
			}
			outputStr = formatResult(v, args.Flags.OutputFormat)
		default:
			wrapped := AgentResult{Result: v}
			outputStr = formatResult(wrapped, args.Flags.OutputFormat)
		}
	}

	// Log execution
	logEntry := createLogEntry(
		a.def.Name, a.def.Version, exitCode, startTime,
		safety.Depth, safety.CallChain, safety.SessionID,
		input, outputStr,
	)
	writeLogEntry(logEntry, logConfig)

	// Write result to stdout
	if outputStr != "" {
		fmt.Print(outputStr)
	}

	// Emit completed/failed
	if exitCode == ExitSuccess {
		emitProgress(a.def.Name, "completed")
	} else {
		emitProgress(a.def.Name, "failed")
	}

	os.Exit(exitCode)
}

// formatResult converts an AgentResult to a string based on the output format.
func formatResult(result AgentResult, format OutputFormat) string {
	switch format {
	case OutputJSON:
		data, err := json.Marshal(result)
		if err != nil {
			return fmt.Sprintf("%v", result.Result)
		}
		return string(data) + "\n"
	default:
		switch v := result.Result.(type) {
		case string:
			return v + "\n"
		default:
			data, err := json.MarshalIndent(v, "", "  ")
			if err != nil {
				return fmt.Sprintf("%v\n", v)
			}
			return string(data) + "\n"
		}
	}
}
