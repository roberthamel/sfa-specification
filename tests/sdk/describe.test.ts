import { test, expect, describe } from "bun:test";
import { generateDescribe } from "../../sdk/typescript/@sfa/sdk/help";
import type { AgentDefinition } from "../../sdk/typescript/@sfa/sdk/types";

const minimalDef: AgentDefinition = {
  name: "test-agent",
  version: "1.0.0",
  description: "A test agent",
  execute: async () => ({ result: "ok" }),
};

describe("generateDescribe", () => {
  test("includes all required fields", () => {
    const desc = generateDescribe(minimalDef);
    expect(desc.name).toBe("test-agent");
    expect(desc.version).toBe("1.0.0");
    expect(desc.description).toBe("A test agent");
    expect(desc.trustLevel).toBe("sandboxed");
  });

  test("includes capabilities array", () => {
    const desc = generateDescribe(minimalDef);
    expect(desc.capabilities).toBeInstanceOf(Array);
    expect((desc.capabilities as string[])).toContain("cli");
  });

  test("includes input specification", () => {
    const desc = generateDescribe(minimalDef);
    const input = desc.input as Record<string, unknown>;
    expect(input.contextRequired).toBe(false);
    expect(input.accepts).toEqual(["text", "json"]);
  });

  test("includes output specification", () => {
    const desc = generateDescribe(minimalDef);
    const output = desc.output as Record<string, unknown>;
    expect(output.formats).toEqual(["text", "json"]);
  });

  test("includes options array", () => {
    const desc = generateDescribe(minimalDef);
    expect(desc.options).toBeInstanceOf(Array);
    expect((desc.options as unknown[]).length).toBe(0);
  });

  test("includes env array", () => {
    const desc = generateDescribe(minimalDef);
    expect(desc.env).toBeInstanceOf(Array);
    expect((desc.env as unknown[]).length).toBe(0);
  });

  test("mcpSupported defaults to false", () => {
    const desc = generateDescribe(minimalDef);
    expect(desc.mcpSupported).toBe(false);
  });

  test("contextRetention defaults to none", () => {
    const desc = generateDescribe(minimalDef);
    expect(desc.contextRetention).toBe("none");
  });

  test("reflects mcpSupported when true", () => {
    const def: AgentDefinition = {
      ...minimalDef,
      mcpSupported: true,
    };
    const desc = generateDescribe(def);
    expect(desc.mcpSupported).toBe(true);
    expect((desc.capabilities as string[])).toContain("mcp");
  });

  test("includes services in capabilities when defined", () => {
    const def: AgentDefinition = {
      ...minimalDef,
      services: {
        postgres: { image: "postgres:16" },
      },
    };
    const desc = generateDescribe(def);
    expect((desc.capabilities as string[])).toContain("services");
    expect(desc.services).toEqual(["postgres"]);
    expect(desc.requiresDocker).toBe(true);
  });

  test("includes env in capabilities when env declarations present", () => {
    const def: AgentDefinition = {
      ...minimalDef,
      env: [{ name: "API_KEY", required: true, secret: true, description: "API Key" }],
    };
    const desc = generateDescribe(def);
    expect((desc.capabilities as string[])).toContain("env");
    const envArr = desc.env as Array<Record<string, unknown>>;
    expect(envArr).toHaveLength(1);
    expect(envArr[0].name).toBe("API_KEY");
    expect(envArr[0].required).toBe(true);
    expect(envArr[0].secret).toBe(true);
  });

  test("includes custom options with correct shape", () => {
    const def: AgentDefinition = {
      ...minimalDef,
      options: [
        { name: "model", alias: "m", description: "Model to use", type: "string", default: "gpt-4" },
        { name: "max-files", description: "Max files", type: "number", required: true },
      ],
    };
    const desc = generateDescribe(def);
    const opts = desc.options as Array<Record<string, unknown>>;
    expect(opts).toHaveLength(2);
    expect(opts[0].name).toBe("model");
    expect(opts[0].alias).toBe("m");
    expect(opts[0].type).toBe("string");
    expect(opts[0].default).toBe("gpt-4");
    expect(opts[1].required).toBe(true);
  });

  test("includes tools when mcpSupported and tools defined", () => {
    const def: AgentDefinition = {
      ...minimalDef,
      mcpSupported: true,
      tools: [
        {
          name: "review",
          description: "Review code",
          inputSchema: { type: "object", properties: { code: { type: "string" } } },
          handler: async () => ({ result: "ok" }),
        },
      ],
    };
    const desc = generateDescribe(def);
    const tools = desc.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("review");
    expect(tools[0].description).toBe("Review code");
    expect(tools[0].inputSchema).toBeDefined();
  });

  test("reflects trustLevel when specified", () => {
    const def: AgentDefinition = {
      ...minimalDef,
      trustLevel: "network",
    };
    const desc = generateDescribe(def);
    expect(desc.trustLevel).toBe("network");
  });

  test("reflects contextRequired when true", () => {
    const def: AgentDefinition = {
      ...minimalDef,
      contextRequired: true,
    };
    const desc = generateDescribe(def);
    expect((desc.input as Record<string, unknown>).contextRequired).toBe(true);
  });

  test("requiresDocker is false when no services", () => {
    const desc = generateDescribe(minimalDef);
    expect(desc.requiresDocker).toBe(false);
  });
});
