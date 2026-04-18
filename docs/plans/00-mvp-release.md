# Aegis — MVP Public Release Plan (v2, decisions locked)

Status snapshot as of `main@89a5e76` (2026-04-18). Updated to incorporate the
decisions you confirmed.

## Locked decisions

| Decision                        | Choice                                                                                                                                                                                                                                                                                    | Impact                                                                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm name**                    | `aegisctx` (binary: `aegisctx`). All three options (`aegisctx`, `ctxaegis`, `contextaegis`) returned 404 on the npm registry, so all are available; I'm picking `aegisctx` because it's shortest and keeps "aegis" as the recognizable prefix. Scoped packages move to `@aegisctx/*`.     | Rename `packages/cli` package from `aegis` → `aegisctx`; rename `@aegis/*` internal scopes → `@aegisctx/*`; update README, PLAN, every CLI snippet in docs, CI scripts, `aegis init` → `aegisctx init`. |
| **License**                     | `BSD-2-Clause-Patent` (replaces `Apache-2.0`).                                                                                                                                                                                                                                            | Update root `LICENSE`, all six `packages/*/package.json`, `README.md`, add an ADR documenting the rationale, add CI license-compat check for transitive deps.                                           |
| **Windows**                     | First-class MVP target alongside macOS and Linux.                                                                                                                                                                                                                                         | Adds ~1 week to the schedule; forces Windows-native `PolyglotExecutor` (no POSIX-shell assumptions), Windows path handling in `aegisctx init`, Windows CI matrix, ACL-based perms instead of `0o700`.   |
| **Platform focus**              | **Codex CLI + Codex GUI** as co-equal primary targets with **Claude Code**. OpenCode stays in MVP. **AmpCode is deferred** to Phase 1.5.                                                                                                                                                  | Frees up ~1 week of adapter work; that capacity redirects into Codex hardening (`codex_hooks` feature flag, safe TOML writes, GUI config probing on Windows/macOS/Linux).                               |
| **Telemetry-free verification** | Belt + braces: (a) CI network-egress block on unit + smoke tests, (b) runtime `AEGISCTX_NO_NETWORK=1` kill-switch that patches `net.connect` / `undici.request` to throw before I/O, (c) published-tarball scan for known telemetry SDKs/domains with an allowlist in `docs/security.md`. | Strongest "no telemetry" guarantee a local-first CLI can credibly make without going full container.                                                                                                    |

---

## 1. Where we are today

### 1.1 Shipped (Phase 0 + Phase 1a)

| Area                                                        | Status            | Notes                                                                   |
| ----------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| Monorepo + toolchain                                        | Done              | pnpm 9, oxlint, dprint, Vitest, tsup, Node 22 (M0.1, M0.5).             |
| Policy engine (`@aegis/core` → `@aegisctx/core`)            | Done              | Branded types, policy eval, routing, snapshot builder (M0.2).           |
| SQLite abstraction (`@aegis/storage` → `@aegisctx/storage`) | Done in code      | `better-sqlite3`, `bun-sqlite`, `node-sqlite` + factory (M0.3).         |
| Migrations                                                  | Done in code      | `storage/migrations/runner.ts`.                                         |
| FTS5 content index                                          | Done in code      | Porter + trigram + RRF (M0.4).                                          |
| Session event store + snapshots                             | Done              | `storage/session/store.ts` + `core/snapshot/builder.ts` (M1.4).         |
| Sandbox engine                                              | Done (POSIX only) | `PolyglotExecutor` (M1.1).                                              |
| MCP server                                                  | Done              | `server.ts` ≤200 LOC; `execute`, `audit`, `doctor` tools; hooks (M1.2). |
| Claude Code adapter (Tier 1)                                | Done              | Schemas, fixtures, tests (M1.3).                                        |
| Policy enforcement at hook + MCP wrapper                    | Done              | M1.5.                                                                   |
| CLI `aegis doctor` + `aegis init`                           | Done              | To be renamed to `aegisctx` (M1.6).                                     |
| CI                                                          | Minimal           | `ubuntu-latest` only; format / lint / typecheck / test shards.          |

### 1.2 Gaps that block an MVP public release

| Gap                                                   | Milestone       | Disposition under the new decisions                          |
| ----------------------------------------------------- | --------------- | ------------------------------------------------------------ |
| Codex CLI adapter                                     | M1.7            | **Expanded** into Codex CLI + Codex GUI adapter pair (P0-1). |
| OpenCode adapter + plugin                             | M1.8            | Still in MVP.                                                |
| AmpCode adapter                                       | M1.9            | **Deferred** to Phase 1.5.                                   |
| HMAC-chained audit log                                | M2.1            | Pulled forward into MVP (P0-2).                              |
| Hardened sandbox defaults                             | M2.2 slice      | Pulled forward into MVP (P0-3).                              |
| Publish pipeline + `aegisctx` name                    | Release blocker | P0-4.                                                        |
| Security posture (`SECURITY.md`, SBOM, audit, egress) | Release blocker | P0-5.                                                        |
| Cross-OS CI (macOS **and Windows**)                   | Release blocker | P0-6, Windows is now a hard requirement.                     |
| Real MCP E2E smoke                                    | Release blocker | P0-7.                                                        |
| Release documentation                                 | Release blocker | P0-8.                                                        |
| Context-savings benchmark                             | Release blocker | P0-9.                                                        |
| `aegisctx doctor` accuracy                            | Release blocker | P0-10.                                                       |
| **License change to `BSD-2-Clause-Patent`**           | Release blocker | New P0-11.                                                   |
| **Windows-native `PolyglotExecutor`**                 | Release blocker | New P0-12.                                                   |
| **Codex hardening (CLI + GUI) as primary target**     | Release blocker | New P0-13.                                                   |
| **Telemetry-free verification layers**                | Release blocker | New P0-14.                                                   |

---

## 2. Definition of MVP (`v0.1.0`) public release

A user on **Windows 10+, macOS 13+, or a mainstream Linux distro** with
Node 22+ can:

1. `npm install -g aegisctx` (or `pnpm add -g aegisctx`) — binary on PATH
   as `aegisctx`, working in `cmd.exe`, PowerShell, Git Bash, zsh, and bash.
2. `aegisctx init <claude-code|codex-cli|codex-gui|opencode>` — writes the
   platform-specific MCP and hook wiring with a `--dry-run` diff preview.
   All four flows work identically on Windows, macOS, and Linux.
3. Start an agent session and observe:
   - `aegisctx_execute` runs sandboxed code in JS/TS/Python/PowerShell/bash
     (bash on Windows is best-effort via Git Bash or WSL) and returns only
     stdout.
   - `aegisctx_search` / `aegisctx_index` round-trip works.
   - Session events persist and restore across compaction (Claude Code,
     OpenCode, Codex GUI) or idle windows (Codex CLI without `codex_hooks`).
   - Policy-denied commands are blocked at the hook _or_ the MCP tool
     wrapper with a structured error.
4. `aegisctx doctor` produces an accurate, actionable pass/warn/fail report
   per platform and OS (especially Windows runtime detection: `py`
   launcher, PowerShell, Node via `where`).
5. `aegisctx audit verify` confirms the HMAC chain is intact.
6. **Zero outbound network traffic** in the default configuration, verified
   (a) in CI by a network-egress block, and (b) at runtime by
   `AEGISCTX_NO_NETWORK=1`.
7. Source is published under **`BSD-2-Clause-Patent`**, with the patent
   grant called out in `LICENSE` and each `package.json`.

MVP does **not** require: AmpCode, Cursor, Windsurf, Antigravity, Gemini
CLI, VS Code Copilot, plugin system, analytics dashboard, export/import,
Level 3 sandbox.

---

## 3. Prioritized improvements

### P0 — Must ship to call it MVP

#### P0-1. Close the four MVP adapters (M1.7, new M1.7b, M1.8)

- **M1.7 Codex CLI (Tier 1L).** Schemas for `~/.codex/hooks.json` and
  `~/.codex/config.toml` `[mcp_servers.aegisctx]`. `aegisctx hook codex
  pre-tool-use` subcommands. Capability `{ tier: '1L', interceptedTools:
  ['Bash'] }`. Resolve `~/.codex/` to `%USERPROFILE%\.codex\` on Windows.
  Honest capability downgrade when `[features] codex_hooks = true` is not
  set. Fixture tests against recorded payloads on all three OSes.
- **M1.7b Codex GUI adapter (Tier 1, new).** Targets the Codex IDE /
  desktop integration. Probe order:
  1. VS Code Codex extension settings
     (`%APPDATA%\Code\User\settings.json` on Windows,
     `~/Library/Application Support/Code/User/settings.json` on macOS,
     `~/.config/Code/User/settings.json` on Linux).
  2. Codex desktop app config at the documented per-OS path (TBD during
     implementation; `aegisctx init codex-gui` always prints the full diff
     before writing).
  3. Fallback: MCP-only registration with an `AGENTS.md` routing template
     for sessions that don't surface hooks.
     Capability advertisement honestly reflects whichever branch the probe
     took.
- **M1.8 OpenCode (Tier 1).** Ship `@aegisctx/opencode-plugin` as a
  separate npm package. Subscribe to `tool.execute.before/after`,
  `session.compacted`, `session.idle`, `permission.asked`. Write MCP
  registration to `opencode.json`. Fixture tests.
- **Cross-cutting:** tier-aware capability advertisement at MCP session
  start — stubbed in `server/capabilities.ts`; wire each adapter.

#### P0-2. HMAC-chained audit log (M2.1, pulled forward)

- `storage/audit/chain.ts`: UUIDv7 IDs, canonical JSON serialization,
  `hmac = HMAC_SHA256(key, prev_hmac ‖ canonical(entry))`.
- Key material at `~/.aegisctx/audit-key` (`0o600` on POSIX; equivalent
  ACL via `icacls /inheritance:r` + grant to current user on Windows).
- Per-project DB: `~/.aegisctx/audit/<project-hash>.db`.
- `aegisctx audit show [--category …]` and `aegisctx audit verify` CLI
  commands.
- CI test: mutate one entry, `verify` must report the exact break point.

#### P0-3. Hardened sandbox defaults (M2.2 slice)

- Default `aegisctx init` policy denies `AWS_*`, `GH_TOKEN`,
  `GITHUB_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`,
  `AZURE_*`, `GCP_*`, plus Windows-specific `USERPROFILE`, `LOCALAPPDATA`,
  `APPDATA` from the sandbox child environment.
- Restricted `PATH` / `Path` in the sandbox: only directories for
  detected runtimes.
- Tempdir: `0o700` on POSIX; Windows creates under
  `%LOCALAPPDATA%\aegisctx\tmp\<session>` with ACLs restricted to the
  current user.
- Default `sandbox.net.deny: ["*"]` verified by an integration test that
  spawns a script attempting `fetch()` / `Invoke-WebRequest` and asserts
  failure on all three OSes.
- Timeout kill: POSIX `SIGKILL` to the process group; Windows `taskkill
  /T /F` against the child PID.

#### P0-4. Packaging and publish pipeline

- Reserve `aegisctx` and the `@aegisctx` org on npm.
- Rename `packages/cli` package → `aegisctx` (bin stays `aegisctx`).
  Internal packages → `@aegisctx/core`, `@aegisctx/engine`,
  `@aegisctx/storage`, `@aegisctx/adapters`, `@aegisctx/server`. Publish
  each at `0.1.0`.
- Adopt `changesets` for versioning + changelog generation.
- CI guard: fail if any workspace grows
  `scripts.{preinstall,install,postinstall,prepare}` (enforces ADR-0015).
- `npm pack --dry-run` check — only `dist/`, `LICENSE`, `README.md` ship.
- `.github/workflows/release.yml` publishes from a tag via GitHub OIDC
  with `npm publish --provenance`.
- Generate SBOM (`@cyclonedx/cyclonedx-npm`) and attach to releases.

#### P0-5. Security posture for a public release

- `SECURITY.md` (disclosure channel, threat model → `PLAN.md §6`, SLAs).
- `npm audit --omit=dev` on every PR; fail on high/critical.
- `osv-scanner` on every PR.
- Dependabot weekly for npm + GitHub Actions pins (already partially
  pinned by SHA in `ci.yml`).
- Assert `@aegisctx/core` has zero runtime deps (`pnpm ls --filter
  @aegisctx/core --prod --json` must be empty).
- Telemetry-free verification — see P0-14.

#### P0-6. Cross-platform CI matrix (incl. Windows)

- `ci.yml`: `os: [ubuntu-latest, macos-latest, windows-latest]`.
- Storage shard: Node 22 (`node:sqlite`) on all three OSes; Bun-latest on
  Linux + macOS (Bun Windows is still alpha — documented as best-effort).
- Engine shard: real process spawning on all three OSes asserts sandbox
  env-filter + timeout behavior is identical.
- Smoke shard: real MCP E2E (P0-7) on all three OSes.

#### P0-7. End-to-end smoke test with a real MCP client

- Build CLI.
- Spawn `aegisctx serve` over stdio.
- `@modelcontextprotocol/sdk` client sends `initialize`, lists tools,
  calls `aegisctx_execute` with `{ language: "javascript", code:
  "console.log(42)" }`. Assert shape + exact stdout.
- Assert zero outbound sockets during the run (P0-14 integration).
- Also: a Codex-CLI-shaped smoke that feeds the hook binary recorded
  stdin fixtures and checks exit code + JSON stdout.

#### P0-8. Release documentation

- Expand `README.md` with a platform × OS matrix, capability tiers,
  troubleshooting.
- `docs/getting-started/claude-code.md`, `codex-cli.md`, `codex-gui.md`,
  `opencode.md` — each with install, `aegisctx init`, first tool call,
  "what to do if it didn't work" (per-OS sections).
- `docs/security.md` — threat model summary, what Level 1 sandbox does
  and does not protect against, disclosure policy, supply-chain posture.
- `docs/policy.md` — syntax reference, scope precedence, worked examples
  for the default deny set, how to open up specific operations.
- `docs/windows.md` — `py` launcher, PowerShell execution policy, WSL
  interop caveats, ACL model for the audit key.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, GitHub issue + PR templates.
- `CHANGELOG.md` auto-generated from changesets.

#### P0-9. Reproducible context-savings benchmark

- `benchmarks/context-savings/` with a recorded Playwright snapshot + a
  script that runs it through `aegisctx_execute` and asserts output size
  ≤ 500 B.
- Non-blocking CI benchmark that posts to the PR and fails on >20%
  regression.

#### P0-10. `aegisctx doctor` accuracy

- Snapshot tests for every failure mode in `PLAN.md §10.4`, on each OS:
  runtime missing, FTS5 unavailable, audit key missing / wrong perms,
  policy file syntactically invalid, hook not registered, corrupt DB.
  Windows-only: `py` launcher missing, PowerShell execution policy too
  restrictive.

#### P0-11. License migration to `BSD-2-Clause-Patent`

- Replace root `LICENSE` with the SPDX `BSD-2-Clause-Patent` text.
- Set `"license": "BSD-2-Clause-Patent"` in every workspace
  `package.json`.
- Update `README.md` "License" section.
- New ADR: "License chosen: BSD-2-Clause-Patent" explaining why the
  explicit patent grant matters for AI-agent tooling.
- CI `license-check` step (e.g. `license-checker-rseidelsohn`) fails on
  any transitive dep with an incompatible license (AGPL, SSPL, etc.).

#### P0-12. Windows-native `PolyglotExecutor`

- Replace POSIX-only `spawn` calls with OS-aware invocation:
  - Default shell: `pwsh.exe` (fallback `powershell.exe`) on Windows;
    `bash` on POSIX.
  - Runtime detection order differs per OS: `python` → `py -3` →
    `python3`; `node`; `tsx` / `bun`; `ruby`; `go run`.
- Env filtering is case-insensitive on Windows (`PATH` vs `Path`).
- Tempdir under `%LOCALAPPDATA%\aegisctx\tmp` with restrictive ACLs.
- Timeout kill via `taskkill /T /F`.
- Line-ending normalization (`\r\n` → `\n`) before passing to the output
  processor.
- Integration tests in the Windows CI job.

#### P0-13. Codex hardening (CLI + GUI as primary targets)

Treat Codex as a co-equal primary target with Claude Code.

- Robust TOML read/modify/write for `~/.codex/config.toml` that preserves
  keys and comments (e.g. `@iarna/toml`), with a dry-run diff.
- Detect `[features] codex_hooks = true`; when unset, `aegisctx init
  codex-cli` prompts to enable it and explains implications. Capability
  advertisement downgrades gracefully if the user declines.
- Windows: resolve `~/.codex/` to `%USERPROFILE%\.codex\`; quote hook
  binary paths with spaces correctly in TOML (the #1 footgun).
- Codex GUI: detect via VS Code extension config or the Codex desktop
  MCP config location; integration test on all three OSes using a mock
  settings file.
- Record real Codex CLI and Codex GUI hook JSON payloads and commit as
  fixtures under `packages/adapters/src/codex/fixtures/`.
- Dedicated `docs/getting-started/codex-cli.md` and `codex-gui.md` with
  step-by-step walkthroughs (screenshots).
- Acceptance: the same `aegisctx init codex-cli` command works
  identically in Git Bash, PowerShell, macOS zsh, and Ubuntu bash, with a
  clean green `aegisctx doctor` at the end.

#### P0-14. Telemetry-free verification (belt + braces)

1. **CI network-egress block.** Run the smoke job under `unshare -n`
   (Linux), a loopback-only `pfctl` rule on macOS, and a Windows Defender
   Firewall outbound-block profile on Windows. Any attempt to open an
   external socket fails the build.
2. **Runtime kill-switch.** `AEGISCTX_NO_NETWORK=1` env var. When set,
   `@aegisctx/server` patches `net.connect`, `dgram.createSocket`, and
   `undici.request` (or re-exports a wrapped `fetch`) to throw
   `NetworkDisabledError` before any I/O. `aegisctx doctor --verbose`
   reports this status. Documented as the user-verifiable "offline
   mode."
3. **Supply-chain telemetry scan.** CI job that greps the published
   tarball and lockfile for known telemetry domains (`segment.io`,
   `mixpanel.com`, `sentry.io`, `amplitude.com`, `posthog.com`, …) and
   packages (`posthog-node`, `@sentry/*`, `analytics-node`, `mixpanel`).
   Fails on any hit unless explicitly allowlisted in `docs/security.md`.

### P1 — Ship within 2 weeks after `v0.1.0`

- **Phase 1.5: AmpCode adapter (M1.9).** Deferred from MVP; immediate
  next item after `v0.1.0`.
- **Ask mode** (M2.4): closes the deny / ask / allow triad.
- **Corruption recovery** (M4.3 slice).
- **Export / import** (M4.2 slice): `aegisctx session export|import`,
  `aegisctx audit export`.
- **Performance budgets in CI** (M4.4): startup <100 ms, FTS5 <10 ms p99,
  policy eval <1 ms.
- **Wave-2 adapter: Cursor** (Tier 2) + **generic MCP fallback** (Tier 3).

### P2 — Post-MVP, in order

- Plugin system with worker-thread isolation (M3.2).
- Gemini CLI adapter.
- VS Code Copilot (non-Codex) adapter.
- KiloCode, Kiro, Zed, Windsurf, Antigravity.
- Level 3 sandbox (Linux namespaces / macOS `sandbox-exec` / Windows Job
  Objects + AppContainer).
- Analytics dashboard (`aegisctx insight`), embedding search.

---

## 4. Cross-cutting hygiene for the public repo

- **Reconcile `MILESTONES.md`.** Check off M0.3, M0.4, M1.2–M1.5 (shipped
  in code, unchecked in the file); link to PR numbers; move M1.9 AmpCode
  under a clearly labeled "Phase 1.5" section.
- **ADRs.**
  - ADR-0010 (Biome → oxlint + dprint): add explicit `status:
    superseded-by 0017` in front matter.
  - New ADR: "License chosen: BSD-2-Clause-Patent."
  - New ADR: "Binary name `aegisctx`."
  - New ADR: "Windows is a first-class MVP target."
- **Exports discipline.** `packages/server/src/runtime/test-utils.ts`
  must not leak through the public barrel — gate behind a `"./testing"`
  sub-export.
- **Subpath policy.** Tighten `exports` maps to the minimum needed API
  surface.
- **Branch protection.** `main` requires CI green + one review; release
  from signed `v*` tags only.

---

## 5. Sequenced 5-week delivery plan (Windows adds a week)

### Week 1 — Rename, relicense, reconcile

1. Reserve `aegisctx` + `@aegisctx` on npm. Rename `packages/cli` →
   `aegisctx`; rename workspace scopes to `@aegisctx/*`; update every
   reference in source, tests, docs, CI.
2. Switch `LICENSE` + every `package.json` `license` field to
   `BSD-2-Clause-Patent` (P0-11). Land the license ADR.
3. Reconcile `MILESTONES.md` with reality.
4. HMAC audit chain (P0-2) + `audit verify` CLI + tests.
5. Hardened sandbox defaults on POSIX (P0-3, POSIX slice).

### Week 2 — Windows-native engine + Codex hardening (part 1)

1. Windows-native `PolyglotExecutor` (P0-12). Green on Windows CI.
2. Codex CLI adapter with safe TOML rewrite (M1.7, P0-13 part).
3. Start Codex GUI adapter (M1.7b): config-probe strategy across all
   three OSes; land fixtures for Linux + macOS.

### Week 3 — Remaining adapters + Windows audit/policy + telemetry

1. Finish Codex GUI adapter; Windows fixtures.
2. OpenCode plugin + adapter (M1.8), publish `@aegisctx/opencode-plugin`
   as a preview tag.
3. Hardened sandbox defaults — Windows slice (P0-3 completion).
4. Telemetry-free verification, all three layers (P0-14).
5. Tier-aware capability advertisement through every adapter.

### Week 4 — Packaging, E2E, docs scaffolding

1. Changesets + `release.yml` with provenance + SBOM (P0-4).
2. Real MCP SDK smoke test on Linux, macOS, Windows (P0-7).
3. `aegisctx doctor` failure-mode snapshot tests on all three OSes
   (P0-10).
4. First pass at getting-started docs for Claude Code, Codex CLI, Codex
   GUI, OpenCode (P0-8).
5. `SECURITY.md`, `CONTRIBUTING.md`, `docs/windows.md`, issue/PR
   templates.

### Week 5 — Polish, benchmark, release

1. Context-savings benchmark in CI (P0-9).
2. Second-pass docs: troubleshooting, policy reference, security scope,
   license note.
3. Dry-run release of `aegisctx@0.1.0-rc.1` + `@aegisctx/*@0.1.0-rc.1`;
   real-session E2E on clean Windows 11, macOS 14, and Ubuntu 24 VMs;
   fix whatever breaks.
4. Cut `v0.1.0` with changelog, SBOM, provenance attestation. Tag.
   Announce.

---

## 6. Ambiguities I will resolve during execution (documented in ADRs)

These don't block starting; I'll pick sensible defaults and record them:

- **Exact Codex GUI config path per OS.** Probe order: VS Code Codex
  extension settings → Codex desktop config → explicit
  `--config-path <path>` fallback.
- **Bash-on-Windows story for `aegisctx_execute`'s `language: "shell"`.**
  Priority: Git Bash → WSL → PowerShell rewrite → fail with install
  suggestion.
- **`aegisctx` as the single install target.** `aegisctx` bundles the
  server/adapters/engine/storage/core via dependencies; `@aegisctx/*`
  scoped packages are also published for power users building custom
  hosts.
