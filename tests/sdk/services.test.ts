import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync, statSync } from "node:fs";

// Services module interacts heavily with Docker and Bun.spawn, so these tests
// focus on the pure functions and template generation logic. Integration tests
// requiring Docker are in the integration test file (12.12).

// We test materializeCompose by importing and checking the generated YAML.
import { materializeCompose } from "../../sdk/typescript/@sfa/sdk/services";
import type { ServiceDefinition } from "../../sdk/typescript/@sfa/sdk/types";

let tmpDir: string;

// DATA_DIR in services.ts is computed at module load from process.env.HOME,
// so the actual service directory is under the real HOME.
const SERVICES_DIR = `${process.env.HOME}/.local/share/single-file-agents/services`;

beforeEach(() => {
  tmpDir = join(tmpdir(), `sfa-test-svc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // Clean up test agent compose dirs we created
  for (const name of ["test-agent", "my-agent", "agent", "perm-test-agent", "multi-agent"]) {
    try { rmSync(join(SERVICES_DIR, name), { recursive: true, force: true }); } catch {}
  }
});

describe("materializeCompose", () => {
  test("creates compose file with correct structure", async () => {
    const services: Record<string, ServiceDefinition> = {
      postgres: {
        image: "postgres:16",
        ports: ["5432:5432"],
        environment: { POSTGRES_PASSWORD: "test" },
      },
    };

    const filePath = await materializeCompose(services, "test-agent", "1.0.0", process.env as Record<string, string>);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("services:");
    expect(content).toContain("postgres:");
    expect(content).toContain("image: postgres:16");
    expect(content).toContain("5432:5432");
    expect(content).toContain("POSTGRES_PASSWORD");
  });

  test("adds sfa.agent and sfa.version labels", async () => {
    const services: Record<string, ServiceDefinition> = {
      redis: { image: "redis:7" },
    };

    const filePath = await materializeCompose(services, "my-agent", "2.0.0", {});

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain('sfa.agent: "my-agent"');
    expect(content).toContain('sfa.version: "2.0.0"');
  });

  test("includes healthcheck when defined", async () => {
    const services: Record<string, ServiceDefinition> = {
      db: {
        image: "postgres:16",
        healthcheck: {
          test: "pg_isready -U postgres",
          interval: "5s",
          timeout: "3s",
          retries: 5,
          start_period: "10s",
        },
      },
    };

    const filePath = await materializeCompose(services, "agent", "1.0.0", {});

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("healthcheck:");
    expect(content).toContain("test: pg_isready -U postgres");
    expect(content).toContain("interval: 5s");
    expect(content).toContain("retries: 5");
  });

  test("includes volumes when defined", async () => {
    const services: Record<string, ServiceDefinition> = {
      db: {
        image: "postgres:16",
        volumes: ["pgdata:/var/lib/postgresql/data"],
      },
    };

    const filePath = await materializeCompose(services, "agent", "1.0.0", {});

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("volumes:");
    expect(content).toContain("pgdata:/var/lib/postgresql/data");
  });

  test("includes command when defined (string)", async () => {
    const services: Record<string, ServiceDefinition> = {
      app: {
        image: "redis:7",
        command: "redis-server --appendonly yes",
      },
    };

    const filePath = await materializeCompose(services, "agent", "1.0.0", {});

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("command: redis-server --appendonly yes");
  });

  test("includes command when defined (array)", async () => {
    const services: Record<string, ServiceDefinition> = {
      app: {
        image: "redis:7",
        command: ["redis-server", "--appendonly", "yes"],
      },
    };

    const filePath = await materializeCompose(services, "agent", "1.0.0", {});

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain('command: ["redis-server", "--appendonly", "yes"]');
  });

  test("interpolates ${VAR} from environment", async () => {
    const services: Record<string, ServiceDefinition> = {
      db: {
        image: "postgres:16",
        environment: { POSTGRES_PASSWORD: "${DB_PASS}" },
      },
    };

    const env = { ...process.env, DB_PASS: "my-secret-password" } as Record<string, string>;
    const filePath = await materializeCompose(services, "agent", "1.0.0", env);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("my-secret-password");
    expect(content).not.toContain("${DB_PASS}");
  });

  test("creates directory with 0700 permissions", async () => {
    const services: Record<string, ServiceDefinition> = {
      db: { image: "postgres:16" },
    };

    await materializeCompose(services, "perm-test-agent", "1.0.0", {});

    const dir = join(SERVICES_DIR, "perm-test-agent");
    const stat = statSync(dir);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("handles multiple services", async () => {
    const services: Record<string, ServiceDefinition> = {
      postgres: { image: "postgres:16", ports: ["5432:5432"] },
      redis: { image: "redis:7", ports: ["6379:6379"] },
    };

    const filePath = await materializeCompose(services, "multi-agent", "1.0.0", {});

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("postgres:");
    expect(content).toContain("redis:");
    expect(content).toContain("postgres:16");
    expect(content).toContain("redis:7");
  });
});
