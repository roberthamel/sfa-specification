import type {
  AgentDefinition,
  AgentResult,
  ExecuteContext,
  McpToolDefinition,
  WriteContextInput,
  SearchContextInput,
  InvokeOptions,
} from "./types";
import { ExitCode } from "./types";
import type { SafetyState } from "./safety";
import type { LoggingConfig } from "./logging";
import type { ResolvedEnv } from "./env";
import { createLogEntry, writeLogEntry } from "./logging";
import { emitProgress } from "./output";
import { maskSecrets } from "./env";
import { invoke as invokeSubagent } from "./invoke";
import {
  writeContext as writeContextImpl,
  searchContext as searchContextImpl,
} from "./context";
import { startServices, stopServices } from "./services";

// -------------------------------------------------------------------
// JSON-RPC 2.0 types
// -------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// -------------------------------------------------------------------
// 10.6: Tool input schema generation
// -------------------------------------------------------------------

/**
 * Generate a JSON Schema for the primary execute tool from the agent definition.
 */
function buildPrimaryToolSchema(def: AgentDefinition): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    context: {
      type: "string",
      description: "Input context for the agent",
    },
  };
  const required: string[] = [];

  if (def.contextRequired) {
    required.push("context");
  }

  // Map custom CLI options to tool parameters
  if (def.options) {
    for (const opt of def.options) {
      const prop: Record<string, unknown> = {
        description: opt.description,
      };
      if (opt.type === "number") prop.type = "number";
      else if (opt.type === "boolean") prop.type = "boolean";
      else prop.type = "string";

      if (opt.default !== undefined) prop.default = opt.default;
      properties[opt.name] = prop;

      if (opt.required) required.push(opt.name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

/**
 * Build the MCP tool list from the agent definition.
 * Includes the primary execute tool plus any additional declared tools.
 */
function buildToolList(def: AgentDefinition): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  const tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> = [];

  // Primary tool from the agent's execute function
  tools.push({
    name: def.name,
    description: def.description,
    inputSchema: buildPrimaryToolSchema(def),
  });

  // Additional declared tools
  if (def.tools) {
    for (const t of def.tools) {
      tools.push({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      });
    }
  }

  return tools;
}

// -------------------------------------------------------------------
// 10.2: MCP stdio transport
// -------------------------------------------------------------------

/**
 * Read a single JSON-RPC message from stdin.
 * MCP stdio uses newline-delimited JSON.
 */
async function* readMessages(signal: AbortSignal): AsyncGenerator<JsonRpcRequest> {
  let buffer = "";

  const reader = Bun.stdin.stream().getReader();

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += new TextDecoder().decode(value);

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (line.length === 0) continue;

        try {
          const msg = JSON.parse(line) as JsonRpcRequest;
          if (msg.jsonrpc === "2.0" && msg.method) {
            yield msg;
          }
        } catch {
          // Skip malformed messages
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Write a JSON-RPC response to stdout.
 */
function sendResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + "\n");
}

/**
 * Send a JSON-RPC error response.
 */
function sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
  sendResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

// -------------------------------------------------------------------
// MCP Server
// -------------------------------------------------------------------

interface McpServerOptions {
  def: AgentDefinition;
  safety: SafetyState;
  loggingConfig: LoggingConfig;
  contextStorePath: string;
  resolvedEnv: ResolvedEnv;
  mergedConfig: Record<string, unknown>;
  quiet: boolean;
  timeoutSeconds: number;
}

/**
 * Run the agent as an MCP server over stdio.
 *
 * Implements tasks 10.1–10.12:
 * - 10.1: --mcp flag detection (handled in index.ts, this fn is called when flag is set)
 * - 10.2: stdio transport (readMessages / sendResponse)
 * - 10.3: initialize handler
 * - 10.4: tools/list handler
 * - 10.5: tools/call handler
 * - 10.6: tool input schema generation
 * - 10.7: per-tool-call execution logging
 * - 10.8: per-tool-call safety guardrails (timeout per call)
 * - 10.9: service startup on MCP server init
 * - 10.10: graceful shutdown
 * - 10.11: mcpSupported opt-in/opt-out (handled in index.ts)
 * - 10.12: ping handler
 */
export async function serveMcp(opts: McpServerOptions): Promise<never> {
  const { def, safety, loggingConfig, contextStorePath, resolvedEnv, mergedConfig, quiet, timeoutSeconds } = opts;

  // 10.9: Start services on MCP server init
  if (def.services && Object.keys(def.services).length > 0) {
    await startServices(def, process.env as Record<string, string | undefined>);
  }

  if (!quiet) {
    emitProgress(def.name, "MCP server started");
  }

  // Build tool list once
  const tools = buildToolList(def);
  const additionalToolMap = new Map<string, McpToolDefinition>();
  if (def.tools) {
    for (const t of def.tools) {
      additionalToolMap.set(t.name, t);
    }
  }

  // Track in-flight calls for graceful shutdown
  let inFlightCount = 0;
  const contextFilesWritten: string[] = [];

  // 10.10: Graceful shutdown
  const serverAc = new AbortController();
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (!quiet) {
      emitProgress(def.name, "MCP server shutting down");
    }

    // Wait for in-flight calls (up to 5s grace)
    const deadline = Date.now() + 5000;
    while (inFlightCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Tear down services if ephemeral
    if (def.services && Object.keys(def.services).length > 0) {
      await stopServices(def.name, def.serviceLifecycle, def.services);
    }

    serverAc.abort();
    process.exit(ExitCode.SUCCESS);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Main message loop
  for await (const msg of readMessages(serverAc.signal)) {
    const id = msg.id ?? null;

    switch (msg.method) {
      // 10.3: Initialize handler
      case "initialize": {
        sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: def.name,
              version: def.version,
            },
          },
        });
        break;
      }

      // Notifications — no response needed
      case "notifications/initialized":
      case "notifications/cancelled": {
        // No response for notifications
        break;
      }

      // 10.12: Ping handler
      case "ping": {
        sendResponse({
          jsonrpc: "2.0",
          id,
          result: {},
        });
        break;
      }

      // 10.4: tools/list handler
      case "tools/list": {
        sendResponse({
          jsonrpc: "2.0",
          id,
          result: { tools },
        });
        break;
      }

      // 10.5: tools/call handler
      case "tools/call": {
        const toolName = (msg.params?.name as string) ?? "";
        const toolArgs = (msg.params?.arguments as Record<string, unknown>) ?? {};

        // Validate tool exists
        const isPrimary = toolName === def.name;
        const additionalTool = additionalToolMap.get(toolName);
        if (!isPrimary && !additionalTool) {
          sendError(id, -32602, `Unknown tool: ${toolName}`);
          break;
        }

        inFlightCount++;
        const callStart = Date.now();

        // 10.8: Per-tool-call safety guardrails (timeout)
        const callAc = new AbortController();
        const callTimeout = setTimeout(() => {
          callAc.abort();
        }, timeoutSeconds * 1000);

        // Build per-call ExecuteContext
        const progress = (message: string) => {
          if (!quiet) {
            emitProgress(def.name, maskSecrets(message, resolvedEnv));
          }
        };

        const ctx: ExecuteContext = {
          input: (toolArgs.context as string) ?? "",
          options: toolArgs as Record<string, string | number | boolean>,
          env: process.env as Record<string, string | undefined>,
          config: mergedConfig,
          signal: callAc.signal,
          depth: safety.depth,
          sessionId: safety.sessionId,
          agentName: def.name,
          agentVersion: def.version,
          progress,
          invoke: async (targetAgent: string, invokeOpts?: InvokeOptions) => {
            const elapsed = Date.now() - callStart;
            const remainingMs = timeoutSeconds * 1000 - elapsed;
            return invokeSubagent(targetAgent, safety, remainingMs > 0 ? remainingMs : undefined, callAc.signal, invokeOpts);
          },
          writeContext: async (entry: WriteContextInput): Promise<string> => {
            const filePath = writeContextImpl(entry, def.name, safety.sessionId, contextStorePath);
            contextFilesWritten.push(filePath);
            return filePath;
          },
          searchContext: async (query: SearchContextInput) => {
            return searchContextImpl(query, contextStorePath);
          },
        };

        try {
          let result: AgentResult;

          if (isPrimary) {
            result = await def.execute(ctx);
          } else {
            result = await additionalTool!.handler(toolArgs, ctx);
          }

          clearTimeout(callTimeout);

          // 10.7: Per-tool-call execution logging
          const outputStr = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
          const logEntry = createLogEntry({
            agent: def.name,
            version: def.version,
            exitCode: 0,
            startTime: callStart,
            depth: safety.depth,
            callChain: safety.callChain,
            sessionId: safety.sessionId,
            input: (toolArgs.context as string) ?? "",
            output: outputStr,
            meta: {
              mcpTool: toolName,
              ...(contextFilesWritten.length > 0 ? { contextFiles: [...contextFilesWritten] } : {}),
            },
          });
          writeLogEntry(logEntry, loggingConfig);

          // Send MCP result
          const content = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: content }],
              isError: false,
            },
          });
        } catch (err: unknown) {
          clearTimeout(callTimeout);

          const errorMsg = (err as Error).message ?? String(err);
          const isTimeout = callAc.signal.aborted;

          // 10.7: Log the failed call
          const logEntry = createLogEntry({
            agent: def.name,
            version: def.version,
            exitCode: isTimeout ? ExitCode.TIMEOUT : ExitCode.FAILURE,
            startTime: callStart,
            depth: safety.depth,
            callChain: safety.callChain,
            sessionId: safety.sessionId,
            input: (toolArgs.context as string) ?? "",
            output: errorMsg,
            meta: { mcpTool: toolName },
          });
          writeLogEntry(logEntry, loggingConfig);

          sendResponse({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: isTimeout ? `Timeout after ${timeoutSeconds}s` : errorMsg }],
              isError: true,
            },
          });
        } finally {
          inFlightCount--;
          contextFilesWritten.length = 0;
        }

        break;
      }

      default: {
        // Unknown method
        if (id !== null) {
          sendError(id, -32601, `Method not found: ${msg.method}`);
        }
        break;
      }
    }
  }

  // Stream ended — clean exit
  await shutdown();
  process.exit(ExitCode.SUCCESS);
}
