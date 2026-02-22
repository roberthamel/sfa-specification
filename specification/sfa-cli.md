# sfa CLI

The `sfa` CLI is a global command-line tool for ecosystem management. It is a separate Go binary — not part of any SDK. This document defines its subcommands: `init`, `validate`, `update`, and `services`.

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
sfa init my-agent                     # TypeScript (default)
sfa init my-agent --language golang   # Go
```

Creates (TypeScript):

```
my-agent/
├── agent.ts          — Minimal agent using defineAgent()
├── @sfa/sdk/         — Vendored SDK source
├── .sfa              — Project marker (language, SDK path)
└── README.md         — Quick-start instructions
```

Creates (Go):

```
my-agent/
├── agent.go          — Minimal agent using sfa.DefineAgent()
├── go.mod            — Go module with local SDK replace directive
├── sfa/              — Vendored Go SDK source
│   └── go.mod        — SDK module
├── .sfa              — Project marker (language, SDK path)
└── README.md         — Quick-start instructions
```

### Options

| Flag | Description |
|---|---|
| `--name "Display Name"` | Custom display name; derives kebab-case agent name |
| `--language <lang>` | Language: `typescript` (default), `golang` |
| `--sdk-path <path>` | Override default SDK vendoring location |

### Behavior

- SDK source files for each language are embedded in the Go binary via `embed.FS` and extracted during scaffolding
- A `.sfa` marker file records the language and SDK path for `sfa update` and `sfa validate`
- TypeScript: scaffolded agent runs immediately with `bun agent.ts --help`
- Go: scaffolded agent builds with `go build -o my-agent .` and runs with `./my-agent --help`
- The scaffolded agent passes `sfa validate`

### Guards

If the target directory already exists and is non-empty, `sfa init` refuses and prints a message suggesting an empty directory or a new name (exit code 1).

## `sfa update`

Updates the vendored SDK in an existing agent project to the latest version embedded in the CLI.

```bash
cd my-agent
sfa update
sfa update --dry-run              # Preview without modifying files
sfa update --language golang      # Override language detection
```

### Detection

Language and SDK path are determined by:

1. `.sfa` marker file (written by `sfa init`)
2. Auto-detection: `@sfa/sdk/` directory → TypeScript, `sfa/*.go` files → Go
3. `--language` flag overrides detected language

### Behavior

- Compares vendored `VERSION` against embedded version
- If already current, prints message and exits
- Deletes vendored SDK directory and re-extracts from embedded copy
- Injects `VERSION` and `CHANGELOG.md` into the new SDK directory
- For Go agents: preserves the existing `sfa/go.mod` module path
- Displays relevant CHANGELOG entries between old and new versions

### Options

| Flag | Description |
|---|---|
| `--language <lang>` | Override language detection |
| `--dry-run` | Preview version change and changelog without modifying files |

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

After validation, if a vendored SDK is detected, prints a warning if it is outdated compared to the CLI's embedded version. This warning is non-fatal and does not affect the exit code.

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

- The `sfa` CLI does not depend on any SDK, Bun, Node.js, or Go at runtime
- It operates purely by invoking agents as subprocesses and querying docker
- Embedded SDKs are used by `sfa init` for scaffolding and `sfa update` for upgrading
- This ensures the CLI works with agents built in any language
