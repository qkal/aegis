# Aegis Release Plans

This directory holds the executable plans for getting Aegis to a public MVP
release (`v0.1.0` as `aegisctx` on npm) and beyond. Each file is an
actionable plan with scope, deliverables, acceptance criteria, test
strategy, and sequencing. Items are referenced from `docs/plans/00-mvp-release.md`
using the `P0-n` identifiers.

| File | Scope | Priority |
|---|---|---|
| [00-mvp-release.md](./00-mvp-release.md) | Master plan: decisions, gaps, 5-week schedule | Source of truth |
| [01-rename-to-aegisctx.md](./01-rename-to-aegisctx.md) | Rename `aegis` → `aegisctx`, `@aegis/*` → `@aegisctx/*` | P0-4 (prereq) |
| [02-license-bsd-2-clause-patent.md](./02-license-bsd-2-clause-patent.md) | Relicense Apache-2.0 → BSD-2-Clause-Patent | P0-11 |
| [03-reconcile-milestones.md](./03-reconcile-milestones.md) | Make `MILESTONES.md` match reality | P0 hygiene |
| [04-hmac-audit-chain.md](./04-hmac-audit-chain.md) | Tamper-evident audit log + `audit verify` | P0-2 (M2.1) |
| [05-sandbox-hardening.md](./05-sandbox-hardening.md) | Env/FS/net defaults + timeout kill semantics | P0-3 (M2.2 slice) |
| [06-cross-platform-ci.md](./06-cross-platform-ci.md) | Ubuntu + macOS + Windows CI matrix | P0-6 |
| [07-windows-polyglot-executor.md](./07-windows-polyglot-executor.md) | Windows-native sandbox engine | P0-12 |
| [08-codex-cli-adapter.md](./08-codex-cli-adapter.md) | Tier 1L adapter + safe TOML rewrite | P0-1 (M1.7) |
| [09-codex-gui-adapter.md](./09-codex-gui-adapter.md) | Tier 1 adapter for Codex GUI (VS Code + desktop) | P0-1 (M1.7b) |
| [10-opencode-adapter.md](./10-opencode-adapter.md) | Tier 1 adapter + `@aegisctx/opencode-plugin` | P0-1 (M1.8) |
| [11-tier-aware-capabilities.md](./11-tier-aware-capabilities.md) | Capability advertisement wired through adapters | P0-1 |
| [12-telemetry-free-verification.md](./12-telemetry-free-verification.md) | CI egress block + `AEGISCTX_NO_NETWORK` + tarball scan | P0-14 |
| [13-packaging-and-release.md](./13-packaging-and-release.md) | Changesets + provenance + SBOM + release workflow | P0-4 |
| [14-mcp-e2e-smoke.md](./14-mcp-e2e-smoke.md) | Real MCP SDK smoke test on all three OSes | P0-7 |
| [15-doctor-snapshot-tests.md](./15-doctor-snapshot-tests.md) | Failure-mode coverage for `aegisctx doctor` | P0-10 |
| [16-documentation.md](./16-documentation.md) | Getting-started, policy, security, Windows docs | P0-8 |
| [17-context-savings-benchmark.md](./17-context-savings-benchmark.md) | Reproducible "56 KB → <500 B" CI benchmark | P0-9 |

## How to use these plans

1. **One PR per plan.** Each file is small enough that it maps to a single
   focused PR. Don't land more than one plan per PR.
2. **Check the dependency arrows.** `01-rename-to-aegisctx.md` must land
   before any plan that references `@aegisctx/*` packages in new code.
   `02-license-bsd-2-clause-patent.md` must land before publish pipeline
   work. `06-cross-platform-ci.md` must land before `07-windows-polyglot-executor.md`
   (we need the Windows runner to validate the engine).
3. **Update `MILESTONES.md` in the same PR** that delivers a milestone.
   No more milestones silently shipping as `[ ]`.
4. **ADRs for structural decisions only.** Any plan that deviates from an
   existing ADR must land an updated or superseding ADR in the same PR.

## Conventions used in these plans

- **Deliverables** lists are copy-pasteable TODOs.
- **Acceptance criteria** are observable outcomes — a reviewer should be
  able to check each one without reading code.
- **Test strategy** calls out the specific Vitest files to add or update.
- **Out of scope** calls out what is deliberately deferred to avoid scope
  creep.
- **Risks** list the top two or three concrete ways the plan can fail,
  with the chosen mitigation.
