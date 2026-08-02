export type ServerName = "nsos";
export type KnownServerName = ServerName | "islands";

export const SERVER_REGISTRY: Readonly<Record<KnownServerName, { url: string; active: boolean; activationGate?: string }>> = Object.freeze({
  nsos: { url: "https://nsos.nanoseil.com/mcp", active: true },
  islands: {
    url: "https://islands.nanoseil.com/mcp",
    active: false,
    activationGate: "deployed /SKILL.md 200, unauthenticated /mcp 401, authenticated initialize success"
  }
});

export function resolveServer(name: string): URL {
  if (name !== "nsos") {
    throw new Error(`Server '${name}' is not in the active release registry`);
  }
  const server = SERVER_REGISTRY[name];
  return new URL(server.url);
}

export function assertAllowedUpstream(url: URL): void {
  const exact = Object.values(SERVER_REGISTRY).filter((server) => server.active).map((server) => server.url);
  if (!exact.includes(url.href)) throw new Error("Upstream is not in the exact production allowlist");
}
