import type { AgentDefinition, ServiceDefinition, ServiceLifecycle } from "./types";
import { ExitCode } from "./types";
import { emitProgress, exitWithError } from "./output";

const DATA_DIR = `${process.env.HOME}/.local/share/single-file-agents/services`;

/**
 * Get the compose file directory for an agent.
 */
function composeDir(agentName: string): string {
  return `${DATA_DIR}/${agentName}`;
}

/** Supported compose filenames in priority order (modern first). */
const COMPOSE_FILENAMES = ["compose.yaml", "docker-compose.yml"] as const;

/**
 * Get the compose file path for an agent.
 * Uses the modern `compose.yaml` for new files.
 */
function composeFilePath(agentName: string): string {
  return `${composeDir(agentName)}/${COMPOSE_FILENAMES[0]}`;
}

/**
 * Find the existing compose file for an agent, checking both modern and legacy filenames.
 * Returns the path if found, or null.
 */
async function findExistingComposeFile(agentName: string): Promise<string | null> {
  const dir = composeDir(agentName);
  for (const name of COMPOSE_FILENAMES) {
    const path = `${dir}/${name}`;
    if (await Bun.file(path).exists()) {
      return path;
    }
  }
  return null;
}

// -------------------------------------------------------------------
// 9.1: Docker/docker-compose availability check
// -------------------------------------------------------------------

/**
 * Check that docker and docker compose are available.
 * Exits with code 1 if not found.
 */
export async function checkDockerAvailability(): Promise<void> {
  try {
    const docker = Bun.spawn(["docker", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const dockerExit = await docker.exited;
    if (dockerExit !== 0) throw new Error("docker not available");
  } catch {
    exitWithError(
      "This agent requires Docker for its service dependencies.\n" +
        "Install Docker: https://docs.docker.com/get-docker/",
      ExitCode.FAILURE,
    );
  }

  try {
    const compose = Bun.spawn(["docker", "compose", "version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const composeExit = await compose.exited;
    if (composeExit !== 0) throw new Error("docker compose not available");
  } catch {
    exitWithError(
      "This agent requires Docker Compose for its service dependencies.\n" +
        "Install Docker Compose: https://docs.docker.com/compose/install/",
      ExitCode.FAILURE,
    );
  }
}

// -------------------------------------------------------------------
// 9.3: Template variable interpolation
// -------------------------------------------------------------------

/**
 * Interpolate ${VAR} references in a string from the environment.
 * Throws on unresolved variables.
 */
function interpolateVars(template: string, env: Record<string, string | undefined>): string {
  const unresolved: string[] = [];
  const result = template.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const value = env[varName];
    if (value === undefined) {
      unresolved.push(varName);
      return match;
    }
    return value;
  });

  if (unresolved.length > 0) {
    exitWithError(
      `Unresolved variables in compose template: ${unresolved.join(", ")}\n` +
        "Ensure these are declared in the agent's env block or set in the environment.",
      ExitCode.INVALID_USAGE,
    );
  }

  return result;
}

// -------------------------------------------------------------------
// 9.2: Compose template materialization
// -------------------------------------------------------------------

/**
 * Convert agent service definitions to a docker compose YAML string.
 * Adds sfa.agent and sfa.version labels to all services.
 */
function buildComposeYaml(
  services: Record<string, ServiceDefinition>,
  agentName: string,
  agentVersion: string,
  env: Record<string, string | undefined>,
): string {
  const lines: string[] = [];
  lines.push("services:");

  for (const [name, svc] of Object.entries(services)) {
    lines.push(`  ${name}:`);
    lines.push(`    image: ${svc.image}`);

    // Labels (9.4)
    lines.push("    labels:");
    lines.push(`      sfa.agent: "${agentName}"`);
    lines.push(`      sfa.version: "${agentVersion}"`);

    // Ports
    if (svc.ports && svc.ports.length > 0) {
      lines.push("    ports:");
      for (const port of svc.ports) {
        lines.push(`      - "${port}"`);
      }
    }

    // Environment
    if (svc.environment && Object.keys(svc.environment).length > 0) {
      lines.push("    environment:");
      for (const [key, value] of Object.entries(svc.environment)) {
        lines.push(`      ${key}: "${value}"`);
      }
    }

    // Volumes
    if (svc.volumes && svc.volumes.length > 0) {
      lines.push("    volumes:");
      for (const vol of svc.volumes) {
        lines.push(`      - "${vol}"`);
      }
    }

    // Command
    if (svc.command) {
      if (Array.isArray(svc.command)) {
        lines.push(`    command: [${svc.command.map((c) => `"${c}"`).join(", ")}]`);
      } else {
        lines.push(`    command: ${svc.command}`);
      }
    }

    // Healthcheck
    if (svc.healthcheck) {
      lines.push("    healthcheck:");
      lines.push(`      test: ${svc.healthcheck.test}`);
      if (svc.healthcheck.interval) lines.push(`      interval: ${svc.healthcheck.interval}`);
      if (svc.healthcheck.timeout) lines.push(`      timeout: ${svc.healthcheck.timeout}`);
      if (svc.healthcheck.retries !== undefined)
        lines.push(`      retries: ${svc.healthcheck.retries}`);
      if (svc.healthcheck.start_period) lines.push(`      start_period: ${svc.healthcheck.start_period}`);
    }
  }

  const yaml = lines.join("\n") + "\n";

  // Interpolate variables from the agent environment
  return interpolateVars(yaml, env);
}

/**
 * Materialize the compose template to disk.
 * Creates the directory with 0700 permissions (9.13).
 */
export async function materializeCompose(
  services: Record<string, ServiceDefinition>,
  agentName: string,
  agentVersion: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  const dir = composeDir(agentName);
  const filePath = composeFilePath(agentName);
  const yaml = buildComposeYaml(services, agentName, agentVersion, env);

  // Create directory with 0700 permissions (9.13)
  const { mkdirSync, chmodSync, unlinkSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  chmodSync(dir, 0o700);

  // Remove legacy filename if present (we always write the modern name)
  const legacyPath = `${dir}/${COMPOSE_FILENAMES[1]}`;
  if (filePath !== legacyPath) {
    try { unlinkSync(legacyPath); } catch { /* not present */ }
  }

  // Write compose file
  await Bun.write(filePath, yaml);

  return filePath;
}

// -------------------------------------------------------------------
// 9.9: Compose template change detection
// -------------------------------------------------------------------

/**
 * Compute a hash of the compose template for change detection.
 */
async function hashTemplate(content: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

/**
 * Read the current materialized compose file hash, or null if not present.
 */
async function readCurrentTemplateHash(agentName: string): Promise<string | null> {
  const hashFile = `${composeDir(agentName)}/.template-hash`;
  const file = Bun.file(hashFile);
  if (await file.exists()) {
    return (await file.text()).trim();
  }
  return null;
}

/**
 * Write the template hash after materialization.
 */
async function writeTemplateHash(agentName: string, hash: string): Promise<void> {
  const hashFile = `${composeDir(agentName)}/.template-hash`;
  await Bun.write(hashFile, hash);
}

// -------------------------------------------------------------------
// 9.8: Service reuse detection
// -------------------------------------------------------------------

/**
 * Check if services are already running for this agent with matching labels.
 */
async function checkRunningServices(agentName: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(
      ["docker", "ps", "--filter", `label=sfa.agent=${agentName}`, "--format", "{{.ID}}"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------
// 9.4: Docker compose up
// -------------------------------------------------------------------

/**
 * Run docker compose up -d for the agent.
 */
async function composeUp(agentName: string): Promise<void> {
  const dir = composeDir(agentName);
  const proc = Bun.spawn(["docker", "compose", "up", "-d"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`docker compose up failed:\n${stderr}`);
  }
}

// -------------------------------------------------------------------
// 9.5: Health check waiting
// -------------------------------------------------------------------

/**
 * Wait for all services to be healthy.
 * Polls docker compose ps until all services report "healthy" or "running" (no healthcheck).
 */
export async function waitForHealthy(
  agentName: string,
  timeoutSeconds: number = 60,
): Promise<void> {
  const dir = composeDir(agentName);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const proc = Bun.spawn(
      ["docker", "compose", "ps", "--format", "json"],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    if (output.trim()) {
      // docker compose ps --format json outputs one JSON object per line
      const containers = output
        .trim()
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      if (containers.length > 0) {
        const allHealthy = containers.every((c: { Health?: string; State?: string }) => {
          // If service has a healthcheck, it must report "healthy"
          // If no healthcheck, "running" is sufficient
          if (c.Health) {
            return c.Health === "healthy";
          }
          return c.State === "running";
        });

        if (allHealthy) return;
      }
    }

    // Wait 2s before next poll
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Timeout — dump logs and tear down
  const logProc = Bun.spawn(["docker", "compose", "logs", "--tail=50"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const logs = await new Response(logProc.stdout).text();
  await logProc.exited;

  process.stderr.write(`Service health check timeout (${timeoutSeconds}s). Recent logs:\n${logs}\n`);

  // Tear down
  await composeDown(agentName);

  exitWithError(
    `Services failed to become healthy within ${timeoutSeconds}s.`,
    ExitCode.FAILURE,
  );
}

// -------------------------------------------------------------------
// 9.6: Connection string injection
// -------------------------------------------------------------------

/**
 * Read published ports for a service and inject SFA_SVC_* env vars.
 */
async function injectServiceConnectionVars(
  agentName: string,
  serviceName: string,
  svcDef: ServiceDefinition,
): Promise<void> {
  const dir = composeDir(agentName);
  const envName = serviceName.toUpperCase().replace(/-/g, "_");

  if (!svcDef.ports || svcDef.ports.length === 0) return;

  // Get the first port mapping to determine the published port
  const firstPort = svcDef.ports[0];
  const containerPort = firstPort.includes(":") ? firstPort.split(":")[1] : firstPort;

  const proc = Bun.spawn(
    ["docker", "compose", "port", serviceName, containerPort],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const trimmed = output.trim();
  if (!trimmed) return;

  // Output is like "0.0.0.0:32768" or ":::32768"
  const parts = trimmed.split(":");
  const port = parts[parts.length - 1];
  const host = "localhost";

  process.env[`SFA_SVC_${envName}_HOST`] = host;
  process.env[`SFA_SVC_${envName}_PORT`] = port;

  // 9.7: Custom connection string template
  if (svcDef.connectionString) {
    const url = svcDef.connectionString
      .replace(/\$\{host\}/g, host)
      .replace(/\$\{port\}/g, port);
    process.env[`SFA_SVC_${envName}_URL`] = url;
  } else {
    // Default URL based on image name heuristic
    const image = svcDef.image.toLowerCase();
    let protocol = "tcp";
    if (image.includes("postgres") || image.includes("pgvector")) protocol = "postgresql";
    else if (image.includes("redis")) protocol = "redis";
    else if (image.includes("mysql") || image.includes("mariadb")) protocol = "mysql";
    else if (image.includes("mongo")) protocol = "mongodb";
    else if (image.includes("elasticsearch") || image.includes("opensearch")) protocol = "http";

    process.env[`SFA_SVC_${envName}_URL`] = `${protocol}://${host}:${port}`;
  }
}

// -------------------------------------------------------------------
// 9.10 / 9.11: Compose down (ephemeral) and persistent lifecycle
// -------------------------------------------------------------------

/**
 * Run docker compose down -v for the agent.
 */
export async function composeDown(agentName: string): Promise<void> {
  const dir = composeDir(agentName);
  const existing = await findExistingComposeFile(agentName);
  if (!existing) return;

  const proc = Bun.spawn(["docker", "compose", "-f", existing, "down", "-v"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
}

// -------------------------------------------------------------------
// 9.12: --services-down flag
// -------------------------------------------------------------------

/**
 * Handle the --services-down flag: tear down services and exit.
 */
export async function handleServicesDown(agentName: string): Promise<never> {
  const running = await checkRunningServices(agentName);
  if (!running) {
    process.stderr.write(`No services running for ${agentName}.\n`);
    process.exit(ExitCode.SUCCESS);
  }

  await composeDown(agentName);
  process.stderr.write(`Services for ${agentName} stopped.\n`);
  process.exit(ExitCode.SUCCESS);
}

// -------------------------------------------------------------------
// Main lifecycle: startServices / stopServices
// -------------------------------------------------------------------

/**
 * Start services for an agent before execution.
 * Handles materialization, reuse detection, compose up, health checks,
 * and connection string injection.
 */
export async function startServices(
  def: AgentDefinition,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (!def.services || Object.keys(def.services).length === 0) return;

  const agentName = def.name;

  // 9.1: Check docker availability
  await checkDockerAvailability();

  emitProgress(agentName, "starting services");

  // 9.2: Materialize compose template
  await materializeCompose(def.services, agentName, def.version, env);

  // 9.9: Compute template hash for change detection
  const composeContent = await Bun.file(composeFilePath(agentName)).text();
  const currentHash = await hashTemplate(composeContent);
  const previousHash = await readCurrentTemplateHash(agentName);

  // 9.8: Check for running services
  const isRunning = await checkRunningServices(agentName);

  if (isRunning) {
    if (previousHash === currentHash) {
      // Template unchanged — reuse services, skip compose up
      emitProgress(agentName, "reusing running services");
    } else {
      // Template changed — recreate
      emitProgress(agentName, "compose template changed, recreating services");
      await composeDown(agentName);
      // Re-materialize (compose down may have cleaned up)
      await materializeCompose(def.services, agentName, def.version, env);
      await composeUp(agentName);
    }
  } else {
    // 9.4: Start services
    await composeUp(agentName);
  }

  // Save template hash
  await writeTemplateHash(agentName, currentHash);

  // 9.5: Wait for health checks
  const healthTimeout = (def as AgentDefinition & { serviceHealthTimeout?: number }).serviceHealthTimeout ?? 60;
  await waitForHealthy(agentName, healthTimeout);

  // 9.6 / 9.7: Inject connection strings
  for (const [serviceName, svcDef] of Object.entries(def.services)) {
    await injectServiceConnectionVars(agentName, serviceName, svcDef);
  }

  emitProgress(agentName, "services ready");
}

/**
 * Stop services after agent execution (for ephemeral lifecycle).
 */
export async function stopServices(
  agentName: string,
  lifecycle: ServiceLifecycle = "persistent",
): Promise<void> {
  // 9.11: Persistent — do nothing, leave running
  if (lifecycle === "persistent") return;

  // 9.10: Ephemeral — tear down
  emitProgress(agentName, "stopping ephemeral services");
  await composeDown(agentName);
}
