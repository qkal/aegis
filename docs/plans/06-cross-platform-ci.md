# Plan 06 — Cross-platform CI matrix (Ubuntu + macOS + Windows)

**Priority:** P0-6. Blocker for the Windows-as-primary-target decision.
**Size:** Small.
**Dependencies:** None. Should land before plan 07 (so the Windows
engine has a CI runner to validate against).

## Why

Windows is a first-class MVP target. Today `.github/workflows/ci.yml`
runs only on `ubuntu-latest`. We expand to all three runners for the
shards that matter (storage, engine, server, smoke) and keep the cheap
shards (format, lint, typecheck) on Ubuntu only.

## Design

### Matrix

| Job             | OS matrix                                     | Rationale                                                  |
| --------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `format`        | ubuntu-latest                                 | dprint is deterministic across OSes.                       |
| `lint`          | ubuntu-latest                                 | oxlint is deterministic.                                   |
| `typecheck`     | ubuntu-latest                                 | TS output is identical.                                    |
| `test-core`     | ubuntu, macos, windows                        | Touches branded types, serialization — quick to run.       |
| `test-storage`  | ubuntu, macos, windows × node22 + bun-latest* | SQLite backends differ per OS.                             |
| `test-engine`   | ubuntu, macos, windows                        | Process-spawning semantics differ.                         |
| `test-server`   | ubuntu, macos, windows                        | Adapter registration + runtime context touches fs + env.   |
| `test-adapters` | ubuntu, macos, windows                        | Claude Code/Codex/OpenCode fixtures must pass on all OSes. |
| `smoke`         | ubuntu, macos, windows                        | Real MCP E2E (plan 14).                                    |
| `hygiene`       | ubuntu-latest                                 | Repo-structure grep checks.                                |
| `license-check` | ubuntu-latest                                 | Single source of truth.                                    |
| `audit-npm`     | ubuntu-latest                                 | `npm audit --omit=dev`.                                    |

*Bun-on-Windows is still alpha in 2026; include as `continue-on-error:
true` until it's stable.

### Caching

- pnpm store cache keyed on `pnpm-lock.yaml` hash and OS.
- Vitest node_modules cache not needed (pnpm handles it).
- Rust toolchain not needed (repo is pure TS).

### Runtime matrix

- Node `22` (primary, MVP target).
- Bun `latest` on ubuntu + macos only.

## Deliverables

1. **Workflow refactor**
   - [ ] Split the monolithic `test` concept into the shards in the
         table above.
   - [ ] Use a matrix strategy with `fail-fast: false` so one OS failure
         doesn't cancel the others.
   - [ ] Add shared `setup` composite action
         (`.github/actions/setup-pnpm-node/action.yml`) so we don't
         duplicate checkout + pnpm + node steps.
2. **Windows-specific tweaks**
   - [ ] Set `shell: bash` explicitly on all `run:` steps so Git Bash is
         used, not `cmd.exe`. This avoids escaping gotchas.
   - [ ] Mitigate Defender-induced flake without trying to disable
         real-time protection (Tamper Protection blocks
         `Set-MpPreference -DisableRealtimeMonitoring` on GitHub-hosted
         runners). In order of preference:
     - Add an exclusion for the workspace at job start:
       `Add-MpPreference -ExclusionPath "$env:GITHUB_WORKSPACE"` (runs
       under the runner's admin token; wrap in `try/catch` so we don't
       hard-fail if the action is blocked by policy).
     - Keep test artifacts on the local `D:` drive where possible —
       hosted Windows runners have a faster, less-scanned data disk.
     - Increase `timeout-minutes` on the engine shard to 20 (from 10)
       and add a single retry on spawn-level flakes.
     - Reduce I/O pressure: run the engine shard with `--pool=threads`
       and cap parallelism, and keep tempdirs under
       `%LOCALAPPDATA%\aegisctx\tmp` so they inherit the exclusion above.
3. **macOS-specific tweaks**
   - [ ] Use `macos-14` (Apple Silicon) when available and pin via SHA
         like the existing actions.
4. **Reporting**
   - [ ] Emit JUnit XML via `pnpm test:ci` and upload as artifacts per
         shard.
5. **Branch protection (out of workflow, documented)**
   - [ ] `main` requires: all `test-*` shards green × all three OSes.

## Acceptance criteria

- CI run on a no-op PR completes green on Ubuntu, macOS, Windows for
  every shard listed above.
- Total wall-clock time ≤ 10 min on a fresh PR (matrix parallelism).
- `continue-on-error: true` set only on Bun-on-Windows.

## Test strategy

- Not applicable to code. The PR itself is the test: open a no-op PR
  and watch the matrix.

## Out of scope

- Self-hosted runners.
- GPU runners.
- Release-signing runners (covered by plan 13).

## Risks

- **Windows runner slowness and flake.** Mitigation: workspace
  Defender exclusion, increased timeouts + retry, tuned parallelism,
  `actions/cache` for pnpm store. We explicitly do NOT attempt to
  disable Defender real-time protection.
- **`node:sqlite` on Windows.** Node 22 supports it but edge cases
  exist. Mitigation: `test-storage` shard on Windows runs only the
  `node:sqlite` adapter path until we verify parity.
