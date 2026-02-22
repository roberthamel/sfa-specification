# Discovery Guide

How to make your agent findable by humans, LLMs, and other agents.

## Three discovery modes

The SFA spec supports three equally valid discovery modes. An agent behaves identically regardless of how it's found.

### 1. Relative path (skill mode)

Place your agent in a project directory. Reference it by relative path:

```bash
./agents/code-reviewer.ts
../shared/my-agent
```

Best for project-specific agents. LLMs discover these by reading project documentation or skill files that reference the agent path.

To invoke from another agent:

```typescript
const result = await ctx.invoke("./agents/code-reviewer", {
  context: "review this",
});
```

### 2. PATH lookup

Install your agent globally so it's accessible by name from any directory:

```bash
# Compile and install to a PATH directory
bun build --compile agent.ts --outfile my-agent
cp my-agent /usr/local/bin/

# Or symlink during development
ln -s $(pwd)/agent.ts /usr/local/bin/my-agent
```

Now any agent or user can invoke it by name:

```bash
my-agent --context "hello"
```

```typescript
const result = await ctx.invoke("my-agent", { context: "hello" });
```

### 3. Explicit declaration

Declare agents in the shared config file (`~/.config/single-file-agents/config.json`):

```json
{
  "agents": {
    "code-reviewer": {
      "command": "/opt/agents/code-reviewer",
      "args": ["--severity", "warning"],
      "env": {
        "API_KEY": "sk-..."
      }
    }
  }
}
```

This parallels how MCP servers are declared in client configs. Best for managed environments where agents are curated.

## The `--describe` flag

Every SFA supports `--describe`, which outputs machine-readable JSON metadata:

```bash
my-agent --describe
```

```json
{
  "name": "my-agent",
  "version": "1.0.0",
  "description": "What this agent does",
  "trustLevel": "sandboxed",
  "capabilities": ["cli"],
  "input": {
    "contextRequired": false,
    "accepts": ["text", "json"]
  },
  "output": {
    "formats": ["text", "json"]
  },
  "options": [...],
  "env": [...],
  "mcpSupported": false,
  "requiresDocker": false
}
```

LLMs use this to understand what an agent does, what inputs it expects, and what environment it needs — without reading documentation.

## Making agents LLM-discoverable

### Via skill documentation

Create a markdown file that an LLM can read to learn about available agents:

```markdown
## Available Agents

### code-reviewer
Path: `./agents/code-reviewer.ts`
Reads code from stdin and outputs findings as JSON.
Usage: `echo "code" | bun ./agents/code-reviewer.ts --output-format json`

### code-fix
Path: `./agents/code-fix.ts`
Invokes code-reviewer and applies automated fixes.
Usage: `cat file.ts | bun ./agents/code-fix.ts`
```

### Via `--describe` inspection

An LLM can run `--describe` on any agent it finds to learn its capabilities dynamically:

```bash
my-agent --describe 2>/dev/null
```

### Via PATH scanning

An LLM can discover agents on PATH by looking for executables that respond to `--describe` with valid SFA metadata.

## Best practices

- Use kebab-case for agent names (`code-reviewer`, not `codeReviewer`)
- Write a clear one-line `description` — it appears in `--help` and `--describe`
- Declare `trustLevel` honestly — invokers use it to decide whether to run your agent
- Set `contextRequired: true` if your agent needs input to function
- Add `examples` to your definition — they appear in `--help` and help LLMs understand usage
