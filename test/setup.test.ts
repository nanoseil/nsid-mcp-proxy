import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateSetup } from "../src/setup.js";

describe("setup generator", () => {
  it("updates Claude JSON idempotently and preserves unrelated entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-setup-"));
    const path = join(directory, "claude.json");
    await writeFile(path, '{"unrelated":true}\n');
    await updateSetup("claude", "persona", "islands", path);
    const first = await readFile(path, "utf8");
    const backup = (await readdir(directory)).find((name) => name.startsWith("claude.json.bak."));
    expect(backup).toBeTruthy();
    expect(await readFile(join(directory, backup!), "utf8")).toBe('{"unrelated":true}\n');
    await updateSetup("claude", "persona", "islands", path);
    expect(await readFile(path, "utf8")).toBe(first);
    expect(JSON.parse(first)).toMatchObject({ unrelated: true });
    expect(first).not.toContain("nsak_");
  });

  it("replaces only its marked Codex block", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-setup-"));
    const path = join(directory, "config.toml");
    await updateSetup("codex", "one", "nsos", path);
    await updateSetup("codex", "two", "nsos", path);
    const text = await readFile(path, "utf8");
    expect(text.match(/nsid-mcp-auth:nanoseil-nsos:start/g)).toHaveLength(1);
    expect(text).toContain('"two"');
    expect(text).not.toContain('"one"');
  });

  it("omits profile by default so the broker uses the launch cwd", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nsid-setup-"));
    const path = join(directory, "config.toml");
    await updateSetup("codex", undefined, "nsos", path);
    const text = await readFile(path, "utf8");
    expect(text).not.toContain("--profile");
    expect(text).toContain('"--server","nsos"');
  });
});
