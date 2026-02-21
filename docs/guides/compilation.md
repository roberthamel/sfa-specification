# Compilation Guide

Build standalone executables from your agents using `bun build --compile`.

## Why compile?

- **Zero dependencies**: The binary includes Bun, the SDK, and your agent code
- **Easy distribution**: Ship a single file
- **PATH installation**: Place the binary anywhere on PATH
- **Cross-platform**: Compile for Linux, macOS, and Windows

## Basic compilation

```bash
bun build --compile agent.ts --outfile my-agent
```

This produces a standalone executable:

```bash
./my-agent --help
./my-agent --context "hello"
echo "input" | ./my-agent --output-format json
```

## Cross-platform compilation

Bun supports cross-compilation with the `--target` flag:

```bash
# Linux x64
bun build --compile agent.ts --outfile my-agent-linux --target=bun-linux-x64

# macOS ARM (Apple Silicon)
bun build --compile agent.ts --outfile my-agent-macos --target=bun-darwin-arm64

# Windows x64
bun build --compile agent.ts --outfile my-agent.exe --target=bun-windows-x64
```

## Agents with services

Compiled agents that declare docker compose services work seamlessly. The compose template is embedded as a string in the binary and extracted to `~/.local/share/single-file-agents/services/<agent-name>/` at runtime.

```bash
bun build --compile agent.ts --outfile semantic-search
./semantic-search --context "query"  # Services start automatically
```

## Agents with MCP support

Compiled agents support MCP mode:

```bash
bun build --compile agent.ts --outfile my-agent
./my-agent --mcp  # Starts MCP server over stdio
```

Configure in an MCP client (e.g., Claude):

```json
{
  "mcpServers": {
    "my-agent": {
      "command": "/path/to/my-agent",
      "args": ["--mcp"]
    }
  }
}
```

## Installing globally

After compiling, copy the binary to a PATH directory:

```bash
bun build --compile agent.ts --outfile my-agent
cp my-agent /usr/local/bin/
```

Now it's invocable by name from anywhere:

```bash
my-agent --context "hello"
```

Other agents can invoke it by name:

```typescript
const result = await ctx.invoke("my-agent", { context: "hello" });
```

## Build script example

```bash
#!/bin/bash
# build.sh — compile agent for multiple platforms

NAME="my-agent"
VERSION=$(bun agent.ts --version 2>/dev/null)

echo "Building $NAME v$VERSION"

bun build --compile agent.ts --outfile "dist/$NAME-darwin-arm64" --target=bun-darwin-arm64
bun build --compile agent.ts --outfile "dist/$NAME-linux-x64" --target=bun-linux-x64
bun build --compile agent.ts --outfile "dist/$NAME.exe" --target=bun-windows-x64

echo "Done. Binaries in dist/"
```

## Binary size

Compiled binaries include the Bun runtime (~50MB baseline). The agent code and SDK add minimal overhead. For multiple agents, each gets its own binary — there is no shared runtime.

## Troubleshooting

**Binary won't run on target platform**: Ensure you used the correct `--target` flag for the platform and architecture.

**Services don't start**: Ensure Docker is installed and running on the target machine. Compiled agents need Docker just like interpreted ones.

**MCP mode hangs**: The MCP server reads from stdin. Make sure the client is connected and sending valid JSON-RPC messages.
