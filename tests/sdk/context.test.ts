import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import {
  resolveContextStorePath,
  writeContext,
  searchContext,
  updateContext,
  addContextLink,
} from "../../@sfa/sdk/context";
import type { SfaConfig } from "../../@sfa/sdk/config";

let tmpDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpDir = join(tmpdir(), `sfa-test-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("resolveContextStorePath", () => {
  test("uses SFA_CONTEXT_STORE env when set", () => {
    process.env.SFA_CONTEXT_STORE = "/custom/context";
    expect(resolveContextStorePath({})).toBe("/custom/context");
  });

  test("uses config contextStore.path", () => {
    delete process.env.SFA_CONTEXT_STORE;
    const config: SfaConfig = { contextStore: { path: "/config/context" } };
    expect(resolveContextStorePath(config)).toBe("/config/context");
  });

  test("uses default path when no env or config", () => {
    delete process.env.SFA_CONTEXT_STORE;
    const path = resolveContextStorePath({});
    expect(path).toContain("single-file-agents/context");
  });
});

describe("writeContext", () => {
  test("writes a context file with frontmatter and content", () => {
    const filePath = writeContext(
      { type: "finding", tags: ["bug"], slug: "test-finding", content: "Found a bug" },
      "my-agent",
      undefined,
      tmpDir,
    );

    expect(filePath).toContain("test-finding.md");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("agent: my-agent");
    expect(content).toContain("type: finding");
    expect(content).toContain("tags: [bug]");
    expect(content).toContain("Found a bug");
  });

  test("organizes by agent name", () => {
    const filePath = writeContext(
      { type: "decision", slug: "test-dec", content: "Decided X" },
      "my-agent",
      undefined,
      tmpDir,
    );
    expect(filePath).toContain("/my-agent/");
  });

  test("organizes by session when provided", () => {
    const filePath = writeContext(
      { type: "artifact", slug: "test-art", content: "Built Y" },
      "my-agent",
      "session-123",
      tmpDir,
    );
    expect(filePath).toContain("/my-agent/session-123/");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("sessionId: session-123");
  });

  test("includes timestamp in frontmatter", () => {
    const filePath = writeContext(
      { type: "reference", slug: "ref", content: "Some ref" },
      "my-agent",
      undefined,
      tmpDir,
    );
    const content = readFileSync(filePath, "utf-8");
    expect(content).toMatch(/timestamp: \d{4}-\d{2}-\d{2}T/);
  });

  test("includes links in frontmatter when provided", () => {
    const filePath = writeContext(
      { type: "summary", slug: "sum", content: "Summary", links: ["other/entry.md"] },
      "my-agent",
      undefined,
      tmpDir,
    );
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("links:");
    expect(content).toContain("other/entry.md");
  });
});

describe("searchContext", () => {
  test("finds entries by agent", () => {
    writeContext(
      { type: "finding", slug: "f1", content: "Finding one" },
      "agent-a",
      undefined,
      tmpDir,
    );
    writeContext(
      { type: "finding", slug: "f2", content: "Finding two" },
      "agent-b",
      undefined,
      tmpDir,
    );

    const results = searchContext({ agent: "agent-a" }, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].agent).toBe("agent-a");
  });

  test("finds entries by type", () => {
    writeContext(
      { type: "finding", slug: "f1", content: "A finding" },
      "my-agent",
      undefined,
      tmpDir,
    );
    writeContext(
      { type: "decision", slug: "d1", content: "A decision" },
      "my-agent",
      undefined,
      tmpDir,
    );

    const results = searchContext({ type: "decision" }, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("decision");
  });

  test("finds entries by tags", () => {
    writeContext(
      { type: "finding", tags: ["security", "auth"], slug: "sec-finding", content: "Security issue" },
      "my-agent",
      undefined,
      tmpDir,
    );
    writeContext(
      { type: "finding", tags: ["performance"], slug: "perf-finding", content: "Slow query" },
      "my-agent",
      undefined,
      tmpDir,
    );

    const results = searchContext({ tags: ["security"] }, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("Security issue");
  });

  test("finds entries by free-text query in content", () => {
    writeContext(
      { type: "finding", slug: "f1", content: "The database connection pool is exhausted" },
      "my-agent",
      undefined,
      tmpDir,
    );
    writeContext(
      { type: "finding", slug: "f2", content: "CSS alignment issue on mobile" },
      "my-agent",
      undefined,
      tmpDir,
    );

    const results = searchContext({ query: "database" }, tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("database");
  });

  test("returns empty array when no matches", () => {
    const results = searchContext({ agent: "nonexistent" }, tmpDir);
    expect(results).toEqual([]);
  });

  test("returns all entries when no filter specified", () => {
    writeContext({ type: "finding", slug: "f1", content: "One" }, "a", undefined, tmpDir);
    writeContext({ type: "decision", slug: "d1", content: "Two" }, "b", undefined, tmpDir);

    const results = searchContext({}, tmpDir);
    expect(results).toHaveLength(2);
  });

  test("sorts results by timestamp descending", () => {
    writeContext({ type: "finding", slug: "first", content: "First" }, "my-agent", undefined, tmpDir);
    // Small delay to ensure different timestamps
    writeContext({ type: "finding", slug: "second", content: "Second" }, "my-agent", undefined, tmpDir);

    const results = searchContext({}, tmpDir);
    expect(results.length).toBe(2);
    // Most recent first
    expect(results[0].timestamp >= results[1].timestamp).toBe(true);
  });
});

describe("updateContext", () => {
  test("replaces content and appends changelog", () => {
    const filePath = writeContext(
      { type: "finding", slug: "update-test", content: "Original content" },
      "my-agent",
      undefined,
      tmpDir,
    );

    updateContext(filePath, "Updated content", "updater-agent", "Fixed the finding");

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Updated content");
    expect(content).toContain("## Changelog");
    expect(content).toContain("[updater-agent]: Fixed the finding");
    // Original content should be replaced
    expect(content).not.toContain("Original content");
  });

  test("appends to existing changelog", () => {
    const filePath = writeContext(
      { type: "finding", slug: "multi-update", content: "V1" },
      "my-agent",
      undefined,
      tmpDir,
    );

    updateContext(filePath, "V2", "agent-a", "First update");
    updateContext(filePath, "V3", "agent-b", "Second update");

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("V3");
    expect(content).toContain("[agent-a]: First update");
    expect(content).toContain("[agent-b]: Second update");
  });

  test("throws for nonexistent file", () => {
    expect(() => {
      updateContext("/nonexistent/file.md", "new", "agent", "desc");
    }).toThrow(/not found/);
  });
});

describe("addContextLink", () => {
  test("adds a link to frontmatter", () => {
    const file1 = writeContext(
      { type: "finding", slug: "source", content: "Source" },
      "my-agent",
      undefined,
      tmpDir,
    );
    const file2 = writeContext(
      { type: "decision", slug: "target", content: "Target" },
      "my-agent",
      undefined,
      tmpDir,
    );

    addContextLink(file1, file2, tmpDir);

    const content = readFileSync(file1, "utf-8");
    expect(content).toContain("links:");
    // Should contain a relative path
    expect(content).toContain("my-agent/");
  });

  test("does not duplicate existing links", () => {
    const file1 = writeContext(
      { type: "finding", slug: "src", content: "Source" },
      "my-agent",
      undefined,
      tmpDir,
    );
    const file2 = writeContext(
      { type: "decision", slug: "tgt", content: "Target" },
      "my-agent",
      undefined,
      tmpDir,
    );

    addContextLink(file1, file2, tmpDir);
    addContextLink(file1, file2, tmpDir);

    const content = readFileSync(file1, "utf-8");
    // Count link occurrences — should appear only once
    const matches = content.match(/- "/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test("throws for nonexistent file", () => {
    expect(() => {
      addContextLink("/nonexistent.md", "/target.md", tmpDir);
    }).toThrow(/not found/);
  });
});
