import { join, relative } from "node:path";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import type { SfaConfig } from "./config";
import type { ContextEntry, ContextType, WriteContextInput, SearchContextInput } from "./types";

const DEFAULT_CONTEXT_DIR = join(homedir(), ".local", "share", "single-file-agents", "context");

/**
 * Resolve the context store root path.
 * Priority: SFA_CONTEXT_STORE env → config contextStore.path → default
 */
export function resolveContextStorePath(config: SfaConfig): string {
  return (
    process.env.SFA_CONTEXT_STORE ??
    config.contextStore?.path ??
    DEFAULT_CONTEXT_DIR
  );
}

/**
 * Generate a compact ISO 8601 timestamp for filenames.
 * Format: 20260221T143022
 */
function compactTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").slice(0, 15);
}

/**
 * Generate YAML frontmatter from metadata.
 */
function generateFrontmatter(meta: {
  agent: string;
  sessionId?: string;
  timestamp: string;
  type: ContextType;
  tags?: string[];
  links?: string[];
}): string {
  const lines: string[] = ["---"];
  lines.push(`agent: ${meta.agent}`);
  if (meta.sessionId) {
    lines.push(`sessionId: ${meta.sessionId}`);
  }
  lines.push(`timestamp: ${meta.timestamp}`);
  lines.push(`type: ${meta.type}`);

  if (meta.tags && meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.join(", ")}]`);
  } else {
    lines.push("tags: []");
  }

  if (meta.links && meta.links.length > 0) {
    lines.push("links:");
    for (const link of meta.links) {
      lines.push(`  - "${link}"`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * Parse YAML frontmatter from a context file.
 * Returns the parsed metadata and the body content.
 */
function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } | null {
  if (!text.startsWith("---\n")) return null;
  const endIdx = text.indexOf("\n---\n", 4);
  if (endIdx < 0) return null;

  const yamlBlock = text.slice(4, endIdx);
  const body = text.slice(endIdx + 5);
  const meta: Record<string, unknown> = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Parse arrays: [item1, item2] or multi-line
    if (typeof value === "string" && (value as string).startsWith("[")) {
      const inner = (value as string).slice(1, -1);
      value = inner
        ? inner.split(",").map((s) => s.trim().replace(/^"|"$/g, ""))
        : [];
    }

    meta[key] = value;
  }

  // Handle multi-line links
  if (meta.links === undefined) {
    const linksMatch = yamlBlock.match(/^links:\s*$/m);
    if (linksMatch) {
      const links: string[] = [];
      const afterLinks = yamlBlock.slice(yamlBlock.indexOf("links:") + 6);
      for (const l of afterLinks.split("\n")) {
        const trimmed = l.trim();
        if (trimmed.startsWith("- ")) {
          links.push(trimmed.slice(2).replace(/^"|"$/g, ""));
        } else if (trimmed && !trimmed.includes(":")) {
          continue;
        } else {
          break;
        }
      }
      meta.links = links;
    }
  }

  return { meta, body };
}

/**
 * Write a context entry to the store.
 * Returns the absolute file path of the written entry.
 */
export function writeContext(
  input: WriteContextInput,
  agentName: string,
  sessionId: string | undefined,
  storePath: string,
): string {
  const now = new Date();
  const timestamp = now.toISOString();
  const compact = compactTimestamp(now);
  const filename = `${compact}-${input.slug}.md`;

  // Determine directory: agent/session/ or agent/
  let dir: string;
  if (sessionId) {
    dir = join(storePath, agentName, sessionId);
  } else {
    dir = join(storePath, agentName);
  }

  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, filename);
  const frontmatter = generateFrontmatter({
    agent: agentName,
    sessionId,
    timestamp,
    type: input.type,
    tags: input.tags,
    links: input.links,
  });

  const content = frontmatter + "\n" + input.content + "\n";
  writeFileSync(filePath, content);

  return filePath;
}

/**
 * Search the context store for entries matching the given criteria.
 * Uses file system scanning and text matching (no external dependencies).
 */
export function searchContext(
  query: SearchContextInput,
  storePath: string,
): ContextEntry[] {
  const results: ContextEntry[] = [];

  // Determine which directories to scan
  let agentDirs: string[];
  if (query.agent) {
    const agentDir = join(storePath, query.agent);
    try {
      readdirSync(agentDir);
      agentDirs = [agentDir];
    } catch {
      return [];
    }
  } else {
    try {
      agentDirs = readdirSync(storePath, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(storePath, d.name));
    } catch {
      return [];
    }
  }

  for (const agentDir of agentDirs) {
    scanDirectory(agentDir, storePath, query, results);
  }

  // Sort by timestamp descending (most recent first)
  results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return results;
}

/**
 * Recursively scan a directory for context files matching the query.
 */
function scanDirectory(
  dir: string,
  storePath: string,
  query: SearchContextInput,
  results: ContextEntry[],
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, storePath, query, results);
    } else if (entry.name.endsWith(".md")) {
      const parsed = parseContextFile(fullPath);
      if (parsed && matchesQuery(parsed, query)) {
        results.push(parsed);
      }
    }
  }
}

/**
 * Parse a context file into a ContextEntry.
 */
function parseContextFile(filePath: string): ContextEntry | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const parsed = parseFrontmatter(text);
  if (!parsed) return null;

  const { meta, body } = parsed;
  return {
    filePath,
    agent: String(meta.agent ?? ""),
    sessionId: meta.sessionId ? String(meta.sessionId) : undefined,
    timestamp: String(meta.timestamp ?? ""),
    type: String(meta.type ?? "finding") as ContextType,
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    links: Array.isArray(meta.links) ? meta.links.map(String) : [],
    content: body.trim(),
  };
}

/**
 * Check if a context entry matches the search query.
 */
function matchesQuery(entry: ContextEntry, query: SearchContextInput): boolean {
  if (query.agent && entry.agent !== query.agent) return false;
  if (query.type && entry.type !== query.type) return false;
  if (query.tags && query.tags.length > 0) {
    const hasMatchingTag = query.tags.some((t) => entry.tags.includes(t));
    if (!hasMatchingTag) return false;
  }
  if (query.query) {
    const lowerQuery = query.query.toLowerCase();
    const inContent = entry.content.toLowerCase().includes(lowerQuery);
    const inTags = entry.tags.some((t) => t.toLowerCase().includes(lowerQuery));
    if (!inContent && !inTags) return false;
  }
  return true;
}

/**
 * Update an existing context entry: replace content and append a changelog entry.
 */
export function updateContext(
  filePath: string,
  newContent: string,
  agentName: string,
  description: string,
): void {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Context file not found: ${filePath}`);
  }

  const parsed = parseFrontmatter(text);
  if (!parsed) {
    throw new Error(`Invalid context file format: ${filePath}`);
  }

  // Reconstruct the file: frontmatter + new content + changelog
  const frontmatterEnd = text.indexOf("\n---\n", 4);
  const frontmatter = text.slice(0, frontmatterEnd + 5);

  // Check if there's already a changelog section
  const changelogIdx = text.indexOf("\n## Changelog\n");
  let existingChangelog = "";
  if (changelogIdx >= 0) {
    existingChangelog = text.slice(changelogIdx + "\n## Changelog\n".length);
  }

  const timestamp = new Date().toISOString();
  const changelogEntry = `- ${timestamp} [${agentName}]: ${description}`;

  let updatedFile = frontmatter + "\n" + newContent + "\n";
  updatedFile += "\n## Changelog\n";
  if (existingChangelog) {
    updatedFile += existingChangelog.trimEnd() + "\n";
  }
  updatedFile += changelogEntry + "\n";

  writeFileSync(filePath, updatedFile);
}

/**
 * Add a link to an existing context entry's frontmatter.
 */
export function addContextLink(
  filePath: string,
  linkPath: string,
  storePath: string,
): void {
  let text: string;
  try {
    text = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Context file not found: ${filePath}`);
  }

  // Compute relative path from the store root
  const relPath = relative(storePath, linkPath);

  const parsed = parseFrontmatter(text);
  if (!parsed) {
    throw new Error(`Invalid context file format: ${filePath}`);
  }

  // Parse existing links
  const existingLinks: string[] = Array.isArray(parsed.meta.links)
    ? parsed.meta.links.map(String)
    : [];

  if (existingLinks.includes(relPath)) return; // Already linked

  existingLinks.push(relPath);

  // Rebuild the frontmatter with the new link
  const meta = parsed.meta;
  meta.links = existingLinks;

  const newFrontmatter = generateFrontmatter({
    agent: String(meta.agent),
    sessionId: meta.sessionId ? String(meta.sessionId) : undefined,
    timestamp: String(meta.timestamp),
    type: String(meta.type) as ContextType,
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : undefined,
    links: existingLinks,
  });

  const updatedFile = newFrontmatter + "\n" + parsed.body;
  writeFileSync(filePath, updatedFile);
}
