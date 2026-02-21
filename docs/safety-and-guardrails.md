# Safety & Guardrails

Agents compose by spawning subagents, which creates risk of runaway execution. This document defines the safety mechanisms that prevent infinite loops, unbounded recursion, and unresponsive agents.

All safety mechanisms are on by default with conservative limits. Agents must opt out, not opt in.

## Recursion Depth Tracking

Every agent tracks its invocation depth via the `SFA_DEPTH` environment variable. When spawning a subagent, the parent increments the depth by 1.

| Variable | Description |
|---|---|
| `SFA_DEPTH` | Current invocation depth (0 for top-level) |
| `SFA_MAX_DEPTH` | Maximum allowed depth (default: 5) |

If `SFA_DEPTH` is not set, the agent assumes depth 0.

### Maximum Depth Enforcement

When `SFA_DEPTH` equals or exceeds `SFA_MAX_DEPTH`, the agent refuses to spawn further subagents and exits with code 1, emitting a depth-limit error to stderr.

The maximum depth is configurable via:
- `--max-depth <n>` flag
- `SFA_MAX_DEPTH` environment variable
- Shared config

Default: 5.

## Loop Detection

Each agent invocation appends its name to `SFA_CALL_CHAIN` (comma-separated). Before executing, an agent checks if its own name already appears in the call chain.

| Variable | Example Value |
|---|---|
| `SFA_CALL_CHAIN` | `planner,code-reviewer,summarizer` |

### Direct Recursion

If agent "code-reviewer" is invoked and `SFA_CALL_CHAIN` already contains "code-reviewer", it exits with code 1 and emits a loop-detection error including the full call chain.

### Indirect Recursion

If agent "summarizer" is invoked and `SFA_CALL_CHAIN` is "planner,summarizer,reviewer", the agent detects the cycle, refuses to execute, and reports the loop path.

### No Loop

When an agent's name does not appear in `SFA_CALL_CHAIN`, it appends its name and proceeds normally.

Loop detection cannot be disabled.

## Timeout Enforcement

Every agent enforces a maximum execution time.

| Source | Priority | Default |
|---|---|---|
| `--timeout <seconds>` | Highest | — |
| `SFA_DEFAULTS_TIMEOUT` env | Medium | — |
| Shared config `defaults.timeout` | Lower | — |
| Built-in default | Lowest | 120s |

When the timeout is reached:
1. Cancel in-flight work
2. Emit a timeout message to stderr
3. Exit with code 3

Timeouts apply to subagents as well — the parent enforces its own timeout on child processes.

## Structured Progress Feedback

Agents emit progress messages to stderr prefixed with `[agent:<name>]`.

### Automatic Messages

| Event | Message |
|---|---|
| Agent starts | `[agent:<name>] starting` |
| Agent completes | `[agent:<name>] completed` |
| Agent fails | `[agent:<name>] failed` |

### Custom Milestones

Agents may emit additional progress messages for significant steps:

```
[agent:code-reviewer] analyzing 50 files
[agent:code-reviewer] found 3 issues
```

In verbose mode, agents emit detailed progress for each step. The `--quiet` flag suppresses progress messages.

## Signal Handling

Agents handle SIGTERM and SIGINT for graceful shutdown.

### SIGINT (Ctrl+C)

1. Cancel ongoing work (via AbortController/signal)
2. Terminate any child processes
3. Emit cancellation message to stderr
4. Exit with code 130

### SIGTERM

1. Gracefully shut down within 5 seconds
2. Terminate any child processes
3. Emit termination message to stderr
4. Exit with code 143

Agents do not leave orphaned subprocesses. When terminated while subagents are running, the agent sends termination signals to all child processes before exiting.

## Summary of Defaults

| Guardrail | Default | Override |
|---|---|---|
| Max depth | 5 | `--max-depth` or `SFA_MAX_DEPTH` |
| Timeout | 120s | `--timeout` or `SFA_DEFAULTS_TIMEOUT` |
| Loop detection | On | Cannot be disabled |
| Progress output | On | `--quiet` suppresses |
| Logging | On | `--no-log` or `SFA_NO_LOG=1` |
