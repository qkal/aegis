# Plan 14 — Real MCP E2E smoke test

**Priority:** P0-7.
**Size:** Small-medium.
**Dependencies:** Plan 01 (tool rename), plan 04 (HMAC audit chain —
the smoke asserts `aegisctx_audit` is registered), plan 06 (CI
matrix), plan 12 (runs inside the network-block).

## Why

`scripts/ci/smoke.mjs` today only asserts that built artifacts exist.
A credible public release needs an end-to-end check that an MCP client
can actually talk to `aegisctx serve`.

## Design

### The smoke

1. Build the CLI + server.
2. Spawn `aegisctx serve` as a child process over stdio (using
   `child_process.spawn` with `stdio: ['pipe', 'pipe', 'inherit']`).
3. Use `@modelcontextprotocol/sdk/client` over a stdio transport to:
   - Send `initialize`; assert response protocol version.
   - List tools; assert `aegisctx_execute`, `aegisctx_search`,
     `aegisctx_index`, `aegisctx_fetch`, `aegisctx_stats`,
     `aegisctx_doctor`, `aegisctx_audit` are present.
   - Call `aegisctx_execute` with
     `{ language: "javascript", code: "console.log(42)" }`; assert
     `result.content[0].text.trim() === "42"`.
   - Call `aegisctx_doctor`; assert success payload contains the
     advertised capability tier.
4. Shut down with `close()`, assert exit code 0 within 5s.

### Codex-CLI-shaped hook smoke

Separate script that feeds a recorded fixture to `aegisctx hook codex
pre-tool-use` via stdin and asserts the stdout JSON shape and exit
code.

### Cross-OS

Runs on all three OSes (plan 06). Absolute paths via `path.resolve`;
stdin/stdout normalized to LF.

## Deliverables

1. **`scripts/ci/mcp-smoke.mjs`**
   - [ ] Implements the flow above.
   - [ ] Uses `@modelcontextprotocol/sdk` as a dev dep (pinned).
2. **`scripts/ci/codex-hook-smoke.mjs`**
   - [ ] Feeds
         `packages/adapters/src/codex/fixtures/pre-tool-use-bash-denied.json`
         to the hook binary; asserts exit 2 + structured JSON stderr.
3. **Integration with `pnpm ci:smoke`**
   - [ ] Update `package.json` `ci:smoke` to run:
     1. `assertSmokeFiles` (existing).
     2. `mcp-smoke`.
     3. `codex-hook-smoke`.
4. **CI**
   - [ ] `.github/workflows/ci.yml` smoke shard runs this on
         ubuntu + macos + windows.
5. **Network-block integration**
   - [ ] The smoke shard runs under the Layer-1 network block from
         plan 12 so a regression that reintroduces outbound calls fails
         the smoke.

## Acceptance criteria

- `pnpm ci:smoke` green locally on POSIX.
- CI smoke green on Ubuntu, macOS, Windows.
- Running `pnpm ci:smoke` with a deliberate regression (adding an
  `await fetch('https://example.com')` to `createServer`) fails the
  job with a clear error.

## Test strategy

- The smoke is the test; no additional unit tests. Script itself is
  small and straight-line.

## Out of scope

- Multi-client concurrent smoke.
- SSE transport (MCP spec defaults to stdio; SSE/HTTP transport lands
  post-MVP).
- Long-running soak tests (Phase 4 M4.4).

## Risks

- **MCP SDK bump churn.** Mitigation: pin the exact version in
  `scripts/` dev deps.
- **Windows stdio CRLF interleaving.** Mitigation: the smoke uses the
  SDK's stdio transport (which handles framing), not ad-hoc reads.
