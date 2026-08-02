import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";

const IDENTITY_BASE = "https://id.nanoseil.com";
const PROFILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const API_KEY_RE = /^nsak_[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9._~-]{16,512}$/;
const LOCK_LEASE_MS = 30_000;

class IdentityNotFoundError extends Error {}

export interface StoredIdentity {
  version?: 1;
  profile?: string;
  account: { id: string; email?: string; username?: string; [key: string]: unknown };
  apiKey: string;
  createdAt: string;
  cwd?: string;
  base?: string;
}

export function profileDirectory(env: NodeJS.ProcessEnv = process.env): string {
  void env;
  return join(homedir(), ".nanoseil", "agent", "identities");
}

export function validateProfile(profile: string): string {
  if (!PROFILE_RE.test(profile)) throw new Error("Profile must be 1-64 safe filename characters");
  return profile;
}

export function profilePath(profile: string, directory = profileDirectory()): string {
  return join(directory, `profile-${validateProfile(profile)}.json`);
}

export function identityKey(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 32);
}

export function cwdIdentityPath(cwd: string, directory = profileDirectory()): string {
  return join(directory, `${identityKey(cwd)}.json`);
}

export function resolveProfile(explicit?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const selected = explicit ?? env.NSID_PROFILE;
  return selected ? validateProfile(selected) : undefined;
}

function validIdentity(value: unknown): value is StoredIdentity {
  const v = value as Partial<StoredIdentity> | null;
  return !!v && (v.version === undefined || v.version === 1) &&
    (v.profile === undefined || PROFILE_RE.test(v.profile)) && typeof v.createdAt === "string" &&
    !!v.account && typeof v.account === "object" && !Array.isArray(v.account) &&
    typeof v.account.id === "string" && v.account.id.length >= 1 && v.account.id.length <= 128 &&
    (v.account.email === undefined || typeof v.account.email === "string") &&
    (v.account.username === undefined || typeof v.account.username === "string") &&
    API_KEY_RE.test(v.apiKey ?? "");
}

async function assertSecureNode(path: string, kind: "file" | "directory", mode: number): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link at ${path}`);
  if (kind === "file" ? !info.isFile() : !info.isDirectory()) throw new Error(`Expected secure ${kind} at ${path}`);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error(`Refusing ${path}: wrong owner`);
  if ((info.mode & 0o777) !== mode) throw new Error(`Refusing ${path}: expected mode ${mode.toString(8)}`);
}

async function ensureSecureDirectory(path: string): Promise<void> {
  try { await assertSecureNode(path, "directory", 0o700); return; }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  await assertSecureNode(path, "directory", 0o700);
}

export async function loadIdentity(profile: string, directory = profileDirectory()): Promise<StoredIdentity> {
  return loadIdentityAt(profilePath(profile, directory), profile);
}

export async function loadCwdIdentity(cwd: string, directory = profileDirectory()): Promise<StoredIdentity> {
  return loadIdentityAt(cwdIdentityPath(cwd, directory));
}

async function loadIdentityAt(path: string, expectedProfile?: string): Promise<StoredIdentity> {
  let raw: string;
  try {
    await assertSecureNode(dirname(path), "directory", 0o700);
    await assertSecureNode(path, "file", 0o600);
    raw = await readFile(path, "utf8");
  }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT")
      throw new IdentityNotFoundError("No identity exists for this selection. Run identity create first.");
    throw cause;
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("Corrupt identity file; refusing to create or overwrite it"); }
  if (!validIdentity(value) || (expectedProfile && value.profile !== expectedProfile)) throw new Error("Invalid identity file");
  return value;
}

async function atomicWrite(path: string, data: string): Promise<void> {
  const directory = dirname(path);
  await ensureSecureDirectory(directory);
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, data, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
    await assertSecureNode(path, "file", 0o600);
  } finally { await rm(temporary, { force: true }); }
}

interface LockRecord { nonce: string; ownerPid: number; host: string; createdAt: string; leaseUntil: number }

function pidIsActive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (cause) { return (cause as NodeJS.ErrnoException).code === "EPERM"; }
}

async function acquireLock(path: string, timeoutMs = 15_000): Promise<() => Promise<void>> {
  const started = Date.now();
  await ensureSecureDirectory(dirname(path));
  const nonce = randomBytes(16).toString("hex");
  const record: LockRecord = { nonce, ownerPid: process.pid, host: hostname(), createdAt: new Date().toISOString(), leaseUntil: Date.now() + LOCK_LEASE_MS };
  while (true) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      return async () => {
        await handle.close();
        const current = JSON.parse(await readFile(path, "utf8").catch(() => "null")) as LockRecord | null;
        if (current?.nonce === nonce) await rm(path, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await assertSecureNode(path, "file", 0o600);
      let stale: LockRecord;
      try { stale = JSON.parse(await readFile(path, "utf8")) as LockRecord; }
      catch { throw new Error("Invalid profile lock; refusing unsafe recovery"); }
      const reclaimable = stale.host === hostname() && Number.isInteger(stale.ownerPid) &&
        Number.isFinite(stale.leaseUntil) && stale.leaseUntil < Date.now() && !pidIsActive(stale.ownerPid);
      if (reclaimable) {
        const again = JSON.parse(await readFile(path, "utf8")) as LockRecord;
        if (again.nonce === stale.nonce) await rm(path);
        continue;
      }
      if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for profile creation lock");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export async function createIdentity(profile: string, options: {
  directory?: string; fetchFn?: typeof fetch; name?: string; cwd?: string; cwdDerived?: boolean;
} = {}): Promise<{ identity: StoredIdentity; created: boolean }> {
  validateProfile(profile);
  const directory = options.directory ?? profileDirectory();
  const cwd = options.cwd ?? process.cwd();
  const path = options.cwdDerived ? cwdIdentityPath(cwd, directory) : profilePath(profile, directory);
  const release = await acquireLock(`${path}.lock`);
  try {
    try { return { identity: await loadIdentityAt(path, options.cwdDerived ? undefined : profile), created: false }; }
    catch (cause) { if (!(cause instanceof IdentityNotFoundError)) throw cause; }
    const recoveryPath = `${path}.recovery.json`;
    try {
      await assertSecureNode(recoveryPath, "file", 0o600);
      const recovery = JSON.parse(await readFile(recoveryPath, "utf8")) as { accountId?: string };
      throw new Error(`Identity persistence recovery is required for account ${recovery.accountId ?? "unknown"}; refusing another signup`);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    const name = options.name ?? profile.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20);
    if (!/^[a-z0-9-]{3,20}$/.test(name)) throw new Error("Identity name must be 3-20 lowercase letters, digits, or hyphens");
    let response: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      response = await (options.fetchFn ?? fetch)(`${IDENTITY_BASE}/api/auth/signup/agent`, {
        method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ name })
      });
      if (response.status !== 429 || attempt === 4) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000 * 2 ** attempt, 8_000)));
    }
    if (!response?.ok) throw new Error(`Identity creation failed (${response?.status ?? "network"})`);
    const body = await response.json() as { account?: StoredIdentity["account"]; apiKey?: string };
    if (!body.account?.id || !body.apiKey || !API_KEY_RE.test(body.apiKey)) throw new Error("Identity returned an invalid response");
    const identity: StoredIdentity = options.cwdDerived
      ? { account: body.account, apiKey: body.apiKey, base: IDENTITY_BASE, cwd, createdAt: new Date().toISOString() }
      : { version: 1, profile, account: body.account, apiKey: body.apiKey, createdAt: new Date().toISOString() };
    await atomicWrite(recoveryPath, `${JSON.stringify({ version: 1, profile, accountId: body.account.id, createdAt: identity.createdAt }, null, 2)}\n`);
    try { await atomicWrite(path, `${JSON.stringify(identity, null, 2)}\n`); }
    catch (cause) { throw new Error(`Identity created but secure persistence failed; recovery marker retained: ${cause instanceof Error ? cause.message : String(cause)}`); }
    await rm(recoveryPath);
    return { identity, created: true };
  } finally { await release(); }
}
