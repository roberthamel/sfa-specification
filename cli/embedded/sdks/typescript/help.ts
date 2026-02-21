import type { AgentDefinition } from "./types";

/**
 * Generate --help output text from an agent definition.
 */
export function generateHelp(def: AgentDefinition): string {
  const lines: string[] = [];

  lines.push(`${def.name} v${def.version}`);
  lines.push(def.description);
  lines.push("");
  lines.push("USAGE:");
  lines.push(`  ${def.name} [OPTIONS] [CONTEXT]`);
  lines.push(`  echo "input" | ${def.name} [OPTIONS]`);
  lines.push("");
  lines.push("STANDARD FLAGS:");
  lines.push("  --help                 Show this help message and exit");
  lines.push("  --version              Show version and exit");
  lines.push("  --describe             Output machine-readable agent metadata as JSON");
  lines.push("  --verbose              Enable verbose diagnostic output on stderr");
  lines.push("  --quiet                Suppress progress messages");
  lines.push("  --output-format <fmt>  Output format: json or text (default: text)");
  lines.push("  --timeout <seconds>    Execution timeout in seconds (default: 120)");
  lines.push("  --context <value>      Pass context as a string argument");
  lines.push("  --context-file <path>  Read context from a file");
  lines.push("  --setup                Run interactive first-time setup");
  lines.push("  --no-log               Suppress execution logging");
  lines.push("  --max-depth <n>        Maximum subagent invocation depth (default: 5)");
  lines.push("  --services-down        Tear down docker compose services and exit");
  lines.push("  --yes                  Auto-confirm prompts");
  lines.push("  --non-interactive      Disable interactive prompts");
  lines.push("  --mcp                  Run as MCP server over stdio");

  if (def.options && def.options.length > 0) {
    lines.push("");
    lines.push("AGENT OPTIONS:");
    for (const opt of def.options) {
      const aliasStr = opt.alias ? `-${opt.alias}, ` : "    ";
      const nameStr = `--${opt.name}`;
      const typeStr = opt.type === "boolean" ? "" : ` <${opt.type}>`;
      const defaultStr = opt.default !== undefined ? ` (default: ${opt.default})` : "";
      const requiredStr = opt.required ? " (required)" : "";
      const pad = Math.max(1, 24 - (aliasStr.length + nameStr.length + typeStr.length));
      lines.push(`  ${aliasStr}${nameStr}${typeStr}${" ".repeat(pad)}${opt.description}${defaultStr}${requiredStr}`);
    }
  }

  if (def.env && def.env.length > 0) {
    lines.push("");
    lines.push("ENVIRONMENT:");
    for (const env of def.env) {
      const requiredStr = env.required ? " (required)" : "";
      const secretStr = env.secret ? " [secret]" : "";
      const defaultStr = env.default !== undefined ? ` (default: ${env.default})` : "";
      lines.push(`  ${env.name}${requiredStr}${secretStr}${defaultStr}`);
      if (env.description) {
        lines.push(`    ${env.description}`);
      }
    }
  }

  if (def.examples && def.examples.length > 0) {
    lines.push("");
    lines.push("EXAMPLES:");
    for (const example of def.examples) {
      lines.push(`  ${example}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate --describe JSON output from an agent definition.
 */
export function generateDescribe(def: AgentDefinition): Record<string, unknown> {
  const describe: Record<string, unknown> = {
    name: def.name,
    version: def.version,
    description: def.description,
    trustLevel: def.trustLevel ?? "sandboxed",
    capabilities: buildCapabilities(def),
    input: {
      contextRequired: def.contextRequired ?? false,
      accepts: ["text", "json"],
    },
    output: {
      formats: ["text", "json"],
    },
    options: (def.options ?? []).map((opt) => ({
      name: opt.name,
      alias: opt.alias,
      description: opt.description,
      type: opt.type,
      default: opt.default,
      required: opt.required ?? false,
    })),
    env: (def.env ?? []).map((e) => ({
      name: e.name,
      required: e.required ?? false,
      secret: e.secret ?? false,
      description: e.description,
    })),
    contextRetention: def.contextRetention ?? "none",
    mcpSupported: def.mcpSupported ?? false,
    requiresDocker: def.services !== undefined && Object.keys(def.services).length > 0,
  };

  if (def.services) {
    describe.services = Object.keys(def.services);
  }

  if (def.mcpSupported && def.tools) {
    describe.tools = def.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  return describe;
}

function buildCapabilities(def: AgentDefinition): string[] {
  const caps: string[] = ["cli"];
  if (def.mcpSupported) caps.push("mcp");
  if (def.services && Object.keys(def.services).length > 0) caps.push("services");
  if (def.env && def.env.length > 0) caps.push("env");
  return caps;
}
