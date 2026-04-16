# ADR-0017: Oxlint and Dprint for Linting and Formatting

## Status

Accepted

## Date

2026-04-17

## Supersedes

ADR-0010: Biome for Linting and Formatting

## Context

The project has outgrown the "single tool does everything" decision captured in ADR-0010.
We now want:

1. `oxlint` for linting
2. `dprint` for formatting
3. Linux-first CI that runs formatting, linting, type checking, tests, build, smoke, and hygiene as separate jobs

This split gives us a faster linter, a formatter that stays deterministic in CI without external plugin downloads, and a clearer separation of responsibilities.

## Decision

Use:

- `oxlint` as the only linter
- `dprint` as the only formatter
- `tsc --noEmit` as a separate type-checking lane for now

Use npm-hosted dprint plugins instead of remote plugin URLs so CI does not need to fetch formatter plugins from a second distribution channel.

Keep CI Linux-first, but restructure it into parallel jobs:

- `format`
- `lint`
- `typecheck`
- `test-core`
- `test-storage`
- `test-rest`
- `build`
- `hygiene`
- `smoke`

## Rationale

- `oxlint` is optimized for large repos and CI workloads.
- `dprint` gives us fast formatting across TypeScript, JSON, and Markdown with one config file.
- Keeping `tsc` separate avoids forcing an immediate TypeScript 7 migration just to adopt Oxlint type-aware linting.
- Repo-owned smoke and hygiene scripts are easier to test than embedding all behavior directly in YAML.

## Consequences

- Contributors use `dprint` for formatting instead of Biome.
- CI gains more breadth without keeping all checks serialized in one job.
- ADR-0010 becomes historical context, not the current standard.
- A future ADR or follow-up decision may replace `tsc --noEmit` after a TypeScript 7 migration.
