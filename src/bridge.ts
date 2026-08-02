import { createInterface } from "node:readline";
import { assertAllowedUpstream } from "./servers.js";
import { redact } from "./redact.js";

type JsonRpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; [key: string]: unknown };

const STRIPPED = new Set([
  "authorization", "cookie", "proxy-authorization", "x-forwarded-for", "x-forwarded-host",
  "x-forwarded-proto", "forwarded", "x-real-ip", "x-nanoseil-identity", "identity"
]);

export function upstreamHeaders(apiKey: string, sessionId?: string): Headers {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return headers;
}

export function sanitizeHeaders(input: Headers): Headers {
  const output = new Headers();
  for (const [key, value] of input) if (!STRIPPED.has(key.toLowerCase())) output.set(key, value);
  return output;
}

function rpcError(id: JsonRpc["id"], code: number, message: string): JsonRpc {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function parseSse(response: Response, emit: (message: JsonRpc) => void): Promise<void> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, boundary);
      const separator = buffer.slice(boundary).startsWith("\r\n") ? 4 : 2;
      buffer = buffer.slice(boundary + separator);
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (data) emit(JSON.parse(data) as JsonRpc);
    }
  }
}

export interface BridgeOptions {
  upstream: URL;
  apiKey: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
  fetchFn?: typeof fetch;
}

export async function runBridge(options: BridgeOptions): Promise<void> {
  assertAllowedUpstream(options.upstream);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const error = options.error ?? process.stderr;
  const fetchFn = options.fetchFn ?? fetch;
  let sessionId: string | undefined;
  let stopped = false;
  let getAbort: AbortController | undefined;
  const inFlight = new Map<string, AbortController>();
  const emit = (message: JsonRpc): void => { output.write(`${JSON.stringify(message)}\n`); };

  const openServerStream = (): void => {
    if (!sessionId || getAbort) return;
    getAbort = new AbortController();
    void fetchFn(options.upstream, {
      method: "GET", redirect: "error", headers: upstreamHeaders(options.apiKey, sessionId), signal: getAbort.signal
    }).then(async (response) => {
      if (response.status === 405) return;
      if (!response.ok) throw new Error(`Upstream event stream failed (${response.status})`);
      await parseSse(response, emit);
    }).catch((cause) => {
      if (!getAbort?.signal.aborted) error.write(`nsid-mcp-auth: ${redact(cause)}\n`);
    }).finally(() => { getAbort = undefined; });
  };

  const handle = async (message: JsonRpc): Promise<void> => {
    const key = message.id === undefined || message.id === null ? undefined : String(message.id);
    const cancelledId = message.method === "notifications/cancelled"
      ? (message.params as { requestId?: string | number } | undefined)?.requestId : undefined;
    if (cancelledId !== undefined) inFlight.get(String(cancelledId))?.abort();
    const controller = new AbortController();
    if (key) inFlight.set(key, controller);
    try {
      const response = await fetchFn(options.upstream, {
        method: "POST", redirect: "error", headers: upstreamHeaders(options.apiKey, sessionId),
        body: JSON.stringify(message), signal: controller.signal
      });
      const assigned = response.headers.get("mcp-session-id");
      if (assigned) sessionId = assigned;
      if (response.status === 401 || response.status === 403) {
        stopped = true;
        emit(rpcError(message.id, -32001, "Nanoseil credential rejected; run identity create or repair the profile"));
        return;
      }
      if (!response.ok) {
        emit(rpcError(message.id, response.status >= 500 ? -32003 : -32002, `Upstream MCP failed (${response.status})`));
        return;
      }
      if (response.status !== 202 && response.status !== 204) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream")) await parseSse(response, emit);
        else if (contentType.includes("application/json")) emit(await response.json() as JsonRpc);
        else throw new Error("Upstream returned an unsupported content type");
      }
      if (message.method === "initialize") openServerStream();
    } catch (cause) {
      if (!controller.signal.aborted) emit(rpcError(message.id, -32003, `Upstream unavailable: ${redact(cause)}`));
    } finally {
      if (key && inFlight.get(key) === controller) inFlight.delete(key);
    }
  };

  const pending = new Set<Promise<void>>();
  const lines = createInterface({ input });
  for await (const line of lines) {
    if (!line.trim() || stopped) continue;
    let message: JsonRpc;
    try { message = JSON.parse(line) as JsonRpc; }
    catch { emit(rpcError(null, -32700, "Invalid JSON-RPC input")); continue; }
    const task = handle(message);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  await Promise.allSettled([...pending]);
  getAbort?.abort();
  if (sessionId) {
    await fetchFn(options.upstream, { method: "DELETE", redirect: "error", headers: upstreamHeaders(options.apiKey, sessionId) }).catch(() => undefined);
  }
}
