# Getting Started

Create your first single-file agent in 5 minutes.

## Prerequisites

- [Bun](https://bun.sh) v1.0 or later
- A terminal

## 1. Scaffold a new agent

Using the `sfa` CLI:

```bash
sfa init my-agent
cd my-agent
```

This creates:

```
my-agent/
  @sfa/sdk/    # Vendored SDK (don't modify)
  agent.ts     # Your agent code
  README.md
```

Or manually — create a directory and copy the `@sfa/sdk/` directory from an existing project:

```bash
mkdir my-agent && cd my-agent
cp -r /path/to/@sfa/sdk .
```

## 2. Write your agent

Create `agent.ts`:

```typescript
import { defineAgent } from "./@sfa/sdk";

export default defineAgent({
  name: "my-agent",
  version: "1.0.0",
  description: "Greets the caller by name",

  execute: async (ctx) => {
    const name = ctx.input.trim() || "world";
    return { result: `Hello, ${name}!` };
  },
});
```

That's it. The SDK handles CLI parsing, help generation, logging, and output formatting.

## 3. Run it

```bash
# Pass input via --context
bun agent.ts --context "Alice"
# Output: Hello, Alice!

# Or pipe via stdin
echo "Bob" | bun agent.ts
# Output: Hello, Bob!

# Built-in flags work automatically
bun agent.ts --help
bun agent.ts --version
bun agent.ts --describe    # Machine-readable JSON metadata
```

## 4. Add features incrementally

### Custom options

```typescript
export default defineAgent({
  name: "my-agent",
  version: "1.0.0",
  description: "Greets the caller",
  options: [
    { name: "greeting", alias: "g", type: "string", default: "Hello", description: "Custom greeting" },
    { name: "shout", type: "boolean", description: "Uppercase the output" },
  ],
  execute: async (ctx) => {
    const greeting = ctx.options.greeting as string;
    const name = ctx.input.trim() || "world";
    let result = `${greeting}, ${name}!`;
    if (ctx.options.shout) result = result.toUpperCase();
    return { result };
  },
});
```

```bash
bun agent.ts --greeting Hi --shout --context "world"
# Output: HI, WORLD!
```

### Environment variables

```typescript
export default defineAgent({
  name: "my-agent",
  version: "1.0.0",
  description: "Fetches data from an API",
  env: [
    { name: "API_KEY", required: true, secret: true, description: "API key for the service" },
  ],
  execute: async (ctx) => {
    const apiKey = ctx.env.API_KEY;
    // Use the key...
    return { result: "done" };
  },
});
```

```bash
# First-time setup — prompts for missing env vars
bun agent.ts --setup

# Then run normally
bun agent.ts --context "query"
```

### JSON output

```bash
bun agent.ts --output-format json --context "Alice"
# Output: {"result":"Hello, Alice!"}
```

## 5. Compile to a standalone binary

```bash
bun build --compile agent.ts --outfile my-agent
./my-agent --context "Alice"
```

The compiled binary includes the SDK, your agent code, and the Bun runtime. No dependencies needed to run it.

## Next steps

- [SDK API Reference](./sdk-api-reference.md) — all functions, types, and options
- [Services Guide](./services.md) — add database and infrastructure dependencies
- [MCP Guide](./mcp.md) — expose your agent as an MCP server
- [Compilation Guide](./compilation.md) — build standalone executables
- [Discovery Guide](./discovery.md) — make your agent findable
