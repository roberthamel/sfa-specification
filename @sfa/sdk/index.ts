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
export { initSafety, checkDepthLimit, checkLoop, buildSubagentSafetyEnv } from "./safety";
export { resolveLoggingConfig, createLogEntry, writeLogEntry } from "./logging";
export type { LogEntry, LoggingConfig } from "./logging";
export { resolveContextStorePath, writeContext, searchContext, updateContext, addContextLink } from "./context";
export { invoke } from "./invoke";
export { startServices, stopServices, composeDown, handleServicesDown, checkDockerAvailability } from "./services";
export { serveMcp } from "./mcp";

import type { AgentDefinition, AgentResult, ExecuteContext } from "./types";
import type { WriteContextInput, SearchContextInput } from "./types";
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
} from "./env";
import { initSafety, setupTimeout, setupSignalHandlers } from "./safety";
import { resolveLoggingConfig, createLogEntry, writeLogEntry } from "./logging";
import {
  resolveContextStorePath,
  writeContext as writeContextImpl,
  searchContext as searchContextImpl,
} from "./context";
import { invoke as invokeSubagent } from "./invoke";
import { startServices, stopServices, handleServicesDown } from "./services";
import { serveMcp } from "./mcp";

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
  // Auto-declare SFA_SVC_* env vars for each service so they flow through
  // config resolution and --setup. This lets users override service connection
  // info per-agent (e.g. point at a remote database instead of local Docker).
  const serviceEnvDeclarations: import("./types").EnvDeclaration[] = [];
  if (def.services) {
    for (const svcName of Object.keys(def.services)) {
      const envPrefix = `SFA_SVC_${svcName.toUpperCase().replace(/-/g, "_")}`;
      serviceEnvDeclarations.push(
        { name: `${envPrefix}_URL`, description: `Connection URL for ${svcName} service` },
        { name: `${envPrefix}_HOST`, description: `Host for ${svcName} service` },
        { name: `${envPrefix}_PORT`, description: `Port for ${svcName} service` },
      );
    }
  }
  const declarations = [...(def.env ?? []), ...serviceEnvDeclarations];
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

  // --- Section 9: Handle --services-down flag ---
  if (args.flags["services-down"]) {
    await handleServicesDown(def.name);
  }

  // --- Section 10: MCP mode ---
  if (args.flags.mcp) {
    // 10.11: Opt-in/opt-out check
    if (def.mcpSupported === false) {
      exitWithError("MCP mode is not supported by this agent.", ExitCode.INVALID_USAGE);
    }

    const safety = initSafety(def.name, args.flags["max-depth"]);
    const loggingConfig = resolveLoggingConfig(config, args.flags["no-log"]);
    const contextStorePath = resolveContextStorePath(config);

    // 10.1: Switch to MCP server mode — does not return
    await serveMcp({
      def,
      safety,
      loggingConfig,
      contextStorePath,
      resolvedEnv,
      mergedConfig,
      quiet: args.flags.quiet,
      timeoutSeconds: args.flags.timeout,
    });
  }

  // --- Section 5: Safety & Guardrails ---
  const safety = initSafety(def.name, args.flags["max-depth"]);
  const { controller: ac, cleanup: cleanupTimeout } = setupTimeout(def.name, args.flags.timeout);
  const { cleanup: cleanupSignals } = setupSignalHandlers(def.name, ac);

  // --- Section 6: Resolve logging config ---
  const loggingConfig = resolveLoggingConfig(config, args.flags["no-log"]);

  // --- Section 7: Resolve context store path ---
  const contextStorePath = resolveContextStorePath(config);

  // Track context files written during this invocation (for log cross-reference)
  const contextFilesWritten: string[] = [];

  // --- Section 9: Start services if declared ---
  if (def.services && Object.keys(def.services).length > 0) {
    await startServices(def, process.env as Record<string, string | undefined>);
  }

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
    depth: safety.depth,
    sessionId: safety.sessionId,
    agentName: def.name,
    agentVersion: def.version,
    progress,
    invoke: async (targetAgent: string, invokeOpts?: import("./types").InvokeOptions) => {
      // Calculate remaining timeout for subagent
      const elapsed = Date.now() - startTime;
      const totalTimeoutMs = args.flags.timeout * 1000;
      const remainingMs = totalTimeoutMs - elapsed;
      return invokeSubagent(targetAgent, safety, remainingMs > 0 ? remainingMs : undefined, ac.signal, invokeOpts);
    },
    writeContext: async (entry: WriteContextInput): Promise<string> => {
      const filePath = writeContextImpl(entry, def.name, safety.sessionId, contextStorePath);
      contextFilesWritten.push(filePath);
      return filePath;
    },
    searchContext: async (query: SearchContextInput): Promise<import("./types").ContextEntry[]> => {
      return searchContextImpl(query, contextStorePath);
    },
  };

  // Execute the agent
  let result: AgentResult;
  let exitCode: number = ExitCode.SUCCESS;
  try {
    result = await def.execute(ctx);
  } catch (err: unknown) {
    cleanupTimeout();
    cleanupSignals();

    // Tear down ephemeral services on failure
    if (def.services && Object.keys(def.services).length > 0) {
      await stopServices(def.name, def.serviceLifecycle, def.services);
    }

    if (ac.signal.aborted) {
      exitCode = ExitCode.TIMEOUT;
      // Log the timeout
      const entry = createLogEntry({
        agent: def.name,
        version: def.version,
        exitCode,
        startTime,
        depth: safety.depth,
        callChain: safety.callChain,
        sessionId: safety.sessionId,
        input,
        output: "Execution timed out",
        meta: contextFilesWritten.length > 0 ? { contextFiles: contextFilesWritten } : undefined,
      });
      writeLogEntry(entry, loggingConfig);
      process.exit(exitCode);
    }

    exitCode = ExitCode.FAILURE;
    if (!args.flags.quiet) {
      emitProgress(def.name, "failed");
    }

    // Log the failure
    const entry = createLogEntry({
      agent: def.name,
      version: def.version,
      exitCode,
      startTime,
      depth: safety.depth,
      callChain: safety.callChain,
      sessionId: safety.sessionId,
      input,
      output: (err as Error).message ?? String(err),
      meta: contextFilesWritten.length > 0 ? { contextFiles: contextFilesWritten } : undefined,
    });
    writeLogEntry(entry, loggingConfig);

    exitWithError((err as Error).message ?? String(err), exitCode);
  }

  cleanupTimeout();
  cleanupSignals();

  // Tear down ephemeral services on success
  if (def.services && Object.keys(def.services).length > 0) {
    await stopServices(def.name, def.serviceLifecycle, def.services);
  }

  // Progress: completed
  if (!args.flags.quiet) {
    const durationMs = Date.now() - startTime;
    emitProgress(def.name, `completed in ${durationMs}ms`);
  }

  // Determine output summary for logging
  const outputStr = typeof result.result === "string" ? result.result : JSON.stringify(result.result);

  // Write execution log entry
  const logEntry = createLogEntry({
    agent: def.name,
    version: def.version,
    exitCode,
    startTime,
    depth: safety.depth,
    callChain: safety.callChain,
    sessionId: safety.sessionId,
    input,
    output: outputStr,
    meta: contextFilesWritten.length > 0 ? { contextFiles: contextFilesWritten } : undefined,
  });
  writeLogEntry(logEntry, loggingConfig);

  // Write result to stdout
  writeResult(result, args.flags["output-format"]);

  process.exit(ExitCode.SUCCESS);
}
