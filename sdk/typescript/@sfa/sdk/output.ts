import type { AgentResult, OutputFormat } from "./types";
import { ExitCode } from "./types";

/**
 * Write the agent result to stdout in the specified format.
 * Diagnostics always go to stderr.
 */
export function writeResult(result: AgentResult, format: OutputFormat): void {
  if (format === "json") {
    const output: Record<string, unknown> = { result: result.result };
    if (result.metadata) output.metadata = result.metadata;
    if (result.warnings && result.warnings.length > 0) output.warnings = result.warnings;
    if (result.error) output.error = result.error;
    process.stdout.write(JSON.stringify(output) + "\n");
  } else {
    // Text mode: write result as string
    const text = typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2);
    process.stdout.write(text + "\n");
  }
}

/**
 * Write a diagnostic/error message to stderr.
 */
export function writeDiagnostic(message: string): void {
  process.stderr.write(message + "\n");
}

/**
 * Write an error and exit with the appropriate code.
 */
export function exitWithError(message: string, code: number = ExitCode.FAILURE): never {
  writeDiagnostic(`error: ${message}`);
  process.exit(code);
}

/**
 * Emit a progress message to stderr in the standard format.
 */
export function emitProgress(agentName: string, message: string): void {
  process.stderr.write(`[agent:${agentName}] ${message}\n`);
}
