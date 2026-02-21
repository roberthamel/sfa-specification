import { defineAgent } from "../../@sfa/sdk";

export default defineAgent({
  name: "code-reviewer",
  version: "1.0.0",
  description: "Reviews code for common issues and writes findings to the context store",
  trustLevel: "sandboxed",
  contextRequired: true,
  contextRetention: "session",

  options: [
    {
      name: "severity",
      alias: "s",
      description: "Minimum severity to report (info, warning, error)",
      type: "string",
      default: "warning",
    },
  ],

  examples: [
    'cat src/app.ts | bun agent.ts',
    'bun agent.ts --context-file src/app.ts --output-format json',
    'bun agent.ts --context-file src/app.ts --severity info',
  ],

  execute: async (ctx) => {
    ctx.progress("analyzing code");

    const code = ctx.input;
    const minSeverity = ctx.options.severity as string;
    const severityOrder = ["info", "warning", "error"];
    const minIdx = severityOrder.indexOf(minSeverity);

    const findings: Array<{ line: number; severity: string; message: string }> = [];

    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for common issues
      if (/\beval\s*\(/.test(line)) {
        findings.push({ line: lineNum, severity: "error", message: "Use of eval() is a security risk" });
      }
      if (/\bconsole\.(log|debug|info)\b/.test(line)) {
        findings.push({ line: lineNum, severity: "info", message: "Console statement found — remove before production" });
      }
      if (/TODO|FIXME|HACK|XXX/.test(line)) {
        findings.push({ line: lineNum, severity: "warning", message: `Unresolved marker: ${line.trim()}` });
      }
      if (line.length > 120) {
        findings.push({ line: lineNum, severity: "info", message: "Line exceeds 120 characters" });
      }
      if (/\bany\b/.test(line) && /:\s*any\b/.test(line)) {
        findings.push({ line: lineNum, severity: "warning", message: "Explicit 'any' type — consider a more specific type" });
      }
      if (/catch\s*\(\s*\w+\s*\)\s*\{?\s*\}/.test(line)) {
        findings.push({ line: lineNum, severity: "warning", message: "Empty catch block swallows errors" });
      }
    }

    // Filter by severity
    const filtered = findings.filter((f) => severityOrder.indexOf(f.severity) >= minIdx);

    ctx.progress(`found ${filtered.length} issue(s)`);

    // Write findings to context store
    if (filtered.length > 0) {
      const content = filtered
        .map((f) => `- **Line ${f.line}** [${f.severity}]: ${f.message}`)
        .join("\n");

      await ctx.writeContext({
        type: "finding",
        tags: ["code-review", "static-analysis"],
        slug: "review-findings",
        content: `# Code Review Findings\n\n${content}`,
      });
    }

    return {
      result: {
        totalIssues: filtered.length,
        findings: filtered,
      },
    };
  },
});
