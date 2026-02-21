import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Shared configuration schema.
 */
export interface SfaConfig {
  apiKeys?: Record<string, string>;
  models?: Record<string, string>;
  mcpServers?: Record<string, string>;
  defaults?: Record<string, unknown>;
  agents?: Record<string, AgentNamespaceConfig>;
  logging?: { file?: string; maxSize?: number; retainFiles?: number };
  contextStore?: { path?: string };
}

export interface AgentNamespaceConfig {
  env?: Record<string, string>;
  [key: string]: unknown;
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "single-file-agents", "config.json");

/**
 * Discover the config file path.
 * Priority: SFA_CONFIG env var → ~/.config/single-file-agents/config.json
 */
export function getConfigPath(): string {
  return process.env.SFA_CONFIG ?? DEFAULT_CONFIG_PATH;
}

/**
 * Load and parse the shared configuration file.
 * Returns an empty config (built-in defaults) if the file doesn't exist.
 */
export async function loadConfig(): Promise<SfaConfig> {
  const configPath = getConfigPath();
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return {};
  }

  try {
    const text = await file.text();
    return JSON.parse(text) as SfaConfig;
  } catch {
    // Malformed config — treat as empty, don't fail
    return {};
  }
}

/**
 * Save the shared configuration file.
 * Used by --setup to persist env vars.
 */
export async function saveConfig(config: SfaConfig): Promise<void> {
  const configPath = getConfigPath();
  const dir = configPath.slice(0, configPath.lastIndexOf("/"));

  // Ensure directory exists
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // directory likely exists
  }

  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Get the agent-specific namespace from config.
 */
export function getAgentNamespace(config: SfaConfig, agentName: string): AgentNamespaceConfig {
  return config.agents?.[agentName] ?? {};
}

/**
 * Merge agent-specific config with shared defaults.
 * Agent namespace values override shared defaults.
 */
export function mergeConfig(config: SfaConfig, agentName: string): Record<string, unknown> {
  const defaults = config.defaults ?? {};
  const agentNs = getAgentNamespace(config, agentName);

  // Agent namespace overrides shared defaults (shallow merge)
  const { env: _env, ...agentSettings } = agentNs;
  return { ...defaults, ...agentSettings };
}

/**
 * Apply environment variable overrides to config values.
 * Pattern: SFA_<SECTION>_<KEY> (uppercase, dots → underscores)
 *
 * Examples:
 *   SFA_APIKEYS_ANTHROPIC → config.apiKeys.anthropic
 *   SFA_DEFAULTS_TIMEOUT → config.defaults.timeout
 */
export function applyEnvOverrides(config: SfaConfig): SfaConfig {
  const result = structuredClone(config);
  const prefix = "SFA_";

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;

    // Skip protocol variables (SFA_DEPTH, SFA_SESSION_ID, etc.)
    const protocolVars = [
      "SFA_CONFIG", "SFA_DEPTH", "SFA_MAX_DEPTH", "SFA_CALL_CHAIN",
      "SFA_SESSION_ID", "SFA_LOG_FILE", "SFA_NO_LOG", "SFA_CONTEXT_STORE",
    ];
    if (protocolVars.includes(key)) continue;

    // Parse SFA_SECTION_KEY → section, key
    const rest = key.slice(prefix.length).toLowerCase();
    const underscoreIdx = rest.indexOf("_");
    if (underscoreIdx < 0) continue;

    const section = rest.slice(0, underscoreIdx);
    const subKey = rest.slice(underscoreIdx + 1);

    switch (section) {
      case "apikeys":
        result.apiKeys = result.apiKeys ?? {};
        result.apiKeys[subKey] = value;
        break;
      case "models":
        result.models = result.models ?? {};
        result.models[subKey] = value;
        break;
      case "mcpservers":
        result.mcpServers = result.mcpServers ?? {};
        result.mcpServers[subKey] = value;
        break;
      case "defaults":
        result.defaults = result.defaults ?? {};
        // Try to parse numeric values
        const num = Number(value);
        result.defaults[subKey] = isNaN(num) ? value : num;
        break;
    }
  }

  return result;
}
