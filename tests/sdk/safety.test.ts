import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import {
  initSafety,
  checkDepthLimit,
  checkLoop,
  buildSubagentSafetyEnv,
  setupTimeout,
} from "../../@sfa/sdk/safety";

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = { ...process.env };
  // Clear safety env vars
  delete process.env.SFA_DEPTH;
  delete process.env.SFA_MAX_DEPTH;
  delete process.env.SFA_CALL_CHAIN;
  delete process.env.SFA_SESSION_ID;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val !== undefined) process.env[key] = val;
  }
});

describe("initSafety", () => {
  test("initializes at depth 0 for top-level invocation", () => {
    const safety = initSafety("my-agent");
    expect(safety.depth).toBe(0);
    expect(safety.callChain).toEqual(["my-agent"]);
  });

  test("generates a session ID for top-level invocation", () => {
    const safety = initSafety("my-agent");
    expect(safety.sessionId).toBeDefined();
    expect(safety.sessionId.length).toBeGreaterThan(0);
    // UUID v4 format
    expect(safety.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test("reads depth from SFA_DEPTH env", () => {
    process.env.SFA_DEPTH = "2";
    const safety = initSafety("my-agent");
    expect(safety.depth).toBe(2);
  });

  test("reads max depth from SFA_MAX_DEPTH env", () => {
    process.env.SFA_MAX_DEPTH = "10";
    const safety = initSafety("my-agent");
    expect(safety.maxDepth).toBe(10);
  });

  test("uses maxDepthFlag over SFA_MAX_DEPTH", () => {
    process.env.SFA_MAX_DEPTH = "10";
    const safety = initSafety("my-agent", 3);
    expect(safety.maxDepth).toBe(3);
  });

  test("defaults max depth to 5", () => {
    const safety = initSafety("my-agent");
    expect(safety.maxDepth).toBe(5);
  });

  test("reads call chain from SFA_CALL_CHAIN", () => {
    process.env.SFA_CALL_CHAIN = "parent-agent,middle-agent";
    const safety = initSafety("my-agent");
    expect(safety.callChain).toEqual(["parent-agent", "middle-agent", "my-agent"]);
  });

  test("uses existing SFA_SESSION_ID", () => {
    process.env.SFA_SESSION_ID = "existing-session-id";
    const safety = initSafety("my-agent");
    expect(safety.sessionId).toBe("existing-session-id");
  });

  test("sets SFA_* env vars on process.env", () => {
    const safety = initSafety("my-agent");
    expect(process.env.SFA_DEPTH).toBe("0");
    expect(process.env.SFA_MAX_DEPTH).toBe("5");
    expect(process.env.SFA_CALL_CHAIN).toBe("my-agent");
    expect(process.env.SFA_SESSION_ID).toBe(safety.sessionId);
  });
});

describe("checkDepthLimit", () => {
  test("does not throw when depth is within limit", () => {
    const safety = { depth: 2, maxDepth: 5, callChain: ["a"], sessionId: "s" };
    expect(() => checkDepthLimit(safety)).not.toThrow();
  });

  test("throws when spawning would exceed max depth", () => {
    const safety = { depth: 4, maxDepth: 5, callChain: ["a"], sessionId: "s" };
    expect(() => checkDepthLimit(safety)).toThrow(/Maximum invocation depth/);
  });

  test("throws when already at max depth", () => {
    const safety = { depth: 5, maxDepth: 5, callChain: ["a"], sessionId: "s" };
    expect(() => checkDepthLimit(safety)).toThrow(/Maximum invocation depth/);
  });
});

describe("checkLoop", () => {
  test("does not throw for non-looping agent", () => {
    const safety = { depth: 1, maxDepth: 5, callChain: ["agent-a", "agent-b"], sessionId: "s" };
    expect(() => checkLoop(safety, "agent-c")).not.toThrow();
  });

  test("throws when target agent is in call chain", () => {
    const safety = { depth: 1, maxDepth: 5, callChain: ["agent-a", "agent-b"], sessionId: "s" };
    expect(() => checkLoop(safety, "agent-a")).toThrow(/Loop detected/);
  });

  test("includes the loop path in error message", () => {
    const safety = { depth: 1, maxDepth: 5, callChain: ["agent-a", "agent-b"], sessionId: "s" };
    expect(() => checkLoop(safety, "agent-a")).toThrow("agent-a → agent-b → agent-a");
  });
});

describe("buildSubagentSafetyEnv", () => {
  test("increments depth by 1", () => {
    const safety = { depth: 2, maxDepth: 5, callChain: ["a", "b"], sessionId: "sess-123" };
    const env = buildSubagentSafetyEnv(safety);
    expect(env.SFA_DEPTH).toBe("3");
  });

  test("preserves max depth", () => {
    const safety = { depth: 0, maxDepth: 10, callChain: ["a"], sessionId: "sess" };
    const env = buildSubagentSafetyEnv(safety);
    expect(env.SFA_MAX_DEPTH).toBe("10");
  });

  test("includes call chain as comma-separated", () => {
    const safety = { depth: 1, maxDepth: 5, callChain: ["agent-a", "agent-b"], sessionId: "sess" };
    const env = buildSubagentSafetyEnv(safety);
    expect(env.SFA_CALL_CHAIN).toBe("agent-a,agent-b");
  });

  test("forwards session ID", () => {
    const safety = { depth: 0, maxDepth: 5, callChain: ["a"], sessionId: "my-session" };
    const env = buildSubagentSafetyEnv(safety);
    expect(env.SFA_SESSION_ID).toBe("my-session");
  });
});

describe("setupTimeout", () => {
  test("returns an AbortController and cleanup function", () => {
    const { controller, cleanup } = setupTimeout("test-agent", 10);
    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal.aborted).toBe(false);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  test("aborts after timeout", async () => {
    const { controller, cleanup } = setupTimeout("test-agent", 0.1); // 100ms
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(controller.signal.aborted).toBe(true);
    cleanup();
  });

  test("does not abort if cleanup is called first", async () => {
    const { controller, cleanup } = setupTimeout("test-agent", 0.2);
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(controller.signal.aborted).toBe(false);
  });
});
