# P0 review checklist

Status date: 2026-08-02. `GO`, Git migration, and npm publishing remain blocked
until every `OPEN` or `PARTIAL` item is closed on a reviewable commit.

| # | Status | Implementation evidence | Test evidence / required test |
|---|---|---|---|
| 1 | CLOSED | `src/identity.ts`: `IdentityNotFoundError`; `loadIdentity` converts only `ENOENT`; `createIdentity` rethrows every other error | `fails closed on corrupt profile instead of creating another identity`; `rejects insecure modes and profile symlinks` assert signup zero |
| 2 | PARTIAL | `assertSecureNode` checks `lstat`, type, symlink, UID and exact modes. Public `NSID_HOME` is ignored and CLI has no root option. Full root-chain `realpath` containment is not implemented | Existing symlink/mode test; add root/intermediate symlink, wrong UID (where supported), EACCES, and canonical-containment tests |
| 3 | PARTIAL | Lock record contains nonce, owner PID, host, createdAt and lease; reclaim requires same host, expired lease, inactive PID and nonce recheck; release deletes only own nonce | Concurrent first-run test exists; add active timeout, stale reclaim, foreign host/owner, invalid metadata and replaced-nonce tests |
| 4 | PARTIAL | Secret-free recovery record with accountId is persisted before identity file. Its presence stops another signup | Add injected identity-write/rename failure followed by second invocation asserting zero signup and no raw key in recovery |
| 5 | OPEN | **cwd compatibility integration.** Default source of truth is `~/.nanoseil/agent/identities/<sha256(cwd)[:32]>.json`. Existing cwd identity is reused in place. Unknown future `account` fields are accepted and preserved. No mapping, scope alias, candidate search, migration, copy, move, or rewrite exists. `--profile` / `NSID_PROFILE` is override-only. P0 broker does not accept legacy path overrides | Unit tests cover raw-string hash, no normalization, distinct hashes, signup-zero failures, override selection, extra-field legacy fixture and byte-identical reuse. Still required: cross-repo same file/account.id integration and nsos-codex proxy fail-fast when `NSID_IDENTITY_FILE` or `NANOSEIL_IDENTITY_DIR` is active |
| 6 | CLOSED | Signup retries only HTTP 429, maximum five attempts, bounded exponential delay | `retries only 429 with bounded attempts`; add explicit 4xx/5xx/network no-retry table before release |
| 7 | PARTIAL | Identity/profile/account schema and anchored length-bounded `nsak_` validator exist | Await Identity owner's stable token grammar; add boundary/legacy compatibility cases against that contract |
| 8 | OPEN | No connect/request/idle-SSE timeout implementation | Add independent fake-timer abort tests for identity and MCP fetches |
| 9 | OPEN | SSE data parsing exists; reconnect, `id`, `retry`, and `Last-Event-ID` do not | **P0 required:** add bounded reconnect/resume, Last-Event-ID, retry policy, exhaustion, and malformed SSE terminal-semantics tests |
| 10 | OPEN | 401/403 emits MCP error and sets stopped, but does not deterministically close stdin/process or abort every concurrent request | Add two-in-flight credential rejection, GET abort, no further POST, stderr diagnosis and nonzero exit tests |
| 11 | OPEN | Production path constructs a fresh header allowlist, but `sanitizeHeaders` is dead API and its test does not assert actual fetch args | Delete helper; assert every production fetch call's complete header set and absence of client credential forwarding |
| 12 | CLOSED | Setup derives the exact package pin from `package.json` at build/runtime; no dist-tag is generated | Setup snapshots assert the manifest-derived pin and README documents explicit upgrade/re-setup |
| 13 | OPEN | Preview currently renders the complete resulting config and may disclose unrelated values | Replace with managed-entry-only redacted preview; add unrelated-secret stdout negative test |
| 14 | PARTIAL | Existing config receives timestamped non-clobbering 0600 backup; atomic write exists. Automatic restore on failure and metadata preservation do not | Existing backup/idempotence test; add injected write/rename failure, restore, owner/mode preservation and multiple-backup tests |
| 15 | CLOSED | Public CLI no longer accepts or documents `--config`; custom paths remain library-level dependency injection for tests | Add CLI argv rejection test for `--config` and arbitrary positional path |
| 16 | OPEN | Claude JSON whole-file serialization can change formatting; Codex marker update lacks TOML validation and unmanaged-table collision detection | Evaluate official Claude/Codex CLI first; otherwise add scope contract, unknown-field/comment, invalid TOML, duplicate table and broken marker tests |
| 17 | PARTIAL | SoRA confirmed the canonical Islands URL. Registry stores it with `active:false`; active allowlist filters it out and resolver rejects `islands` before credential transmission | URL decision is closed, but release dependency remains open until deployed `/SKILL.md` 200, unauth MCP 401, authenticated initialize success, and post-activation negative allowlist tests |
| 18 | CLOSED | The formal repository now exists and `package.json` points to its exact public GitHub URL | Packed manifest contains the matching repository metadata required for provenance |

## Current verified baseline

- TypeScript typecheck passes.
- 16 tests pass across identity, bridge, setup, and server registry.
- Package is `@nanoseil/nsid-mcp-auth@0.1.0-next.0`; no publish occurred.
- This baseline is a spike, not a release candidate.

## Release artifacts still required

- All checklist items closed on a formal PR HEAD.
- Full tarball scan for tokens, identity JSON, npm configuration, caches,
  coverage, maps, fixtures, and lifecycle scripts.
- Real Claude/Codex stdio tests against active NSOS and deployed Islands.
- Identity revoke test after the revocation authority deploys.
- npm organization ownership, 2FA, provenance, `next` publish authorization,
  and explicit SoRA approval.
