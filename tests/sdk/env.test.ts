import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  resolveEnv,
  validateEnv,
  injectEnv,
  maskSecrets,
  buildSubagentEnv,
  formatMissingEnvError,
} from "../../sdk/typescript/@sfa/sdk/env";
import type { EnvDeclaration } from "../../sdk/typescript/@sfa/sdk/types";
import type { SfaConfig } from "../../sdk/typescript/@sfa/sdk/config";

// Save and restore env between tests
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  // Restore env
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val !== undefined) {
      process.env[key] = val;
    }
  }
});

describe("resolveEnv", () => {
  test("resolves from process.env (highest precedence)", () => {
    process.env.MY_VAR = "from-env";
    const declarations: EnvDeclaration[] = [
      { name: "MY_VAR", default: "from-default" },
    ];
    const config: SfaConfig = {
      agents: { "test-agent": { env: { MY_VAR: "from-config" } } },
    };
    const resolved = resolveEnv(declarations, "test-agent", config);
    expect(resolved.values.MY_VAR).toBe("from-env");
  });

  test("resolves from agent config namespace", () => {
    delete process.env.MY_VAR;
    const declarations: EnvDeclaration[] = [
      { name: "MY_VAR", default: "from-default" },
    ];
    const config: SfaConfig = {
      agents: { "test-agent": { env: { MY_VAR: "from-agent-config" } } },
    };
    const resolved = resolveEnv(declarations, "test-agent", config);
    expect(resolved.values.MY_VAR).toBe("from-agent-config");
  });

  test("resolves from global defaults", () => {
    delete process.env.MY_VAR;
    const declarations: EnvDeclaration[] = [
      { name: "MY_VAR" },
    ];
    const config: SfaConfig = {
      defaults: { env: { MY_VAR: "from-global-defaults" } } as Record<string, unknown>,
    };
    const resolved = resolveEnv(declarations, "test-agent", config);
    expect(resolved.values.MY_VAR).toBe("from-global-defaults");
  });

  test("resolves from definition default (lowest precedence)", () => {
    delete process.env.MY_VAR;
    const declarations: EnvDeclaration[] = [
      { name: "MY_VAR", default: "from-definition" },
    ];
    const resolved = resolveEnv(declarations, "test-agent", {});
    expect(resolved.values.MY_VAR).toBe("from-definition");
  });

  test("tracks secret variables", () => {
    const declarations: EnvDeclaration[] = [
      { name: "API_KEY", secret: true, default: "sk-123" },
      { name: "MODEL", default: "gpt-4" },
    ];
    const resolved = resolveEnv(declarations, "test-agent", {});
    expect(resolved.secrets.has("API_KEY")).toBe(true);
    expect(resolved.secrets.has("MODEL")).toBe(false);
  });

  test("omits unresolved non-required vars", () => {
    delete process.env.OPTIONAL_VAR;
    const declarations: EnvDeclaration[] = [
      { name: "OPTIONAL_VAR" },
    ];
    const resolved = resolveEnv(declarations, "test-agent", {});
    expect("OPTIONAL_VAR" in resolved.values).toBe(false);
  });
});

describe("validateEnv", () => {
  test("returns empty array when all required vars present", () => {
    const declarations: EnvDeclaration[] = [
      { name: "REQUIRED_VAR", required: true },
    ];
    const resolved = { values: { REQUIRED_VAR: "present" }, secrets: new Set<string>() };
    const missing = validateEnv(declarations, resolved);
    expect(missing).toEqual([]);
  });

  test("reports all missing required vars at once", () => {
    const declarations: EnvDeclaration[] = [
      { name: "VAR_A", required: true, description: "First var" },
      { name: "VAR_B", required: true, description: "Second var" },
      { name: "VAR_C", required: false },
    ];
    const resolved = { values: {}, secrets: new Set<string>() };
    const missing = validateEnv(declarations, resolved);
    expect(missing).toHaveLength(2);
    expect(missing[0].name).toBe("VAR_A");
    expect(missing[0].description).toBe("First var");
    expect(missing[1].name).toBe("VAR_B");
  });

  test("does not report optional vars as missing", () => {
    const declarations: EnvDeclaration[] = [
      { name: "OPTIONAL_VAR", required: false },
    ];
    const resolved = { values: {}, secrets: new Set<string>() };
    const missing = validateEnv(declarations, resolved);
    expect(missing).toEqual([]);
  });
});

describe("injectEnv", () => {
  test("injects resolved values into process.env", () => {
    delete process.env.INJECTED_VAR;
    const resolved = {
      values: { INJECTED_VAR: "injected-value" },
      secrets: new Set<string>(),
    };
    injectEnv(resolved);
    expect(process.env.INJECTED_VAR).toBe("injected-value");
  });

  test("does not override existing process.env values", () => {
    process.env.EXISTING_VAR = "original";
    const resolved = {
      values: { EXISTING_VAR: "overridden" },
      secrets: new Set<string>(),
    };
    injectEnv(resolved);
    expect(process.env.EXISTING_VAR).toBe("original");
  });
});

describe("maskSecrets", () => {
  test("replaces secret values with ***", () => {
    const resolved = {
      values: { API_KEY: "sk-secret-123" },
      secrets: new Set(["API_KEY"]),
    };
    const masked = maskSecrets("Using key sk-secret-123 for auth", resolved);
    expect(masked).toBe("Using key *** for auth");
  });

  test("does not mask non-secret values", () => {
    const resolved = {
      values: { MODEL: "gpt-4" },
      secrets: new Set<string>(),
    };
    const masked = maskSecrets("Using model gpt-4", resolved);
    expect(masked).toBe("Using model gpt-4");
  });

  test("masks multiple occurrences", () => {
    const resolved = {
      values: { SECRET: "abc" },
      secrets: new Set(["SECRET"]),
    };
    const masked = maskSecrets("abc and abc", resolved);
    expect(masked).toBe("*** and ***");
  });

  test("handles empty secret value gracefully", () => {
    const resolved = {
      values: { SECRET: "" },
      secrets: new Set(["SECRET"]),
    };
    const masked = maskSecrets("no change here", resolved);
    expect(masked).toBe("no change here");
  });
});

describe("buildSubagentEnv", () => {
  test("forwards SFA_* protocol variables", () => {
    process.env.SFA_DEPTH = "1";
    process.env.SFA_SESSION_ID = "test-session";
    const env = buildSubagentEnv();
    expect(env.SFA_DEPTH).toBe("1");
    expect(env.SFA_SESSION_ID).toBe("test-session");
  });

  test("forwards system variables (PATH, HOME, etc.)", () => {
    const env = buildSubagentEnv();
    expect(env.PATH).toBeDefined();
    expect(env.HOME).toBeDefined();
  });

  test("does NOT forward agent-specific env vars", () => {
    process.env.MY_CUSTOM_VAR = "should-not-forward";
    const env = buildSubagentEnv();
    expect(env.MY_CUSTOM_VAR).toBeUndefined();
  });
});

describe("formatMissingEnvError", () => {
  test("formats missing vars with descriptions", () => {
    const missing = [
      { name: "API_KEY", description: "Your API key" },
      { name: "MODEL" },
    ];
    const msg = formatMissingEnvError("my-agent", missing);
    expect(msg).toContain("Missing required environment variables:");
    expect(msg).toContain("API_KEY — Your API key");
    expect(msg).toContain("MODEL");
    expect(msg).toContain("my-agent --setup");
  });
});
