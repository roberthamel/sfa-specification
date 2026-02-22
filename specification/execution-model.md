# Execution Model

This document defines how agents receive context, execute their task, and deliver results. The execution model is designed around opaque, stateless, single-purpose invocations.

## Context Input Handling

Agents accept optional context as input through three mechanisms:

| Method | Description |
|---|---|
| stdin | Piped content is read as input context |
| `--context <value>` | Context provided as a string argument |
| `--context-file <path>` | Context read from a file |

When no context is provided, the agent operates autonomously using only its configuration and built-in purpose. The agent does not fail due to absent context unless context is explicitly required (declared in `--describe` output). If context is required but not provided, the agent exits with code 2 and prints a message to stderr.

## Opaque Execution

The invoker does not need to know or manage the agent's internal execution strategy. An agent may internally:

- Call MCP servers
- Invoke skills
- Spawn subagents
- Read files
- Make network requests
- Perform any other operation

The invoker only observes the agent's stdout output and exit code. Internal operations (MCP calls, skill invocations, subagent outputs) are invisible to the invoker.

## Single-Purpose Execution

Each agent performs exactly one well-defined task. The agent's purpose is clearly stated in its `--describe` output and `--help` text. An agent is a specialist — it does one thing, not a general-purpose tool that accepts arbitrary instructions.

When an agent receives context that does not match its declared purpose, it either ignores the irrelevant context or exits with a clear message explaining its scope.

## Stateless Execution

Each invocation is independent. An agent does not depend on state from previous invocations. All necessary input is provided via context, arguments, or configuration.

An agent MAY read from external state stores (databases, files, context store) as part of its task, but does not maintain implicit session state between invocations. It does not write session tokens, cookies, or temporary state files that a subsequent invocation would depend on.

Consecutive invocations with identical input produce the same result (given identical external state).

## Result Delivery

An agent delivers its result to stdout as the final action before exiting.

- **On success (exit 0)**: stdout contains the complete result
- **On failure (non-zero exit)**: a partial result MAY be emitted; in JSON mode, an `error` field is included
- **JSON mode**: the result is a single valid JSON object
- **Text mode**: the result is plain text

The result is complete — partial results due to interruption are indicated by a non-zero exit code.
