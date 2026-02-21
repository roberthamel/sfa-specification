import { defineAgent } from "../../@sfa/sdk";
import type { ExecuteContext, AgentResult } from "../../@sfa/sdk";

/**
 * MCP-enabled code reviewer with three tools:
 * - review: Analyze code for issues (primary tool, also works in CLI mode)
 * - explain: Explain what a piece of code does
 * - suggest: Suggest improvements for a piece of code
 */
export default defineAgent({
  name: "code-reviewer-mcp",
  version: "1.0.0",
  description: "Reviews, explains, and suggests improvements for code — supports MCP server mode",
  trustLevel: "sandboxed",
  contextRetention: "session",
  mcpSupported: true,

  options: [
    {
      name: "severity",
      alias: "s",
      description: "Minimum severity to report (info, warning, error)",
      type: "string",
      default: "warning",
    },
    {
      name: "language",
      alias: "l",
      description: "Source language hint (typescript, python, go, etc.)",
      type: "string",
      default: "typescript",
    },
  ],

  examples: [
    'cat src/app.ts | bun agent.ts',
    'bun agent.ts --context-file src/app.ts --output-format json',
    'bun agent.ts --mcp  # Start as MCP server',
  ],

  tools: [
    {
      name: "explain",
      description: "Explain what a piece of code does in plain language",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "The code to explain" },
          language: { type: "string", description: "Source language" },
          detail: {
            type: "string",
            enum: ["brief", "detailed"],
            description: "Level of detail",
          },
        },
        required: ["code"],
      },
      handler: async (
        input: Record<string, unknown>,
        ctx: ExecuteContext,
      ): Promise<AgentResult> => {
        const code = input.code as string;
        const detail = (input.detail as string) ?? "brief";

        ctx.progress("explaining code");

        // Static analysis-based explanation
        const lines = code.split("\n").filter(Boolean);
        const hasFunction = /\b(function|const\s+\w+\s*=|def\s+|func\s+)/.test(code);
        const hasClass = /\b(class|struct|interface)\s+/.test(code);
        const hasImports = /\b(import|require|from|use)\b/.test(code);
        const hasLoop = /\b(for|while|forEach|map|reduce)\b/.test(code);
        const hasConditional = /\b(if|else|switch|match|case)\b/.test(code);
        const hasAsync = /\b(async|await|Promise|then|catch)\b/.test(code);

        const parts: string[] = [];
        parts.push(`This code is ${lines.length} line(s) long.`);
        if (hasImports) parts.push("It imports external dependencies.");
        if (hasClass) parts.push("It defines a class or interface.");
        if (hasFunction) parts.push("It defines one or more functions.");
        if (hasAsync) parts.push("It uses asynchronous operations.");
        if (hasLoop) parts.push("It contains iteration logic.");
        if (hasConditional) parts.push("It includes conditional branching.");

        if (detail === "detailed") {
          parts.push(`\nStructure: ${lines.length} lines, ${code.length} characters.`);
        }

        return { result: parts.join(" ") };
      },
    },
    {
      name: "suggest",
      description: "Suggest improvements for a piece of code",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "The code to improve" },
          focus: {
            type: "string",
            enum: ["readability", "performance", "security", "all"],
            description: "Area to focus suggestions on",
          },
        },
        required: ["code"],
      },
      handler: async (
        input: Record<string, unknown>,
        ctx: ExecuteContext,
      ): Promise<AgentResult> => {
        const code = input.code as string;
        const focus = (input.focus as string) ?? "all";

        ctx.progress("generating suggestions");

        const suggestions: Array<{ category: string; suggestion: string }> = [];

        // Readability suggestions
        if (focus === "readability" || focus === "all") {
          if (code.split("\n").some((l) => l.length > 120)) {
            suggestions.push({ category: "readability", suggestion: "Break long lines to improve readability" });
          }
          if (!/\/[/*]/.test(code) && code.split("\n").length > 20) {
            suggestions.push({ category: "readability", suggestion: "Add comments to document complex logic" });
          }
        }

        // Performance suggestions
        if (focus === "performance" || focus === "all") {
          if (/\.forEach\(/.test(code)) {
            suggestions.push({ category: "performance", suggestion: "Consider using for...of instead of .forEach() for better performance" });
          }
          if (/JSON\.parse\(JSON\.stringify\(/.test(code)) {
            suggestions.push({ category: "performance", suggestion: "Use structuredClone() instead of JSON round-trip for deep cloning" });
          }
        }

        // Security suggestions
        if (focus === "security" || focus === "all") {
          if (/\beval\s*\(/.test(code)) {
            suggestions.push({ category: "security", suggestion: "Remove eval() — it enables code injection attacks" });
          }
          if (/innerHTML\s*=/.test(code)) {
            suggestions.push({ category: "security", suggestion: "Use textContent instead of innerHTML to prevent XSS" });
          }
          if (/\bhttp:\/\//.test(code)) {
            suggestions.push({ category: "security", suggestion: "Use HTTPS instead of HTTP for external URLs" });
          }
        }

        if (suggestions.length === 0) {
          suggestions.push({ category: "general", suggestion: "No immediate improvements identified" });
        }

        await ctx.writeContext({
          type: "finding",
          tags: ["code-review", "suggestions", focus],
          slug: "improvement-suggestions",
          content: `# Code Improvement Suggestions\n\nFocus: ${focus}\n\n${suggestions
            .map((s) => `- **[${s.category}]** ${s.suggestion}`)
            .join("\n")}`,
        });

        return {
          result: {
            focus,
            suggestions,
            total: suggestions.length,
          },
        };
      },
    },
  ],

  // Primary execute function — used in CLI mode and as the primary MCP tool
  execute: async (ctx) => {
    ctx.progress("analyzing code");

    const code = ctx.input;
    if (!code) {
      return { result: { totalIssues: 0, findings: [] }, warnings: ["No code provided"] };
    }

    const minSeverity = ctx.options.severity as string;
    const severityOrder = ["info", "warning", "error"];
    const minIdx = severityOrder.indexOf(minSeverity);

    const findings: Array<{ line: number; severity: string; message: string }> = [];

    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      if (/\beval\s*\(/.test(line)) {
        findings.push({ line: lineNum, severity: "error", message: "Use of eval() is a security risk" });
      }
      if (/\bconsole\.(log|debug|info)\b/.test(line)) {
        findings.push({ line: lineNum, severity: "info", message: "Console statement found" });
      }
      if (/TODO|FIXME|HACK|XXX/.test(line)) {
        findings.push({ line: lineNum, severity: "warning", message: `Unresolved marker: ${line.trim()}` });
      }
      if (line.length > 120) {
        findings.push({ line: lineNum, severity: "info", message: "Line exceeds 120 characters" });
      }
      if (/:\s*any\b/.test(line)) {
        findings.push({ line: lineNum, severity: "warning", message: "Explicit 'any' type" });
      }
      if (/catch\s*\(\s*\w+\s*\)\s*\{?\s*\}/.test(line)) {
        findings.push({ line: lineNum, severity: "warning", message: "Empty catch block" });
      }
    }

    const filtered = findings.filter((f) => severityOrder.indexOf(f.severity) >= minIdx);

    ctx.progress(`found ${filtered.length} issue(s)`);

    if (filtered.length > 0) {
      await ctx.writeContext({
        type: "finding",
        tags: ["code-review", "static-analysis"],
        slug: "review-findings",
        content: `# Code Review Findings\n\n${filtered
          .map((f) => `- **Line ${f.line}** [${f.severity}]: ${f.message}`)
          .join("\n")}`,
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
