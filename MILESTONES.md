# Aegis — Milestone Backlog

Phased implementation plan with concrete deliverables, acceptance criteria, and risk callouts.
Each milestone builds on the previous one. Quality gates must pass before advancing.

---

## Phase 0: Foundation — Architecture Validation

**Duration**: 1 week
**Theme**: Prove the architecture works before building on it.

### Deliverables

- [x] **M0.1** — Monorepo skeleton builds and type-checks
  - pnpm workspaces resolve all `workspace:*` dependencies
  - `pnpm build` succeeds across all packages
  - `pnpm typecheck` reports zero errors
  - tsconfig project references enforce dependency direction
- [x] **M0.2** — Policy evaluation engine with property-based tests
  - `evaluateToolCall()` handles deny → ask → allow → default-deny
  - `evaluateEnvVar()`, `evaluateFilePath()`, `evaluateNetAccess()` all implemented
  - Glob matching covers `*`, `?`, literal escaping
  - Property-based tests (fast-check): random inputs produce deterministic output
  - 100% statement / 95%+ branch coverage on `packages/core/src/policy/`
- [ ] **M0.3** — SQLite adapter abstraction
  - `Database` interface implemented for `better-sqlite3`
  - `node:sqlite` adapter (Node 22+) implemented
  - In-memory database (`:memory:`) works for all tests
  - Migration system applies numbered migrations idempotently
- [ ] **M0.4** — FTS5 content indexing proof
  - Porter + trigram dual FTS5 tables created via migrations
  - Content chunking (markdown by headings, 4KB max)
  - Content deduplication via SHA-256 hash
  - RRF merge with configurable k-parameter
  - Benchmark: <10ms p99 query latency on 10K chunks
- [x] **M0.5** — CI pipeline green
  - Vitest runs all packages
  - Biome lint passes
  - TypeScript strict mode, zero errors

### Acceptance Criteria
- `pnpm test` passes with 100% core logic coverage
- Policy evaluation is deterministic (verified by property test)
- FTS5 queries return relevant results in <10ms on 10K chunks

### Risks
- `node:sqlite` API differences may require more bridging than expected
- FTS5 trigram tokenizer performance on large corpora is unvalidated

### Out of Scope
- Platform-specific code, MCP protocol, CLI, audit HMAC chain

---

## Phase 1: MVP Core — Working MCP Server

**Duration**: 2 weeks
**Theme**: Installable, usable tool with Claude Code.

### Deliverables

- [ ] **M1.1** — Sandbox execution engine (`@aegis/engine`)
  - `PolyglotExecutor` spawns isolated processes per language
  - Runtime detection for all 11 supported languages
  - Environment explicitly constructed (not inherited)
  - Process timeout with `SIGKILL` to entire process group
  - Output capture with truncation and ANSI stripping
  - Integration tests with real process spawning
- [ ] **M1.2** — MCP server with tool registration (`@aegis/server`)
  - `aegis_execute` — sandboxed code execution
  - `aegis_search` — BM25-ranked content search
  - `aegis_index` — content indexing
  - `aegis_fetch` — URL fetch, convert to markdown, index
  - `aegis_stats` — session statistics
  - `aegis_doctor` — diagnostics
  - MCP stdio transport, graceful shutdown
  - Server.ts stays under 200 lines
- [ ] **M1.3** — Claude Code adapter (Tier 1)
  - Full hook support: PreToolUse, PostToolUse, PreCompact, SessionStart
  - Platform detection via `CLAUDE_PROJECT_DIR`
  - Input validation (Zod) at adapter boundary
  - Session event extraction from PostToolUse results
  - Fixture-based tests against recorded Claude Code hook payloads
- [ ] **M1.4** — Session event capture and restore
  - PostToolUse events captured as typed `SessionEvent` records
  - PreCompact generates priority-tiered snapshot (2KB budget)
  - SessionStart restores snapshot into agent context
  - Events persist in SQLite across compaction/resume cycles
- [ ] **M1.5** — Policy enforcement integration
  - PreToolUse hook evaluates tool calls against policy
  - Denied commands return structured error to agent
  - Default policy blocks `sudo`, `rm -rf`, `.env` reads, etc.
  - Policy loaded from `~/.aegis/config.json` and project `.aegis/config.json`
- [ ] **M1.6** — CLI: `aegis doctor` + `aegis init claude-code`
  - `aegis doctor` validates platform, runtimes, storage, policy, hooks
  - `aegis init` creates `~/.aegis/config.json` with secure defaults
  - `aegis init claude-code` configures Claude Code hooks
  - Clear, colored terminal output

### Acceptance Criteria
- Install via `npm install -g aegis` (or local `pnpm build`)
- `aegis init` + start Claude Code session → hooks registered
- `aegis_execute` runs JavaScript in sandbox, returns only stdout
- `aegis_search` returns ranked results from indexed content
- Session events persist across compaction → restore cycle
- `aegis doctor` reports all checks passing
- Context savings measurable: 56KB Playwright snapshot → <500B

### Risks
- MCP SDK version compatibility across Claude Code versions
- Hook timing — PreToolUse must respond within platform timeout

### Out of Scope
- Audit log, non-Claude platforms, plugins, advanced policy features

---

## Phase 2: Hardened Architecture — Security & Multi-Platform

**Duration**: 2 weeks
**Theme**: Audit trail, enhanced isolation, broader platform support.

### Deliverables

- [ ] **M2.1** — HMAC-chained audit log (`@aegis/storage/audit`)
  - Append-only audit entries with UUIDv7 IDs
  - HMAC chain: each entry includes HMAC of previous entry
  - Audit key generated on first run, stored at `~/.aegis/audit-key` (0o600)
  - Separate SQLite database per project
  - `aegis audit show` CLI command with category/action/decision filters
  - `aegis audit verify` CLI command validates chain integrity
- [ ] **M2.2** — Enhanced sandbox isolation
  - Explicit env var allowlist (no credential passthrough by default)
  - Deny `AWS_*`, `GH_TOKEN`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, etc.
  - Filesystem scoping: no access to `~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg`
  - Restricted `PATH` with only declared runtimes
  - Temporary directories with `0o700` permissions
- [ ] **M2.3** — Multi-platform adapters
  - Gemini CLI adapter (Tier 1)
  - Cursor adapter (Tier 2)
  - VS Code Copilot adapter (Tier 1)
  - Platform auto-detection via environment variables
  - Each adapter has fixture-based tests
- [ ] **M2.4** — Advanced policy features
  - `ask` mode: user confirmation prompt with decision recording
  - File path deny patterns with symlink resolution
  - Environment variable patterns (glob matching)
  - `aegis policy check <command>` CLI command
  - `aegis policy validate` CLI command
- [ ] **M2.5** — Migration system operational
  - Schema changes across DB versions tested
  - Upgrade path from Phase 1 schema to Phase 2 schema verified
  - Corruption detection: `SQLITE_CORRUPT` → rename, recreate, notify

### Acceptance Criteria
- `aegis audit verify` confirms chain integrity after full session
- Denied command appears in audit log with reason
- Three platforms working with appropriate capability tiers
- Policy `ask` mode prompts user and records decision
- Schema migration from v1 → v2 succeeds without data loss

### Risks
- HMAC chain performance on high-frequency audit writes
- Platform-specific hook quirks (Cursor's rejected sessionStart)

### Out of Scope
- Plugins, namespace isolation, analytics, export/import

---

## Phase 3: Ecosystem — Plugins & All Platforms

**Duration**: 2 weeks
**Theme**: Extensibility and platform coverage.

### Deliverables

- [ ] **M3.1** — Remaining platform adapters
  - OpenCode adapter (Tier 2)
  - KiloCode adapter (Tier 2)
  - Codex CLI adapter (Tier 3)
  - Kiro adapter (Tier 2)
  - Zed adapter (Tier 3)
  - Generic MCP-only fallback adapter (Tier 3)
- [ ] **M3.2** — Plugin system with worker-thread isolation
  - `AegisPlugin` interface: `onToolCall`, `onToolResult`, `onSessionStart`, `onSessionCompact`
  - `PluginContext` with constrained API (read sessions, search, index — no policy/audit access)
  - Plugins loaded from `~/.aegis/plugins/` or `<project>/.aegis/plugins/`
  - Worker thread isolation with structured clone boundary
  - Plugin schema validation at load time
- [ ] **M3.3** — Platform config templates and init
  - `aegis init <platform>` for all supported platforms
  - Config templates in `configs/` directory
  - Routing instruction files (AGENTS.md, GEMINI.md, etc.) for Tier 3 platforms
  - Templates not auto-written to project directory (user-initiated only)
- [ ] **M3.4** — Comprehensive `aegis doctor`
  - Validates all platform-specific configurations
  - Reports capability tier for detected platform
  - Checks plugin validity and isolation
  - Provides actionable fix suggestions for all failure modes

### Acceptance Criteria
- `aegis init <platform>` works for all supported platforms
- Plugin loaded, executed in worker thread, constrained to declared API
- `aegis doctor` validates all platform configurations
- Tier 3 platforms report honest ~60% routing compliance

### Risks
- Worker thread structured clone boundary limits plugin API design
- Platforms with in-process plugin models need different isolation

### Out of Scope
- Analytics dashboard, Level 3 sandbox, export/import

---

## Phase 4: Operational Maturity — Observability & Reliability

**Duration**: 2 weeks
**Theme**: Production-ready observability, data management, performance.

### Deliverables

- [ ] **M4.1** — Analytics engine
  - Per-tool context savings calculation
  - Tool call frequency and latency tracking
  - Cache hit/miss rates
  - Session pattern analysis
  - `aegis stats` CLI with detailed report
- [ ] **M4.2** — Export / Import
  - `aegis export --session` → JSON (discriminated union schema)
  - `aegis export --audit` → JSONL
  - `aegis export --content` → Markdown
  - `aegis import --session <file>` with schema validation
  - Round-trip: export → purge → import → verify
- [ ] **M4.3** — Corruption recovery
  - Corruption detection in all DB operations
  - Corrupt DB renamed to `<name>.corrupt.<timestamp>.db`
  - Fresh DB created with current schema
  - `aegis doctor` checks for `.corrupt.*` files
  - Never silently delete — user may want recovery
- [ ] **M4.4** — Performance targets
  - Server startup to first MCP response: <100ms
  - FTS5 query on 10K chunks: <10ms p99
  - Sandbox spawn + execute + capture: <500ms (trivial script)
  - Policy evaluation: <1ms per command
  - Memory usage: <50MB for typical session (1000 events, 100 sources)
  - Benchmark suite in CI with regression detection

### Acceptance Criteria
- `aegis stats` produces accurate context savings report
- Export → purge → import → verify round-trip succeeds
- Corrupted DB detected and recovered without affecting other DBs
- Startup benchmarked at <100ms
- Memory stays under 50MB for typical session

### Risks
- Analytics computation on large event sets may be slow
- Export format must be forward-compatible with future schema changes

### Out of Scope
- GUI, cloud sync, Level 3 sandbox

---

## Phase 5: Advanced Capabilities (Ongoing)

**Duration**: Ongoing
**Theme**: Advanced security, intelligence, and developer experience.

### Deliverables

- [ ] **M5.1** — Level 3 sandbox: Linux namespace isolation
  - `unshare` for PID/network namespace isolation
  - macOS: `sandbox-exec` profile (deprecated but functional)
  - Opt-in via `aegis config set sandbox.level 3`
  - Fallback to Level 1 with monitoring
- [ ] **M5.2** — Local analytics dashboard (`aegis insight`)
  - Local web UI served via `aegis insight`
  - Context savings over time
  - Policy decision distribution
  - Session timeline visualization
  - Reads from local DBs only, zero network
- [ ] **M5.3** — Advanced search features
  - Optional embedding-based search (user-configured model)
  - Hybrid: BM25 + embedding with fusion
  - Cross-session knowledge persistence per-project
- [ ] **M5.4** — Batch execution optimization
  - Parallel sandbox processes
  - Shared runtime process pools
  - Warm-start optimization for repeated languages

### Risks
- Namespace isolation requires elevated privileges on some systems
- Embedding search adds large dependency (model files)
- Cross-session knowledge design needs careful privacy review

---

## Quality Gates (Apply to All Phases)

Every phase must satisfy the applicable gates before release:

### Security
- [ ] Zero `any` in `@aegis/core` (enforced by biome `noExplicitAny: "error"`)
- [ ] All external inputs validated by Zod schemas
- [ ] Policy evaluation has 100% branch coverage
- [ ] No `eval()`, `Function()`, `vm.runInNewContext()` on untrusted input
- [ ] No postinstall or lifecycle scripts in published package
- [ ] `npm audit` reports zero high/critical vulnerabilities

### Correctness
- [ ] Policy evaluation is deterministic (property-based test)
- [ ] Session restore reproduces same snapshot given same events
- [ ] Search results are stable (same query + same index → same results)
- [ ] Migration system is idempotent (running migrations twice is safe)
- [ ] All discriminated union types exhaustively handled in switch statements

### Compatibility
- [ ] Works on Node.js 22+ (primary) and Bun
- [ ] Works on macOS (Intel + Apple Silicon), Linux (x64 + arm64)
- [ ] SQLite works across all supported backends

### Performance
- [ ] Server startup to first MCP response: <100ms
- [ ] FTS5 query on 10K chunks: <10ms p99
- [ ] Policy evaluation: <1ms per command

### Privacy
- [ ] Zero network calls in default configuration
- [ ] No filesystem access outside `~/.aegis/`, project dir, and OS temp
- [ ] No environment variable logging that could contain secrets
