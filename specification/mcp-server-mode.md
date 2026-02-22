# MCP Server Mode

Agents can optionally serve their capabilities over the MCP stdio transport. This document defines the `--mcp` flag, tool mapping, multi-tool support, protocol compliance, subsystem integration, graceful shutdown, and opt-in model.

## MCP Mode Activation

The `--mcp` flag starts the agent as an MCP server:

```bash
my-agent --mcp
```

In MCP mode, the agent does NOT execute its task immediately. Instead, it listens for MCP protocol messages on stdin and responds on stdout, running as a long-lived process until terminated.

Without `--mcp`, the agent behaves as a standard CLI tool (execute once and exit).

## Execute Function as MCP Tool

The agent's `execute` function is exposed as an MCP tool:

| MCP Concept | Maps To |
|---|---|
| Tool name | Agent name |
| Tool description | Agent description |
| Input schema | Derived from `--describe` metadata |
| Tool handler | `execute` function |

When an MCP client sends a `tools/call` request with the agent's tool name, the agent invokes its `execute` function with the provided parameters as context and returns the result.

### Tool Input Schema

The input schema is a JSON Schema derived from:
- Accepted context types → tool parameters
- Custom CLI options → additional parameters

## Multi-Tool Support

An agent MAY declare additional MCP tools beyond the primary `execute` function:

```typescript
tools: [
  { name: "review", description: "Review code", handler: async (ctx) => { ... } },
  { name: "explain", description: "Explain code", handler: async (ctx) => { ... } },
  { name: "suggest", description: "Suggest improvements", handler: async (ctx) => { ... } },
]
```

In MCP mode, `tools/list` returns all declared tools plus the primary execute tool. In CLI mode, additional tools are not accessible — only the primary `execute` function runs.

## MCP Protocol Compliance

In MCP mode, the agent implements the MCP protocol over stdio transport using JSON-RPC 2.0:

### Required Methods

| Method | Description |
|---|---|
| `initialize` | Respond with server info (name, version) and capabilities (tools) |
| `tools/list` | Return tool schemas for all exposed tools |
| `tools/call` | Execute the requested tool and return results |
| `ping` | Health check, respond with pong |

Unsupported methods return a JSON-RPC error with code -32601 (method not found).

## Subsystem Integration

All agent subsystems remain active in MCP mode:

| Subsystem | MCP Behavior |
|---|---|
| Config loading | Loaded on server startup |
| Environment validation | Validated on server startup; fails to start if missing |
| Execution logging | One JSONL entry per tool call |
| Context store | Accessible during tool calls (`writeContext`, `searchContext`) |
| Safety guardrails | Depth tracking and timeout enforced per tool call |
| Service dependencies | Started on server startup, kept running for server lifetime |

## MCP Server Declaration

An agent in MCP mode is declarable in MCP client configuration files:

```json
{
  "mcpServers": {
    "code-reviewer": {
      "command": "/usr/local/bin/sfa-code-reviewer",
      "args": ["--mcp"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

This makes SFA agents drop-in compatible with existing MCP client ecosystems (e.g., Claude's `mcp_servers` config).

## Graceful Shutdown

On SIGTERM or SIGINT:

| Scenario | Behavior |
|---|---|
| No in-flight tool calls | Shut down immediately |
| Tool call in progress | Allow completion (up to 5s grace period) |

After grace period:
1. Tear down services (if lifecycle is ephemeral)
2. Write final log entries
3. Close stdio transport

## Opt-In Model

MCP mode is opt-in per agent.

| Configuration | Behavior |
|---|---|
| `mcpSupported: true` | `--mcp` flag available and functional |
| `mcpSupported: false` or omitted | `--mcp` exits with code 2: "MCP mode is not supported by this agent" |

The `--describe` output includes `"mcpSupported": true` when the agent supports MCP mode.

## Three Integration Surfaces

A single agent definition provides:

1. **CLI tool** — direct invocation by users, scripts, or LLMs
2. **Skill** — discoverable by LLMs via skill documentation
3. **MCP server** — declarable in MCP client configurations
