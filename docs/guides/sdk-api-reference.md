# SDK API Reference

Complete reference for the `@sfa/sdk` TypeScript SDK.

## `defineAgent(definition)`

The main entry point. Accepts an `AgentDefinition`, wires up all subsystems, and runs the agent immediately.

```typescript
import { defineAgent } from "@sfa/sdk";

export default defineAgent({
  name: "my-agent",
  version: "1.0.0",
  description: "What this agent does",
  execute: async (ctx) => {
    return { result: "output" };
  },
});
```

**Returns**: `void` — the agent runs at module load.

---

## `AgentDefinition`

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | `string` | Yes | — | Kebab-case agent name |
| `version` | `string` | Yes | — | Semver version string |
| `description` | `string` | Yes | — | One-line description |
| `execute` | `(ctx: ExecuteContext) => Promise<AgentResult>` | Yes | — | The agent's main logic |
| `trustLevel` | `"sandboxed" \| "local" \| "network" \| "privileged"` | No | `"sandboxed"` | Declared trust level |
| `contextRequired` | `boolean` | No | `false` | Whether input is mandatory |
| `contextRetention` | `"none" \| "session" \| "permanent"` | No | `"none"` | Context retention hint |
| `env` | `EnvDeclaration[]` | No | `[]` | Environment variable declarations |
| `options` | `AgentOption[]` | No | `[]` | Custom CLI options |
| `examples` | `string[]` | No | `[]` | Usage examples for `--help` |
| `services` | `Record<string, ServiceDefinition>` | No | — | Docker compose service definitions |
| `serviceLifecycle` | `"persistent" \| "ephemeral"` | No | `"persistent"` | Service lifecycle mode |
| `mcpSupported` | `boolean` | No | `false` | Enable `--mcp` flag |
| `tools` | `McpToolDefinition[]` | No | `[]` | Additional MCP tools |

---

## `ExecuteContext`

Passed to the `execute` function. Provides access to input, options, environment, and SDK utilities.

### Properties

| Property | Type | Description |
|---|---|---|
| `input` | `string` | Input context from stdin, `--context`, or `--context-file` |
| `options` | `Record<string, string \| number \| boolean>` | Standard flags + custom options |
| `env` | `Record<string, string \| undefined>` | Resolved environment variables |
| `config` | `Record<string, unknown>` | Merged shared config |
| `signal` | `AbortSignal` | Fires on SIGINT, SIGTERM, or timeout |
| `depth` | `number` | Current invocation depth (0 = top-level) |
| `sessionId` | `string` | UUID for this invocation tree |
| `agentName` | `string` | Agent's name from definition |
| `agentVersion` | `string` | Agent's version from definition |

### Methods

#### `ctx.progress(message: string): void`

Emit a progress message to stderr in the format `[agent:<name>] <message>`. Suppressed when `--quiet` is passed. Secret values are automatically masked.

```typescript
ctx.progress("processing 42 files");
// stderr: [agent:my-agent] processing 42 files
```

#### `ctx.invoke(agentName: string, options?: InvokeOptions): Promise<InvokeResult>`

Invoke another agent as a subprocess.

```typescript
const result = await ctx.invoke("other-agent", {
  context: "input for the subagent",
  args: ["--output-format", "json"],
  timeout: 30,
});

if (result.ok) {
  const output = JSON.parse(result.output);
}
```

**`InvokeOptions`**:

| Field | Type | Default | Description |
|---|---|---|---|
| `context` | `string` | — | Input passed via stdin |
| `args` | `string[]` | `[]` | Additional CLI arguments |
| `timeout` | `number` | Parent's remaining timeout | Timeout in seconds |

**`InvokeResult`**:

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | `true` if exit code was 0 |
| `exitCode` | `number` | Exit code (3 = timeout) |
| `output` | `string` | Captured stdout |
| `stderr` | `string` | Captured stderr |

Automatically enforces depth limits, loop detection, and timeout. Only `SFA_*` protocol variables are forwarded to the subagent.

#### `ctx.writeContext(entry: WriteContextInput): Promise<string>`

Write a context entry to the persistent context store. Returns the file path.

```typescript
const path = await ctx.writeContext({
  type: "finding",
  tags: ["security", "xss"],
  slug: "xss-vulnerability",
  content: "# XSS Found\n\nUnsanitized user input at line 42.",
  links: [],
});
```

**`WriteContextInput`**:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"finding" \| "decision" \| "artifact" \| "reference" \| "summary"` | Yes | Entry type |
| `slug` | `string` | Yes | URL-friendly filename slug |
| `content` | `string` | Yes | Markdown body |
| `tags` | `string[]` | No | Searchable tags |
| `links` | `string[]` | No | Links to other context entries |

#### `ctx.searchContext(query: SearchContextInput): Promise<ContextEntry[]>`

Search the context store.

```typescript
const entries = await ctx.searchContext({
  agent: "code-reviewer",
  type: "finding",
  tags: ["security"],
  query: "XSS",
});
```

**`SearchContextInput`**:

| Field | Type | Description |
|---|---|---|
| `agent` | `string` | Filter by agent name |
| `type` | `ContextType` | Filter by entry type |
| `tags` | `string[]` | Filter by tags (any match) |
| `query` | `string` | Free-text content search |

All fields are optional. Results include `filePath`, `agent`, `sessionId`, `timestamp`, `type`, `tags`, `links`, and `content`.

---

## `AgentResult`

Returned from the `execute` function.

| Field | Type | Required | Description |
|---|---|---|---|
| `result` | `string \| Record<string, unknown>` | Yes | Primary output (sent to stdout) |
| `metadata` | `Record<string, unknown>` | No | Extra metadata (included in JSON output) |
| `warnings` | `string[]` | No | Non-fatal warnings |
| `error` | `string` | No | Partial result error description |

---

## `EnvDeclaration`

Declare an environment variable the agent needs.

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Variable name (e.g., `"API_KEY"`) |
| `required` | `boolean` | `false` | Fail on startup if missing |
| `secret` | `boolean` | `false` | Mask in all output |
| `default` | `string` | — | Default value if not set |
| `description` | `string` | — | Human-readable description |

---

## `AgentOption`

Define a custom CLI flag.

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Long flag name without `--` (e.g., `"max-files"`) |
| `alias` | `string` | — | Single-char short flag (e.g., `"m"`) |
| `description` | `string` | — | Help text |
| `type` | `"string" \| "number" \| "boolean"` | — | Expected type |
| `default` | `string \| number \| boolean` | — | Default value |
| `required` | `boolean` | `false` | Fail if not provided |

---

## `ServiceDefinition`

Define a docker compose service.

| Field | Type | Description |
|---|---|---|
| `image` | `string` | Docker image (e.g., `"postgres:16"`) |
| `ports` | `string[]` | Port mappings (e.g., `["5432:5432"]`) |
| `environment` | `Record<string, string>` | Environment variables (supports `${VAR}` interpolation) |
| `healthcheck` | `object` | Health check config: `test`, `interval`, `timeout`, `retries`, `start_period` |
| `volumes` | `string[]` | Volume mounts |
| `command` | `string \| string[]` | Override container command |
| `connectionString` | `string` | Custom connection string template |

---

## `McpToolDefinition`

Define an additional MCP tool (only used in `--mcp` mode).

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Tool name |
| `description` | `string` | Tool description |
| `inputSchema` | `Record<string, unknown>` | JSON Schema for tool input |
| `handler` | `(input, ctx) => Promise<AgentResult>` | Tool handler function |

---

## `ExitCode`

Standard exit codes (exported constant):

| Code | Name | Meaning |
|---|---|---|
| 0 | `SUCCESS` | Agent completed successfully |
| 1 | `FAILURE` | Agent encountered an error |
| 2 | `INVALID_USAGE` | Invalid arguments or missing requirements |
| 3 | `TIMEOUT` | Execution timed out |
| 4 | `PERMISSION_DENIED` | Permission denied |
| 130 | `SIGINT` | Interrupted by SIGINT |
| 143 | `SIGTERM` | Terminated by SIGTERM |

---

## Standard CLI Flags

Every agent automatically supports these flags:

| Flag | Type | Default | Description |
|---|---|---|---|
| `--help` | boolean | — | Show help and exit |
| `--version` | boolean | — | Show version and exit |
| `--describe` | boolean | — | Output JSON metadata and exit |
| `--verbose` | boolean | `false` | Enable verbose diagnostics |
| `--quiet` | boolean | `false` | Suppress progress messages |
| `--output-format` | `"text" \| "json"` | `"text"` | Output format |
| `--timeout` | number | `120` | Timeout in seconds |
| `--context` | string | — | Input context as a string |
| `--context-file` | string | — | Read input from a file |
| `--setup` | boolean | — | Run interactive env var setup |
| `--no-log` | boolean | `false` | Suppress execution logging |
| `--max-depth` | number | `5` | Max subagent depth |
| `--services-down` | boolean | — | Tear down docker services and exit |
| `--yes` | boolean | `false` | Auto-confirm prompts |
| `--non-interactive` | boolean | `false` | Disable interactive prompts |
| `--mcp` | boolean | — | Run as MCP server |

---

## Advanced Exports

The SDK also exports lower-level functions for advanced use cases:

- **Config**: `loadConfig()`, `saveConfig()`, `getConfigPath()`, `mergeConfig()`, `applyEnvOverrides()`
- **Environment**: `resolveEnv()`, `validateEnv()`, `injectEnv()`, `maskSecrets()`, `buildSubagentEnv()`, `runSetup()`
- **Safety**: `initSafety()`, `checkDepthLimit()`, `checkLoop()`, `buildSubagentSafetyEnv()`
- **Logging**: `resolveLoggingConfig()`, `createLogEntry()`, `writeLogEntry()`
- **Context**: `resolveContextStorePath()`, `writeContext()`, `searchContext()`, `updateContext()`, `addContextLink()`
- **Invoke**: `invoke()`
- **Services**: `startServices()`, `stopServices()`, `composeDown()`, `handleServicesDown()`, `checkDockerAvailability()`
- **MCP**: `serveMcp()`

These are useful if you're building custom tooling or alternative agents that don't use `defineAgent()`.
