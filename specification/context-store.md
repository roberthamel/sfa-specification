# Context Store

The context store is a persistent, file-based location where agents write important findings, decisions, and intermediate artifacts. It is separate from the execution log — richer, longer-form, and designed for LLMs to search and reload.

## Store Location

The default context store path is:

```
~/.local/share/single-file-agents/context/
```

### Resolution Order

1. `SFA_CONTEXT_STORE` environment variable
2. Shared config `contextStore.path`
3. Default path above

If the directory does not exist, the agent creates it (including parents) before writing.

## Directory Structure

The store is organized by agent name:

```
context/
├── code-reviewer/
│   ├── 20260221T143022-auth-vulnerability.md
│   ├── 20260221T150045-sql-injection.md
│   └── a1b2c3d4-session/
│       └── 20260221T143022-review-summary.md
├── code-fixer/
│   └── 20260221T151000-applied-fixes.md
```

## File Format

Each context entry is a separate markdown file with YAML frontmatter.

### Filename Pattern

```
<timestamp>-<slug>.md
```

Where timestamp is ISO 8601 compact (e.g., `20260221T143022`) and slug is a short kebab-case descriptor.

### Frontmatter

```yaml
---
agent: code-reviewer
sessionId: a1b2c3d4-e5f6-7890-abcd-ef1234567890
timestamp: 2026-02-21T14:30:22Z
type: finding
tags: [security, authentication, sql-injection]
links:
  - code-reviewer/20260221T143022-auth-vulnerability.md
---
```

Required frontmatter fields:

| Field | Type | Description |
|---|---|---|
| `agent` | string | Name of the writing agent |
| `sessionId` | string | Session ID from `SFA_SESSION_ID` |
| `timestamp` | string | ISO 8601 timestamp |
| `type` | string | One of: `finding`, `decision`, `artifact`, `reference`, `summary` |
| `tags` | string[] | Searchable keywords |

Optional fields:

| Field | Type | Description |
|---|---|---|
| `links` | string[] | Relative paths to related context entries |

### Markdown Body

The body after frontmatter is markdown prose describing the context in enough detail for an LLM to understand it without the original conversation.

## Separation from Execution Log

| | Execution Log | Context Store |
|---|---|---|
| Format | JSONL, one line per entry | Markdown + YAML frontmatter |
| Size per entry | ~500 bytes (summaries capped) | Unbounded |
| Purpose | Audit trail, quick lookups | Rich long-term memory |
| Search | `rg` on flat JSON fields | `rg` on frontmatter + full text |
| Written when | Every invocation (automatic) | When agent has something worth persisting |

Cross-references: when an agent writes both a log entry and context files in the same invocation, the log entry MAY include a `contextFiles` field in its `meta` object listing the paths of context files written.

## Searchability

The markdown + frontmatter format enables both structured and full-text search:

```bash
# Search by tag
rg 'tags:.*security' ~/.local/share/single-file-agents/context/

# Search by type
rg '^type: finding' ~/.local/share/single-file-agents/context/

# Full-text search
rg 'authentication' ~/.local/share/single-file-agents/context/

# List files for an agent
ls ~/.local/share/single-file-agents/context/code-reviewer/

# Search across all agents
rg 'type: decision' ~/.local/share/single-file-agents/context/
```

## Cross-Agent Access and Mutability

Any agent can read context files written by any other agent. The context store is a shared resource.

### Updating Entries

An agent MAY update any context entry (including those written by other agents) but MUST record all changes within the same file by appending to a `## Changelog` section.

Agents do not delete context files. An agent MAY mark an entry as superseded via a changelog entry and link to the replacement.

### Changelog Format

```markdown
## Changelog

- 2026-02-21T15:10:00Z [code-fixer]: Updated severity from medium to high after patch analysis
- 2026-02-21T16:00:00Z [summarizer]: Marked as superseded, see code-reviewer/20260221T160000-updated-finding.md
```

When modifying a file with no changelog section, the agent adds the section. Subsequent modifications append to it.

## Context Entry Linking

Entries support links to other entries using relative file paths in the `links` frontmatter array:

```yaml
links:
  - code-reviewer/20260221T143022-auth-vulnerability.md
  - code-fixer/20260221T151000-applied-fixes.md
```

When creating a superseding entry, the new entry links to the old one, and the old entry is updated with a changelog noting it was superseded (including a link to the new entry).

LLMs can follow links to gather related context across agents and sessions.

## Session-Scoped Context

Agents MAY organize context by session using subdirectories:

```
context/<agent-name>/<session-id>/<timestamp>-<slug>.md
```

When `SFA_SESSION_ID` is set, agents SHOULD write to a session subdirectory. When no session ID is set, agents write directly to the agent's root context directory.

Session directories enable bulk retrieval of all context from a specific session:

```bash
ls ~/.local/share/single-file-agents/context/*/<session-id>/
```

## Size Management

Agents do not manage context store cleanup themselves. Cleanup is handled by a separate housekeeping operation (manual or scheduled).

Agents MAY declare a recommended retention period in `--describe` output:

```json
{
  "contextRetention": "30d"
}
```

Default recommendation: 30 days. Context files remain on disk until explicitly cleaned up.
