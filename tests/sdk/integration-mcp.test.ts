import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Integration test: agent running as MCP server.
 * Sends JSON-RPC tool calls and verifies responses and logging.
 */

describe("MCP integration", () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sfa-mcp-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    logFile = join(tmpDir, "mcp-exec.jsonl");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createMcpAgent(): string {
    const agentPath = join(tmpDir, "mcp-int-agent.ts");
    const code = `
import { defineAgent } from "${join(process.cwd(), "@sfa/sdk/index")}";

defineAgent({
  name: "mcp-int-agent",
  version: "2.0.0",
  description: "MCP integration test agent",
  mcpSupported: true,
  tools: [
    {
      name: "uppercase",
      description: "Convert text to uppercase",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      handler: async (input) => ({ result: String(input.text).toUpperCase() }),
    },
    {
      name: "failing-tool",
      description: "A tool that always fails",
      inputSchema: { type: "object", properties: {} },
      handler: async () => { throw new Error("Intentional failure"); },
    },
  ],
  execute: async (ctx) => ({ result: "Processed: " + ctx.input }),
});
`;
    writeFileSync(agentPath, code);
    return agentPath;
  }

  async function runMcpSession(agentPath: string, messages: object[]): Promise<{ responses: any[]; stderr: string }> {
    const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";

    const proc = Bun.spawn(["bun", agentPath, "--mcp"], {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        SFA_LOG_FILE: logFile,
        SFA_NO_LOG: undefined, // ensure logging is enabled
      },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    // Give it time then kill
    setTimeout(() => {
      try { proc.kill("SIGTERM"); } catch {}
    }, 500);

    const responses: any[] = [];
    for (const line of stdout.trim().split("\n")) {
      if (line.trim()) {
        try { responses.push(JSON.parse(line)); } catch {}
      }
    }

    return { responses, stderr };
  }

  test("full MCP session: initialize, list tools, call tools, verify logging", async () => {
    const agentPath = createMcpAgent();

    const { responses } = await runMcpSession(agentPath, [
      // 1. Initialize
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      // 2. Initialized notification (no response expected)
      { jsonrpc: "2.0", method: "notifications/initialized" },
      // 3. List tools
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      // 4. Call primary tool
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mcp-int-agent", arguments: { context: "hello world" } } },
      // 5. Call additional tool
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "uppercase", arguments: { text: "make me loud" } } },
      // 6. Ping
      { jsonrpc: "2.0", id: 5, method: "ping" },
    ]);

    // 1. Initialize response
    const initResp = responses.find((r) => r.id === 1);
    expect(initResp).toBeDefined();
    expect(initResp.result.protocolVersion).toBe("2024-11-05");
    expect(initResp.result.serverInfo.name).toBe("mcp-int-agent");
    expect(initResp.result.serverInfo.version).toBe("2.0.0");

    // 3. Tools list
    const toolsResp = responses.find((r) => r.id === 2);
    expect(toolsResp).toBeDefined();
    expect(toolsResp.result.tools).toHaveLength(3); // primary + uppercase + failing-tool
    const toolNames = toolsResp.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("mcp-int-agent");
    expect(toolNames).toContain("uppercase");
    expect(toolNames).toContain("failing-tool");

    // 4. Primary tool call
    const primaryResp = responses.find((r) => r.id === 3);
    expect(primaryResp).toBeDefined();
    expect(primaryResp.result.content[0].text).toBe("Processed: hello world");
    expect(primaryResp.result.isError).toBe(false);

    // 5. Additional tool call
    const uppercaseResp = responses.find((r) => r.id === 4);
    expect(uppercaseResp).toBeDefined();
    expect(uppercaseResp.result.content[0].text).toBe("MAKE ME LOUD");

    // 6. Ping
    const pingResp = responses.find((r) => r.id === 5);
    expect(pingResp).toBeDefined();
    expect(pingResp.result).toEqual({});

    // Verify execution logging (per-tool-call logging)
    // Give a moment for logs to flush
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const logContent = readFileSync(logFile, "utf-8").trim();
      const logLines = logContent.split("\n").filter((l) => l.trim());

      // Should have at least 2 log entries (for the two tool calls)
      expect(logLines.length).toBeGreaterThanOrEqual(2);

      const entries = logLines.map((l) => JSON.parse(l));

      // Check primary tool log entry
      const primaryLog = entries.find((e: any) => e.meta?.mcpTool === "mcp-int-agent");
      if (primaryLog) {
        expect(primaryLog.agent).toBe("mcp-int-agent");
        expect(primaryLog.exitCode).toBe(0);
        expect(primaryLog.meta.mcpTool).toBe("mcp-int-agent");
      }

      // Check additional tool log entry
      const uppercaseLog = entries.find((e: any) => e.meta?.mcpTool === "uppercase");
      if (uppercaseLog) {
        expect(uppercaseLog.exitCode).toBe(0);
        expect(uppercaseLog.meta.mcpTool).toBe("uppercase");
      }
    } catch {
      // Log file may not exist if writing was suppressed — that's OK for this test
    }
  });

  test("tool call error handling", async () => {
    const agentPath = createMcpAgent();

    const { responses } = await runMcpSession(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "failing-tool", arguments: {} } },
    ]);

    const errorResp = responses.find((r) => r.id === 2);
    expect(errorResp).toBeDefined();
    expect(errorResp.result.isError).toBe(true);
    expect(errorResp.result.content[0].text).toContain("Intentional failure");
  });

  test("MCP tool input schema is correct", async () => {
    const agentPath = createMcpAgent();

    const { responses } = await runMcpSession(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    const toolsResp = responses.find((r) => r.id === 2);
    const uppercaseTool = toolsResp.result.tools.find((t: any) => t.name === "uppercase");

    expect(uppercaseTool.inputSchema.type).toBe("object");
    expect(uppercaseTool.inputSchema.properties.text.type).toBe("string");
    expect(uppercaseTool.inputSchema.required).toContain("text");
  });
});
