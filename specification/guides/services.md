# Services Guide

Add database, cache, and other infrastructure dependencies to your agent using embedded docker compose.

## Overview

Agents can declare docker compose services directly in their definition. The SDK handles:

1. Materializing the compose template to disk
2. Running `docker compose up -d`
3. Waiting for health checks to pass
4. Injecting connection strings into the agent's environment
5. Optionally tearing down services after execution

## Prerequisites

- Docker and Docker Compose v2 installed and running
- Docker socket accessible to the current user

## Declaring services

Add a `services` field to your agent definition:

```typescript
import { defineAgent } from "./@sfa/sdk";

export default defineAgent({
  name: "my-agent",
  version: "1.0.0",
  description: "Agent with a PostgreSQL database",

  services: {
    postgres: {
      image: "postgres:16",
      ports: ["5432:5432"],
      environment: {
        POSTGRES_PASSWORD: "${DB_PASSWORD}",
        POSTGRES_DB: "mydb",
      },
      healthcheck: {
        test: "pg_isready -U postgres",
        interval: "5s",
        retries: 5,
      },
    },
  },

  env: [
    { name: "DB_PASSWORD", default: "devpassword", description: "Database password" },
  ],

  execute: async (ctx) => {
    const dbUrl = ctx.env.SFA_SVC_POSTGRES_URL;
    // Use dbUrl to connect...
    return { result: "done" };
  },
});
```

## Connection string injection

After services start, the SDK injects environment variables for each service:

| Variable | Example | Description |
|---|---|---|
| `SFA_SVC_<NAME>_HOST` | `SFA_SVC_POSTGRES_HOST=127.0.0.1` | Service host |
| `SFA_SVC_<NAME>_PORT` | `SFA_SVC_POSTGRES_PORT=5432` | Published port |
| `SFA_SVC_<NAME>_URL` | `SFA_SVC_POSTGRES_URL=tcp://127.0.0.1:5432` | Connection URL |

Service names are uppercased with hyphens replaced by underscores.

### Custom connection strings

Use the `connectionString` field for protocol-specific URLs:

```typescript
services: {
  postgres: {
    image: "postgres:16",
    ports: ["5432:5432"],
    environment: { POSTGRES_PASSWORD: "${DB_PASSWORD}" },
    connectionString: "postgresql://postgres:${DB_PASSWORD}@${host}:${port}/mydb",
  },
},
```

The `${host}` and `${port}` placeholders are replaced with the actual published values. Other `${VAR}` references resolve from the agent's environment.

## Template variable interpolation

Compose templates support `${VAR}` syntax, resolved from the agent's environment after env validation:

```typescript
environment: {
  POSTGRES_PASSWORD: "${DB_PASSWORD}",  // Resolved from agent env
  REDIS_URL: "${CACHE_URL}",           // Resolved from agent env
},
```

All variables must be resolvable — the SDK fails if any `${VAR}` remains unresolved.

## Service lifecycle

### Persistent (default)

```typescript
serviceLifecycle: "persistent",
```

Services stay running between invocations. Good for databases and search engines where startup is slow.

### Ephemeral

```typescript
serviceLifecycle: "ephemeral",
```

Services are torn down (`docker compose down -v`) after each execution. Good for temporary caches or tracing collectors.

## Managing services

### Tear down manually

```bash
# Via your agent
bun agent.ts --services-down

# Via the sfa CLI
sfa services down my-agent

# All SFA services
sfa services down --all
```

### List running services

```bash
sfa services list
```

Shows all containers with `sfa.agent` labels — agent name, service, status, ports, and uptime.

## Service reuse

The SDK detects already-running services by checking for containers with matching `sfa.agent` labels. If the compose template hasn't changed (hash comparison), `docker compose up` is skipped entirely.

## Health checks

The SDK waits for all services to report healthy before proceeding. Default timeout is 60 seconds. If services don't become healthy in time, the agent fails with a clear error.

## Security

- Compose files are written to `~/.local/share/single-file-agents/services/<agent-name>/` with `0700` permissions
- Secrets in compose templates are resolved from the agent's environment (never hardcoded)
- Materialized compose files are cleaned up on service teardown

## Example: pgvector for semantic search

```typescript
services: {
  postgres: {
    image: "pgvector/pgvector:pg16",
    ports: ["5432:5432"],
    environment: {
      POSTGRES_PASSWORD: "${DB_PASSWORD}",
      POSTGRES_DB: "vectors",
    },
    healthcheck: {
      test: "pg_isready -U postgres",
      interval: "5s",
      retries: 5,
    },
    connectionString: "postgresql://postgres:${DB_PASSWORD}@${host}:${port}/vectors",
  },
},
```

## Example: Redis cache

```typescript
services: {
  redis: {
    image: "redis:7-alpine",
    ports: ["6379:6379"],
    healthcheck: {
      test: "redis-cli ping",
      interval: "3s",
      retries: 3,
    },
  },
},
serviceLifecycle: "ephemeral",  // Fresh cache each run
```
