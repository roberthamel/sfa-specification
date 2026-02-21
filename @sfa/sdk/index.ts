export type {
  AgentDefinition,
  AgentResult,
  ExecuteContext,
  EnvDeclaration,
  ServiceDefinition,
  ContextEntry,
  InvokeResult,
  InvokeOptions,
  WriteContextInput,
  SearchContextInput,
  AgentOption,
  McpToolDefinition,
  TrustLevel,
  ContextType,
  ServiceLifecycle,
  OutputFormat,
} from "./types";

export { ExitCode } from "./types";

export type { SfaConfig, AgentNamespaceConfig } from "./config";
export { loadConfig, saveConfig, getConfigPath, mergeConfig, applyEnvOverrides } from "./config";
export { resolveEnv, validateEnv, injectEnv, maskSecrets, buildSubagentEnv, runSetup } from "./env";

import type { AgentDefinition, AgentResult, ExecuteContext } from "./types";
import { ExitCode } from "./types";
import { parseArgs } from "./cli";
import { generateHelp, generateDescribe } from "./help";
import { readInput } from "./input";
import { writeResult, exitWithError, emitProgress } from "./output";
import { loadConfig, applyEnvOverrides, mergeConfig } from "./config";
import {
  resolveEnv,
  validateEnv,
  injectEnv,
  maskSecrets,
  formatMissingEnvError,
  runSetup,
  buildSubagentEnv,
} from "./env";

/**
 * Define and run a single-file agent.
 *
 * This is the main entry point for the SDK. It accepts an agent definition,
 * parses CLI arguments, handles standard flags (--help, --version, --describe),
 * reads input context, and executes the agent's function.
 *
 * The agent runs immediately when this function is called (at module load via
 * `export default defineAgent({...})`).
 */
export function defineAgent(definition: AgentDefinition): void {
  // Run the agent — top-level await handled by Bun
  runAgent(definition).catch((err) => {
    exitWithError(err?.message ?? String(err), ExitCode.FAILURE);
  });
}

async function runAgent(def: AgentDefinition): Promise<void> {
  const startTime = Date.now();
  const args = parseArgs(process.argv.slice(2), def.options);

  // Handle unknown flags
  if (args.unknown.length > 0) {
    exitWithError(`Unknown option: ${args.unknown[0]}\nRun '${def.name} --help' for usage.`, ExitCode.INVALID_USAGE);
  }

  // --help: print help and exit
  if (args.flags.help) {
    process.stdout.write(generateHelp(def) + "\n");
    process.exit(ExitCode.SUCCESS);
  }

  // --version: print version and exit
  if (args.flags.version) {
    process.stdout.write(def.version + "\n");
    process.exit(ExitCode.SUCCESS);
  }

  // --describe: print JSON metadata and exit
  if (args.flags.describe) {
    process.stdout.write(JSON.stringify(generateDescribe(def), null, 2) + "\n");
    process.exit(ExitCode.SUCCESS);
  }

  // Validate required custom options
  if (def.options) {
    for (const opt of def.options) {
      if (opt.required && args.custom[opt.name] === undefined) {
        exitWithError(
          `Missing required option: --${opt.name}\nRun '${def.name} --help' for usage.`,
          ExitCode.INVALID_USAGE,
        );
      }
    }
  }

  // --- Section 3: Load and merge config ---
  const rawConfig = await loadConfig();
  const config = applyEnvOverrides(rawConfig);
  const mergedConfig = mergeConfig(config, def.name);

  // --- Section 4: Resolve and validate environment ---
  const declarations = def.env ?? [];
  const resolvedEnv = resolveEnv(declarations, def.name, config);

  // --setup: run interactive setup and exit
  if (args.flags.setup) {
    await runSetup(def.name, declarations, args.flags["non-interactive"]);
    process.exit(ExitCode.SUCCESS);
  }

  // Validate required env vars
  const missingEnv = validateEnv(declarations, resolvedEnv);
  if (missingEnv.length > 0) {
    exitWithError(formatMissingEnvError(def.name, missingEnv), ExitCode.INVALID_USAGE);
  }

  // Inject resolved env vars into process.env
  injectEnv(resolvedEnv);

  // Read SFA protocol env vars
  const depth = parseInt(process.env.SFA_DEPTH ?? "0", 10);
  const maxDepth = args.flags["max-depth"] ?? parseInt(process.env.SFA_MAX_DEPTH ?? "5", 10);
  const sessionId =
    process.env.SFA_SESSION_ID ?? crypto.randomUUID();
  const callChain = process.env.SFA_CALL_CHAIN
    ? process.env.SFA_CALL_CHAIN.split(",")
    : [];
  const timeout = args.flags.timeout;

  // Set up AbortController for timeout and signal handling
  const ac = new AbortController();

  // Timeout timer
  const timeoutTimer = setTimeout(() => {
    emitProgress(def.name, `timeout after ${timeout}s`);
    ac.abort();
  }, timeout * 1000);

  // Signal handlers
  const onSigint = () => {
    emitProgress(def.name, "interrupted");
    ac.abort();
    // Defer exit to let cleanup happen
    setTimeout(() => process.exit(ExitCode.SIGINT), 100);
  };
  const onSigterm = () => {
    emitProgress(def.name, "terminating");
    ac.abort();
    setTimeout(() => process.exit(ExitCode.SIGTERM), 5000);
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  // Read input context
  let input: string;
  try {
    input = await readInput({
      context: args.flags.context,
      "context-file": args.flags["context-file"],
    });
  } catch (err: unknown) {
    exitWithError((err as Error).message, ExitCode.INVALID_USAGE);
  }

  // Check if context is required but missing
  if (def.contextRequired && !input) {
    exitWithError(
      `This agent requires context input. Provide via stdin, --context, or --context-file.\nRun '${def.name} --help' for usage.`,
      ExitCode.INVALID_USAGE,
    );
  }

  // Progress: starting (with secret masking)
  if (!args.flags.quiet) {
    emitProgress(def.name, "starting");
  }

  // Build the execute context with secret-aware progress
  const progress = (message: string) => {
    if (!args.flags.quiet) {
      emitProgress(def.name, maskSecrets(message, resolvedEnv));
    }
  };

  const ctx: ExecuteContext = {
    input,
    options: { ...args.flags, ...args.custom } as Record<string, string | number | boolean>,
    env: process.env as Record<string, string | undefined>,
    config: mergedConfig,
    signal: ac.signal,
    depth,
    sessionId,
    agentName: def.name,
    agentVersion: def.version,
    progress,
    // Stubbed — full implementations in later sections
    invoke: async () => {
      throw new Error("invoke() not yet available — requires SDK safety & invocation modules");
    },
    writeContext: async () => {
      throw new Error("writeContext() not yet available — requires SDK context store module");
    },
    searchContext: async () => {
      throw new Error("searchContext() not yet available — requires SDK context store module");
    },
  };

  // Execute the agent
  let result: AgentResult;
  try {
    result = await def.execute(ctx);
  } catch (err: unknown) {
    clearTimeout(timeoutTimer);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);

    if (ac.signal.aborted) {
      // Timeout or signal — exit with appropriate code
      process.exit(ExitCode.TIMEOUT);
    }

    if (!args.flags.quiet) {
      emitProgress(def.name, "failed");
    }
    exitWithError((err as Error).message ?? String(err), ExitCode.FAILURE);
  }

  clearTimeout(timeoutTimer);
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);

  // Progress: completed
  if (!args.flags.quiet) {
    const durationMs = Date.now() - startTime;
    emitProgress(def.name, `completed in ${durationMs}ms`);
  }

  // Write result to stdout
  writeResult(result, args.flags["output-format"]);

  process.exit(ExitCode.SUCCESS);
}
