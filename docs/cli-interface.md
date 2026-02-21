# CLI Interface

Every single-file agent exposes a consistent CLI interface. This document defines the standard arguments, option flags, output contract, exit codes, and identity metadata that all agents must implement.

## Standard Argument Structure

Every agent entry point is an executable file invocable directly from the shell. Arguments follow POSIX conventions with long-form flags.

### Context Input

Agents accept optional context via three mechanisms:

| Method | Example |
|---|---|
| stdin | `echo "code" \| agent` |
| `--context` flag | `agent --context "review this code"` |
| `--context-file` flag | `agent --context-file ./input.txt` |

When no context is provided, the agent operates autonomously using only its built-in purpose and configuration.

## Common Option Flags

Every agent supports these standard flags:

| Flag | Description |
|---|---|
| `--help` | Print usage information (name, description, arguments, examples), exit 0 |
| `--version` | Print version string, exit 0 |
| `--verbose` | Enable detailed diagnostic output on stderr |
| `--quiet` | Suppress progress messages on stderr |
| `--output-format <json\|text>` | Set output format (default: `text`) |
| `--timeout <seconds>` | Set maximum execution time |
| `--describe` | Output machine-readable JSON metadata, exit 0 |
| `--setup` | Run interactive first-time configuration |
| `--no-log` | Suppress execution logging |
| `--max-depth <n>` | Set maximum subagent recursion depth |
| `--services-down` | Tear down docker compose services and exit |
| `--yes` | Skip destructive action confirmation prompts |
| `--non-interactive` | Run without any interactive prompts |
| `--context <value>` | Provide context as a string argument |
| `--context-file <path>` | Provide context from a file |
| `--mcp` | Start as an MCP server instead of executing |

Agents MAY define additional flags specific to their task.

## Structured Output Contract

Result and diagnostic output are separated by stream:

- **stdout**: Result payload only
- **stderr**: Progress messages, diagnostics, logs, errors

This separation allows invokers to capture the result cleanly regardless of verbosity settings.

### JSON Output Structure

When `--output-format json` is used, the JSON object on stdout contains at minimum:

```json
{
  "result": "..."
}
```

It MAY also contain `metadata`, `warnings`, and `errors` fields.

### Text Output

When no `--output-format` is specified (or `--output-format text`), the agent writes plain text to stdout.

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General failure |
| 2 | Invalid usage / bad arguments |
| 3 | Timeout exceeded |
| 4 | Permission denied |
| 10+ | Agent-specific errors (reserved for agents) |
| 130 | Interrupted (SIGINT) |
| 143 | Terminated (SIGTERM) |

When an agent exits with code 0, stdout contains the complete result. On non-zero exit, a partial result MAY be emitted with an `error` field in JSON mode.

Invalid or unrecognized arguments result in exit code 2 with a usage hint on stderr.

## Agent Identity Metadata

### `--help` Output

The `--help` output includes:

- Agent name
- Version
- One-line description
- Accepted input/output formats
- All available flags with descriptions
- Usage examples

### Machine-Readable Identity

When invoked with `--help --output-format json`, the agent outputs a JSON object with fields:

```json
{
  "name": "code-reviewer",
  "version": "1.0.0",
  "description": "Reviews code for common issues",
  "input": ["text", "file"],
  "output": ["text", "json"],
  "options": [
    { "flag": "--verbose", "description": "Enable detailed output" }
  ]
}
```

### `--describe` Output

The `--describe` flag outputs comprehensive JSON metadata sufficient for an LLM to decide whether and how to use the agent:

```json
{
  "name": "code-reviewer",
  "version": "1.0.0",
  "description": "Reviews code for common issues",
  "capabilities": ["code-analysis"],
  "input": { "types": ["text"], "required": false },
  "output": { "formats": ["text", "json"] },
  "options": [...],
  "trustLevel": "sandboxed",
  "env": [...],
  "services": [],
  "mcpSupported": true,
  "contextRetention": "30d",
  "examples": [
    { "command": "echo 'fn main()' | code-reviewer", "description": "Review code from stdin" }
  ]
}
```
