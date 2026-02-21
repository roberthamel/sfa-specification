# Single-File Agents

A standard for building portable, composable, CLI-invokable agents that can be discovered and used by humans, LLMs, and other agents.

An SFA is a self-contained executable with a consistent CLI interface. Any agent that implements the spec can be invoked by any other agent — no custom integration code required.

## Quick start

### TypeScript (Bun)

```bash
sfa init my-agent
cd my-agent
```

```typescript
import { defineAgent } from "./@sfa/sdk";

export default defineAgent({
  name: "my-agent",
  version: "1.0.0",
  description: "Greets the caller by name",

  execute: async (ctx) => {
    const name = ctx.input.trim() || "world";
    return { result: `Hello, ${name}!` };
  },
});
```

```bash
bun agent.ts --context "Alice"   # Hello, Alice!
bun agent.ts --help              # Built-in CLI flags
bun agent.ts --describe          # Machine-readable JSON metadata
```

### Go

```bash
sfa init my-agent --language golang
cd my-agent
```

```go
package main

import "my-agent/sfa"

func main() {
	sfa.DefineAgent(sfa.AgentDef{
		Name:        "my-agent",
		Version:     "1.0.0",
		Description: "Greets the caller by name",
		Execute: func(ctx sfa.ExecuteContext) (*sfa.InvokeResult, error) {
			name := ctx.Input
			if name == "" {
				name = "world"
			}
			return &sfa.InvokeResult{Result: "Hello, " + name + "!"}, nil
		},
	}).Run()
}
```

```bash
go build -o my-agent . && ./my-agent --context "Alice"   # Hello, Alice!
./my-agent --help
./my-agent --describe
```

## What you get for free

The SDK handles everything that isn't your agent's logic:

- **CLI parsing** — `--help`, `--version`, `--describe`, `--verbose`, `--quiet`, `--output-format`, `--timeout`, custom options
- **Configuration** — shared config file at `~/.config/single-file-agents/config.json`, env var overrides
- **Environment management** — declare required env vars, validate on startup, `--setup` interactive flow, secret masking
- **Safety guardrails** — depth tracking, loop detection, timeout enforcement, SIGINT/SIGTERM handling
- **Execution logging** — every invocation logged to a JSONL file with session tracking and rotation
- **Context store** — persistent file-based store for findings, decisions, and artifacts searchable by agents
- **Agent composition** — `invoke()` to call other agents as subagents with env isolation and depth tracking
- **Service dependencies** — embed docker compose templates, auto-provision databases/infrastructure
- **MCP server mode** — `--mcp` flag turns any agent into an MCP server over stdio

## Project structure

```
single-file-agents/
├── sdk/
│   ├── typescript/@sfa/sdk/  # TypeScript/Bun SDK (vendored into agent projects)
│   └── golang/sfa/           # Go SDK (vendored into agent projects)
├── cli/                      # sfa CLI tool (Go) — init, validate, update
│   └── embedded/sdks/        # Embedded SDK copies for scaffolding
├── docs/                     # Specification documents and guides
├── examples/                 # Example agents
│   ├── hello-world/          # Minimal agent, no deps
│   ├── code-reviewer/        # Reads stdin, writes findings to context store
│   ├── code-fix/             # Composes code-reviewer as a subagent
│   ├── semantic-search/      # Uses pgvector via embedded docker compose
│   └── code-reviewer-mcp/    # Multi-tool MCP server mode
├── tests/sdk/                # SDK test suite
├── VERSION                   # Spec version (shared across all SDKs)
└── CHANGELOG.md              # Release history
```

## Specification

The spec covers 13 capabilities. An agent can adopt them incrementally — start with just the CLI interface and add more over time.

| Spec | What it defines |
|---|---|
| [CLI Interface](docs/cli-interface.md) | Standard args, flags, output contract, exit codes |
| [Shared Config](docs/shared-config.md) | Config file location, schema, env var overrides |
| [Agent Discovery](docs/agent-discovery.md) | Relative path, PATH lookup, explicit declaration |
| [Execution Model](docs/execution-model.md) | Context input, opaque execution, result delivery |
| [Safety & Guardrails](docs/safety-and-guardrails.md) | Depth tracking, loop detection, timeouts, signals |
| [Security](docs/security.md) | Trust levels, setup flow, filesystem boundaries |
| [Execution Logging](docs/execution-logging.md) | JSONL format, session tracking, rotation |
| [Context Store](docs/context-store.md) | Persistent store for findings, decisions, artifacts |
| [Agent Environment](docs/agent-environment.md) | Env var declaration, validation, precedence |
| [Service Dependencies](docs/service-dependencies.md) | Embedded docker compose, health checks, connection injection |
| [MCP Server Mode](docs/mcp-server-mode.md) | `--mcp` flag, tool mapping, dual-mode agents |
| [SDK (TypeScript/Bun)](docs/sdk-typescript.md) | Reference implementation and API surface |
| [sfa CLI](docs/sfa-cli.md) | Go binary for scaffolding, validation, service management |

## Guides

- [Getting Started](docs/guides/getting-started.md) — create your first agent in 5 minutes
- [SDK API Reference](docs/guides/sdk-api-reference.md) — all exported functions, types, and options
- [Vendoring](docs/guides/vendoring.md) — copy the SDK into your project
- [Services](docs/guides/services.md) — add docker compose dependencies
- [Discovery](docs/guides/discovery.md) — make your agent findable
- [Compilation](docs/guides/compilation.md) — build standalone executables
- [MCP Server Mode](docs/guides/mcp.md) — expose your agent as an MCP server

## Development

Prerequisites: [Bun](https://bun.sh) v1.0+, [Go](https://go.dev) 1.21+

```bash
make help            # Show all targets

make test            # Run SDK + CLI tests
make lint            # Typecheck SDK, vet Go CLI
make build           # Build sfa CLI binary
make build-examples  # Compile examples to standalone binaries
make validate-examples  # Validate examples against the spec
make sync-sdks       # Sync SDK sources into CLI embedded directory

make all             # lint + test + validate + build
```

## Key principles

- **Language-agnostic spec** — the spec defines CLI behavior; any language can implement it
- **`SFA_*` env vars as coordination protocol** — inter-agent communication without files or network
- **Stdout for results, stderr for diagnostics** — clean Unix piping
- **Safe by default** — depth limits, timeouts, and loop detection are on by default
- **No daemon, no registry, no framework** — agents are just executables
- **Incremental adoption** — start with `--help` and exit codes, add capabilities over time
