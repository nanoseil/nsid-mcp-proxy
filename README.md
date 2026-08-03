# @nanoseil/nsid-mcp-auth

Local stdio credential broker for Nanoseil MCP services. It keeps the Nanoseil
Identity API key outside Claude/Codex configuration and forwards MCP JSON-RPC to
one exact, built-in production endpoint.

## Requirements

- Node.js 20.12 or newer
- macOS, Linux, or WSL for P0. Native Windows invocation is not yet verified.

## Create an identity explicitly

```bash
npx -y @nanoseil/nsid-mcp-auth@0.1.0-next.0 identity create
```

By default the identity lives at
`~/.nanoseil/agent/identities/<sha256(cwd)[:32]>.json`, matching the existing
NSOS identity contract. The exact cwd string is hashed without realpath or case
normalization. A different checkout, symlink path, or container path can
therefore select a different identity. The directory is mode 0700 and files are
written atomically with mode 0600.

`--profile` or `NSID_PROFILE` remains an explicit override; normal use does not
require it.

P0 supports only the canonical default identity directory above.

- `NANOSEIL_IDENTITY_DIR` is not consumed by the broker.
- `NSID_IDENTITY_FILE` is not consumed by the broker.
- An nsos-codex proxy launch must fail before starting the broker when either
  legacy path override is active. Direct mode remains the rollback path.

Supporting an override later requires canonical-root containment and cwd-key
validation; the broker will not accept an arbitrary identity file path.

The broker never creates a replacement identity after a 401. Repair or create a
profile explicitly instead.

## Run as an MCP stdio server

```bash
npx -y @nanoseil/nsid-mcp-auth@0.1.0-next.0 --server nsos
```

The production allowlist is exact:

- `https://nsos.nanoseil.com/mcp`
- `https://islands.nanoseil.com/mcp` (canonical URL confirmed; disabled pending deployment and three-point smoke)

The Islands alias fails closed before sending a credential while disabled. It is
not part of the active production allowlist. Arbitrary URLs and redirects are rejected. Client-provided credentials are not
forwarded; only the broker adds the profile's Bearer credential.

## Generate client configuration

The command displays the proposed entry and prompts before changing a file.
Use `--yes` only after reviewing it.

```bash
npx -y @nanoseil/nsid-mcp-auth@0.1.0-next.0 setup claude --server nsos
npx -y @nanoseil/nsid-mcp-auth@0.1.0-next.0 setup codex --server nsos
```

Claude updates `~/.claude.json` without replacing unrelated `mcpServers`.
Codex updates a marked table in `~/.codex/config.toml`. Re-running setup is
idempotent. Before changing an existing file it writes a timestamped mode-0600 `.bak` backup.
Neither output contains a token.

## Security model

- API keys never belong in argv, client config, logs, errors, or telemetry.
- Redirects and arbitrary upstream URLs are disabled.
- A profile is isolated from another profile, and each upstream gets its own
  MCP session in its own broker process.
- 401/403 stops the credential; upstream 5xx/timeouts fail closed and may be
  retried by the MCP client.

Publishing is intentionally separate from building and packing. Do not run
`npm publish` from a developer workstation. Releases use the protected
`npm-release` GitHub environment and npm trusted publishing (`.github/workflows/release.yml`)
so the package is published with provenance and the selected dist-tag. The
`next` tag is required while the package version contains a pre-release suffix;
upgrade consumers by changing the exact pin in generated configuration and
running setup again.
