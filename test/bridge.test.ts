import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runBridge, sanitizeHeaders, upstreamHeaders } from "../src/bridge.js";

async function execute(responses: Response[], inputLines: object[]) {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors = new PassThrough();
  let text = "";
  output.on("data", (chunk) => { text += chunk.toString(); });
  const fetchFn = vi.fn(async () => responses.shift() ?? new Response(null, { status: 405 }));
  const promise = runBridge({ upstream: new URL("https://nsos.nanoseil.com/mcp"), apiKey: "nsak_id.secret", input, output, error: errors, fetchFn });
  for (const line of inputLines) input.write(`${JSON.stringify(line)}\n`);
  input.end();
  await promise;
  return { fetchFn, text };
}

describe("stdio bridge", () => {
  it("passes initialize JSON and carries the assigned session", async () => {
    const { fetchFn, text } = await execute([
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200, headers: { "content-type": "application/json", "mcp-session-id": "session-1" }
      }),
      new Response(null, { status: 405 }),
      new Response(null, { status: 200 })
    ], [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
    expect(text).toContain('"id":1');
    expect((fetchFn.mock.calls[1]?.[1] as RequestInit).method).toBe("GET");
    expect(new Headers((fetchFn.mock.calls[1]?.[1] as RequestInit).headers).get("mcp-session-id")).toBe("session-1");
    expect((fetchFn.mock.calls.at(-1)?.[1] as RequestInit).method).toBe("DELETE");
  });

  it("does not invent a session or call GET/DELETE for a stateless upstream", async () => {
    const { fetchFn, text } = await execute([
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200, headers: { "content-type": "application/json" }
      })
    ], [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
    expect(text).toContain('"id":1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
    expect(new Headers((fetchFn.mock.calls[0]?.[1] as RequestInit).headers).has("mcp-session-id")).toBe(false);
  });

  it("stops after 401 without signup or credential leakage", async () => {
    const { fetchFn, text } = await execute([new Response(null, { status: 401 })], [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" }
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(text).toContain("credential rejected");
    expect(text).not.toContain("nsak_");
  });

  it("fails closed on redirect", async () => {
    const fetchFn = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect mode is set to error");
    });
    const input = new PassThrough(); const output = new PassThrough();
    let text = ""; output.on("data", (c) => { text += c.toString(); });
    const pending = runBridge({ upstream: new URL("https://nsos.nanoseil.com/mcp"), apiKey: "nsak_id.secret", input, output, fetchFn });
    input.end('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    await pending;
    expect(text).toContain("Upstream unavailable");
  });

  it("aborts an in-flight request when stdio sends cancelled", async () => {
    const input = new PassThrough(); const output = new PassThrough();
    let aborted = false;
    const fetchFn = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id?: number };
      if (body.id === 7) return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); });
      });
      return new Response(null, { status: 202 });
    });
    const pending = runBridge({ upstream: new URL("https://nsos.nanoseil.com/mcp"), apiKey: "nsak_id.secret", input, output, fetchFn });
    input.write('{"jsonrpc":"2.0","id":7,"method":"tools/call"}\n');
    await new Promise((resolve) => setTimeout(resolve, 5));
    input.write('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}}\n');
    input.end();
    await pending;
    expect(aborted).toBe(true);
  });
});

describe("headers", () => {
  it("strips credentials and forwarding identity", () => {
    const result = sanitizeHeaders(new Headers({ authorization: "bad", cookie: "bad", "x-forwarded-for": "bad", accept: "ok" }));
    expect([...result]).toEqual([["accept", "ok"]]);
    expect(upstreamHeaders("nsak_id.secret").get("authorization")).toBe("Bearer nsak_id.secret");
  });
});
