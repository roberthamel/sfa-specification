/**
 * Trust level declaration for the agent.
 * Indicates what system access the agent requires.
 */
export type TrustLevel = "sandboxed" | "local" | "network" | "privileged";

/**
 * Context entry type for the context store.
 */
export type ContextType = "finding" | "decision" | "artifact" | "reference" | "summary";

/**
 * Service lifecycle mode.
 */
export type ServiceLifecycle = "persistent" | "ephemeral";

/**
 * Output format for agent results.
 */
export type OutputFormat = "json" | "text";

/**
 * Environment variable declaration for an agent.
 */
export interface EnvDeclaration {
  /** Environment variable name */
  name: string;
  /** Whether this variable is required for the agent to function */
  required?: boolean;
  /** Whether this variable contains a secret (will be masked in output) */
  secret?: boolean;
  /** Default value if not provided */
  default?: string;
  /** Human-readable description */
  description?: string;
}

/**
 * Docker compose service definition embedded in an agent.
 */
export interface ServiceDefinition {
  image: string;
  ports?: string[];
  environment?: Record<string, string>;
  healthcheck?: {
    test: string;
    interval?: string;
    timeout?: string;
    retries?: number;
    start_period?: string;
  };
  volumes?: string[];
  command?: string | string[];
  /** Custom connection string template, e.g. "postgres://${USER}:${PASS}@${HOST}:${PORT}/db" */
  connectionString?: string;
}

/**
 * Custom CLI option definition for an agent.
 */
export interface AgentOption {
  /** Long flag name (without --), e.g. "max-files" */
  name: string;
  /** Short flag alias (single char), e.g. "m" */
  alias?: string;
  /** Human-readable description */
  description: string;
  /** Expected type */
  type: "string" | "number" | "boolean";
  /** Default value */
  default?: string | number | boolean;
  /** Whether this option is required */
  required?: boolean;
}

/**
 * MCP tool definition for multi-tool MCP server mode.
 */
export interface McpToolDefinition {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** JSON Schema for tool input */
  inputSchema?: Record<string, unknown>;
  /** Tool handler function */
  handler: (input: Record<string, unknown>, ctx: ExecuteContext) => Promise<AgentResult>;
}

/**
 * The main agent definition object passed to defineAgent().
 */
export interface AgentDefinition {
  /** Agent name (kebab-case, used in CLI and discovery) */
  name: string;
  /** Semantic version string */
  version: string;
  /** One-line description of what the agent does */
  description: string;
  /** Trust level declaration */
  trustLevel?: TrustLevel;
  /** Whether context input is required */
  contextRequired?: boolean;
  /** Environment variable declarations */
  env?: EnvDeclaration[];
  /** Docker compose service definitions */
  services?: Record<string, ServiceDefinition>;
  /** Service lifecycle mode */
  serviceLifecycle?: ServiceLifecycle;
  /** Custom CLI options */
  options?: AgentOption[];
  /** Usage examples for --help output */
  examples?: string[];
  /** Whether this agent supports MCP server mode */
  mcpSupported?: boolean;
  /** Additional MCP tools (only used in MCP mode) */
  tools?: McpToolDefinition[];
  /** Context retention preference hint */
  contextRetention?: "none" | "session" | "permanent";
  /** The agent's execute function */
  execute: (ctx: ExecuteContext) => Promise<AgentResult>;
}

/**
 * Context object passed to the agent's execute function.
 */
export interface ExecuteContext {
  /** Input context (from stdin, --context, or --context-file) */
  input: string;
  /** Parsed CLI options (standard + custom) */
  options: Record<string, string | number | boolean>;
  /** Resolved environment variables (including SFA_* protocol vars) */
  env: Record<string, string | undefined>;
  /** Loaded and merged configuration */
  config: Record<string, unknown>;
  /** AbortSignal for cancellation (triggered by SIGINT/SIGTERM/timeout) */
  signal: AbortSignal;
  /** Current invocation depth */
  depth: number;
  /** Session ID for this invocation tree */
  sessionId: string;
  /** Agent name */
  agentName: string;
  /** Agent version */
  agentVersion: string;
  /** Emit a progress message to stderr */
  progress: (message: string) => void;
  /** Invoke a subagent */
  invoke: (agentName: string, options?: InvokeOptions) => Promise<InvokeResult>;
  /** Write a context entry to the store */
  writeContext: (entry: WriteContextInput) => Promise<string>;
  /** Search the context store */
  searchContext: (query: SearchContextInput) => Promise<ContextEntry[]>;
}

/**
 * Options for invoking a subagent.
 */
export interface InvokeOptions {
  /** Context to pass to the subagent (via stdin) */
  context?: string;
  /** Additional CLI arguments */
  args?: string[];
  /** Timeout in seconds (defaults to remaining parent timeout) */
  timeout?: number;
}

/**
 * Result from a subagent invocation.
 */
export interface InvokeResult {
  /** Whether the subagent succeeded (exit code 0) */
  ok: boolean;
  /** Exit code from the subagent */
  exitCode: number;
  /** Stdout output from the subagent */
  output: string;
  /** Stderr output from the subagent */
  stderr: string;
}

/**
 * Result returned from an agent's execute function.
 */
export interface AgentResult {
  /** The primary result payload */
  result: string | Record<string, unknown>;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** Optional warnings */
  warnings?: string[];
  /** Optional error description (for partial results) */
  error?: string;
}

/**
 * Input for writing a context entry.
 */
export interface WriteContextInput {
  /** Context entry type */
  type: ContextType;
  /** Searchable tags */
  tags?: string[];
  /** URL-friendly slug for the filename */
  slug: string;
  /** Markdown content body */
  content: string;
  /** Links to other context entries */
  links?: string[];
}

/**
 * Input for searching the context store.
 */
export interface SearchContextInput {
  /** Filter by agent name */
  agent?: string;
  /** Filter by tags */
  tags?: string[];
  /** Filter by context type */
  type?: ContextType;
  /** Free-text search query */
  query?: string;
}

/**
 * A context entry read from the store.
 */
export interface ContextEntry {
  /** Absolute file path */
  filePath: string;
  /** Agent that wrote this entry */
  agent: string;
  /** Session ID when written */
  sessionId?: string;
  /** Timestamp when written */
  timestamp: string;
  /** Context entry type */
  type: ContextType;
  /** Tags */
  tags: string[];
  /** Links to other entries */
  links: string[];
  /** Markdown content body */
  content: string;
}

/**
 * Standard exit codes.
 */
export const ExitCode = {
  SUCCESS: 0,
  FAILURE: 1,
  INVALID_USAGE: 2,
  TIMEOUT: 3,
  PERMISSION_DENIED: 4,
  SIGINT: 130,
  SIGTERM: 143,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
