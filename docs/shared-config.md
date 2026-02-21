# Shared Config

Agents read shared configuration from a common file. This document defines the config file location, schema, environment variable overrides, and read-only contract.

## Config File Location

The configuration file is located at:

```
~/.config/single-file-agents/config.json
```

This follows the XDG Base Directory specification. The path is overridable via the `SFA_CONFIG` environment variable.

### Resolution Order

1. `SFA_CONFIG` environment variable (if set, use that path)
2. `~/.config/single-file-agents/config.json` (default)
3. Built-in defaults (if no file exists)

When no configuration file is found, the agent operates with built-in defaults and does not fail.

## Configuration Schema

The configuration format is JSON with these top-level keys:

```json
{
  "apiKeys": {
    "anthropic": "sk-ant-...",
    "openai": "sk-..."
  },
  "models": {
    "default": "claude-sonnet-4-20250514",
    "fast": "claude-haiku-4-5-20251001"
  },
  "mcpServers": {
    "filesystem": "stdio:///usr/local/bin/mcp-filesystem"
  },
  "defaults": {
    "timeout": 120,
    "outputFormat": "text",
    "verbose": false
  },
  "agents": {
    "code-reviewer": {
      "timeout": 300,
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Top-Level Keys

| Key | Type | Description |
|---|---|---|
| `apiKeys` | `Record<string, string>` | API keys by provider name |
| `models` | `Record<string, string>` | Model aliases to identifiers |
| `mcpServers` | `Record<string, string>` | MCP server connection URIs |
| `defaults` | `Record<string, any>` | Default settings (timeout, output format, verbosity) |
| `agents` | `Record<string, object>` | Per-agent configuration namespaces |

### Agent Namespace

Each agent may have its own namespace under `agents.<agent-name>`. Agent-specific values override shared defaults. For example, if `defaults.timeout` is 60 and `agents.code-reviewer.timeout` is 120, the code-reviewer agent uses 120.

## Environment Variable Override

Any configuration value can be overridden via environment variables. The naming convention is:

```
SFA_<SECTION>_<KEY>
```

All uppercase, dots replaced by underscores. Environment variables take precedence over file-based configuration.

| Config Path | Environment Variable |
|---|---|
| `apiKeys.anthropic` | `SFA_APIKEYS_ANTHROPIC` |
| `defaults.timeout` | `SFA_DEFAULTS_TIMEOUT` |
| `models.default` | `SFA_MODELS_DEFAULT` |

## Read-Only Contract

Agents do not modify the shared configuration file during execution. Configuration is a read-only resource. Any agent that requires persistent state manages it separately from the shared config.

The only exception is the `--setup` flow, which writes to the config file interactively with user consent.
