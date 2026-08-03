# B-plan spike: `@nanoseil/nsid-mcp-auth`

Status: pre-release design and local tarball only. No npm publish has occurred.

## Public CLI surface

```text
nsid-mcp-auth [--profile <persona>] --server <active-alias>
nsid-mcp-auth identity create [--profile <persona>] [--name <agent-name>]
nsid-mcp-auth setup <claude|codex> [--profile <persona>] --server <active-alias> [--yes]
```

The default selection is the legacy-compatible raw-cwd hash record. A
profile/persona is an explicit override. Only a
built-in server alias is accepted. There is no
token option, URL option, HTTP listener, install script, or postinstall script.
Before stable release, generated configuration pins the reviewed exact version
`@nanoseil/nsid-mcp-auth@0.1.0-next.1`.

## Transport state machine

```text
START
  -> load profile (missing/invalid -> STOP)
  -> accept newline-delimited JSON-RPC on stdio
  -> POST message to exact upstream, redirect:error, broker Bearer only
     -> initialize response: capture Mcp-Session-Id -> open authenticated GET SSE
     -> JSON response: emit one JSON-RPC line to stdout
     -> SSE response: emit each data JSON-RPC message to stdout
     -> 202/204: emit nothing
     -> 401/403: emit sanitized credential error -> CREDENTIAL_STOPPED
     -> 4xx: sanitized request failure, session remains usable
     -> 5xx/network/timeout: sanitized retryable failure, fail closed
  -> notifications/cancelled: abort matching POST and forward notification
  -> stdin EOF/signal: abort GET, settle requests, authenticated DELETE session
  -> STOP
```

One broker process has one profile and one exact upstream. Session IDs never
cross that boundary. A stateless upstream that issues no session ID uses POST
only: the broker neither opens GET nor sends DELETE and never invents an ID.
Islands uses that contract (POST JSON/SSE, cancellation by POST abort). A
sessionful upstream gets GET/DELETE only after it explicitly returns
`Mcp-Session-Id`. GET reconnect/resumption against a sessionful real upstream
remains a P0 E2E gate; the spike does not claim it complete.

The canonical Islands URL is confirmed but not production-active. Activation
requires route deployment, then Islands-owned smoke proving
`/SKILL.md` 200, unauthenticated MCP 401, and authenticated initialize success.
Until then `--server islands` fails before credential transmission. The local
`islands-local -> http://localhost:3000/mcp` fixture belongs only to a separate
dev/test build and is absent from the release manifest and public CLI.

## Package manifest and release ladder

- package: `@nanoseil/nsid-mcp-auth@0.1.0-next.1`
- bin: `nsid-mcp-auth`
- Node: `>=20.12`
- runtime dependencies: zero
- package files: `dist`, `README.md`, `LICENSE`, manifest
- publish configuration: public, provenance, `next` tag
- no lifecycle scripts other than `prepack` compilation; no install/postinstall
- registry availability: package currently returns npm 404
- ownership/2FA: not verified because the execution identity is not logged into npm
- `latest` promotion requires security/E2E findings zero and explicit SoRA GO

## Threat model

| Threat | P0 control | Gate |
| --- | --- | --- |
| Credential in argv/config | no token option; profile lookup only | argv/config snapshots contain no `nsak_` |
| Open-proxy/SSRF | aliases map to exact HTTPS URLs; inactive aliases fail closed | unknown/inactive alias and redirects rejected |
| Credential forwarding to redirect | `redirect: error` | redirect negative test |
| Client credential/header smuggling | stdio carries JSON-RPC only; broker constructs HTTP headers | stripping/unit review |
| Token in logs/errors | response bodies not echoed; centralized redaction | stderr, exception, snapshot, tarball scan |
| Identity multiplication after revoke | 401 never signs up | 401 no-resignup test |
| Concurrent first run | per-profile exclusive lock and atomic 0600 rename | concurrent creation test |
| Config destruction | preview, explicit confirm, `.bak`, atomic write | idempotence/backup tests |
| Supply-chain execution | zero runtime deps, no install/postinstall, lockfile/provenance | tarball and manifest review |

Crash dumps and npm debug logs are environment-level risks: the broker never
passes a token via argv or npm configuration, and publish/install smoke scans
the selected temp cache plus tarball before release.

## Generated settings

Claude:

```json
{
  "mcpServers": {
    "nanoseil-islands": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@nanoseil/nsid-mcp-auth@0.1.0-next.1", "--server", "nsos"]
    }
  }
}
```

Codex:

```toml
[mcp_servers.nanoseil-islands]
command = "npx"
args = ["-y", "@nanoseil/nsid-mcp-auth@0.1.0-next.1", "--server", "nsos"]
```

The NSOS direct `bearer_token_env_var` path is not modified by this package.
Migration remains opt-in and rollback-compatible.

## Local tarball result

The reviewed spike tarball contains 31 files, is 14.0 kB compressed / 49.9 kB
unpacked, and contains no runtime dependency tree. Fresh-temp `npx` smoke and
secret scans are recorded separately from the source. Real
Claude/Codex/NSOS/Islands and Identity revoke E2E remain release gates.
