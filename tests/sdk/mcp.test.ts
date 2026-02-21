import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const SDK_PATH = join(process.cwd(), "@sfa/sdk/index");

describe("MCP server mode", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sfa-test-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTestAgent(opts: { mcpSupported?: boolean; tools?: boolean } = {}): string {
    const agentPath = join(tmpDir, "mcp-test-agent.ts");
    const toolsBlock = opts.tools ? `
  tools: [
    {
      name: "greet",
      description: "Greet someone",
      inputSchema: { type: "object", properties: { name: { type: "string" } } },
      handler: async (input) => ({ result: "Hello " + (input.name || "world") }),
    },
  ],` : "";

    const code = `
import { defineAgent } from "${SDK_PATH}";

defineAgent({
  name: "mcp-test-agent",
  version: "0.1.0",
  description: "Test agent for MCP",
  mcpSupported: ${opts.mcpSupported !== false},${toolsBlock}
  execute: async (ctx) => ({ result: "echo: " + ctx.input }),
});
`;
    writeFileSync(agentPath, code);
    return agentPath;
  }

  async function sendMcpMessages(agentPath: string, messages: object[]): Promise<object[]> {
    const input = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";

    const proc = Bun.spawn(["bun", agentPath, "--mcp", "--no-log"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SFA_NO_LOG: "1" },
    });

    // Write messages to stdin then close it
    proc.stdin.write(input);
    proc.stdin.end();

    const stdout = await new Response(proc.stdout).text();

    // Kill the server after reading
    try { proc.kill("SIGTERM"); } catch {}

    const responses: object[] = [];
    for (const line of stdout.trim().split("\n")) {
      if (line.trim()) {
        try {
          responses.push(JSON.parse(line));
        } catch {}
      }
    }

    return responses;
  }

  test("responds to initialize request", async () => {
    const agentPath = createTestAgent();
    const responses = await sendMcpMessages(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    ]);

    expect(responses.length).toBeGreaterThanOrEqual(1);
    const resp = responses[0] as any;
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.result.serverInfo.name).toBe("mcp-test-agent");
    expect(resp.result.serverInfo.version).toBe("0.1.0");
    expect(resp.result.capabilities.tools).toBeDefined();
  });

  test("responds to ping", async () => {
    const agentPath = createTestAgent();
    const responses = await sendMcpMessages(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);

    const ping = responses.find((r: any) => r.id === 2) as any;
    expect(ping).toBeDefined();
    expect(ping.result).toEqual({});
  });

  test("responds to tools/list with primary tool", async () => {
    const agentPath = createTestAgent();
    const responses = await sendMcpMessages(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    const toolsList = responses.find((r: any) => r.id === 2) as any;
    expect(toolsList).toBeDefined();
    expect(toolsList.result.tools).toBeInstanceOf(Array);
    expect(toolsList.result.tools.length).toBeGreaterThanOrEqual(1);

    const primaryTool = toolsList.result.tools.find((t: any) => t.name === "mcp-test-agent");
    expect(primaryTool).toBeDefined();
    expect(primaryTool.description).toBe("Test agent for MCP");
    expect(primaryTool.inputSchema).toBeDefined();
  });

  test("responds to tools/list with additional tools", async () => {
    const agentPath = createTestAgent({ tools: true });
    const responses = await sendMcpMessages(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    const toolsList = responses.find((r: any) => r.id === 2) as any;
    expect(toolsList.result.tools.length).toBe(2);
    const greetTool = toolsList.result.tools.find((t: any) => t.name === "greet");
    expect(greetTool).toBeDefined();
    expect(greetTool.description).toBe("Greet someone");
  });

  test("handles tools/call for primary tool", async () => {
    const agentPath = createTestAgent();
    const responses = await sendMcpMessages(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mcp-test-agent", arguments: { context: "hello" } } },
    ]);

    const callResult = responses.find((r: any) => r.id === 2) as any;
    expect(callResult).toBeDefined();
    expect(callResult.result.content).toBeInstanceOf(Array);
    expect(callResult.result.content[0].type).toBe("text");
    expect(callResult.result.content[0].text).toBe("echo: hello");
    expect(callResult.result.isError).toBe(false);
  });

  test("handles tools/call for additional tool", async () => {
    const agentPath = createTestAgent({ tools: true });
    const responses = await sendMcpMessages(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "greet", arguments: { name: "Claude" } } },
    ]);

    const callResult = responses.find((r: any) => r.id === 2) as any;
    expect(callResult).toBeDefined();
    expect(callResult.result.content[0].text).toBe("Hello Claude");
  });

  test("returns error for unknown tool", async () => {
    const agentPath = createTestAgent();
    const responses = await sendMcpMessages(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nonexistent", arguments: {} } },
    ]);

    const callResult = responses.find((r: any) => r.id === 2) as any;
    expect(callResult).toBeDefined();
    expect(callResult.error).toBeDefined();
    expect(callResult.error.message).toContain("Unknown tool");
  });

  test("returns error for unknown method", async () => {
    const agentPath = createTestAgent();
    const responses = await sendMcpMessages(agentPath, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "nonexistent/method" },
    ]);

    const resp = responses.find((r: any) => r.id === 2) as any;
    expect(resp).toBeDefined();
    expect(resp.error).toBeDefined();
    expect(resp.error.message).toContain("Method not found");
  });

  test("rejects --mcp when mcpSupported is false", async () => {
    const agentPath = join(tmpDir, "no-mcp-agent.ts");
    const code = `
import { defineAgent } from "${SDK_PATH}";

defineAgent({
  name: "no-mcp-agent",
  version: "0.1.0",
  description: "Agent that rejects MCP",
  mcpSupported: false,
  execute: async (ctx) => ({ result: "ok" }),
});
`;
    writeFileSync(agentPath, code);

    const proc = Bun.spawn(["bun", agentPath, "--mcp"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SFA_NO_LOG: "1" },
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(2); // INVALID_USAGE
  });
});
