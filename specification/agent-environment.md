# Agent Environment

Agents declare the environment variables they require. This document defines environment variable declaration, startup validation, the setup flow, precedence order, secret masking, and isolation from subagents.

## Environment Variable Declaration

Agents declare all environment variables they require in the agent definition. Each declaration includes:

| Field | Type | Description |
|---|---|---|
| `name` | string | Variable name (e.g., `OPENAI_API_KEY`) |
| `required` | boolean | Whether the variable must be set |
| `secret` | boolean | Whether the value should be masked in output |
| `default` | string? | Default value (for optional variables) |
| `description` | string | Human-readable description |

This declaration is the single source of truth for what an agent needs from the environment.

### Example

```typescript
env: [
  { name: "OPENAI_API_KEY", required: true, secret: true, description: "OpenAI API key for completions" },
  { name: "MODEL_NAME", required: false, default: "gpt-4", description: "Model to use" },
]
```

## Startup Validation

On startup, before executing its task, the agent validates that all required environment variables are present and non-empty.

If any required variable is missing:
1. Exit with code 2
2. Print to stderr: variable name, description, and instructions to configure it via `--setup` or by setting the variable directly
3. List ALL missing variables, not just the first one

If all required variables are present, the agent proceeds without prompting.

## Setup Flow

The `--setup` command prompts for all declared environment variables that are not yet configured.

### Behavior

1. For each undeclared required variable: prompt the user with the variable name and description
2. For already-configured variables: show the current value (masked if secret), ask if the user wants to update
3. Store values in shared config at `agents.<agent-name>.env.<VAR_NAME>`
4. On subsequent runs, load these values from config into the process environment

### Example Interaction

```
$ my-agent --setup

OPENAI_API_KEY (OpenAI API key for completions):
> sk-...

MODEL_NAME (Model to use) [default: gpt-4]:
> (enter to accept default)

Configuration saved to ~/.config/single-file-agents/config.json
```

## Precedence Order

Environment variables follow a strict precedence (highest to lowest):

| Priority | Source |
|---|---|
| 1 (highest) | Process environment (set by invoker or shell) |
| 2 | Shared config agent namespace (`agents.<name>.env.*`) |
| 3 | Shared config global defaults (`defaults.env.*`) |
| 4 (lowest) | Agent definition defaults |

Higher-precedence sources override lower ones. For example, if `OPENAI_API_KEY` is set in both the process environment and shared config, the process environment value is used.

## Secret Masking

Variables declared as `secret: true` are masked in all output:

| Context | Behavior |
|---|---|
| `--describe` output | Shows variable name and description, not value |
| `--verbose` logging | Replaces value with `***` |
| Execution log `meta` | Does not contain secret values |
| `--setup` display | Shows masked current value |
| Error messages | Does not include secret values |

## Env Var Isolation from Subagents

Agent-specific environment variables (those declared in the agent's env block) are NOT automatically forwarded to subagents. Each agent manages its own environment independently.

If a subagent needs the same API key, it declares it independently and loads it from its own config namespace.

Only `SFA_*` protocol variables are forwarded:

| Forwarded | Not Forwarded |
|---|---|
| `SFA_DEPTH` | `OPENAI_API_KEY` |
| `SFA_CALL_CHAIN` | `DB_PASSWORD` |
| `SFA_SESSION_ID` | Any non-`SFA_*` variable |
| `SFA_MAX_DEPTH` | |
| `SFA_CONFIG` | |
| `SFA_LOG_FILE` | |
| `SFA_NO_LOG` | |
| `SFA_CONTEXT_STORE` | |
