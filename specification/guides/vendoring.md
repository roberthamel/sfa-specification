# Vendoring Guide

The SFA SDK is distributed by vendoring — copying the source into your project. There is no npm package to install.

## Why vendoring?

- Agents are self-contained: no package registry dependency
- Works with `bun build --compile` for standalone executables
- No version conflicts between agents
- Source is readable and modifiable

## How to vendor the SDK

### Option 1: Use `sfa init`

```bash
sfa init my-agent
```

This scaffolds a new agent directory with the SDK already vendored:

```
my-agent/
  @sfa/sdk/    # SDK source
  agent.ts     # Agent scaffold
  README.md
```

### Option 2: Copy manually

Copy the `@sfa/sdk/` directory from any existing agent project or from the SDK source repository:

```bash
cp -r /path/to/single-file-agents/@sfa/sdk ./my-agent/@sfa/sdk
```

The SDK directory should be a sibling of your agent file:

```
my-agent/
  @sfa/sdk/
    index.ts
    types/
    cli.ts
    config.ts
    env.ts
    safety.ts
    logging.ts
    context.ts
    invoke.ts
    services.ts
    mcp.ts
    output.ts
    input.ts
    help.ts
    package.json
  agent.ts       # imports from "./@sfa/sdk"
```

### Option 3: Copy from a compiled release

If a release bundle is available, extract the SDK from it.

## Import path

Your agent imports the SDK using a relative path:

```typescript
import { defineAgent } from "./@sfa/sdk";
```

Or from a nested directory:

```typescript
import { defineAgent } from "../@sfa/sdk";
```

## Updating the SDK

To update to a newer version, replace the `@sfa/sdk/` directory:

```bash
rm -rf @sfa/sdk
cp -r /path/to/newer/@sfa/sdk .
```

The SDK has no external dependencies, so there are no transitive updates to worry about.

## SDK contents

The SDK is pure TypeScript with no dependencies. Key files:

| File | Purpose |
|---|---|
| `index.ts` | Main entry, exports `defineAgent()` and all public APIs |
| `types/index.ts` | All TypeScript interfaces and type definitions |
| `cli.ts` | Argument parsing |
| `config.ts` | Shared config loading and merging |
| `env.ts` | Environment variable resolution, validation, masking |
| `safety.ts` | Depth tracking, loop detection, timeout, signals |
| `logging.ts` | JSONL execution log writing and rotation |
| `context.ts` | Context store read/write/search |
| `invoke.ts` | Subagent invocation via `Bun.spawn` |
| `services.ts` | Docker compose lifecycle management |
| `mcp.ts` | MCP JSON-RPC server over stdio |
| `output.ts` | Result formatting and output |
| `input.ts` | stdin and context input reading |
| `help.ts` | Help text and `--describe` generation |
