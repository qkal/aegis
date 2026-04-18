# Plan 03 — Reconcile `MILESTONES.md` with shipped code

**Priority:** P0 hygiene. Blocks a credible public release (users will
read `MILESTONES.md` first).
**Size:** Tiny.
**Dependencies:** None. Best landed as a standalone PR so the diff is
auditable.

## Why

Several milestones are shipped in code but still `[ ]` in
`MILESTONES.md`:

| Milestone | Evidence |
|---|---|
| M0.3 SQLite adapter abstraction | `packages/storage/src/adapters/{better-sqlite3,bun-sqlite,node-sqlite,factory}.ts` + `factory.test.ts`. |
| M0.4 FTS5 content indexing proof | `packages/storage/src/content/{chunk,index-impl,schema}.ts` + tests; RRF merge present. |
| M1.2 MCP server with tool registration | `packages/server/src/server.ts` ≤200 LOC; tools present. |
| M1.3 Claude Code adapter | `packages/adapters/src/claude-code/{adapter,events,fixtures,schemas}.ts` + tests. |
| M1.4 Session event capture and restore | `packages/storage/src/session/store.ts` + `packages/core/src/snapshot/builder.ts`. |
| M1.5 Policy enforcement integration | `packages/server/src/hooks/policy.ts`, `packages/server/src/policy/load.ts`. |

## Deliverables

1. **Check off shipped items**
   - [ ] Flip M0.3, M0.4, M1.2, M1.3, M1.4, M1.5 to `[x]`.
   - [ ] Next to each, inline-link the PR that shipped it (from
     `git log --oneline`).
2. **Update scope callouts**
   - [ ] Under Phase 1 "Phase 1b", note that M1.9 (AmpCode) is deferred
     to Phase 1.5 per the locked decision in `docs/plans/00-mvp-release.md`.
   - [ ] Add a new "Phase 1.5" section after Phase 1 with a single
     deliverable: M1.9 AmpCode adapter.
   - [ ] Expand M1.7 into M1.7 (Codex CLI) and M1.7b (Codex GUI).
3. **Add Windows + license acceptance criteria**
   - [ ] Under Phase 1 Acceptance Criteria, add:
     - `aegisctx init` works identically on Windows 10+, macOS 13+,
       Ubuntu 22.04+.
     - `LICENSE` is `BSD-2-Clause-Patent`.
     - Zero outbound network traffic during smoke tests (CI-verified).
4. **Rename inline CLI invocations**
   - [ ] All `aegis init`, `aegis doctor`, `aegis audit` references
     renamed to `aegisctx *`. (Will be picked up by plan 01's bulk
     rename; if plan 03 lands first, do it inline.)

## Acceptance criteria

- `MILESTONES.md` `[x]` entries match what is actually in the code.
- Every `[x]` entry links to a merged PR.
- Phase 1.5 section exists.
- M1.7 and M1.7b coexist as separate deliverables.

## Test strategy

- Not applicable (documentation-only). Add a lightweight CI check in
  `scripts/ci/hygiene.mjs` that greps for `M1.2`, `M1.3`, `M1.4`, `M1.5`,
  `M0.3`, `M0.4` in `MILESTONES.md` and asserts they are `[x]`. This
  prevents regressions where a later PR "unchecks" a milestone by
  accident.

## Out of scope

- Writing detailed acceptance criteria for plans 04–17 (they live in
  those plan files, not here).
