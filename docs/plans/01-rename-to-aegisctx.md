# Plan 01 — Rename `aegis` → `aegisctx`

**Priority:** P0-4 prerequisite. Blocks publish-to-npm work in plan 13.
**Size:** Medium (wide but shallow).
**Dependencies:** None. Must land *before* any new user-facing copy is
written so we don't cement the old name in docs.

## Why

The `aegis` name has unrelated prior art on npm. The published CLI is
renamed to `aegisctx` (bin name `aegisctx`). Internal packages move to the
`@aegisctx` scope. The product name "Aegis" stays in prose.

## Deliverables

1. **Workspace rename**
   - [ ] `packages/cli/package.json`: `"name": "aegisctx"`, bin key stays
     `"aegisctx"` (already named correctly on the bin side).
   - [ ] `packages/core/package.json`: `"name": "@aegisctx/core"`.
   - [ ] `packages/engine/package.json`: `"name": "@aegisctx/engine"`.
   - [ ] `packages/storage/package.json`: `"name": "@aegisctx/storage"`.
   - [ ] `packages/adapters/package.json`: `"name": "@aegisctx/adapters"`.
   - [ ] `packages/server/package.json`: `"name": "@aegisctx/server"`.
   - [ ] All internal `workspace:*` dependency keys updated to the new
     names.
   - [ ] `pnpm-workspace.yaml` unchanged (path-based), but run
     `pnpm install` and commit the updated lockfile.
2. **Source code rename**
   - [ ] `rg -l '@aegis/' packages/ scripts/ | xargs sed -i
     's|@aegis/|@aegisctx/|g'` (or equivalent manual edits).
   - [ ] `rg -l '"aegis"' packages/` — any bare `"aegis"` string that
     refers to the CLI package gets updated; product name "Aegis" in
     docstrings stays.
   - [ ] Vitest alias in `vitest.config.ts` updated
     (`@aegis/*` → `@aegisctx/*`).
3. **CLI surface**
   - [ ] `CLI_NAME` constant in `packages/cli/src/index.ts` stays
     `"aegisctx"` (the bin was already named right; confirm and add a
     test).
   - [ ] `aegis_*` MCP tool names renamed to `aegisctx_*`
     (`aegis_execute` → `aegisctx_execute`, etc.) in
     `packages/server/src/tools/` + tests.
   - [ ] `aegis init`, `aegis doctor`, `aegis audit` references in
     terminal output + help text say `aegisctx`.
4. **Directory structure on disk**
   - [ ] `~/.aegis/` → `~/.aegisctx/` across `packages/cli/src/commands/`
     and `packages/server/src/runtime/context.ts`.
   - [ ] One-time migration helper in `packages/cli/src/commands/init.ts`:
     if `~/.aegis/` exists and `~/.aegisctx/` does not, print a hint to
     the user (no automatic move — safer during rename).
5. **Documentation**
   - [ ] `README.md`, `PLAN.md`, `MILESTONES.md`, all ADRs, all `docs/`
     files — every `aegis init`, `aegis doctor`, `aegis audit`,
     `npm install -g aegis`, and `@aegis/*` import becomes the new form.
   - [ ] `docs/plans/*.md` already use the new names (reference only).
6. **CI / scripts**
   - [ ] `scripts/ci/smoke.mjs`: CLI_NAME assertion updated.
   - [ ] `scripts/ci/hygiene.mjs`: any grep/regex keyed on the old name
     updated.
   - [ ] `.github/workflows/ci.yml`: no change needed beyond comments.
7. **Config file templates**
   - [ ] `configs/*.json` references to `aegis` tool names and `aegis`
     MCP server names renamed.

## Acceptance criteria

- `pnpm install` succeeds; `pnpm -r run build` succeeds.
- `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck` all
  pass.
- `node packages/cli/dist/bin.js --version` prints the version.
- `node packages/cli/dist/bin.js init --dry-run claude-code` references
  only new names in its output.
- `rg -l '@aegis/'` in the tree returns no matches.
- `rg 'aegis_execute|aegis_search|aegis_index|aegis_fetch|aegis_stats|aegis_doctor|aegis_audit|aegis_batch|aegis_execute_file'`
  returns zero matches.
- `rg '\baegis init\b|\baegis doctor\b|\baegis audit\b|\baegis config\b|\baegis policy\b|\baegis session\b|\baegis stats\b|\baegis purge\b|npm install -g aegis\b'`
  returns zero matches.

## Test strategy

- Update every test file that imports from `@aegis/*` to
  `@aegisctx/*`.
- Add `packages/cli/src/cli.test.ts` assertion that `CLI_NAME` is
  `"aegisctx"`.
- Add a regression test: snapshot of `aegisctx doctor --help` output,
  asserting it does not contain the string `aegis ` (with trailing
  space) as a command prefix.

## Out of scope

- Publishing to npm (covered by plan 13).
- Migrating existing users' `~/.aegis/` directories automatically — we
  surface a one-line hint and document the one-line shell command
  they'd run.

## Risks

- **Leftover references in fixtures** — JSON fixtures may embed the old
  tool names. Mitigation: grep both source and fixture trees; CI
  hygiene script adds a guard.
- **Line-ending churn on Windows PRs** — mitigated by `.gitattributes`
  (confirm it's present, add one if not).

## Sequencing inside the PR

1. Rename workspace package.json files, run `pnpm install`, commit.
2. Bulk `sed` across `packages/` for `@aegis/` → `@aegisctx/`, commit.
3. MCP tool name renames in `packages/server/src/tools/` + tests, commit.
4. `~/.aegis/` → `~/.aegisctx/` + migration hint in `init`, commit.
5. Docs + ADRs + scripts, commit.
6. `pnpm build && pnpm test && pnpm lint && pnpm typecheck`, commit any
   follow-ups.
