#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runBridge } from "./bridge.js";
import { createIdentity, identityKey, loadCwdIdentity, loadIdentity, resolveProfile } from "./identity.js";
import { redact } from "./redact.js";
import { resolveServer, type ServerName } from "./servers.js";
import { applySetup, planSetup, previewPlan, type ClientName } from "./setup.js";

const HELP = `nsid-mcp-auth — Nanoseil Identity credential broker

Usage:
  nsid-mcp-auth [--profile <name>] --server <nsos>
  nsid-mcp-auth identity create [--profile <name>] [--name <agent-name>]
  nsid-mcp-auth setup <claude|codex> [--profile <name>] --server <nsos> [--yes]

The default command is an MCP stdio server. Credentials are read from the selected
profile and are never accepted in arguments or generated client configuration.`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function confirm(): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const lines = createInterface({ input: stdin, output: stdout });
  try { return /^(y|yes)$/i.test((await lines.question("Apply this configuration? [y/N] ")).trim()); }
  finally { lines.close(); }
}

async function main(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length === 0) { stdout.write(`${HELP}\n`); return; }
  const profile = resolveProfile(option(args, "--profile"));
  const cwd = process.cwd();
  if (args[0] === "identity") {
    if (args[1] !== "create") throw new Error("Only 'identity create' is supported");
    const requestedName = option(args, "--name");
    const selection = profile ?? identityKey(cwd);
    const result = await createIdentity(selection, { ...(requestedName ? { name: requestedName } : {}), cwd, cwdDerived: !profile });
    stdout.write(`${result.created ? "Created" : "Reused"} ${profile ? `identity profile '${profile}'` : "cwd identity"} (${result.identity.account.id}).\n`);
    return;
  }
  const server = option(args, "--server") as ServerName | undefined;
  if (!server) throw new Error("--server is required");
  const upstream = resolveServer(server);
  if (args[0] === "setup") {
    const client = args[1] as ClientName;
    if (client !== "claude" && client !== "codex") throw new Error("setup client must be claude or codex");
    const plan = await planSetup(client, profile, server);
    stdout.write(`${previewPlan(plan)}\n`);
    if (!args.includes("--yes") && !(await confirm())) throw new Error("Configuration was not changed (pass --yes for non-interactive use)");
    const path = await applySetup(plan);
    stdout.write(`Updated ${path}\n`);
    return;
  }
  const identity = profile ? await loadIdentity(profile) : await loadCwdIdentity(cwd);
  await runBridge({ upstream, apiKey: identity.apiKey });
}

main(process.argv.slice(2)).catch((cause) => {
  process.stderr.write(`nsid-mcp-auth: ${redact(cause)}\n`);
  process.exitCode = 1;
});
