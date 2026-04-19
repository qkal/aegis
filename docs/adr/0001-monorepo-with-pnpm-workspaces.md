# ADR-0001: Monorepo with pnpm Workspaces

## Status

Accepted

## Date

2025-01-15

## Context

Aegis consists of six packages with coordinated releases, shared types, and strict dependency direction. We need a repository structure that enforces architectural boundaries while enabling atomic cross-package changes and a single CI pipeline.

Options considered:

1. **Monorepo with pnpm workspaces** — All packages in one repo, managed by pnpm.
2. **Polyrepo** — Each package in its own repository, published independently.
3. **Monorepo with Turborepo/Nx** — Monorepo with a build orchestration layer.

## Decision

Use a **pnpm workspace monorepo** with six packages:

```text
packages/core       — Pure logic, zero dependencies
packages/engine     — Sandbox execution, runtime detection
packages/storage    — SQLite persistence, FTS5 indexing, audit log
packages/adapters   — Platform-specific hook adapters
packages/server     — MCP server, tool registration
packages/cli        — CLI entry point, user-facing commands
```

Dependency direction is strict and enforced by package boundaries:

```text
core → (nothing)
engine → core
storage → core
adapters → core
server → core, engine, storage, adapters
cli → core, engine, storage, adapters, server
```

## Rationale

- **Shared types**: Packages share branded types, event models, and policy types from `@aegisctx/core`. A monorepo makes this trivial; a polyrepo requires publishing and versioning for every type change.
- **Atomic changes**: A policy schema change that affects core, storage, and server can be committed, tested, and reviewed as a single PR.
- **Single CI pipeline**: One test run validates all packages and their interactions.
- **No build orchestrator needed**: pnpm workspaces handle dependency linking. tsup handles per-package builds. Turborepo/Nx would add complexity without proportional benefit at this scale (6 packages).
- **Disk efficiency**: pnpm's content-addressable store deduplicates dependencies across packages.

## Consequences

- All packages share a single version of each dependency (enforced by pnpm strict peer deps).
- Package boundaries must be maintained by convention and CI checks (no runtime enforcement).
- Contributors must understand the monorepo structure.
- `pnpm` is required — `npm` and `yarn` are not supported for development.
