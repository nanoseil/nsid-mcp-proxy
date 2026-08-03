import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { ServerName } from "./servers.js";

export type ClientName = "claude" | "codex";

const require = createRequire(import.meta.url);
const packageManifest = require("../package.json") as { name?: unknown; version?: unknown };
if (packageManifest.name !== "@nanoseil/nsid-mcp-auth" || typeof packageManifest.version !== "string") {
  throw new Error("Invalid nsid-mcp-auth package manifest");
}
export const PACKAGE_VERSION = packageManifest.version;

function commandArgs(profile: string | undefined, server: ServerName): string[] {
  return ["-y", `@nanoseil/nsid-mcp-auth@${PACKAGE_VERSION}`, ...(profile ? ["--profile", profile] : []), "--server", server];
}

export function renderedEntry(client: ClientName, profile: string | undefined, server: ServerName): string {
  const name = `nanoseil-${server}`;
  if (client === "claude") return JSON.stringify({ [name]: { type: "stdio", command: "npx", args: commandArgs(profile, server) } }, null, 2);
  return `[mcp_servers.${name}]\ncommand = "npx"\nargs = ${JSON.stringify(commandArgs(profile, server))}`;
}

async function atomicText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export interface SetupPlan { target: string; existing: string; next: string; changed: boolean }

export async function planSetup(client: ClientName, profile: string | undefined, server: ServerName, path?: string): Promise<SetupPlan> {
  const target = path ?? (client === "claude" ? join(homedir(), ".claude.json") : join(homedir(), ".codex", "config.toml"));
  let existing = "";
  try { existing = await readFile(target, "utf8"); } catch { /* new file */ }
  const name = `nanoseil-${server}`;
  let next: string;
  if (client === "claude") {
    let root: Record<string, unknown> = {};
    if (existing.trim()) root = JSON.parse(existing) as Record<string, unknown>;
    const current = (root.mcpServers && typeof root.mcpServers === "object" ? root.mcpServers : {}) as Record<string, unknown>;
    current[name] = { type: "stdio", command: "npx", args: commandArgs(profile, server) };
    root.mcpServers = current;
    next = `${JSON.stringify(root, null, 2)}\n`;
  } else {
    const start = `# nsid-mcp-auth:${name}:start`;
    const end = `# nsid-mcp-auth:${name}:end`;
    const block = `${start}\n${renderedEntry(client, profile, server)}\n${end}`;
    const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
    next = existing.match(pattern) ? existing.replace(pattern, block) : `${existing.trimEnd()}${existing ? "\n\n" : ""}${block}\n`;
  }
  return { target, existing, next, changed: next !== existing };
}

export function previewPlan(plan: SetupPlan): string {
  if (!plan.changed) return `No changes: ${plan.target}`;
  return [`--- ${plan.target}`, `+++ ${plan.target}`, "@@ generated configuration @@", plan.next].join("\n");
}

export async function applySetup(plan: SetupPlan): Promise<string> {
  if (!plan.changed) return plan.target;
  if (plan.existing) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${plan.target}.bak.${stamp}`;
    await copyFile(plan.target, backup);
    await chmod(backup, 0o600);
  }
  await atomicText(plan.target, plan.next);
  return plan.target;
}

export async function updateSetup(client: ClientName, profile: string | undefined, server: ServerName, path?: string): Promise<string> {
  return applySetup(await planSetup(client, profile, server, path));
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
