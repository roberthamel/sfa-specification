# Single-File Agents Specification

A standard for building portable, composable, CLI-invokable agents that can be discovered and used by humans, LLMs, and other agents.

## Overview

Single-file agents (SFAs) are self-contained executables with a consistent CLI interface, shared configuration, and built-in safety guardrails. Any agent that implements this specification can be invoked by any other agent — no custom integration code required.

An SFA:

- Has a single entry point (executable file)
- Follows a standard CLI interface (flags, exit codes, output contract)
- Is self-describing via `--describe`
- Reads shared configuration from a well-known location
- Declares its environment variable requirements
- Logs every invocation to a common JSONL file
- Can write persistent context to a shared store
- Enforces safety guardrails (depth limits, timeouts, loop detection)
- Can optionally serve as an MCP server

## Specification Documents

| Document | Description |
|---|---|
| [CLI Interface](./cli-interface.md) | Standard arguments, flags, output contract, exit codes |
| [Shared Config](./shared-config.md) | Configuration file location, schema, env var overrides |
| [Agent Discovery](./agent-discovery.md) | How agents are found: relative path, PATH, explicit declaration |
| [Execution Model](./execution-model.md) | Context input, opaque execution, stateless, result delivery |
| [Safety & Guardrails](./safety-and-guardrails.md) | Depth tracking, loop detection, timeouts, signal handling |
| [Security](./security.md) | Trust levels, setup flow, filesystem boundaries, secrets |
| [Execution Logging](./execution-logging.md) | JSONL log format, session tracking, rotation, searchability |
| [Context Store](./context-store.md) | Persistent file-based store for findings, decisions, artifacts |
| [Agent Environment](./agent-environment.md) | Env var declaration, validation, setup, precedence, masking |
| [Service Dependencies](./service-dependencies.md) | Embedded docker compose, lifecycle, health checks, connection injection |
| [MCP Server Mode](./mcp-server-mode.md) | `--mcp` flag, tool mapping, protocol compliance, dual-mode agents |
| [SDK (TypeScript/Bun)](./sdk-typescript.md) | Reference implementation, vendoring model, API surface |
| [sfa CLI](./sfa-cli.md) | Go binary for validation, scaffolding, service management |

## Guides

| Guide | Description |
|---|---|
| [Getting Started](./guides/getting-started.md) | Create your first agent in 5 minutes |
| [SDK API Reference](./guides/sdk-api-reference.md) | All exported functions, types, and options |
| [Vendoring](./guides/vendoring.md) | How to copy the SDK into your project |
| [Services](./guides/services.md) | Add docker compose dependencies to an agent |
| [Discovery](./guides/discovery.md) | Make your agent findable (skill, PATH, explicit) |
| [Compilation](./guides/compilation.md) | Build standalone executables with `bun build --compile` |
| [MCP Server Mode](./guides/mcp.md) | Enable MCP server mode, declare tools, configure clients |

## Key Principles

- **Language-agnostic spec, TypeScript reference SDK**: The spec defines CLI behavior; any language can implement it
- **Environment variables as coordination protocol**: `SFA_*` vars handle all inter-agent communication
- **Stdout for results, stderr for everything else**: Clean Unix piping
- **Safe by default**: Depth limits, timeouts, and loop detection are on by default
- **Incremental adoption**: Start with `--help` and exit codes, add capabilities over time
- **No daemon, no registry, no framework**: Agents are just executables

## Version

This is version 1.0 of the Single-File Agents specification.
