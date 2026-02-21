# Agent Discovery

Agents can be found and invoked through multiple mechanisms. This document defines the three discovery modes, resolution mode independence, and the `--describe` flag for self-description.

## Discovery Modes

### 1. Relative Path (Skill Mode)

An agent can be invoked by relative path when bundled as a skill within a project. The invoker references the agent using a relative path from the project root or from a known skills directory.

```bash
./skills/code-reviewer/agent --describe
.claude/skills/summarizer/agent --context "..."
```

Agents placed in a project's `.claude/skills/`, `skills/`, or equivalent directory are discoverable by LLMs that have access to skill documentation.

### 2. PATH-Based Resolution

An agent can be placed in the user's PATH for global availability. LLMs and other agents discover PATH-available agents through documentation files or by searching the PATH directly.

```bash
sfa-code-reviewer --describe
```

An `AGENTS.md` file in the project root or home directory can list available agents. Each entry includes at minimum:

- Agent name
- One-line description
- Invocation example
- Accepted input types

### 3. Explicit Command Declaration (MCP-Style)

An agent can be declared explicitly in a configuration file with its full command path, arguments, and environment. This parallels MCP server declarations.

```json
{
  "name": "code-reviewer",
  "command": "/usr/local/bin/sfa-code-reviewer",
  "args": ["--output-format", "json"],
  "description": "Reviews code for common issues",
  "env": {
    "OPENAI_API_KEY": "sk-..."
  }
}
```

## Resolution Mode Independence

An agent produces identical behavior regardless of which resolution mode was used to find it. The resolution mode does not affect input handling, output format, or exit codes.

The same agent invoked via relative path, PATH lookup, and explicit declaration with identical input produces the same output and exit code in all three cases.

## Self-Description via `--describe`

Every agent supports a `--describe` flag that outputs machine-readable JSON metadata. This metadata is sufficient for an LLM to decide whether and how to use the agent.

```bash
agent --describe
```

Output:

```json
{
  "name": "code-reviewer",
  "version": "1.0.0",
  "description": "Reviews code for common issues",
  "capabilities": ["code-analysis", "security-review"],
  "input": { "types": ["text"], "required": false },
  "output": { "formats": ["text", "json"] },
  "options": [
    { "flag": "--language", "description": "Target language", "type": "string" }
  ],
  "trustLevel": "sandboxed",
  "mcpSupported": true,
  "examples": [
    { "command": "echo 'fn main()' | code-reviewer", "description": "Review Rust code" }
  ]
}
```

The `--describe` output provides enough information for an LLM to construct a valid invocation command without prior knowledge of the agent.
