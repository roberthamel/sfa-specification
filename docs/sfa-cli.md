# sfa CLI

The `sfa` CLI is a global command-line tool for ecosystem management. It is a separate Go binary — not part of the TypeScript SDK. This document defines its subcommands: `init`, `validate`, and `services`.

## Overview

| Property | Value |
|---|---|
| Language | Go |
| Distribution | Single statically-linked binary |
| Runtime dependencies | None (no Go, Node, or Bun required) |
| Platforms | linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64 |

Built with `CGO_ENABLED=0 go build` for fully static binaries.

## `sfa init`

Scaffolds a new single-file agent project.

```bash
sfa init my-agent
```

Creates:

```
my-agent/
├── agent.ts          — Minimal agent using defineAgent()
├── @sfa/sdk/         — Vendored SDK source (complete, ready to import)
└── README.md         — Quick-start instructions
```

### Options

| Flag | Description |
|---|---|
| `--name "Display Name"` | Custom display name; derives kebab-case agent name |

### Behavior

- The TypeScript SDK source files are embedded in the Go binary via `embed.FS` and extracted during scaffolding
- The scaffolded `agent.ts` includes a placeholder name, description, and execute function
- The scaffolded agent runs immediately: `bun agent.ts --help`
- The scaffolded agent compiles: `bun build --compile agent.ts --outfile my-agent`
- The compiled agent passes `sfa validate`

### Guards

If the target directory already exists and is non-empty, `sfa init` refuses and prints a message suggesting an empty directory or a new name (exit code 1).

## `sfa validate`

Checks whether an agent complies with the SFA specification.

```bash
sfa validate ./my-agent
```

### Validation Checks

1. **`--help`**: Invoke agent with `--help`, expect exit code 0
2. **`--version`**: Invoke agent with `--version`, expect exit code 0, version string on stdout
3. **`--describe`**: Invoke agent with `--describe`, expect exit code 0, valid JSON with required fields

### `--describe` Validation

The CLI verifies the presence of required fields:
- `name` (string)
- `version` (string)
- `description` (string)
- `trustLevel` (string)
- `mcpSupported` (boolean, if present)

If `env` declarations are present, each entry must have:
- `name` (string)
- `required` (boolean)

### Output

On success: reports all checks passed, exits with code 0.

On failure: reports each failure with a clear description of expected vs. received, exits with code 1.

### Language Agnostic

Validation works with agents written in any language. The CLI does not inspect internals — only the CLI interface (exit codes, flags, JSON output).

```bash
sfa validate ./my-go-agent      # Go binary
sfa validate ./my-python-agent  # Python script
sfa validate ./my-ts-agent      # TypeScript agent
```

## `sfa services`

Manages docker containers created by SFA agents. All SFA-managed containers are identified by the `sfa.agent` docker label.

### `sfa services list`

Lists all running SFA-managed containers.

```bash
sfa services list
```

Output columns: agent name, service name, status, ports, uptime.

If no SFA-managed containers exist, prints "No SFA services running" and exits with code 0.

### `sfa services down <agent>`

Stops services for a specific agent.

```bash
sfa services down code-reviewer
```

Runs `docker compose down -v` using the compose file at:

```
~/.local/share/single-file-agents/services/<agent-name>/docker-compose.yml
```

### `sfa services down --all`

Stops all SFA-managed containers across all agents.

```bash
sfa services down --all
```

Stops and removes all docker containers with the `sfa.agent` label.

### Docker Requirement

If docker is not installed or not running, the CLI prints a clear error message and exits with code 1.

## Design Principles

- The `sfa` CLI does not depend on the TypeScript SDK, Bun, or Node.js at runtime
- It operates purely by invoking agents as subprocesses and querying docker
- The embedded SDK is only used by `sfa init` for scaffolding
- This ensures the CLI works with agents built in any language
