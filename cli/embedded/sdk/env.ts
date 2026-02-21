import type { EnvDeclaration } from "./types";
import type { SfaConfig } from "./config";
import { getAgentNamespace, loadConfig, saveConfig } from "./config";

/**
 * Result of resolving environment variables for an agent.
 */
export interface ResolvedEnv {
  /** All resolved env var values (injected into process.env) */
  values: Record<string, string>;
  /** Names of secret variables (for masking) */
  secrets: Set<string>;
}

/**
 * Resolve environment variables using the precedence order:
 * 1. Process environment (highest)
 * 2. Shared config agent namespace (agents.<name>.env.*)
 * 3. Shared config global defaults (defaults.env.*)
 * 4. Agent definition defaults (lowest)
 */
export function resolveEnv(
  declarations: EnvDeclaration[],
  agentName: string,
  config: SfaConfig,
): ResolvedEnv {
  const agentNs = getAgentNamespace(config, agentName);
  const globalDefaults = (config.defaults as Record<string, unknown>)?.env as Record<string, string> | undefined;
  const values: Record<string, string> = {};
  const secrets = new Set<string>();

  for (const decl of declarations) {
    if (decl.secret) {
      secrets.add(decl.name);
    }

    // Precedence: process env > agent config > global defaults > definition default
    const value =
      process.env[decl.name] ??
      agentNs.env?.[decl.name] ??
      globalDefaults?.[decl.name] ??
      decl.default;

    if (value !== undefined) {
      values[decl.name] = value;
    }
  }

  return { values, secrets };
}

/**
 * Validate that all required env vars are present.
 * Returns an array of missing variable descriptions (empty if all present).
 */
export function validateEnv(
  declarations: EnvDeclaration[],
  resolved: ResolvedEnv,
): { name: string; description?: string }[] {
  const missing: { name: string; description?: string }[] = [];

  for (const decl of declarations) {
    if (decl.required && !resolved.values[decl.name]) {
      missing.push({ name: decl.name, description: decl.description });
    }
  }

  return missing;
}

/**
 * Inject resolved env vars into the process environment.
 */
export function injectEnv(resolved: ResolvedEnv): void {
  for (const [name, value] of Object.entries(resolved.values)) {
    // Only set if not already in process env (process env has highest precedence)
    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

/**
 * Mask secret values in a string.
 * Replaces any occurrence of a secret value with "***".
 */
export function maskSecrets(text: string, resolved: ResolvedEnv): string {
  let masked = text;
  for (const name of resolved.secrets) {
    const value = resolved.values[name];
    if (value && value.length > 0) {
      // Use split/join for global replacement (avoids regex escaping issues)
      masked = masked.split(value).join("***");
    }
  }
  return masked;
}

/**
 * Build an environment for a subagent invocation.
 * Only forwards SFA_* protocol variables. Does NOT forward agent-specific env vars.
 */
export function buildSubagentEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};

  // Forward only SFA_* protocol variables
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("SFA_")) {
      env[key] = value;
    }
  }

  // Also forward basic system env vars (PATH, HOME, etc.)
  const systemVars = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "LC_ALL"];
  for (const key of systemVars) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }

  return env;
}

/**
 * Format an error message for missing required env vars.
 */
export function formatMissingEnvError(
  agentName: string,
  missing: { name: string; description?: string }[],
): string {
  const lines = ["Missing required environment variables:"];
  for (const v of missing) {
    const desc = v.description ? ` — ${v.description}` : "";
    lines.push(`  ${v.name}${desc}`);
  }
  lines.push("");
  lines.push(`Configure them with: ${agentName} --setup`);
  lines.push("Or set them in your environment before running.");
  return lines.join("\n");
}

/**
 * Run the interactive --setup flow.
 * Prompts for each undeclared/missing env var and stores in shared config.
 */
export async function runSetup(
  agentName: string,
  declarations: EnvDeclaration[],
  nonInteractive: boolean,
): Promise<void> {
  const config = await loadConfig();

  // Ensure agents namespace exists
  config.agents = config.agents ?? {};
  config.agents[agentName] = config.agents[agentName] ?? {};
  config.agents[agentName].env = config.agents[agentName].env ?? {};

  const agentEnv = config.agents[agentName].env!;

  process.stderr.write(`\nSetting up ${agentName}...\n\n`);

  for (const decl of declarations) {
    const currentValue = process.env[decl.name] ?? agentEnv[decl.name];
    const hasValue = currentValue !== undefined && currentValue !== "";

    // Show description
    const requiredStr = decl.required ? " (required)" : " (optional)";
    const secretStr = decl.secret ? " [secret]" : "";
    process.stderr.write(`${decl.name}${requiredStr}${secretStr}\n`);
    if (decl.description) {
      process.stderr.write(`  ${decl.description}\n`);
    }

    if (hasValue) {
      const displayValue = decl.secret ? "***" : currentValue;
      process.stderr.write(`  Current value: ${displayValue}\n`);
    }

    if (nonInteractive) {
      if (!hasValue && decl.required) {
        process.stderr.write(`  ⚠ Not configured (set ${decl.name} environment variable)\n`);
      }
      process.stderr.write("\n");
      continue;
    }

    // Prompt for value
    const defaultHint = decl.default ? ` [${decl.default}]` : hasValue ? " [keep current]" : "";
    process.stderr.write(`  Enter value${defaultHint}: `);

    const input = await readLine();

    if (input.trim()) {
      agentEnv[decl.name] = input.trim();
    } else if (!hasValue && decl.default) {
      agentEnv[decl.name] = decl.default;
    }
    // If input is empty and has current value, keep it

    process.stderr.write("\n");
  }

  await saveConfig(config);
  process.stderr.write(`Configuration saved.\n`);
}

/**
 * Read a line from stdin (for interactive prompts).
 */
async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const onData = (chunk: Buffer) => {
      data += chunk.toString();
      if (data.includes("\n")) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(data.trim());
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
