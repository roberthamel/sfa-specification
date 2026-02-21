import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import {
  loadConfig,
  getConfigPath,
  mergeConfig,
  applyEnvOverrides,
  getAgentNamespace,
} from "../../sdk/typescript/@sfa/sdk/config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `sfa-test-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SFA_CONFIG;
  // Clean up env overrides
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SFA_APIKEYS_") || key.startsWith("SFA_DEFAULTS_") || key.startsWith("SFA_MODELS_")) {
      delete process.env[key];
    }
  }
});

describe("getConfigPath", () => {
  test("returns SFA_CONFIG env var when set", () => {
    process.env.SFA_CONFIG = "/custom/config.json";
    expect(getConfigPath()).toBe("/custom/config.json");
  });

  test("returns default path when SFA_CONFIG is not set", () => {
    delete process.env.SFA_CONFIG;
    const path = getConfigPath();
    expect(path).toContain(".config/single-file-agents/config.json");
  });
});

describe("loadConfig", () => {
  test("returns empty config when file does not exist", async () => {
    process.env.SFA_CONFIG = join(tmpDir, "nonexistent.json");
    const config = await loadConfig();
    expect(config).toEqual({});
  });

  test("loads valid config file", async () => {
    const configPath = join(tmpDir, "config.json");
    await Bun.write(configPath, JSON.stringify({
      apiKeys: { anthropic: "sk-test" },
      models: { default: "claude-3" },
    }));
    process.env.SFA_CONFIG = configPath;
    const config = await loadConfig();
    expect(config.apiKeys?.anthropic).toBe("sk-test");
    expect(config.models?.default).toBe("claude-3");
  });

  test("returns empty config for malformed JSON", async () => {
    const configPath = join(tmpDir, "config.json");
    await Bun.write(configPath, "not valid json{{{");
    process.env.SFA_CONFIG = configPath;
    const config = await loadConfig();
    expect(config).toEqual({});
  });

  test("loads agent namespace config", async () => {
    const configPath = join(tmpDir, "config.json");
    await Bun.write(configPath, JSON.stringify({
      agents: {
        "my-agent": {
          env: { API_KEY: "abc123" },
          customSetting: true,
        },
      },
    }));
    process.env.SFA_CONFIG = configPath;
    const config = await loadConfig();
    expect(config.agents?.["my-agent"]?.env?.API_KEY).toBe("abc123");
  });
});

describe("getAgentNamespace", () => {
  test("returns agent namespace when present", () => {
    const config = {
      agents: {
        "my-agent": { env: { KEY: "val" }, customProp: 42 },
      },
    };
    const ns = getAgentNamespace(config, "my-agent");
    expect(ns.env?.KEY).toBe("val");
  });

  test("returns empty object when agent not in config", () => {
    const ns = getAgentNamespace({}, "my-agent");
    expect(ns).toEqual({});
  });

  test("returns empty object when agents section is absent", () => {
    const ns = getAgentNamespace({ apiKeys: {} }, "my-agent");
    expect(ns).toEqual({});
  });
});

describe("mergeConfig", () => {
  test("agent namespace overrides shared defaults", () => {
    const config = {
      defaults: { timeout: 60, model: "gpt-3.5" },
      agents: {
        "my-agent": { timeout: 120 },
      },
    };
    const merged = mergeConfig(config, "my-agent");
    expect(merged.timeout).toBe(120);
    expect(merged.model).toBe("gpt-3.5");
  });

  test("returns defaults when no agent namespace", () => {
    const config = { defaults: { timeout: 60 } };
    const merged = mergeConfig(config, "my-agent");
    expect(merged.timeout).toBe(60);
  });

  test("returns empty when no defaults and no namespace", () => {
    const merged = mergeConfig({}, "my-agent");
    expect(merged).toEqual({});
  });

  test("does not include env in merged output", () => {
    const config = {
      agents: {
        "my-agent": { env: { KEY: "val" }, timeout: 30 },
      },
    };
    const merged = mergeConfig(config, "my-agent");
    expect(merged.env).toBeUndefined();
    expect(merged.timeout).toBe(30);
  });
});

describe("applyEnvOverrides", () => {
  test("overrides apiKeys from SFA_APIKEYS_* env vars", () => {
    process.env.SFA_APIKEYS_ANTHROPIC = "sk-override";
    const config = applyEnvOverrides({ apiKeys: { anthropic: "sk-original" } });
    expect(config.apiKeys?.anthropic).toBe("sk-override");
    delete process.env.SFA_APIKEYS_ANTHROPIC;
  });

  test("creates apiKeys section if not present", () => {
    process.env.SFA_APIKEYS_OPENAI = "sk-new";
    const config = applyEnvOverrides({});
    expect(config.apiKeys?.openai).toBe("sk-new");
    delete process.env.SFA_APIKEYS_OPENAI;
  });

  test("overrides models from SFA_MODELS_* env vars", () => {
    process.env.SFA_MODELS_DEFAULT = "gpt-4";
    const config = applyEnvOverrides({});
    expect(config.models?.default).toBe("gpt-4");
    delete process.env.SFA_MODELS_DEFAULT;
  });

  test("overrides defaults with numeric parsing", () => {
    process.env.SFA_DEFAULTS_TIMEOUT = "30";
    const config = applyEnvOverrides({});
    expect(config.defaults?.timeout).toBe(30);
    delete process.env.SFA_DEFAULTS_TIMEOUT;
  });

  test("overrides defaults with string value", () => {
    process.env.SFA_DEFAULTS_LOGLEVEL = "debug";
    const config = applyEnvOverrides({});
    expect(config.defaults?.loglevel).toBe("debug");
    delete process.env.SFA_DEFAULTS_LOGLEVEL;
  });

  test("skips protocol variables (SFA_DEPTH, SFA_SESSION_ID, etc.)", () => {
    process.env.SFA_DEPTH = "2";
    process.env.SFA_SESSION_ID = "abc";
    const config = applyEnvOverrides({});
    // Protocol vars should not appear in any config section
    expect(config.apiKeys).toBeUndefined();
    expect(config.defaults).toBeUndefined();
    delete process.env.SFA_DEPTH;
    delete process.env.SFA_SESSION_ID;
  });

  test("does not mutate original config", () => {
    const original = { apiKeys: { anthropic: "original" } };
    process.env.SFA_APIKEYS_ANTHROPIC = "override";
    applyEnvOverrides(original);
    expect(original.apiKeys.anthropic).toBe("original");
    delete process.env.SFA_APIKEYS_ANTHROPIC;
  });
});
