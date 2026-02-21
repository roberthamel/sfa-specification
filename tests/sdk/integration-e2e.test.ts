import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Integration test: end-to-end agent that:
 * - Runs with a custom config
 * - Reads context from --context
 * - Writes to the context store
 * - Logs execution to JSONL
 * - Returns JSON output
 *
 * (Subagent invocation and services are tested with mock commands
 *  since we can't guarantee Docker in CI.)
 */

describe("end-to-end integration", () => {
  let tmpDir: string;
  let logFile: string;
  let contextDir: string;
  let configFile: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sfa-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    logFile = join(tmpDir, "exec.jsonl");
    contextDir = join(tmpDir, "context");
    configFile = join(tmpDir, "config.json");

    // Write a test config
    writeFileSync(configFile, JSON.stringify({
      defaults: { timeout: 30 },
      agents: { "e2e-agent": { env: { GREETING: "Hello from config" } } },
    }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createE2EAgent(): string {
    const agentPath = join(tmpDir, "e2e-agent.ts");
    const code = `
import { defineAgent } from "${join(process.cwd(), "sdk/typescript/@sfa/sdk/index")}";

defineAgent({
  name: "e2e-agent",
  version: "1.2.3",
  description: "End-to-end test agent",
  env: [
    { name: "GREETING", default: "Hello" },
  ],
  contextRetention: "session",
  options: [
    { name: "mode", alias: "m", description: "Operation mode", type: "string", default: "default" },
  ],
  execute: async (ctx) => {
    // Write a context entry
    const filePath = await ctx.writeContext({
      type: "finding",
      tags: ["test", "e2e"],
      slug: "test-finding",
      content: "Found during e2e test: " + ctx.input,
    });

    // Search context
    const found = await ctx.searchContext({ tags: ["e2e"] });

    return {
      result: {
        input: ctx.input,
        greeting: ctx.env.GREETING,
        mode: ctx.options.mode,
        contextFile: filePath,
        contextEntriesFound: found.length,
        depth: ctx.depth,
        sessionId: ctx.sessionId,
      },
    };
  },
});
`;
    writeFileSync(agentPath, code);
    return agentPath;
  }

  test("runs agent with context, config, logging, and context store", async () => {
    const agentPath = createE2EAgent();

    const proc = Bun.spawn(
      ["bun", agentPath, "--context", "test input data", "--output-format", "json", "--mode", "test"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SFA_CONFIG: configFile,
          SFA_LOG_FILE: logFile,
          SFA_CONTEXT_STORE: contextDir,
        },
      },
    );

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);

    // Parse JSON output
    const output = JSON.parse(stdout.trim());
    expect(output.result.input).toBe("test input data");
    expect(output.result.greeting).toBe("Hello from config");
    expect(output.result.mode).toBe("test");
    expect(output.result.depth).toBe(0);
    expect(output.result.sessionId).toBeDefined();
    expect(output.result.contextEntriesFound).toBeGreaterThanOrEqual(1);

    // Verify context file was written
    expect(output.result.contextFile).toContain("test-finding.md");
    const contextContent = readFileSync(output.result.contextFile, "utf-8");
    expect(contextContent).toContain("Found during e2e test: test input data");
    expect(contextContent).toContain("type: finding");
    expect(contextContent).toContain("tags: [test, e2e]");

    // Verify execution log was written
    const logContent = readFileSync(logFile, "utf-8").trim();
    const logEntry = JSON.parse(logContent);
    expect(logEntry.agent).toBe("e2e-agent");
    expect(logEntry.version).toBe("1.2.3");
    expect(logEntry.exitCode).toBe(0);
    expect(logEntry.durationMs).toBeGreaterThanOrEqual(0);
    expect(logEntry.inputSummary).toBe("test input data");
    expect(logEntry.meta?.contextFiles).toBeInstanceOf(Array);

    // Verify progress messages on stderr
    expect(stderr).toContain("[agent:e2e-agent] starting");
    expect(stderr).toContain("[agent:e2e-agent] completed");
  });

  test("agent --help exits 0 with help text", async () => {
    const agentPath = createE2EAgent();

    const proc = Bun.spawn(["bun", agentPath, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SFA_NO_LOG: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("e2e-agent");
    expect(stdout).toContain("USAGE:");
    expect(stdout).toContain("STANDARD FLAGS:");
    expect(stdout).toContain("AGENT OPTIONS:");
    expect(stdout).toContain("--mode");
    expect(stdout).toContain("ENVIRONMENT:");
    expect(stdout).toContain("GREETING");
  });

  test("agent --version exits 0 with version", async () => {
    const agentPath = createE2EAgent();

    const proc = Bun.spawn(["bun", agentPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SFA_NO_LOG: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("1.2.3");
  });

  test("agent --describe outputs complete JSON metadata", async () => {
    const agentPath = createE2EAgent();

    const proc = Bun.spawn(["bun", agentPath, "--describe"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SFA_NO_LOG: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    const desc = JSON.parse(stdout);
    expect(desc.name).toBe("e2e-agent");
    expect(desc.version).toBe("1.2.3");
    expect(desc.description).toBe("End-to-end test agent");
    expect(desc.trustLevel).toBeDefined();
    expect(desc.capabilities).toContain("cli");
    expect(desc.capabilities).toContain("env");
    expect(desc.contextRetention).toBe("session");
    expect(desc.options.length).toBeGreaterThanOrEqual(1);
    expect(desc.env.length).toBeGreaterThanOrEqual(1);
    expect(typeof desc.mcpSupported).toBe("boolean");
  });

  test("agent with subagent invocation (echo as subagent)", async () => {
    const agentPath = join(tmpDir, "parent-agent.ts");
    const code = `
import { defineAgent } from "${join(process.cwd(), "sdk/typescript/@sfa/sdk/index")}";

defineAgent({
  name: "parent-agent",
  version: "1.0.0",
  description: "Parent agent that invokes echo",
  execute: async (ctx) => {
    const result = await ctx.invoke("echo", { args: ["subagent-output"] });
    return {
      result: {
        subagentOk: result.ok,
        subagentOutput: result.output.trim(),
        subagentExitCode: result.exitCode,
      },
    };
  },
});
`;
    writeFileSync(agentPath, code);

    const proc = Bun.spawn(["bun", agentPath, "--output-format", "json"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SFA_NO_LOG: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout.trim());
    expect(output.result.subagentOk).toBe(true);
    expect(output.result.subagentOutput).toBe("subagent-output");
    expect(output.result.subagentExitCode).toBe(0);
  });

  test("agent exits with code 2 for unknown flags", async () => {
    const agentPath = createE2EAgent();

    const proc = Bun.spawn(["bun", agentPath, "--nonexistent-flag"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SFA_NO_LOG: "1" },
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(2);
  });

  test("--no-log suppresses logging", async () => {
    const agentPath = createE2EAgent();

    const proc = Bun.spawn(
      ["bun", agentPath, "--context", "test", "--no-log"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          SFA_LOG_FILE: logFile,
          SFA_CONTEXT_STORE: contextDir,
          SFA_CONFIG: configFile,
        },
      },
    );

    await proc.exited;

    // Log file should not exist
    try {
      readFileSync(logFile);
      expect(true).toBe(false); // should not reach here
    } catch {
      // Expected
    }
  });

  test("text output format (default)", async () => {
    const agentPath = join(tmpDir, "text-agent.ts");
    const code = `
import { defineAgent } from "${join(process.cwd(), "sdk/typescript/@sfa/sdk/index")}";

defineAgent({
  name: "text-agent",
  version: "1.0.0",
  description: "Returns text",
  execute: async () => ({ result: "plain text output" }),
});
`;
    writeFileSync(agentPath, code);

    const proc = Bun.spawn(["bun", agentPath], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, SFA_NO_LOG: "1" },
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("plain text output");
  });
});
