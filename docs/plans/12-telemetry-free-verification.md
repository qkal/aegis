# Plan 12 — Telemetry-free verification (belt + braces)

**Priority:** P0-14. Required to credibly claim "zero telemetry" in the
README.
**Size:** Medium.
**Dependencies:** Plan 06 (CI matrix for the egress block), plan 13
(publish pipeline for the tarball scan).

## Why

"Local-first, zero telemetry" is a marquee claim. We back it with
three independent layers so no single failure mode can quietly let
network calls slip in.

## Layer 1 — CI network-egress block

### Approach per OS

| OS | Mechanism |
|---|---|
| Linux | Run the smoke job inside `unshare -n` so the job has no network namespace. Loopback-only. |
| macOS | `pfctl` anchor that blocks all outbound TCP/UDP except loopback, enabled for the smoke job's duration. |
| Windows | `New-NetFirewallRule` outbound block profile enabled on job start, removed on cleanup. |

### Scope

The egress-blocked job runs: `pnpm build && pnpm ci:smoke && pnpm
test:core && pnpm test:storage`.

Jobs *not* in the block: dependency install (needs registry),
`test:adapters` (Claude Code/Codex/OpenCode fixture fetches — if any —
happen here rather than being baked in), `license-check`, `audit-npm`.

### Expected outcome

Any attempt to open an external socket during the blocked jobs fails
the CI job with a clear error message. A deliberate
"attempt to fetch" test runs inside the block and asserts the fetch
throws, proving the block is active.

## Layer 2 — Runtime kill-switch (`AEGISCTX_NO_NETWORK=1`)

### Behavior

When the env var is set (or the resolved config has
`network.disable = true`):

1. `packages/server/src/runtime/context.ts` sets up a network kill
   switch *before* any I/O:
   - `require('net').connect` and `require('net').createConnection`
     patched to throw `NetworkDisabledError`.
   - `require('tls').connect` patched similarly.
   - `require('dgram').createSocket` patched.
   - `require('undici').request` / the global `fetch` wrapped to
     throw.
   - `require('http2').connect` patched.
2. Exception: loopback (`127.0.0.1`, `::1`) connections are still
   allowed — needed for MCP stdio transport variants that use
   loopback sockets.
3. `aegisctx doctor --verbose` reports
   `networkDisabled: true | false` and whether the kill-switch is
   active.

### Testing

A unit test imports the kill-switch, activates it, and asserts that
`fetch('https://example.com')` rejects with `NetworkDisabledError`
synchronously (before any socket work).

## Layer 3 — Supply-chain telemetry scan

### Approach

CI job `supply-chain-scan`:

1. `npm pack --workspaces` to produce tarballs.
2. For each tarball, unpack and grep the contents for:
   - Known telemetry domains: `segment.io`, `mixpanel.com`,
     `sentry.io`, `amplitude.com`, `posthog.com`,
     `browser-intake-datadoghq`, `analytics.google.com`,
     `googletagmanager.com`, `rudderstack.com`, `heap.io`.
   - Known telemetry packages (via `package.json` dep tree):
     `posthog-node`, `@sentry/*`, `analytics-node`, `mixpanel`,
     `@amplitude/*`, `rudder-sdk-node`.
3. Allowlist file (`docs/security.md`-referenced): if we ever need to
   depend on one of these (e.g., for an explicit opt-in feature),
   it must be added to `scripts/ci/telemetry-allowlist.txt` with a
   justification in `docs/security.md` §"Third-party SDKs".
4. Fail the build on any hit not in the allowlist.

### Bonus: `lockfile-scan`

Parse `pnpm-lock.yaml` and assert no resolved dep package name is in
the denylist. This catches dev-time regressions faster than the
tarball scan (which only runs on release builds).

## Deliverables

1. **Layer 1**
   - [ ] `.github/actions/network-block/action.yml` — composite action
     that enables the block per-OS.
   - [ ] Smoke job wraps its run steps in the block action.
   - [ ] A dedicated smoke test
     (`scripts/ci/network-block-canary.mjs`) that asserts network is
     blocked — if it passes (network works), fail the job.
2. **Layer 2**
   - [ ] `packages/server/src/runtime/no-network.ts` — kill-switch
     impl.
   - [ ] Wired into `createServer()` before any other side effect.
   - [ ] `packages/server/src/runtime/no-network.test.ts`.
   - [ ] `aegisctx doctor` prints the status.
   - [ ] Documented in `README.md` under "Offline mode" and in
     `docs/security.md`.
3. **Layer 3**
   - [ ] `.github/workflows/ci.yml` new job `supply-chain-scan`.
   - [ ] `scripts/ci/telemetry-scan.mjs` — does the scan + allowlist
     check.
   - [ ] `scripts/ci/telemetry-allowlist.txt` — empty at MVP.
   - [ ] `scripts/ci/lockfile-scan.mjs` — lockfile-name denylist check.

## Acceptance criteria

- The CI network-block canary fails the build if the block ever
  silently stops working.
- `AEGISCTX_NO_NETWORK=1 node -e "
    const s = require('@aegisctx/server');
    s.createServer({});
    fetch('https://example.com').catch(e => { console.log(e.name); process.exit(0); });
    setTimeout(() => { console.log('NO_ERROR'); process.exit(1); }, 1000);
  "` prints `NetworkDisabledError`.
- Supply-chain scan reports zero hits on a clean repo.
- Adding a fake dep named `posthog-node` to any package breaks the
  `lockfile-scan` job (verified by a canary test).

## Test strategy

- Unit tests for the kill-switch's patch points.
- Integration test in CI that intentionally tries to fetch during the
  network block and asserts the whole job fails.
- Canary dep (in a test-only package JSON) for the supply-chain scan.

## Out of scope

- On-device DNS sinkholing for users (they get the `AEGISCTX_NO_NETWORK`
  env var and CI-level proof; that's enough).
- Runtime proxies — users who want more (mitmproxy, etc.) can layer
  them on top.

## Risks

- **Kill-switch patches need to run before any dep that caches
  `net.connect`.** Mitigation: imported first in `createServer`; CI
  test verifies. If a dep caches the reference at module init, the
  kill-switch won't catch it — we grep published bundles for direct
  `net.connect` references and assert they come from `undici`/`net`
  only.
- **`unshare -n` not available on all Linux runners.** GitHub's
  Ubuntu runners ship `util-linux`; this works. Document if it ever
  changes.
