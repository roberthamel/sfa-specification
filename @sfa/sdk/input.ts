/**
 * Read input context from stdin (if piped), --context, or --context-file.
 * Priority: --context-file > --context > stdin
 */
export async function readInput(flags: {
  context?: string;
  "context-file"?: string;
}): Promise<string> {
  // --context-file takes priority
  if (flags["context-file"]) {
    const file = Bun.file(flags["context-file"]);
    if (!(await file.exists())) {
      throw new Error(`Context file not found: ${flags["context-file"]}`);
    }
    return await file.text();
  }

  // --context string argument
  if (flags.context) {
    return flags.context;
  }

  // Check if stdin has data (piped input)
  if (!process.stdin.isTTY) {
    return await readStdin();
  }

  // No input context
  return "";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
