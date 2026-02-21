package sfa

import "context"

// TrustLevel describes the agent's permission requirements.
type TrustLevel string

const (
	TrustSandboxed  TrustLevel = "sandboxed"
	TrustLocal      TrustLevel = "local"
	TrustNetwork    TrustLevel = "network"
	TrustPrivileged TrustLevel = "privileged"
)

// ContextType classifies context store entries.
type ContextType string

const (
	ContextFinding   ContextType = "finding"
	ContextDecision  ContextType = "decision"
	ContextArtifact  ContextType = "artifact"
	ContextReference ContextType = "reference"
	ContextSummary   ContextType = "summary"
)

// OutputFormat controls result output formatting.
type OutputFormat string

const (
	OutputJSON OutputFormat = "json"
	OutputText OutputFormat = "text"
)

// ServiceLifecycle controls Docker Compose service lifetime.
type ServiceLifecycle string

const (
	ServicePersistent ServiceLifecycle = "persistent"
	ServiceEphemeral  ServiceLifecycle = "ephemeral"
)

// Exit codes per the SFA specification.
const (
	ExitSuccess        = 0
	ExitFailure        = 1
	ExitInvalidUsage   = 2
	ExitTimeout        = 3
	ExitPermissionDeny = 4
	ExitSIGINT         = 130
	ExitSIGTERM        = 143
)

// EnvDef declares an environment variable the agent requires or uses.
type EnvDef struct {
	Name        string
	Required    bool
	Secret      bool
	Default     string
	Description string
}

// OptionDef declares a custom CLI option for the agent.
type OptionDef struct {
	Name        string // long flag name (e.g. "model")
	Alias       string // single-char alias (e.g. "m")
	Description string
	Type        string // "string", "number", "boolean"
	Default     any
	Required    bool
}

// ServiceDef declares a Docker Compose service dependency.
type ServiceDef struct {
	Image       string
	Ports       []string
	Environment map[string]string
	Healthcheck *HealthcheckDef
	Volumes     []string
	Command     any // string or []string
	ConnString  string
}

// HealthcheckDef is a Docker healthcheck configuration.
type HealthcheckDef struct {
	Test        string
	Interval    string
	Timeout     string
	Retries     int
	StartPeriod string
}

// AgentDef is the complete definition passed to DefineAgent.
type AgentDef struct {
	Name             string
	Version          string
	Description      string
	TrustLevel       TrustLevel
	ContextRequired  bool
	Env              []EnvDef
	Services         map[string]ServiceDef
	ServiceLifecycle ServiceLifecycle
	Options          []OptionDef
	Examples         []string
	Execute          func(ctx *ExecuteContext) (any, error)
}

// ExecuteContext is passed to the agent's Execute function.
type ExecuteContext struct {
	Input        string
	Options      map[string]any
	Env          map[string]string
	Config       map[string]any
	Ctx          context.Context
	Depth        int
	SessionID    string
	AgentName    string
	AgentVersion string
	Progress     func(message string)
	Invoke       func(agentName string, opts *InvokeOpts) (*InvokeResult, error)
	WriteContext func(entry ContextEntry) (string, error)
	SearchContext func(query ContextQuery) ([]ContextResult, error)
}

// InvokeOpts configures a subagent invocation.
type InvokeOpts struct {
	Context string
	Args    []string
	Timeout int // seconds; 0 = use parent's remaining timeout
}

// InvokeResult is the result of a subagent invocation.
type InvokeResult struct {
	OK       bool
	ExitCode int
	Output   string
	Stderr   string
}

// ContextEntry is used to write a context store entry.
type ContextEntry struct {
	Type    ContextType
	Tags    []string
	Slug    string
	Content string
	Links   []string
}

// ContextQuery defines search criteria for the context store.
type ContextQuery struct {
	Agent string
	Tags  []string
	Type  ContextType
	Query string
}

// ContextResult is a context store entry returned from search.
type ContextResult struct {
	FilePath  string
	Agent     string
	SessionID string
	Timestamp string
	Type      ContextType
	Tags      []string
	Links     []string
	Content   string
}

// AgentResult wraps the return value from an agent's Execute function.
type AgentResult struct {
	Result   any                    `json:"result"`
	Metadata map[string]any         `json:"metadata,omitempty"`
	Warnings []string               `json:"warnings,omitempty"`
	Error    string                 `json:"error,omitempty"`
}
