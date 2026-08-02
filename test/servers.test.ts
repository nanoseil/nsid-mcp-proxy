import { describe, expect, it } from "vitest";
import { assertAllowedUpstream, resolveServer, SERVER_REGISTRY } from "../src/servers.js";

describe("release server manifest", () => {
  it("fails closed for Islands until deployment smoke activates it", () => {
    expect(SERVER_REGISTRY.islands).toMatchObject({ url: "https://islands.nanoseil.com/mcp", active: false });
    expect(() => resolveServer("islands")).toThrow(/not in the active/);
    expect(() => assertAllowedUpstream(new URL(SERVER_REGISTRY.islands.url))).toThrow(/allowlist/);
  });

  it("rejects alternate NSOS paths, ports, and subdomains", () => {
    expect(resolveServer("nsos").href).toBe("https://nsos.nanoseil.com/mcp");
    for (const value of ["https://nsos.nanoseil.com/other", "https://nsos.nanoseil.com:444/mcp", "https://evil.nsos.nanoseil.com/mcp"])
      expect(() => assertAllowedUpstream(new URL(value))).toThrow(/allowlist/);
  });
});
