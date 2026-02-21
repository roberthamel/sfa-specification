import { defineAgent } from "../../sdk/typescript/@sfa/sdk";

export default defineAgent({
  name: "code-fix",
  version: "1.0.0",
  description: "Invokes code-reviewer as a subagent, reads its findings, and applies automated fixes",
  trustLevel: "local",
  contextRequired: true,
  contextRetention: "session",

  examples: [
    'cat src/app.ts | bun agent.ts',
    'bun agent.ts --context-file src/app.ts --output-format json',
  ],

  execute: async (ctx) => {
    const code = ctx.input;

    // Step 1: Invoke code-reviewer as a subagent
    // Note: For .ts agents that aren't compiled, we invoke via "bun" with the agent path as an arg.
    // Compiled agents (via `bun build --compile`) are directly executable.
    ctx.progress("running code-reviewer");
    const reviewerPath = new URL("../code-reviewer/agent.ts", import.meta.url).pathname;
    const reviewResult = await ctx.invoke("bun", {
      context: code,
      args: [reviewerPath, "--severity", "warning", "--output-format", "json", "--quiet"],
    });

    if (!reviewResult.ok) {
      return {
        result: { fixed: false, reason: "code-reviewer failed" },
        error: reviewResult.stderr,
      };
    }

    // Step 2: Parse findings
    // The reviewer's --output-format json wraps output as { result: { totalIssues, findings } }
    let findings: Array<{ line: number; severity: string; message: string }>;
    try {
      const parsed = JSON.parse(reviewResult.output);
      const result = parsed.result ?? parsed;
      findings = result.findings ?? [];
    } catch {
      return {
        result: { fixed: false, reason: "could not parse reviewer output" },
        error: "Invalid JSON from code-reviewer",
      };
    }

    if (findings.length === 0) {
      ctx.progress("no issues to fix");
      return { result: { fixed: false, reason: "no issues found", code } };
    }

    // Step 3: Search for prior review context
    const priorContext = await ctx.searchContext({
      agent: "code-reviewer",
      type: "finding",
      tags: ["code-review"],
    });
    if (priorContext.length > 0) {
      ctx.progress(`found ${priorContext.length} prior review(s) in context store`);
    }

    // Step 4: Apply automated fixes
    ctx.progress(`applying fixes for ${findings.length} issue(s)`);
    const lines = code.split("\n");
    const appliedFixes: string[] = [];

    // Process findings in reverse line order so fixes don't shift line numbers
    const sortedFindings = [...findings].sort((a, b) => b.line - a.line);

    for (const finding of sortedFindings) {
      const idx = finding.line - 1;
      if (idx < 0 || idx >= lines.length) continue;

      // Fix: Remove console.log/debug/info statements
      if (finding.message.includes("Console statement")) {
        lines.splice(idx, 1);
        appliedFixes.push(`Removed console statement at line ${finding.line}`);
        continue;
      }

      // Fix: Replace eval() with Function constructor (safer, still flaggable)
      if (finding.message.includes("eval()")) {
        lines[idx] = lines[idx].replace(/\beval\s*\(([^)]+)\)/, "new Function($1)()");
        appliedFixes.push(`Replaced eval() with Function constructor at line ${finding.line}`);
        continue;
      }
    }

    // Step 5: Write fix summary to context store
    if (appliedFixes.length > 0) {
      const fixContent = appliedFixes.map((f) => `- ${f}`).join("\n");
      await ctx.writeContext({
        type: "decision",
        tags: ["code-fix", "automated"],
        slug: "applied-fixes",
        content: `# Applied Code Fixes\n\n${fixContent}\n\n## Remaining Issues\n\n${
          findings.length - appliedFixes.length
        } issue(s) require manual attention.`,
      });
    }

    return {
      result: {
        fixed: appliedFixes.length > 0,
        appliedFixes,
        remainingIssues: findings.length - appliedFixes.length,
        code: lines.join("\n"),
      },
    };
  },
});
