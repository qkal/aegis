# Oxlint, Dprint, and CI Modernization Design

## Status

Approved in brainstorming on 2026-04-17.

## Goal

Fully remove Biome from Aegis, replace it with `oxlint` for linting and `dprint` for formatting, and redesign GitHub Actions CI so pull requests get broader verification with lower wall-clock time on the required Linux path.

## User Decisions

- Remove Biome completely rather than keeping it as a formatter.
- Use `dprint` as the formatter replacement.
- Keep CI Linux-first and optimize for the fastest required path.
- Keep a dedicated `tsc --noEmit` lane for now.
- Add more CI coverage in this order:
  1. built-artifact smoke checks
  2. parallelized test execution
  3. install/build hygiene verification

## Current State

### Tooling

- Root scripts in [package.json](/C:/Users/Better/Documents/aegis/package.json) use Biome for linting and formatting:
  - `lint`: `biome check .`
  - `lint:fix`: `biome check --write .`
  - `format`: `biome format --write .`
- Formatting and linting settings live in [biome.json](/C:/Users/Better/Documents/aegis/biome.json).
- The repo currently uses TypeScript `5.7.3`, Vitest, pnpm workspaces, and per-package `tsc --noEmit`.

### CI

- CI is defined in [.github/workflows/ci.yml](/C:/Users/Better/Documents/aegis/.github/workflows/ci.yml).
- One Ubuntu job runs `lint`, `typecheck`, `test:coverage`, and `build` sequentially.
- Coverage is uploaded as an artifact, but tests are not sharded and there is no separate smoke or hygiene lane.

### Documentation Drift Risk

Biome is treated as the canonical toolchain in:

- [README.md](/C:/Users/Better/Documents/aegis/README.md)
- [PLAN.md](/C:/Users/Better/Documents/aegis/PLAN.md)
- [MILESTONES.md](/C:/Users/Better/Documents/aegis/MILESTONES.md)
- [docs/adr/0010-biome-for-linting-and-formatting.md](/C:/Users/Better/Documents/aegis/docs/adr/0010-biome-for-linting-and-formatting.md)

Any migration that only changes scripts and CI would leave the repo architecturally inconsistent.

## External Constraints

- Oxlint supports root config files in `.oxlintrc.json` or `oxlint.config.ts`. For this repo, JSON config is preferred because it keeps the lint config runtime-independent and simpler in CI.
- Oxlint type-aware linting exists, but it currently requires `TypeScript 7.0+` and monorepos may need built `.d.ts` outputs for reliable analysis.
- `dprint` supports TypeScript/JavaScript, JSON, and Markdown through first-party plugins, which covers the file types Aegis currently formats in practice.
- GitHub Actions already supports the workflow-level `concurrency` pattern the repo is using, plus pnpm dependency caching through `actions/setup-node`.

References:

- [Oxlint overview](https://oxc.rs/docs/guide/usage/linter.html)
- [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config)
- [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware)
- [Oxlint `typescript/no-explicit-any`](https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-explicit-any)
- [dprint configuration](https://dprint.dev/config/)
- [dprint plugins](https://dprint.dev/plugins/)
- [GitHub Actions concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub Actions dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [GitHub Actions artifacts](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow)

## Target Design

### 1. Tooling Responsibilities

The repo will use one tool per responsibility:

- `oxlint`: linting only
- `dprint`: formatting only
- `tsc --noEmit`: type checking only
- `vitest`: unit and package-level test execution

Biome will be removed from:

- root dependencies
- root scripts
- config files
- docs and ADR references
- CI commands

### 2. Root Config Files

The root of the repo will contain:

- `.oxlintrc.json`
- `dprint.json`

`.oxlintrc.json` is preferred over `oxlint.config.ts` because it avoids a Node-executed config layer and is easier to keep deterministic across editors, local runs, and CI.

`dprint.json` will format:

- TypeScript and JavaScript
- JSON and JSONC-style config files where supported
- Markdown

This is sufficient to cover the repo’s source files, root config files, ADRs, plans, and README content.

### 3. Root Script Contract

The root scripts will be reshaped to make responsibilities explicit:

- `lint`: run `oxlint`
- `lint:fix`: run `oxlint --fix`
- `format`: run `dprint fmt`
- `format:check`: run `dprint check`
- `typecheck`: keep `pnpm -r run typecheck`
- `test`: keep Vitest as the default local test entrypoint

The existing Biome command names should not be preserved behind compatibility aliases. The repo should move to the new commands directly so CI, documentation, and editor setup all describe the same workflow.

### 4. Rule-Mapping Strategy

The migration should preserve intent, not replicate every Biome behavior mechanically.

Rules and behavior that must survive the migration:

- zero-tolerance for explicit `any`
- correctness-focused lint defaults
- import hygiene
- double quotes, semicolons, and tab indentation

How that intent maps:

- `typescript/no-explicit-any` in Oxlint replaces the current Biome `noExplicitAny` enforcement
- `dprint` becomes the source of truth for formatting style
- import/order cleanup is handled with Oxlint rules and autofix where it is safe, rather than as formatter magic

The migration should not attempt to recreate every current Biome convenience if that adds significant complexity or reduces determinism.

### 5. Documentation and ADR Strategy

The repo should not silently pretend ADR-0010 never happened.

Design decision:

- add a new ADR that supersedes ADR-0010
- update ADR-0010’s status to indicate that it has been superseded
- update README, PLAN, and MILESTONES to reference the new toolchain

This preserves architectural history while making the current standard explicit.

## CI Architecture

### 1. Workflow Shape

Replace the single `quality` job with a Linux-first parallel workflow. The required path remains Ubuntu-only, but the work is split into independent jobs to reduce elapsed time.

Required jobs:

- `format`
- `lint`
- `typecheck`
- `test-core`
- `test-storage`
- `test-rest`
- `build`
- `hygiene`
- `smoke`

`smoke` depends on `build`. The other jobs should run independently as much as possible.

### 2. Job Responsibilities

#### `format`

- Run `pnpm format:check`
- Fail on formatting drift only

#### `lint`

- Run `pnpm lint`
- Fail on Oxlint findings only

#### `typecheck`

- Run `pnpm typecheck`
- Keep this lane separate from linting during the first migration

#### `test-core`

- Run tests limited to `packages/core`

#### `test-storage`

- Run tests limited to `packages/storage`

#### `test-rest`

- Run the remaining tests, initially covering `adapters`, `engine`, `server`, `cli`, and any future root-level `tests/`

Sharding by stable package/area boundaries is preferred over timing-based sharding because it is easy to reason about, does not require external tooling, and stays stable as the repo evolves.

#### `build`

- Run `pnpm build`
- Upload built artifacts needed by `smoke`

The artifact set should include at minimum the package `dist/` directories and the root metadata needed to execute built files consistently.

#### `hygiene`

- Run `pnpm install --frozen-lockfile`
- Verify install/build hygiene separate from lint or tests
- Check that publishable workspace packages can produce distributable artifacts or package tarballs

The goal of this job is to catch dependency drift, broken publish surfaces, and packaging regressions without coupling those failures to the test or lint lanes.

#### `smoke`

- Download the build artifact from `build`
- Execute built code paths that validate runtime viability

Smoke coverage should start with what the repo can currently support safely:

- verify the built CLI entrypoint loads without module-resolution failure
- run the built CLI in a minimal invocation path once argument dispatch exists
- verify the built server package can be imported without runtime crash

Because the CLI is still scaffold-level today, the first version of `smoke` should validate artifact integrity and loadability, then expand to command-level assertions as the CLI matures.

### 3. Shared Job Setup

Each job should keep the existing supply-chain posture:

- pinned `actions/checkout`
- pinned `pnpm/action-setup`
- pinned `actions/setup-node`
- least-privilege `permissions`

Each job should use pnpm caching through `actions/setup-node` and keep `concurrency.cancel-in-progress: true` at the workflow level.

### 4. Coverage Policy

Coverage should not stay on the critical path by default if it materially slows the required PR flow.

Initial decision:

- remove mandatory coverage collection from every required test job
- keep the required path optimized for fast feedback
- revisit coverage thresholds or a dedicated coverage lane after the migration lands and timings are measured

This matches the user’s priority order of smoke checks first, test parallelism second, and hygiene third.

## Migration Phases

### Phase 1: Toolchain Replacement

- add `oxlint` and `dprint`
- create `.oxlintrc.json` and `dprint.json`
- replace root scripts
- remove `@biomejs/biome`
- remove `biome.json`

### Phase 2: Repo Normalization

- apply the new formatter across the repository
- separate pure formatting churn from lint-driven source changes where practical
- fix rule violations introduced or surfaced by the new lint rules

### Phase 3: Documentation and ADR Alignment

- add the new superseding ADR
- mark ADR-0010 as superseded
- update README, PLAN, and MILESTONES to reference the new toolchain and CI behavior

### Phase 4: CI Restructure

- split the monolithic CI job into parallel Linux jobs
- add test sharding
- add build artifact upload/download
- add smoke validation
- add hygiene validation

### Phase 5: Post-Migration Evaluation

- measure CI wall-clock time before and after the migration
- check whether any test shard is materially imbalanced
- decide whether a separate coverage lane is worth adding
- evaluate a future upgrade path to `TypeScript 7 + oxlint --type-aware --type-check`

## Out of Scope

These items are explicitly not part of the first migration:

- replacing `tsc --noEmit` immediately
- adding required Windows or macOS CI jobs
- building deep end-to-end environment tests for unfinished CLI/server behavior
- keeping Biome as a temporary dual-run verifier

## Risks and Mitigations

### Formatting Churn

Risk:

- `dprint` may reformat files differently from Biome, producing a large first diff

Mitigation:

- keep the formatter migration in an isolated commit or tightly-scoped commit series
- separate formatting-only churn from semantic lint fixes where possible

### Import-Order Behavior Changes

Risk:

- Biome previously bundled organize-imports behavior into one tool; the new split may surface different import diffs

Mitigation:

- treat import ordering as an explicit lint/fix concern
- keep the first pass conservative and deterministic

### Smoke Job False Expectations

Risk:

- the repo’s CLI is not feature-complete, so an ambitious smoke lane could fail for reasons unrelated to packaging or runtime integrity

Mitigation:

- scope the first smoke job to “built artifact loads and runs minimally” instead of pretending the CLI is feature-complete

### Future Type-Aware Lint Temptation

Risk:

- trying to replace `tsc` during the first migration could expand scope into a TypeScript 7 migration

Mitigation:

- keep type-aware Oxlint as a post-migration evaluation item only

## Success Criteria

The migration is successful when all of the following are true:

- Biome no longer exists in dependencies, scripts, config, CI, or active documentation
- local developer workflow is documented as `dprint` for formatting and `oxlint` for linting
- CI required jobs run in parallel on Linux
- CI validates built artifacts via a smoke lane
- CI test execution is sharded by stable package boundaries
- CI includes a separate hygiene lane for install/build/package integrity
- `tsc --noEmit` remains intact during the first migration
