import { ExitCode } from "./types";
import { exitWithError, emitProgress } from "./output";

/**
 * Safety state for the current agent invocation.
 * Read from environment on startup, used for enforcement.
 */
export interface SafetyState {
  /** Current invocation depth */
  depth: number;
  /** Maximum allowed depth */
  maxDepth: number;
  /** Call chain (agent names) up to and including this agent */
  callChain: string[];
  /** Session ID for this invocation tree */
  sessionId: string;
}

/**
 * Initialize safety state from environment and CLI flags.
 * Reads SFA_DEPTH, SFA_MAX_DEPTH, SFA_CALL_CHAIN, SFA_SESSION_ID.
 * Generates a new session ID if this is a top-level invocation.
 */
export function initSafety(
  agentName: string,
  maxDepthFlag?: number,
): SafetyState {
  const depth = parseInt(process.env.SFA_DEPTH ?? "0", 10);
  const maxDepth =
    maxDepthFlag ??
    parseInt(process.env.SFA_MAX_DEPTH ?? "5", 10);
  const parentChain = process.env.SFA_CALL_CHAIN
    ? process.env.SFA_CALL_CHAIN.split(",")
    : [];
  const sessionId = process.env.SFA_SESSION_ID ?? crypto.randomUUID();

  // Check for loop: if this agent already appears in the call chain, refuse
  if (parentChain.includes(agentName)) {
    const loopPath = [...parentChain, agentName].join(" → ");
    exitWithError(
      `Loop detected: ${loopPath}\nAgent "${agentName}" already appears in the call chain.`,
      ExitCode.FAILURE,
    );
  }

  // Append this agent to the call chain
  const callChain = [...parentChain, agentName];

  // Propagate to process.env so child processes and subsystems can read them
  process.env.SFA_DEPTH = String(depth);
  process.env.SFA_MAX_DEPTH = String(maxDepth);
  process.env.SFA_CALL_CHAIN = callChain.join(",");
  process.env.SFA_SESSION_ID = sessionId;

  return { depth, maxDepth, callChain, sessionId };
}

/**
 * Check whether spawning a subagent is allowed at the current depth.
 * Throws if at or above max depth.
 */
export function checkDepthLimit(safety: SafetyState): void {
  if (safety.depth + 1 >= safety.maxDepth) {
    throw new Error(
      `Maximum invocation depth reached (${safety.maxDepth}). ` +
      `Cannot spawn subagent at depth ${safety.depth + 1}.`,
    );
  }
}

/**
 * Check whether spawning a named subagent would create a loop.
 * Throws if the agent name already appears in the call chain.
 */
export function checkLoop(safety: SafetyState, targetAgent: string): void {
  if (safety.callChain.includes(targetAgent)) {
    const loopPath = [...safety.callChain, targetAgent].join(" → ");
    throw new Error(`Loop detected: ${loopPath}`);
  }
}

/**
 * Build SFA_* environment variables for a subagent invocation.
 * Increments depth, appends to call chain, forwards session ID.
 */
export function buildSubagentSafetyEnv(safety: SafetyState): Record<string, string> {
  return {
    SFA_DEPTH: String(safety.depth + 1),
    SFA_MAX_DEPTH: String(safety.maxDepth),
    SFA_CALL_CHAIN: safety.callChain.join(","),
    SFA_SESSION_ID: safety.sessionId,
  };
}

/**
 * Set up timeout with an AbortController.
 * Returns the controller and a cleanup function.
 */
export function setupTimeout(
  agentName: string,
  timeoutSeconds: number,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    emitProgress(agentName, `timeout after ${timeoutSeconds}s`);
    controller.abort();
  }, timeoutSeconds * 1000);

  return {
    controller,
    cleanup: () => clearTimeout(timer),
  };
}

/**
 * Set up signal handlers (SIGINT, SIGTERM).
 * Returns a cleanup function to remove them.
 */
export function setupSignalHandlers(
  agentName: string,
  controller: AbortController,
): { cleanup: () => void } {
  const onSigint = () => {
    emitProgress(agentName, "interrupted");
    controller.abort();
    setTimeout(() => process.exit(ExitCode.SIGINT), 100);
  };

  const onSigterm = () => {
    emitProgress(agentName, "terminating");
    controller.abort();
    setTimeout(() => process.exit(ExitCode.SIGTERM), 5000);
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return {
    cleanup: () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    },
  };
}
