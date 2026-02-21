import { join, dirname, basename } from "node:path";
import { mkdirSync, statSync, renameSync, readdirSync, unlinkSync, openSync, writeSync, closeSync, constants } from "node:fs";
import { homedir } from "node:os";
import type { SfaConfig } from "./config";

const DEFAULT_LOG_DIR = join(homedir(), ".local", "share", "single-file-agents", "logs");
const DEFAULT_LOG_FILE = join(DEFAULT_LOG_DIR, "executions.jsonl");
const DEFAULT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const DEFAULT_RETAIN_COUNT = 5;

/**
 * JSONL log entry schema.
 */
export interface LogEntry {
  timestamp: string;
  agent: string;
  version: string;
  exitCode: number;
  durationMs: number;
  depth: number;
  callChain: string[];
  inputSummary: string;
  outputSummary: string;
  sessionId: string;
  meta?: Record<string, unknown>;
}

/**
 * Logging configuration resolved from env/config/defaults.
 */
export interface LoggingConfig {
  /** Resolved log file path */
  filePath: string;
  /** Whether logging is suppressed */
  suppressed: boolean;
  /** Max file size in bytes before rotation */
  maxSizeBytes: number;
  /** Number of rotated files to retain */
  retainCount: number;
}

/**
 * Resolve logging configuration from environment, config, and defaults.
 * Priority: SFA_LOG_FILE env → config logging.file → default path
 */
export function resolveLoggingConfig(config: SfaConfig, noLogFlag: boolean): LoggingConfig {
  const suppressed = noLogFlag || process.env.SFA_NO_LOG === "1";

  const filePath =
    process.env.SFA_LOG_FILE ??
    config.logging?.file ??
    DEFAULT_LOG_FILE;

  const maxSizeBytes = config.logging?.maxSize
    ? config.logging.maxSize * 1024 * 1024
    : DEFAULT_MAX_SIZE_BYTES;

  const retainCount = config.logging?.retainFiles ?? DEFAULT_RETAIN_COUNT;

  return { filePath, suppressed, maxSizeBytes, retainCount };
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Create a log entry from execution data.
 */
export function createLogEntry(params: {
  agent: string;
  version: string;
  exitCode: number;
  startTime: number;
  depth: number;
  callChain: string[];
  sessionId: string;
  input: string;
  output: string;
  meta?: Record<string, unknown>;
}): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    agent: params.agent,
    version: params.version,
    exitCode: params.exitCode,
    durationMs: Date.now() - params.startTime,
    depth: params.depth,
    callChain: params.callChain,
    inputSummary: truncate(params.input, 500),
    outputSummary: truncate(params.output, 500),
    sessionId: params.sessionId,
    ...(params.meta ? { meta: params.meta } : {}),
  };
}

/**
 * Ensure the log directory exists.
 */
function ensureLogDir(filePath: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

/**
 * Check if the log file needs rotation and rotate if so.
 */
function rotateIfNeeded(config: LoggingConfig): void {
  try {
    const stat = statSync(config.filePath);
    if (stat.size < config.maxSizeBytes) return;
  } catch {
    // File doesn't exist yet, no rotation needed
    return;
  }

  // Rotate: rename current file with timestamp suffix
  const now = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const dir = dirname(config.filePath);
  const base = basename(config.filePath, ".jsonl");
  const rotatedName = `${base}-${now}.jsonl`;
  const rotatedPath = join(dir, rotatedName);

  try {
    renameSync(config.filePath, rotatedPath);
  } catch {
    // If rename fails, skip rotation
    return;
  }

  // Clean up old rotated files
  cleanupRotatedFiles(dir, base, config.retainCount);
}

/**
 * Remove rotated log files beyond the retain count.
 */
function cleanupRotatedFiles(dir: string, basePrefix: string, retainCount: number): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(basePrefix + "-") && f.endsWith(".jsonl"))
      .sort()
      .reverse();

    // Keep the most recent `retainCount` files, delete the rest
    for (let i = retainCount; i < files.length; i++) {
      try {
        unlinkSync(join(dir, files[i]));
      } catch {
        // Best effort
      }
    }
  } catch {
    // Best effort
  }
}

/**
 * Write a log entry to the JSONL file using O_APPEND for atomic writes.
 * This is best-effort: failures emit a warning to stderr but never affect exit code.
 */
export function writeLogEntry(entry: LogEntry, config: LoggingConfig): void {
  if (config.suppressed) return;

  try {
    ensureLogDir(config.filePath);
    rotateIfNeeded(config);

    const line = JSON.stringify(entry) + "\n";
    const fd = openSync(config.filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND);
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
  } catch (err: unknown) {
    // Non-blocking: warn on stderr, never fail
    process.stderr.write(
      `[sfa] warning: failed to write execution log: ${(err as Error).message}\n`,
    );
  }
}
