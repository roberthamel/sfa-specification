import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import {
  resolveLoggingConfig,
  createLogEntry,
  writeLogEntry,
} from "../../sdk/typescript/@sfa/sdk/logging";
import type { SfaConfig } from "../../sdk/typescript/@sfa/sdk/config";

let tmpDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpDir = join(tmpdir(), `sfa-test-log-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  savedEnv = { ...process.env };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val !== undefined) process.env[key] = val;
    else delete process.env[key];
  }
});

describe("resolveLoggingConfig", () => {
  test("uses SFA_LOG_FILE env when set", () => {
    process.env.SFA_LOG_FILE = "/custom/log.jsonl";
    const config = resolveLoggingConfig({}, false);
    expect(config.filePath).toBe("/custom/log.jsonl");
  });

  test("uses config logging.file when SFA_LOG_FILE not set", () => {
    delete process.env.SFA_LOG_FILE;
    const sfaConfig: SfaConfig = { logging: { file: "/config/log.jsonl" } };
    const config = resolveLoggingConfig(sfaConfig, false);
    expect(config.filePath).toBe("/config/log.jsonl");
  });

  test("uses default path when no env or config", () => {
    delete process.env.SFA_LOG_FILE;
    const config = resolveLoggingConfig({}, false);
    expect(config.filePath).toContain("single-file-agents/logs/executions.jsonl");
  });

  test("suppressed when noLogFlag is true", () => {
    const config = resolveLoggingConfig({}, true);
    expect(config.suppressed).toBe(true);
  });

  test("suppressed when SFA_NO_LOG=1", () => {
    process.env.SFA_NO_LOG = "1";
    const config = resolveLoggingConfig({}, false);
    expect(config.suppressed).toBe(true);
  });

  test("not suppressed by default", () => {
    delete process.env.SFA_NO_LOG;
    const config = resolveLoggingConfig({}, false);
    expect(config.suppressed).toBe(false);
  });

  test("uses configured maxSize and retainFiles", () => {
    const sfaConfig: SfaConfig = { logging: { maxSize: 100, retainFiles: 3 } };
    const config = resolveLoggingConfig(sfaConfig, false);
    expect(config.maxSizeBytes).toBe(100 * 1024 * 1024);
    expect(config.retainCount).toBe(3);
  });

  test("defaults to 50MB maxSize and 5 retain count", () => {
    const config = resolveLoggingConfig({}, false);
    expect(config.maxSizeBytes).toBe(50 * 1024 * 1024);
    expect(config.retainCount).toBe(5);
  });
});

describe("createLogEntry", () => {
  test("creates entry with all required fields", () => {
    const entry = createLogEntry({
      agent: "test-agent",
      version: "1.0.0",
      exitCode: 0,
      startTime: Date.now() - 100,
      depth: 0,
      callChain: ["test-agent"],
      sessionId: "sess-123",
      input: "test input",
      output: "test output",
    });

    expect(entry.agent).toBe("test-agent");
    expect(entry.version).toBe("1.0.0");
    expect(entry.exitCode).toBe(0);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.depth).toBe(0);
    expect(entry.callChain).toEqual(["test-agent"]);
    expect(entry.sessionId).toBe("sess-123");
    expect(entry.inputSummary).toBe("test input");
    expect(entry.outputSummary).toBe("test output");
    expect(entry.timestamp).toBeDefined();
  });

  test("truncates input and output to 500 chars", () => {
    const longInput = "x".repeat(600);
    const longOutput = "y".repeat(600);
    const entry = createLogEntry({
      agent: "test-agent",
      version: "1.0.0",
      exitCode: 0,
      startTime: Date.now(),
      depth: 0,
      callChain: [],
      sessionId: "s",
      input: longInput,
      output: longOutput,
    });

    expect(entry.inputSummary.length).toBe(500);
    expect(entry.inputSummary.endsWith("...")).toBe(true);
    expect(entry.outputSummary.length).toBe(500);
    expect(entry.outputSummary.endsWith("...")).toBe(true);
  });

  test("includes meta when provided", () => {
    const entry = createLogEntry({
      agent: "test-agent",
      version: "1.0.0",
      exitCode: 0,
      startTime: Date.now(),
      depth: 0,
      callChain: [],
      sessionId: "s",
      input: "",
      output: "",
      meta: { contextFiles: ["/tmp/a.md"] },
    });
    expect(entry.meta?.contextFiles).toEqual(["/tmp/a.md"]);
  });

  test("omits meta when not provided", () => {
    const entry = createLogEntry({
      agent: "test-agent",
      version: "1.0.0",
      exitCode: 0,
      startTime: Date.now(),
      depth: 0,
      callChain: [],
      sessionId: "s",
      input: "",
      output: "",
    });
    expect(entry.meta).toBeUndefined();
  });
});

describe("writeLogEntry", () => {
  test("writes JSONL entry to file", () => {
    const logFile = join(tmpDir, "test.jsonl");
    const config = {
      filePath: logFile,
      suppressed: false,
      maxSizeBytes: 50 * 1024 * 1024,
      retainCount: 5,
    };

    const entry = createLogEntry({
      agent: "test-agent",
      version: "1.0.0",
      exitCode: 0,
      startTime: Date.now(),
      depth: 0,
      callChain: ["test-agent"],
      sessionId: "sess",
      input: "hello",
      output: "world",
    });

    writeLogEntry(entry, config);

    const content = readFileSync(logFile, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.agent).toBe("test-agent");
    expect(parsed.inputSummary).toBe("hello");
    expect(parsed.outputSummary).toBe("world");
  });

  test("appends to existing file (multiple entries)", () => {
    const logFile = join(tmpDir, "multi.jsonl");
    const config = {
      filePath: logFile,
      suppressed: false,
      maxSizeBytes: 50 * 1024 * 1024,
      retainCount: 5,
    };

    const entry1 = createLogEntry({
      agent: "agent-1", version: "1.0.0", exitCode: 0, startTime: Date.now(),
      depth: 0, callChain: [], sessionId: "s", input: "", output: "first",
    });
    const entry2 = createLogEntry({
      agent: "agent-2", version: "1.0.0", exitCode: 0, startTime: Date.now(),
      depth: 0, callChain: [], sessionId: "s", input: "", output: "second",
    });

    writeLogEntry(entry1, config);
    writeLogEntry(entry2, config);

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).agent).toBe("agent-1");
    expect(JSON.parse(lines[1]).agent).toBe("agent-2");
  });

  test("does not write when suppressed", () => {
    const logFile = join(tmpDir, "suppressed.jsonl");
    const config = {
      filePath: logFile,
      suppressed: true,
      maxSizeBytes: 50 * 1024 * 1024,
      retainCount: 5,
    };

    const entry = createLogEntry({
      agent: "test-agent", version: "1.0.0", exitCode: 0, startTime: Date.now(),
      depth: 0, callChain: [], sessionId: "s", input: "", output: "",
    });

    writeLogEntry(entry, config);

    try {
      readFileSync(logFile);
      // File should not exist
      expect(true).toBe(false);
    } catch {
      // Expected — file should not exist
    }
  });

  test("creates log directory if missing", () => {
    const logFile = join(tmpDir, "nested", "deep", "log.jsonl");
    const config = {
      filePath: logFile,
      suppressed: false,
      maxSizeBytes: 50 * 1024 * 1024,
      retainCount: 5,
    };

    const entry = createLogEntry({
      agent: "test-agent", version: "1.0.0", exitCode: 0, startTime: Date.now(),
      depth: 0, callChain: [], sessionId: "s", input: "", output: "",
    });

    writeLogEntry(entry, config);

    const content = readFileSync(logFile, "utf-8");
    expect(content.trim().length).toBeGreaterThan(0);
  });

  test("rotates when file exceeds maxSize", () => {
    const logFile = join(tmpDir, "rotate.jsonl");
    const config = {
      filePath: logFile,
      suppressed: false,
      maxSizeBytes: 100, // Very small — trigger rotation
      retainCount: 2,
    };

    // Write a large-ish entry to exceed the size
    writeFileSync(logFile, "x".repeat(200) + "\n");

    const entry = createLogEntry({
      agent: "test-agent", version: "1.0.0", exitCode: 0, startTime: Date.now(),
      depth: 0, callChain: [], sessionId: "s", input: "", output: "",
    });

    writeLogEntry(entry, config);

    // Should have rotated: original file has the new entry, and a rotated file exists
    const files = readdirSync(tmpDir).filter((f) => f.startsWith("rotate"));
    expect(files.length).toBeGreaterThanOrEqual(2); // rotate.jsonl + rotate-<timestamp>.jsonl
  });

  test("non-blocking: does not throw on write failure", () => {
    // Point at a non-writable path
    const config = {
      filePath: "/dev/null/impossible/path/log.jsonl",
      suppressed: false,
      maxSizeBytes: 50 * 1024 * 1024,
      retainCount: 5,
    };

    const entry = createLogEntry({
      agent: "test", version: "1.0.0", exitCode: 0, startTime: Date.now(),
      depth: 0, callChain: [], sessionId: "s", input: "", output: "",
    });

    // Should not throw
    expect(() => writeLogEntry(entry, config)).not.toThrow();
  });
});
