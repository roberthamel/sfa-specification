package sfa

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	flag "github.com/spf13/pflag"
)

// StandardFlags holds the parsed standard SFA CLI flags.
type StandardFlags struct {
	Help           bool
	Version        bool
	Verbose        bool
	Quiet          bool
	OutputFormat   OutputFormat
	Timeout        int
	Describe       bool
	Setup          bool
	NoLog          bool
	MaxDepth       int
	ServicesDown   bool
	Yes            bool
	NonInteractive bool
	Context        string
	ContextFile    string
	MCP            bool
}

// ParsedArgs is the result of parsing CLI arguments.
type ParsedArgs struct {
	Flags      StandardFlags
	Custom     map[string]any
	Positional []string
	Unknown    []string
}

// parseArgs parses CLI arguments into standard flags, custom options, and positional args.
func parseArgs(argv []string, customOptions []OptionDef) (*ParsedArgs, error) {
	fs := flag.NewFlagSet("sfa-agent", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	// Standard flags
	help := fs.Bool("help", false, "Show help information")
	version := fs.Bool("version", false, "Show version")
	verbose := fs.Bool("verbose", false, "Enable verbose output")
	quiet := fs.Bool("quiet", false, "Suppress non-essential output")
	outputFormat := fs.String("output-format", "text", "Output format (json, text)")
	timeout := fs.Int("timeout", 120, "Execution timeout in seconds")
	describe := fs.Bool("describe", false, "Output agent metadata as JSON")
	setup := fs.Bool("setup", false, "Interactive setup for environment variables")
	noLog := fs.Bool("no-log", false, "Suppress execution logging")
	maxDepth := fs.Int("max-depth", 5, "Maximum invocation depth")
	servicesDown := fs.Bool("services-down", false, "Tear down Docker services")
	yes := fs.Bool("yes", false, "Auto-confirm prompts")
	nonInteractive := fs.Bool("non-interactive", false, "Non-interactive mode")
	contextFlag := fs.String("context", "", "Context input string")
	contextFile := fs.String("context-file", "", "Context input file path")
	mcp := fs.Bool("mcp", false, "Run as MCP server")

	// Custom option flags
	customPtrs := make(map[string]any)
	for _, opt := range customOptions {
		switch opt.Type {
		case "string":
			def := ""
			if opt.Default != nil {
				def = fmt.Sprintf("%v", opt.Default)
			}
			p := fs.String(opt.Name, def, opt.Description)
			if opt.Alias != "" {
				fs.StringVarP(p, opt.Name, opt.Alias, def, opt.Description)
			}
			customPtrs[opt.Name] = p
		case "number":
			def := 0
			if opt.Default != nil {
				switch v := opt.Default.(type) {
				case int:
					def = v
				case float64:
					def = int(v)
				}
			}
			p := fs.Int(opt.Name, def, opt.Description)
			if opt.Alias != "" {
				fs.IntVarP(p, opt.Name, opt.Alias, def, opt.Description)
			}
			customPtrs[opt.Name] = p
		case "boolean":
			def := false
			if opt.Default != nil {
				if b, ok := opt.Default.(bool); ok {
					def = b
				}
			}
			p := fs.Bool(opt.Name, def, opt.Description)
			if opt.Alias != "" {
				fs.BoolVarP(p, opt.Name, opt.Alias, def, opt.Description)
			}
			customPtrs[opt.Name] = p
		}
	}

	// Parse, collecting unknown flags
	fs.ParseErrorsWhitelist.UnknownFlags = true
	if err := fs.Parse(argv); err != nil {
		return nil, err
	}

	// Collect unknown flags (pflag doesn't provide a clean way, so we detect them)
	var unknown []string
	// Check for flags that weren't defined
	knownFlags := make(map[string]bool)
	fs.VisitAll(func(f *flag.Flag) {
		knownFlags[f.Name] = true
	})
	for _, arg := range argv {
		if strings.HasPrefix(arg, "--") {
			name := strings.TrimPrefix(arg, "--")
			if idx := strings.Index(name, "="); idx >= 0 {
				name = name[:idx]
			}
			if name != "" && !knownFlags[name] {
				unknown = append(unknown, arg)
			}
		} else if strings.HasPrefix(arg, "-") && len(arg) == 2 {
			// Short flag — check if it's a known alias
			shortName := string(arg[1])
			found := false
			fs.VisitAll(func(f *flag.Flag) {
				if f.Shorthand == shortName {
					found = true
				}
			})
			if !found {
				unknown = append(unknown, arg)
			}
		}
	}

	// Build custom values map
	custom := make(map[string]any)
	for _, opt := range customOptions {
		ptr, ok := customPtrs[opt.Name]
		if !ok {
			continue
		}
		switch opt.Type {
		case "string":
			custom[opt.Name] = *ptr.(*string)
		case "number":
			custom[opt.Name] = *ptr.(*int)
		case "boolean":
			custom[opt.Name] = *ptr.(*bool)
		}
	}

	// Validate required custom options
	for _, opt := range customOptions {
		if !opt.Required {
			continue
		}
		val, exists := custom[opt.Name]
		if !exists {
			continue
		}
		switch v := val.(type) {
		case string:
			if v == "" {
				return nil, fmt.Errorf("required option --%s is missing", opt.Name)
			}
		}
	}

	// Parse output format
	of := OutputText
	switch *outputFormat {
	case "json":
		of = OutputJSON
	case "text":
		of = OutputText
	default:
		return nil, fmt.Errorf("invalid output format: %s (expected json or text)", *outputFormat)
	}

	return &ParsedArgs{
		Flags: StandardFlags{
			Help:           *help,
			Version:        *version,
			Verbose:        *verbose,
			Quiet:          *quiet,
			OutputFormat:   of,
			Timeout:        *timeout,
			Describe:       *describe,
			Setup:          *setup,
			NoLog:          *noLog,
			MaxDepth:       *maxDepth,
			ServicesDown:   *servicesDown,
			Yes:            *yes,
			NonInteractive: *nonInteractive,
			Context:        *contextFlag,
			ContextFile:    *contextFile,
			MCP:            *mcp,
		},
		Custom:     custom,
		Positional: fs.Args(),
		Unknown:    unknown,
	}, nil
}

// readInput reads context input from --context-file, --context, or stdin.
func readInput(flags StandardFlags) (string, error) {
	if flags.ContextFile != "" {
		data, err := os.ReadFile(flags.ContextFile)
		if err != nil {
			return "", fmt.Errorf("failed to read context file %s: %w", flags.ContextFile, err)
		}
		return string(data), nil
	}

	if flags.Context != "" {
		return flags.Context, nil
	}

	// Check if stdin has data (not a terminal)
	stat, err := os.Stdin.Stat()
	if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
		data, err := os.ReadFile("/dev/stdin")
		if err != nil {
			return "", fmt.Errorf("failed to read stdin: %w", err)
		}
		return string(data), nil
	}

	return "", nil
}

// generateHelp builds the --help output for an agent.
func generateHelp(def *AgentDef) string {
	var b strings.Builder

	b.WriteString(fmt.Sprintf("%s v%s\n", def.Name, def.Version))
	b.WriteString(fmt.Sprintf("%s\n\n", def.Description))
	b.WriteString("USAGE:\n")
	b.WriteString(fmt.Sprintf("  %s [OPTIONS]\n\n", def.Name))
	b.WriteString("OPTIONS:\n")
	b.WriteString("  --help                Show this help message\n")
	b.WriteString("  --version             Show version\n")
	b.WriteString("  --describe            Output agent metadata as JSON\n")
	b.WriteString("  --verbose             Enable verbose output\n")
	b.WriteString("  --quiet               Suppress non-essential output\n")
	b.WriteString("  --output-format FMT   Output format: json, text (default: text)\n")
	b.WriteString("  --timeout SECS        Execution timeout in seconds (default: 120)\n")
	b.WriteString("  --context STRING      Context input string\n")
	b.WriteString("  --context-file PATH   Context input file path\n")
	b.WriteString("  --setup               Interactive environment variable setup\n")
	b.WriteString("  --no-log              Suppress execution logging\n")
	b.WriteString("  --max-depth N         Maximum invocation depth (default: 5)\n")
	b.WriteString("  --services-down       Tear down Docker services\n")
	b.WriteString("  --yes                 Auto-confirm prompts\n")
	b.WriteString("  --non-interactive     Non-interactive mode\n")
	b.WriteString("  --mcp                 Run as MCP server\n")

	if len(def.Options) > 0 {
		b.WriteString("\nAGENT OPTIONS:\n")
		for _, opt := range def.Options {
			flag := fmt.Sprintf("  --%s", opt.Name)
			if opt.Alias != "" {
				flag = fmt.Sprintf("  -%s, --%s", opt.Alias, opt.Name)
			}
			b.WriteString(fmt.Sprintf("%-26s %s\n", flag, opt.Description))
		}
	}

	if len(def.Env) > 0 {
		b.WriteString("\nENVIRONMENT VARIABLES:\n")
		for _, e := range def.Env {
			req := "optional"
			if e.Required {
				req = "required"
			}
			b.WriteString(fmt.Sprintf("  %-24s %s (%s)\n", e.Name, e.Description, req))
		}
	}

	if len(def.Examples) > 0 {
		b.WriteString("\nEXAMPLES:\n")
		for _, ex := range def.Examples {
			b.WriteString(fmt.Sprintf("  %s\n", ex))
		}
	}

	return b.String()
}

// generateDescribe builds the --describe JSON output for an agent.
func generateDescribe(def *AgentDef, resolvedEnv map[string]string, secrets map[string]bool) map[string]any {
	desc := map[string]any{
		"name":        def.Name,
		"version":     def.Version,
		"description": def.Description,
	}

	if def.TrustLevel != "" {
		desc["trustLevel"] = string(def.TrustLevel)
	}

	if def.ContextRequired {
		desc["contextRequired"] = true
	}

	if len(def.Env) > 0 {
		envList := make([]map[string]any, 0, len(def.Env))
		for _, e := range def.Env {
			entry := map[string]any{
				"name":     e.Name,
				"required": e.Required,
			}
			if e.Secret {
				entry["secret"] = true
			}
			if e.Description != "" {
				entry["description"] = e.Description
			}
			if e.Default != "" {
				if e.Secret {
					entry["default"] = "***"
				} else {
					entry["default"] = e.Default
				}
			}
			// Show current value (masked if secret)
			if val, ok := resolvedEnv[e.Name]; ok && val != "" {
				if secrets[e.Name] {
					entry["value"] = "***"
				} else {
					entry["value"] = val
				}
			}
			envList = append(envList, entry)
		}
		desc["env"] = envList
	}

	if len(def.Options) > 0 {
		optList := make([]map[string]any, 0, len(def.Options))
		for _, o := range def.Options {
			entry := map[string]any{
				"name":        o.Name,
				"description": o.Description,
				"type":        o.Type,
			}
			if o.Alias != "" {
				entry["alias"] = o.Alias
			}
			if o.Required {
				entry["required"] = true
			}
			if o.Default != nil {
				entry["default"] = o.Default
			}
			optList = append(optList, entry)
		}
		desc["options"] = optList
	}

	if len(def.Services) > 0 {
		desc["requiresDocker"] = true
		svcNames := make([]string, 0, len(def.Services))
		for name := range def.Services {
			svcNames = append(svcNames, name)
		}
		desc["services"] = svcNames
	} else {
		desc["requiresDocker"] = false
	}

	desc["mcpSupported"] = false

	return desc
}

// parseInt safely parses an int from a string, returning fallback on error.
func parseInt(s string, fallback int) int {
	v, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return v
}
