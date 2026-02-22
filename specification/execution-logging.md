# Execution Logging

Every agent invocation is recorded to a common JSONL log file. This document defines the log location, entry schema, session tracking, searchability, rotation, and suppression.

## Log File Location

The default log location is:

```
~/.local/share/single-file-agents/logs/executions.jsonl
```

### Resolution Order

1. `SFA_LOG_FILE` environment variable
2. Shared config `logging.file`
3. Default path above

If the log directory does not exist, the agent creates it (including parents) before writing.

## JSONL Format

Each invocation produces a single JSON line. JSONL keeps entries small and the file appendable without parsing.

### Log Entry Schema

| Field | Type | Description |
|---|---|---|
| `timestamp` | string | ISO 8601 timestamp |
| `agent` | string | Agent name |
| `version` | string | Agent version |
| `exitCode` | integer | Process exit code |
| `durationMs` | integer | Execution time in milliseconds |
| `depth` | integer | Invocation depth from `SFA_DEPTH` |
| `callChain` | string[] | Agent names from `SFA_CALL_CHAIN` |
| `inputSummary` | string | Truncated input description (max 500 chars) |
| `outputSummary` | string | Truncated output description (max 500 chars) |
| `sessionId` | string | UUID linking all agents in one invocation tree |
| `meta` | object? | Optional agent-specific data |

### Example Entry

```json
{"timestamp":"2026-02-21T14:30:22Z","agent":"code-reviewer","version":"1.0.0","exitCode":0,"durationMs":3420,"depth":0,"callChain":["code-reviewer"],"inputSummary":"Review of auth.ts (1200 chars)","outputSummary":"Found 2 issues: SQL injection in query(), missing input validation in login()","sessionId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"}
```

Input and output summaries exceeding 500 characters are truncated with a trailing `...`.

Required fields use a flat structure (no nesting). Nesting is allowed only in the optional `meta` object.

## Session Tracking

A top-level invocation generates a unique session ID (UUID v4) and passes it to subagents via `SFA_SESSION_ID`. All agents in the same invocation tree share the same session ID.

| Scenario | Behavior |
|---|---|
| No `SFA_SESSION_ID` set | Generate new UUID v4 |
| `SFA_SESSION_ID` set | Use existing value |

This enables grouping all log entries from a single user-initiated action:

```bash
rg '"sessionId":"a1b2c3d4-..."' ~/.local/share/single-file-agents/logs/executions.jsonl
```

## Searchability

The JSONL format is optimized for line-oriented search tools like ripgrep. Consistent field names across all agents enable pattern-based queries:

| Query | Command |
|---|---|
| By agent name | `rg '"agent":"code-reviewer"' <logfile>` |
| By date | `rg '"timestamp":"2026-02-21' <logfile>` |
| Failed executions | `rg '"exitCode":[^0]' <logfile>` |
| By session | `rg '"sessionId":"<uuid>"' <logfile>` |

## Agent Access to Execution History

Every agent has read access to the execution log and may query it as part of its task. Use cases:

- Check whether a prior run succeeded
- Find past output from a collaborating agent
- Avoid redundant work (cache hint, not authoritative)
- Review execution patterns across sessions

The log path is discoverable through the same resolution order as any config value. Agents handle missing history gracefully when prior invocations used `--no-log`.

## Log Rotation

When the log file exceeds a configurable maximum size, the agent rotates it:

| Setting | Config Key | Default |
|---|---|---|
| Max file size | `logging.maxSizeMB` | 50 MB |
| Retained files | `logging.retainCount` | 5 |

Rotation renames the current file with a timestamp suffix (e.g., `executions-2026-02-21T120000.jsonl`) and starts a new file. When more than `retainCount` rotated files exist, the oldest are deleted.

Agents check file size before writing.

## Non-Blocking Logging

Log writing is best-effort:

- Writes happen at exit, not during execution
- Log failures do not affect the agent's exit code or output
- On write failure, the agent emits a warning to stderr and continues
- Writing uses `O_APPEND` mode for atomic appends (POSIX guarantees atomic writes up to `PIPE_BUF`, typically 4KB — log entries are well under this)

## Log Suppression

Logging can be suppressed via:

- `--no-log` flag
- `SFA_NO_LOG=1` environment variable

When suppressed, no JSONL entry is written for that invocation. Useful for testing, benchmarking, or privacy-sensitive invocations.
