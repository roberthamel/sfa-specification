import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { invoke } from "../../sdk/typescript/@sfa/sdk/invoke";
import type { SafetyState } from "../../sdk/typescript/@sfa/sdk/safety";

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val !== undefined) process.env[key] = val;
    else delete process.env[key];
  }
});

describe("invoke", () => {
  const baseSafety: SafetyState = {
    depth: 0,
    maxDepth: 5,
    callChain: ["parent-agent"],
    sessionId: "test-session",
  };

  test("invokes a simple agent and captures stdout", async () => {
    const result = await invoke(
      "echo",
      baseSafety,
      10000,
      new AbortController().signal,
      { args: ["hello from subagent"] },
    );
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toBe("hello from subagent");
  });

  test("captures exit code from failed command", async () => {
    const result = await invoke(
      "false",
      baseSafety,
      10000,
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  test("throws on depth limit exceeded", async () => {
    const atMaxDepth: SafetyState = {
      depth: 4,
      maxDepth: 5,
      callChain: ["a", "b", "c", "d", "e"],
      sessionId: "s",
    };

    await expect(
      invoke("echo", atMaxDepth, 10000, new AbortController().signal, { args: ["hi"] }),
    ).rejects.toThrow(/Maximum invocation depth/);
  });

  test("throws on loop detection", async () => {
    const safety: SafetyState = {
      depth: 1,
      maxDepth: 5,
      callChain: ["echo"],
      sessionId: "s",
    };

    await expect(
      invoke("echo", safety, 10000, new AbortController().signal),
    ).rejects.toThrow(/Loop detected/);
  });

  test("passes context via stdin", async () => {
    // Use `cat` to echo back stdin
    const result = await invoke(
      "cat",
      baseSafety,
      10000,
      new AbortController().signal,
      { context: "input from parent" },
    );
    expect(result.ok).toBe(true);
    expect(result.output.trim()).toBe("input from parent");
  });

  test("enforces timeout", async () => {
    const result = await invoke(
      "sleep",
      baseSafety,
      undefined,
      new AbortController().signal,
      { args: ["10"], timeout: 0.5 }, // 0.5 second timeout
    );
    // Should have timed out
    expect(result.exitCode).toBe(3);
    expect(result.ok).toBe(false);
  });

  test("propagates parent abort signal", async () => {
    const ac = new AbortController();
    // Abort immediately
    setTimeout(() => ac.abort(), 100);

    const result = await invoke(
      "sleep",
      baseSafety,
      undefined,
      ac.signal,
      { args: ["10"] },
    );
    // Should have been killed
    expect(result.ok).toBe(false);
  });

  test("propagates SFA_* env vars but not custom vars", async () => {
    process.env.SFA_SESSION_ID = "test-session";
    process.env.MY_CUSTOM_VAR = "should-not-forward";

    const result = await invoke(
      "env",
      baseSafety,
      10000,
      new AbortController().signal,
    );

    expect(result.output).toContain("SFA_DEPTH=1"); // incremented
    expect(result.output).toContain("SFA_SESSION_ID=test-session");
    expect(result.output).not.toContain("MY_CUSTOM_VAR");
  });
});
