import type { InvokeOptions, InvokeResult } from "./types";
import type { SafetyState } from "./safety";
import { checkDepthLimit, checkLoop, buildSubagentSafetyEnv } from "./safety";
import { buildSubagentEnv } from "./env";

/**
 * Active child processes tracked for cleanup on parent termination.
 */
const activeChildren = new Set<import("bun").Subprocess>();

/**
 * Install a signal handler that propagates SIGTERM to all active child processes.
 * Called once when the first invoke() happens.
 */
let cleanupInstalled = false;

function installCleanupHandler(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;

  const cleanup = () => {
    for (const child of activeChildren) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may have already exited
      }
    }
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.on("exit", cleanup);
}

/**
 * Invoke a subagent by name.
 *
 * Spawns a subprocess with Bun.spawn, propagates SFA_* env vars (with
 * incremented depth and updated call chain), captures stdout/stderr,
 * and enforces timeout.
 *
 * @param agentName - The agent to invoke (must be in PATH or a relative/absolute path)
 * @param safety - Current safety state (depth, call chain, session)
 * @param parentTimeoutMs - Remaining parent timeout in ms (for default subagent timeout)
 * @param signal - Parent AbortSignal for cancellation propagation
 * @param options - Context, args, and timeout override
 */
export async function invoke(
  agentName: string,
  safety: SafetyState,
  parentTimeoutMs: number | undefined,
  signal: AbortSignal,
  options: InvokeOptions = {},
): Promise<InvokeResult> {
  // 8.5: Depth limit check before spawning
  checkDepthLimit(safety);

  // 8.6: Loop detection check before spawning
  checkLoop(safety, agentName);

  // 8.7: Install cleanup handler for child process management
  installCleanupHandler();

  // 8.2: Build environment for the subagent
  // Start with filtered env (SFA_* + system vars only)
  const baseEnv = buildSubagentEnv();
  // Override with incremented safety env vars
  const safetyEnv = buildSubagentSafetyEnv(safety);
  const env = { ...baseEnv, ...safetyEnv };

  // Build the command
  const cmd = [agentName, ...(options.args ?? [])];

  // 8.4: Determine timeout — explicit option, or remaining parent timeout
  const timeoutMs = options.timeout
    ? options.timeout * 1000
    : parentTimeoutMs;

  // Spawn the subprocess
  const proc = Bun.spawn(cmd, {
    env: env as Record<string, string>,
    stdin: options.context ? new Blob([options.context]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Track the child for cleanup
  activeChildren.add(proc);

  // 8.4: Set up timeout enforcement
  let timedOut = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // Already exited
      }
      // Force kill after 5s grace period
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already exited
        }
      }, 5000);
    }, timeoutMs);
  }

  // 8.7: Propagate parent abort signal to child
  const onAbort = () => {
    try {
      proc.kill("SIGTERM");
    } catch {
      // Already exited
    }
  };
  if (!signal.aborted) {
    signal.addEventListener("abort", onAbort, { once: true });
  } else {
    // Already aborted
    try {
      proc.kill("SIGTERM");
    } catch {
      // Already exited
    }
  }

  // 8.3: Capture stdout and stderr
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  // Wait for the process to complete
  const exitCode = await proc.exited;

  // Cleanup
  if (timeoutTimer !== undefined) {
    clearTimeout(timeoutTimer);
  }
  signal.removeEventListener("abort", onAbort);
  activeChildren.delete(proc);

  return {
    ok: exitCode === 0,
    exitCode: timedOut ? 3 : exitCode,
    output: stdout,
    stderr,
  };
}
