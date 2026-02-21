# Security

Agents operate with varying levels of system access. This document defines trust levels, first-time setup, filesystem boundaries, secret handling, executable integrity, and permission prompting.

## Trust Levels

Every agent declares its trust level in `--describe` output. Trust levels are a declaration — the invoker (user or LLM) decides what to do with this information.

| Level | Description |
|---|---|
| `sandboxed` | No filesystem/network access beyond its task |
| `local` | Reads/writes local files within a declared scope |
| `network` | Makes outbound network requests |
| `privileged` | Requires elevated permissions or access to secrets |

An LLM seeing `trustLevel: "privileged"` can request user confirmation before invoking the agent. A CI system can reject non-sandboxed agents.

## First-Time Setup

Agents that require configuration before first use provide a `--setup` command.

### Agents Requiring Setup

When an unconfigured agent is invoked:
1. It detects missing configuration
2. Exits with code 1
3. Emits a message to stderr instructing the user to run `<agent> --setup`

The `--setup` flow:
1. Prompts for each required value interactively
2. Stores values in the shared config under the agent's namespace
3. Subsequent runs load these values automatically

### Drop-In Agents

Agents with no external dependencies or credentials are executable immediately after being placed in PATH or a project directory. No setup step required.

## Filesystem Access Boundaries

Agents with `local` trust level declare the filesystem paths they access in `--describe` output:

```json
{
  "trustLevel": "local",
  "filesystemScope": ["./src/**", "./tests/**"]
}
```

Agents do not access files outside their declared scope and respect the working directory provided by the invoker.

## Secret Handling

Agents do not log, emit to stdout, or include in error messages any secret values (API keys, tokens, credentials).

Rules:
- Secrets are used only for their intended purpose (e.g., API authentication)
- `--verbose` output masks or omits secret values
- Secrets are not forwarded to subagents by default (each agent manages its own credentials)
- The execution log's `meta` object does not contain secret values
- The `--setup` flow masks stored values when displaying them

## Executable Integrity

Agents are self-contained:

- No runtime code fetching — agents do not download scripts or binaries from remote sources to execute
- Dependencies are bundled or declared in a manifest alongside the agent
- Users can audit an agent's complete behavior by reading its source and declared dependencies

## Permission Prompting for Destructive Actions

Agents that perform destructive actions (deleting files, modifying system state, sending external requests) prompt the user for confirmation before proceeding.

### Interactive Mode (Default)

The agent prompts the user on stderr for confirmation before destructive actions.

### Non-Interactive Mode

When invoked with `--yes` or `--non-interactive`, the agent proceeds with destructive actions without prompting, logging each action to stderr.
