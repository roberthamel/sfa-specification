import { test, expect, describe } from "bun:test";
import { parseArgs } from "../../@sfa/sdk/cli";

describe("parseArgs", () => {
  describe("standard flags", () => {
    test("parses --help as boolean", () => {
      const result = parseArgs(["--help"]);
      expect(result.flags.help).toBe(true);
    });

    test("parses --version as boolean", () => {
      const result = parseArgs(["--version"]);
      expect(result.flags.version).toBe(true);
    });

    test("parses --verbose as boolean", () => {
      const result = parseArgs(["--verbose"]);
      expect(result.flags.verbose).toBe(true);
    });

    test("parses --quiet as boolean", () => {
      const result = parseArgs(["--quiet"]);
      expect(result.flags.quiet).toBe(true);
    });

    test("parses --describe as boolean", () => {
      const result = parseArgs(["--describe"]);
      expect(result.flags.describe).toBe(true);
    });

    test("parses --setup as boolean", () => {
      const result = parseArgs(["--setup"]);
      expect(result.flags.setup).toBe(true);
    });

    test("parses --no-log as boolean", () => {
      const result = parseArgs(["--no-log"]);
      expect(result.flags["no-log"]).toBe(true);
    });

    test("parses --services-down as boolean", () => {
      const result = parseArgs(["--services-down"]);
      expect(result.flags["services-down"]).toBe(true);
    });

    test("parses --yes as boolean", () => {
      const result = parseArgs(["--yes"]);
      expect(result.flags.yes).toBe(true);
    });

    test("parses --non-interactive as boolean", () => {
      const result = parseArgs(["--non-interactive"]);
      expect(result.flags["non-interactive"]).toBe(true);
    });

    test("parses --mcp as boolean", () => {
      const result = parseArgs(["--mcp"]);
      expect(result.flags.mcp).toBe(true);
    });

    test("parses --output-format with space-separated value", () => {
      const result = parseArgs(["--output-format", "json"]);
      expect(result.flags["output-format"]).toBe("json");
    });

    test("parses --output-format with = value", () => {
      const result = parseArgs(["--output-format=json"]);
      expect(result.flags["output-format"]).toBe("json");
    });

    test("parses --timeout as number", () => {
      const result = parseArgs(["--timeout", "60"]);
      expect(result.flags.timeout).toBe(60);
    });

    test("parses --timeout with = value", () => {
      const result = parseArgs(["--timeout=30"]);
      expect(result.flags.timeout).toBe(30);
    });

    test("parses --max-depth as number", () => {
      const result = parseArgs(["--max-depth", "3"]);
      expect(result.flags["max-depth"]).toBe(3);
    });

    test("parses --context as string", () => {
      const result = parseArgs(["--context", "some input"]);
      expect(result.flags.context).toBe("some input");
    });

    test("parses --context-file as string", () => {
      const result = parseArgs(["--context-file", "/tmp/input.txt"]);
      expect(result.flags["context-file"]).toBe("/tmp/input.txt");
    });
  });

  describe("defaults", () => {
    test("boolean flags default to false", () => {
      const result = parseArgs([]);
      expect(result.flags.help).toBe(false);
      expect(result.flags.version).toBe(false);
      expect(result.flags.verbose).toBe(false);
      expect(result.flags.quiet).toBe(false);
      expect(result.flags.describe).toBe(false);
      expect(result.flags.setup).toBe(false);
      expect(result.flags["no-log"]).toBe(false);
      expect(result.flags["services-down"]).toBe(false);
      expect(result.flags.yes).toBe(false);
      expect(result.flags["non-interactive"]).toBe(false);
      expect(result.flags.mcp).toBe(false);
    });

    test("output-format defaults to text", () => {
      const result = parseArgs([]);
      expect(result.flags["output-format"]).toBe("text");
    });

    test("timeout defaults to 120", () => {
      const result = parseArgs([]);
      expect(result.flags.timeout).toBe(120);
    });

    test("max-depth defaults to 5", () => {
      const result = parseArgs([]);
      expect(result.flags["max-depth"]).toBe(5);
    });

    test("context and context-file default to undefined", () => {
      const result = parseArgs([]);
      expect(result.flags.context).toBeUndefined();
      expect(result.flags["context-file"]).toBeUndefined();
    });
  });

  describe("custom options", () => {
    test("parses custom string option", () => {
      const result = parseArgs(["--model", "gpt-4"], [
        { name: "model", description: "Model to use", type: "string" },
      ]);
      expect(result.custom.model).toBe("gpt-4");
    });

    test("parses custom number option", () => {
      const result = parseArgs(["--max-files", "10"], [
        { name: "max-files", description: "Max files", type: "number" },
      ]);
      expect(result.custom["max-files"]).toBe(10);
    });

    test("parses custom boolean option", () => {
      const result = parseArgs(["--dry-run"], [
        { name: "dry-run", description: "Dry run", type: "boolean" },
      ]);
      expect(result.custom["dry-run"]).toBe(true);
    });

    test("parses custom option with alias", () => {
      const result = parseArgs(["-m", "gpt-4"], [
        { name: "model", alias: "m", description: "Model to use", type: "string" },
      ]);
      expect(result.custom.model).toBe("gpt-4");
    });

    test("parses custom boolean option with alias", () => {
      const result = parseArgs(["-d"], [
        { name: "dry-run", alias: "d", description: "Dry run", type: "boolean" },
      ]);
      expect(result.custom["dry-run"]).toBe(true);
    });

    test("applies custom option defaults", () => {
      const result = parseArgs([], [
        { name: "model", description: "Model to use", type: "string", default: "gpt-3.5" },
      ]);
      expect(result.custom.model).toBe("gpt-3.5");
    });

    test("custom boolean option defaults to false", () => {
      const result = parseArgs([], [
        { name: "dry-run", description: "Dry run", type: "boolean" },
      ]);
      expect(result.custom["dry-run"]).toBe(false);
    });

    test("custom option with = syntax", () => {
      const result = parseArgs(["--model=claude"], [
        { name: "model", description: "Model to use", type: "string" },
      ]);
      expect(result.custom.model).toBe("claude");
    });
  });

  describe("positional arguments", () => {
    test("collects positional arguments", () => {
      const result = parseArgs(["file1.txt", "file2.txt"]);
      expect(result.positional).toEqual(["file1.txt", "file2.txt"]);
    });

    test("separates flags from positionals", () => {
      const result = parseArgs(["--verbose", "file.txt"]);
      expect(result.flags.verbose).toBe(true);
      expect(result.positional).toEqual(["file.txt"]);
    });

    test("-- stops flag parsing", () => {
      const result = parseArgs(["--verbose", "--", "--not-a-flag", "file.txt"]);
      expect(result.flags.verbose).toBe(true);
      expect(result.positional).toEqual(["--not-a-flag", "file.txt"]);
    });
  });

  describe("unknown flags", () => {
    test("collects unknown flags", () => {
      const result = parseArgs(["--unknown-flag"]);
      expect(result.unknown).toEqual(["--unknown-flag"]);
    });

    test("collects unknown short flags", () => {
      const result = parseArgs(["-x"]);
      expect(result.unknown).toEqual(["-x"]);
    });

    test("collects flag missing value as unknown", () => {
      const result = parseArgs(["--timeout"]);
      expect(result.unknown).toEqual(["--timeout"]);
    });
  });

  describe("edge cases", () => {
    test("empty argv returns defaults", () => {
      const result = parseArgs([]);
      expect(result.positional).toEqual([]);
      expect(result.unknown).toEqual([]);
    });

    test("multiple flags combined", () => {
      const result = parseArgs(["--verbose", "--quiet", "--timeout", "30", "--output-format", "json"]);
      expect(result.flags.verbose).toBe(true);
      expect(result.flags.quiet).toBe(true);
      expect(result.flags.timeout).toBe(30);
      expect(result.flags["output-format"]).toBe("json");
    });

    test("mixes standard and custom flags", () => {
      const result = parseArgs(["--verbose", "--model", "gpt-4", "input.txt"], [
        { name: "model", description: "Model", type: "string" },
      ]);
      expect(result.flags.verbose).toBe(true);
      expect(result.custom.model).toBe("gpt-4");
      expect(result.positional).toEqual(["input.txt"]);
    });
  });
});
