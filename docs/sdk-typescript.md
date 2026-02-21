# SDK (TypeScript/Bun)

The TypeScript/Bun SDK is the reference implementation of the SFA specification. It handles all spec compliance so agent authors focus on their agent's logic. This document describes the SDK's architecture, API surface, and vendoring model.

## Overview

The SDK is a thin compliance layer, not a framework. It provides:

- `defineAgent()` — main entry point, wires all subsystems together
- `invoke()` — spawn subagents with env var propagation
- `writeContext()` / `searchContext()` — context store helpers
- `progress()` — structured progress output

Agent authors provide a name, description, and `execute` function. The SDK handles everything else.

## Architecture

```
@sfa/sdk/
├── index.ts          — defineAgent(), invoke(), progress()
├── types/            — TypeScript types for all interfaces
├── config.ts         — Config loading and merge
├── env.ts            — Environment validation and setup
├── logging.ts        — JSONL execution logging
├── context.ts        — Context store read/write/search
├── safety.ts         — Depth, loop, timeout, signals
├── services/         — Docker compose lifecycle
│   ├── materialize.ts
│   ├── up.ts
│   ├── down.ts
│   └── inject.ts
└── mcp/              — MCP server mode
    ├── serve.ts
    ├── schema.ts
    └── handler.ts
```

## `defineAgent()`

The main entry point. Accepts an agent definition and returns a fully configured agent:

```typescript
import { defineAgent } from "@sfa/sdk";

export default defineAgent({
  name: "code-reviewer",
  version: "1.0.0",
  description: "Reviews code for common issues",
  trustLevel: "sandboxed",
  execute: async (ctx) => {
    const code = ctx.input;
    // ... do the work ...
    return { result: "No issues found" };
  },
});
```

The returned agent handles all spec-compliant CLI flags, config loading, logging, and safety checks without additional code from the author.

### Agent with Custom Options

```typescript
export default defineAgent({
  name: "code-reviewer",
  version: "1.0.0",
  description: "Reviews code for common issues",
  trustLevel: "sandboxed",
  options: [
    { flag: "--language", type: "string", description: "Target language" },
    { flag: "--strict", type: "boolean", description: "Enable strict mode" },
  ],
  execute: async (ctx) => {
    const lang = ctx.options.language;
    const strict = ctx.options.strict;
    // ...
  },
});
```

Custom options are merged with standard flags and parsed values are available in the execute context.

## Execution Modes

The SDK supports two execution modes with identical behavior:

| Mode | Command | Use Case |
|---|---|---|
| Interpreted | `bun agent.ts` | Development, fast iteration |
| Compiled | `bun build --compile agent.ts --outfile agent` | Distribution, zero dependencies |

Compiled mode produces a standalone executable that runs without Bun installed.

## Automatic SFA Protocol Handling

The SDK automatically manages all `SFA_*` environment variables:

- Reads `SFA_DEPTH`, `SFA_CALL_CHAIN`, `SFA_SESSION_ID` on startup
- Generates `SFA_SESSION_ID` (UUID v4) at the top level
- Increments `SFA_DEPTH` and appends to `SFA_CALL_CHAIN` when spawning subagents
- Enforces `SFA_MAX_DEPTH` and loop detection

Agent authors never manage these variables manually.

## `invoke()`

Spawns another SFA-compliant agent as a subprocess:

```typescript
const result = await invoke("sfa-summarizer", {
  context: "text to summarize",
  timeout: 30,
});
```

The helper:
- Propagates `SFA_*` env vars (incremented depth, updated call chain)
- Captures stdout as the result
- Enforces the parent's remaining timeout on the child
- Checks depth limit before spawning
- Checks call chain for loops before spawning

## Config Loading

Config is loaded automatically on startup following the resolution order (`SFA_CONFIG` → default path → built-in defaults). Agent-specific config is merged from the agent's namespace. The loaded config is available in the execute context:

```typescript
execute: async (ctx) => {
  const apiKey = ctx.config.apiKeys?.anthropic;
  // ...
}
```

Missing config files do not cause failure.

## Execution Logging

The SDK writes a JSONL log entry on every invocation automatically. The agent author does not write logging code. The SDK handles:
- Log rotation
- `SFA_NO_LOG` suppression
- `O_APPEND` atomic writes
- Non-blocking writes at exit

## Context Store Helpers

### `writeContext()`

```typescript
await ctx.writeContext({
  type: "finding",
  tags: ["security", "sql-injection"],
  slug: "sql-injection-in-query",
  content: "Found SQL injection vulnerability in the query() function..."
});
```

Writes a markdown file with YAML frontmatter to the context store.

### `searchContext()`

```typescript
const results = await ctx.searchContext({
  tags: ["security"],
  type: "finding",
  query: "authentication"
});
```

Uses ripgrep under the hood for fast text search across context files.

## `progress()`

Emits spec-compliant progress messages to stderr:

```typescript
ctx.progress("analyzing 50 files");
// Output: [agent:code-reviewer] analyzing 50 files
```

The SDK automatically emits `starting` and `completed`/`failed` messages.

## Signal Handling

The SDK registers SIGTERM and SIGINT handlers:
- Signals the execute function's AbortController
- Terminates child processes spawned via `invoke()`
- Emits termination message to stderr
- Exits with correct code (130 for SIGINT, 143 for SIGTERM)

## TypeScript Types

The SDK exports typed interfaces for:
- `AgentDefinition` — agent configuration
- `ExecuteContext` — context passed to execute function
- `AgentResult` — return type from execute
- `EnvDeclaration` — environment variable declaration
- `ServiceDefinition` — docker compose service
- `ContextEntry` — context store entry
- `InvokeResult` — subagent invocation result

All public APIs are fully typed. Types drive `--describe` output generation.

## Vendoring Model

The SDK is distributed as source files copied into agent projects, not as an npm package.

- No `bun install` or `npm install` required
- No registry dependency
- Self-contained `@sfa/sdk/` directory
- Import from local path: `import { defineAgent } from "@sfa/sdk"`

The `sfa init` command copies the SDK from the Go binary's embedded filesystem.

## Compiled Agents and Compose Templates

When compiled with `bun build --compile`, compose templates declared in the agent definition are embedded as string constants in the binary. At runtime, the SDK extracts them to the standard materialization path. No sidecar files needed — only the single binary (plus Docker for service dependencies).

## SDK Scope

The SDK handles:
- CLI parsing
- Config loading
- Environment validation
- Execution logging
- Context store
- Safety guardrails
- Service lifecycle
- MCP server mode

The SDK does NOT include the global `sfa` CLI tool (that is a separate Go binary — see [sfa CLI](./sfa-cli.md)).
