# MCP Server Mode Guide

Expose your agent as an MCP (Model Context Protocol) server so LLM clients can invoke it as a tool.

## Overview

Any SFA can serve as an MCP server by adding `mcpSupported: true` to its definition. In MCP mode, the agent:

- Runs as a long-lived process (instead of execute-and-exit)
- Reads JSON-RPC 2.0 messages from stdin
- Writes responses to stdout
- Exposes the `execute` function as an MCP tool
- Can optionally expose additional tools

## Enabling MCP support

```typescript
import { defineAgent } from "./@sfa/sdk";

export default defineAgent({
  name: "my-agent",
  version: "1.0.0",
  description: "Does something useful",
  mcpSupported: true,

  execute: async (ctx) => {
    const input = ctx.input;
    return { result: `Processed: ${input}` };
  },
});
```

Run in MCP mode:

```bash
bun agent.ts --mcp
```

The agent is now an MCP server. It responds to `initialize`, `tools/list`, `tools/call`, and `ping`.

## How CLI maps to MCP

| CLI concept | MCP equivalent |
|---|---|
| Agent name | Tool name |
| `--describe` output | Tool schema in `tools/list` |
| `--context` / stdin input | Tool input `context` parameter |
| Custom options | Tool input parameters |
| `execute()` return | Tool call result |

## Single-tool mode

By default, the agent's `execute` function is exposed as a single MCP tool named after the agent:

```json
{
  "tools": [{
    "name": "my-agent",
    "description": "Does something useful",
    "inputSchema": {
      "type": "object",
      "properties": {
        "context": { "type": "string", "description": "Input context for the agent" }
      }
    }
  }]
}
```

Custom options from the agent definition automatically become tool input parameters.

## Multi-tool mode

Add a `tools` array to expose additional capabilities:

```typescript
export default defineAgent({
  name: "code-helper",
  version: "1.0.0",
  description: "Reviews, explains, and improves code",
  mcpSupported: true,

  tools: [
    {
      name: "explain",
      description: "Explain what code does",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code to explain" },
          detail: { type: "string", enum: ["brief", "detailed"] },
        },
        required: ["code"],
      },
      handler: async (input, ctx) => {
        const code = input.code as string;
        return { result: `This code does...` };
      },
    },
    {
      name: "suggest",
      description: "Suggest code improvements",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code to improve" },
          focus: { type: "string", enum: ["readability", "performance", "security"] },
        },
        required: ["code"],
      },
      handler: async (input, ctx) => {
        return { result: { suggestions: ["..."] } };
      },
    },
  ],

  // Primary tool — also available in CLI mode
  execute: async (ctx) => {
    return { result: { findings: [] } };
  },
});
```

This exposes three tools: `code-helper` (primary), `explain`, and `suggest`.

The `handler` function receives the same `ExecuteContext` as `execute`, so it has access to `ctx.progress()`, `ctx.writeContext()`, `ctx.searchContext()`, `ctx.invoke()`, and all other context properties.

## Configuring in MCP clients

### Claude Desktop

Add to your Claude MCP configuration:

```json
{
  "mcpServers": {
    "code-helper": {
      "command": "bun",
      "args": ["/path/to/agent.ts", "--mcp"]
    }
  }
}
```

Or with a compiled binary:

```json
{
  "mcpServers": {
    "code-helper": {
      "command": "/path/to/code-helper",
      "args": ["--mcp"]
    }
  }
}
```

### Any MCP client

The agent uses stdio transport (stdin/stdout). Configure your client to spawn the agent process with the `--mcp` flag.

## Subsystem integration

All SFA subsystems remain active in MCP mode:

- **Config**: Loaded once at server startup
- **Environment**: Resolved at startup, available to all tool calls
- **Logging**: One JSONL entry per tool call
- **Context store**: Available via `ctx.writeContext()` and `ctx.searchContext()`
- **Services**: Started once at server startup, kept running for the server's lifetime
- **Safety**: Depth tracking and timeout enforced per tool call

## Graceful shutdown

On SIGTERM or SIGINT:

1. In-flight tool calls get 5 seconds to complete
2. Ephemeral docker services are torn down
3. Transport is closed
4. Process exits cleanly

## Opting out

If your agent should never run as an MCP server, explicitly set:

```typescript
mcpSupported: false,
```

Running with `--mcp` will exit with code 2 (invalid usage).

## Protocol details

The MCP implementation follows the [MCP specification](https://modelcontextprotocol.io):

- Transport: stdio (newline-delimited JSON-RPC 2.0)
- Protocol version: `2024-11-05`
- Capabilities: `tools` (list and call)
- Notifications: `notifications/initialized` (acknowledged silently)
- Health check: `ping` method

## Example: testing MCP mode manually

```bash
# Start the server
bun agent.ts --mcp

# Send messages (in another terminal, or pipe them):
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"my-agent","arguments":{"context":"hello"}}}'
```
