import type { AgentOption, OutputFormat } from "./types";

/**
 * Standard flags that every SFA agent supports.
 */
export interface StandardFlags {
  help: boolean;
  version: boolean;
  verbose: boolean;
  quiet: boolean;
  "output-format": OutputFormat;
  timeout: number;
  describe: boolean;
  setup: boolean;
  "no-log": boolean;
  "max-depth": number;
  "services-down": boolean;
  yes: boolean;
  "non-interactive": boolean;
  context: string | undefined;
  "context-file": string | undefined;
  mcp: boolean;
}

export interface ParsedArgs {
  flags: StandardFlags;
  custom: Record<string, string | number | boolean>;
  positional: string[];
  unknown: string[];
}

const STANDARD_FLAG_DEFS: Record<string, { type: "string" | "number" | "boolean"; default?: unknown }> = {
  help: { type: "boolean" },
  version: { type: "boolean" },
  verbose: { type: "boolean" },
  quiet: { type: "boolean" },
  "output-format": { type: "string", default: "text" },
  timeout: { type: "number", default: 120 },
  describe: { type: "boolean" },
  setup: { type: "boolean" },
  "no-log": { type: "boolean" },
  "max-depth": { type: "number", default: 5 },
  "services-down": { type: "boolean" },
  yes: { type: "boolean" },
  "non-interactive": { type: "boolean" },
  context: { type: "string" },
  "context-file": { type: "string" },
  mcp: { type: "boolean" },
};

/**
 * Parse CLI arguments into standard flags, custom options, and positional args.
 */
export function parseArgs(argv: string[], customOptions?: AgentOption[]): ParsedArgs {
  const flags: Record<string, unknown> = {};
  const custom: Record<string, string | number | boolean> = {};
  const positional: string[] = [];
  const unknown: string[] = [];

  // Initialize defaults for standard flags
  for (const [name, def] of Object.entries(STANDARD_FLAG_DEFS)) {
    if (def.default !== undefined) {
      flags[name] = def.default;
    } else if (def.type === "boolean") {
      flags[name] = false;
    }
  }

  // Initialize defaults for custom options
  const customMap = new Map<string, AgentOption>();
  const aliasMap = new Map<string, string>();
  if (customOptions) {
    for (const opt of customOptions) {
      customMap.set(opt.name, opt);
      if (opt.alias) aliasMap.set(opt.alias, opt.name);
      if (opt.default !== undefined) {
        custom[opt.name] = opt.default;
      } else if (opt.type === "boolean") {
        custom[opt.name] = false;
      }
    }
  }

  // Skip first two args (bun/node and script path) — caller should pass process.argv.slice(2)
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--") {
      // Everything after -- is positional
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      const name = eqIdx >= 0 ? arg.slice(2, eqIdx) : arg.slice(2);
      const inlineValue = eqIdx >= 0 ? arg.slice(eqIdx + 1) : undefined;

      // Check standard flags
      if (name in STANDARD_FLAG_DEFS) {
        const def = STANDARD_FLAG_DEFS[name];
        if (def.type === "boolean") {
          flags[name] = true;
        } else {
          const value = inlineValue ?? argv[++i];
          if (value === undefined) {
            unknown.push(arg);
          } else {
            flags[name] = def.type === "number" ? Number(value) : value;
          }
        }
      }
      // Check custom options
      else if (customMap.has(name)) {
        const opt = customMap.get(name)!;
        if (opt.type === "boolean") {
          custom[name] = true;
        } else {
          const value = inlineValue ?? argv[++i];
          if (value === undefined) {
            unknown.push(arg);
          } else {
            custom[name] = opt.type === "number" ? Number(value) : value;
          }
        }
      } else {
        unknown.push(arg);
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Short alias
      const alias = arg[1];
      const name = aliasMap.get(alias);
      if (name) {
        const opt = customMap.get(name)!;
        if (opt.type === "boolean") {
          custom[name] = true;
        } else {
          const value = argv[++i];
          if (value === undefined) {
            unknown.push(arg);
          } else {
            custom[name] = opt.type === "number" ? Number(value) : value;
          }
        }
      } else {
        unknown.push(arg);
      }
    } else {
      positional.push(arg);
    }

    i++;
  }

  return {
    flags: flags as unknown as StandardFlags,
    custom,
    positional,
    unknown,
  };
}
