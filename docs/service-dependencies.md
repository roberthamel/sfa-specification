# Service Dependencies

Agents can declare infrastructure dependencies as embedded docker compose templates. This document defines template declaration, materialization, variable interpolation, lifecycle management, health checks, connection string injection, service reuse, and cleanup.

## Embedded Compose Template Declaration

An agent declares infrastructure dependencies as a docker compose template within its agent definition. The template is a valid compose file expressed as an object or string.

```typescript
services: {
  postgres: {
    image: "pgvector/pgvector:pg16",
    ports: ["5432:5432"],
    environment: { POSTGRES_PASSWORD: "${DB_PASSWORD}" },
    healthcheck: { test: "pg_isready", interval: "5s", retries: 5 },
  },
},
serviceLifecycle: "persistent",
```

Agents with no `services` block skip all compose-related lifecycle management.

## Compose File Materialization

The SDK writes the compose template to:

```
~/.local/share/single-file-agents/services/<agent-name>/docker-compose.yml
```

All services in the materialized file include labels for identification:

```yaml
labels:
  sfa.agent: <agent-name>
  sfa.version: <agent-version>
```

For compiled agents (`bun build --compile`), the compose template is embedded as a string constant in the binary and extracted at runtime.

## Template Variable Interpolation

Compose templates support `${VAR_NAME}` syntax. Variables are resolved from the agent's environment after env validation and config loading.

```yaml
environment:
  POSTGRES_PASSWORD: ${DB_PASSWORD}
```

This allows templates to reference credentials without hardcoding values. If a referenced variable is not set, the SDK exits with code 2 and reports the unresolved variable.

## Service Lifecycle Management

The SDK manages docker compose around agent execution:

### Before Execution

1. Materialize compose template to disk
2. Run `docker compose up -d`
3. Wait for all health checks to pass
4. Inject connection strings into agent environment
5. Call agent's `execute` function

### After Execution

Behavior depends on `serviceLifecycle`:

| Mode | Behavior | Use Case |
|---|---|---|
| `persistent` (default) | Services left running | Databases, search engines — slow to start, cheap to reuse |
| `ephemeral` | `docker compose down -v` after execution | Tracing collectors, temp caches — clean state every run |

## Health Check Waiting

Before invoking `execute`, the SDK waits for all compose services to report healthy using docker compose's built-in health check mechanism.

| Setting | Default |
|---|---|
| Health check timeout | 60 seconds (configurable via `serviceHealthTimeout`) |

If any service fails to become healthy:
1. Emit service logs to stderr
2. Run `docker compose down`
3. Exit with code 1

## Connection String Injection

For each service, the SDK reads published ports and sets environment variables:

| Variable | Example |
|---|---|
| `SFA_SVC_<NAME>_HOST` | `SFA_SVC_POSTGRES_HOST=localhost` |
| `SFA_SVC_<NAME>_PORT` | `SFA_SVC_POSTGRES_PORT=54321` |
| `SFA_SVC_<NAME>_URL` | `SFA_SVC_POSTGRES_URL=postgresql://localhost:54321` |

### Custom Connection Strings

Service definitions may include a `connectionString` template:

```typescript
{
  redis: {
    image: "redis:7",
    ports: ["6379:6379"],
    connectionString: "redis://${host}:${port}/0"
  }
}
```

The SDK interpolates `${host}` and `${port}` and sets `SFA_SVC_REDIS_URL` accordingly.

## Service Reuse

When `serviceLifecycle` is `persistent`, the SDK detects already-running services on subsequent invocations:

1. Check for running containers with matching `sfa.agent` labels
2. Compare compose template hash with the running template
3. If unchanged: skip `docker compose up`, proceed to health checks
4. If changed: run `docker compose down` then `docker compose up -d` with the new template

## Service Cleanup

### Per-Agent Cleanup

The `--services-down` flag tears down all services for the agent:

```bash
my-agent --services-down
```

Runs `docker compose down -v` and exits with code 0. If no services are running, reports that and exits with code 0.

### Global Cleanup

The `sfa` CLI provides global service management (see [sfa CLI](./sfa-cli.md)).

## Docker Availability Check

Before any compose operations, the SDK verifies that `docker` and `docker compose` are available. If not available:

1. Exit with code 1
2. Emit: "This agent requires Docker for its service dependencies. Install Docker: https://docs.docker.com/get-docker/"

## Describe Output

An agent's `--describe` output includes service dependency information:

```json
{
  "services": [
    { "name": "postgres", "image": "pgvector/pgvector:pg16", "ports": ["5432"] }
  ],
  "requiresDocker": true
}
```

## Compose File Permissions

Materialized compose files are written to a directory with `0700` permissions to protect interpolated credentials.
