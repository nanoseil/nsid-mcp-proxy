import { chmod, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIdentity, cwdIdentityPath, identityKey, loadCwdIdentity, loadIdentity, profilePath, resolveProfile } from "../src/identity.js";

describe("identity profiles", () => {
  it("creates once under concurrent first run and stores mode 0600", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-identity-"));
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      account: { id: "account-1", username: "persona" }, apiKey: "nsak_id.0123456789abcdef"
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const [a, b] = await Promise.all([
      createIdentity("persona", { directory, fetchFn }),
      createIdentity("persona", { directory, fetchFn })
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect((await stat(profilePath("persona", directory))).mode & 0o777).toBe(0o600);
    expect((await loadIdentity("persona", directory)).apiKey).toBe("nsak_id.0123456789abcdef");
    expect(await readFile(profilePath("persona", directory), "utf8")).not.toContain(".tmp");
  });

  it("does not expose an Identity response body on failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-identity-"));
    const fetchFn = vi.fn(async () => new Response("nsak_leaked.secret", { status: 503 }));
    await expect(createIdentity("persona", { directory, fetchFn })).rejects.not.toThrow(/nsak_/);
  });

  it("fails closed on corrupt profile instead of creating another identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-corrupt-"));
    const path = profilePath("persona", directory);
    await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
      await mkdir(join(directory, "profiles"), { recursive: true, mode: 0o700 });
      await writeFile(path, "{broken", { mode: 0o600 });
    });
    const fetchFn = vi.fn();
    await expect(createIdentity("persona", { directory, fetchFn })).rejects.toThrow(/Corrupt identity/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects insecure modes and profile symlinks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-permissions-"));
    await mkdir(join(directory, "profiles"), { mode: 0o700 });
    const target = join(directory, "target.json");
    await writeFile(target, JSON.stringify({ version: 1, profile: "persona", account: { id: "id" }, apiKey: "nsak_id.0123456789abcdef", createdAt: new Date().toISOString() }), { mode: 0o600 });
    await symlink(target, profilePath("persona", directory));
    await expect(loadIdentity("persona", directory)).rejects.toThrow(/symbolic link/);
    await import("node:fs/promises").then(({ rm }) => rm(profilePath("persona", directory)));
    await writeFile(profilePath("persona", directory), await readFile(target), { mode: 0o644 });
    await chmod(profilePath("persona", directory), 0o644);
    await expect(loadIdentity("persona", directory)).rejects.toThrow(/expected mode 600/);
  });

  it("retries only 429 with bounded attempts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-backoff-"));
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ account: { id: "id" }, apiKey: "nsak_id.0123456789abcdef" }), { status: 200 }));
    await createIdentity("persona", { directory, fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  }, 3_000);

  it("uses the legacy cwd hash and record by default without rewriting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-cwd-"));
    const cwd = "/work/Project/../project";
    expect(identityKey(cwd)).toBe("fd16856326789ae62ac70f61fd2cf88a");
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ account: { id: "id" }, apiKey: "nsak_id.0123456789abcdef" }), { status: 200 }));
    await createIdentity(identityKey(cwd), { directory, cwd, cwdDerived: true, fetchFn });
    const before = await readFile(cwdIdentityPath(cwd, directory), "utf8");
    expect((await loadCwdIdentity(cwd, directory)).cwd).toBe(cwd);
    await createIdentity(identityKey(cwd), { directory, cwd, cwdDerived: true, fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await readFile(cwdIdentityPath(cwd, directory), "utf8")).toBe(before);
  });

  it("reads an nsos-codex legacy fixture in place without token copying", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-legacy-fixture-"));
    const cwd = "/work/existing-project";
    const fixtureUrl = new URL("./fixtures/nsos-codex-legacy-identity.json", import.meta.url);
    const fixture = (await readFile(fixtureUrl, "utf8")).replace("<API_KEY>", `nsak_fixture.${"x".repeat(32)}`);
    await writeFile(cwdIdentityPath(cwd, directory), fixture, { mode: 0o600 });
    const before = await readFile(cwdIdentityPath(cwd, directory), "utf8");
    const loaded = await loadCwdIdentity(cwd, directory);
    expect(loaded.account.id).toBe("legacy-account-id");
    expect(loaded.account.plan).toBe("member");
    expect(loaded.account.futureIdentityField).toEqual({ enabled: true });
    expect(await readFile(cwdIdentityPath(cwd, directory), "utf8")).toBe(before);
    expect((await readdir(directory)).filter((name) => name.endsWith(".json"))).toEqual([`${identityKey(cwd)}.json`]);
  });

  it("does not signup during a normal load when the cwd identity is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-cwd-missing-"));
    const fetchFn = vi.fn();
    await expect(loadCwdIdentity("/work/missing", directory)).rejects.toThrow(/identity exists/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("keeps distinct raw cwd strings on distinct hashes without normalization", () => {
    expect(identityKey("/work/project")).not.toBe(identityKey("/work/Project"));
    expect(identityKey("/work/project")).not.toBe(identityKey("/work/other/../project"));
    expect(identityKey("/work/project")).not.toBe(identityKey("/symlink/project"));
  });

  it("treats profile as an explicit override only", () => {
    expect(resolveProfile(undefined, {})).toBeUndefined();
    expect(resolveProfile("explicit", { NSID_PROFILE: "environment" })).toBe("explicit");
    expect(resolveProfile(undefined, { NSID_PROFILE: "environment" })).toBe("environment");
  });
});
