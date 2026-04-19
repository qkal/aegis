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
  - Dependency direction (`core ← engine ← storage ← server ← cli`) is
    enforced through pnpm workspace linking; TypeScript project
    references are out of scope for Phase 0.
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
- [x] **M0.4** — FTS5 content indexing proof
  - Porter + trigram dual FTS5 tables created via migrations
  - Content chunking (markdown by headings, 4KB max)
  - Content deduplication via SHA-256 hash
  - RRF merge with configurable k-parameter
  - Benchmark: `pnpm bench` (`packages/storage/src/content/search.bench.ts`)
    exercises a 10K-chunk corpus. Identifier queries meet the <10ms p99
    target (~7ms observed); broad multi-token queries are dominated by the
    trigram tokenizer (~20ms p99) — a quantified follow-up for future
    tuning, not a regression. Default overall p99 budget is 25ms.
- [x] **M0.5** — CI pipeline green
  - Vitest runs all packages
  - `pnpm format:check` passes
  - `pnpm lint` passes
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

## Phase 1: MVP Core — Multi-Platform MCP Server

**Duration**: 3 weeks (Phase 1a: M1.1–M1.6, ~2 weeks; Phase 1b: M1.7–M1.9, ~1 week)
**Theme**: Installable, usable tool with Claude Code, Codex CLI, OpenCode, and AmpCode.

Phase 1a delivers the core server, Claude Code adapter, session capture, policy
enforcement, and CLI. Phase 1b adds the three additional platform adapters.
Phase 1b may slip to week 4 if Phase 1a cross-cutting work (tier-aware
capability advertisement, MCP-wrapper enforcement, idle-window snapshots) takes
longer than estimated.

See [ADR-0016](./docs/adr/0016-mvp-adapter-scope.md) for the rationale
behind the four-platform MVP scope. Cursor, Windsurf, Antigravity, Zed,
VS Code Copilot, Gemini CLI, Kiro, and KiloCode are deferred to Phase 2 / 3.

### Deliverables

- [x] **M1.1** — Sandbox execution engine (`@aegisctx/engine`)
  - `PolyglotExecutor` spawns isolated processes per language
  - Runtime detection for all 11 supported languages
  - Environment explicitly constructed (not inherited)
  - Process timeout with `SIGKILL` to entire process group
  - Output capture with truncation and ANSI stripping
  - Integration tests with real process spawning
- [ ] **M1.2** — MCP server with tool registration (`@aegisctx/server`)
  - `aegisctx_execute` — sandboxed code execution
  - `aegisctx_search` — BM25-ranked content search
  - `aegisctx_index` — content indexing
  - `aegisctx_fetch` — URL fetch, convert to markdown, index
  - `aegisctx_stats` — session statistics
  - `aegisctx_doctor` — diagnostics
  - MCP stdio transport, graceful shutdown
  - Tier-aware capability advertisement to the agent at session start
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
  - OpenCode supports both `session.compacted` and `session.idle`; Phase 1
    uses compaction snapshots (like Claude Code) with idle-window as fallback
  - Compaction-less platforms (Codex, AmpCode) use idle-window snapshots only
- [ ] **M1.5** — Policy enforcement integration
  - PreToolUse hook evaluates tool calls against policy (where supported)
  - MCP tool wrapper enforces policy when hooks are unavailable / unmatched
  - Denied commands return structured error to agent
  - Default policy blocks `sudo`, `rm -rf`, `.env` reads, credential env vars
  - Policy loaded from `~/.aegisctx/config.json` and project `.aegisctx/config.json`
- [ ] **M1.6** — CLI: `aegisctx doctor` + `aegisctx init <platform>`
  - `aegisctx doctor` validates platform, runtimes, storage, policy, hooks
  - `aegisctx init` creates `~/.aegisctx/config.json` with secure defaults
  - `aegisctx init claude-code|codex|opencode|amp` configures the platform
  - Each `init` prints the diff before applying and supports `--dry-run`
  - Clear, colored terminal output
- [ ] **M1.7** — Codex CLI adapter (Tier 1L)
  - Hook support behind `[features] codex_hooks = true` flag check
  - Reads `~/.codex/hooks.json` and project `.codex/hooks.json`
  - Installs `aegisctx hook codex pre-tool-use` etc. as command hooks
  - Reports `interceptedTools: ['Bash']` in capabilities (per current Codex matcher)
  - MCP registration in `~/.codex/config.toml` `[mcp_servers.aegisctx]`
  - Platform detection via `CODEX_HOME` / `CODEX_SESSION_ID`
  - Fixture-based tests against recorded Codex hook payloads
- [ ] **M1.8** — OpenCode adapter (Tier 1)
  - Plugin shipped as `@aegisctx/opencode-plugin` (separate npm package OR loaded from `~/.config/opencode/plugins/aegisctx.ts`)
  - Hooks: `tool.execute.before`, `tool.execute.after`, `session.compacted`, `session.idle`, `permission.asked`
  - MCP registration in `opencode.json` (or `~/.config/opencode/opencode.json`)
  - Platform detection via `OPENCODE_*` env vars + `.opencode/` directory presence
  - Fixture-based tests against recorded OpenCode plugin events
- [ ] **M1.9** — AmpCode adapter (Tier 3)
  - MCP registration via `amp mcp add aegisctx -- aegisctx serve` (or `.amp/settings.json` write)
  - Routing instruction file `.amp/AGENTS.md` template installed by `aegisctx init amp`
  - Capabilities honestly report `tier: 3, supportedHooks: []`
  - Policy enforced inside the MCP tool wrapper (no PreToolUse available)
  - Platform detection via `AMP_*` env vars + `~/.amp/` presence
  - Fixture-based tests against recorded MCP request/response pairs

### Acceptance Criteria

- Install via `npm install -g aegisctx` (or local `pnpm build`)
- `aegisctx init claude-code` + start Claude Code session → hooks registered
- `aegisctx init codex` + start Codex CLI session → hooks + MCP registered
- `aegisctx init opencode` + start OpenCode session → plugin + MCP registered
- `aegisctx init amp` + start Amp session → MCP registered, AGENTS.md routing in place
- `aegisctx_execute` runs JavaScript in sandbox, returns only stdout, on all four platforms
- `aegisctx_search` returns ranked results from indexed content, on all four platforms
- Session events persist across compaction → restore cycle (Claude Code, OpenCode)
- Session events persist across idle → restore cycle (Codex, AmpCode)
- `aegisctx doctor` reports all checks passing on each detected platform
- Context savings measurable: 56KB Playwright snapshot → <500B (Claude Code, OpenCode)
- AmpCode adapter reports `Tier 3` to the agent at session start (verified by fixture)
- Codex adapter reports `interceptedTools: ['Bash']` (verified by fixture)

### Risks

- MCP SDK version compatibility across all four platforms
- Hook timing — PreToolUse must respond within platform timeout (Claude Code: 60s default; Codex: 600s default; OpenCode: bun async, no hard limit)
- Codex `codex_hooks` is feature-flagged and may break on Codex version bumps
- OpenCode plugin SDK is < 1.0; event names may rename
- AmpCode has no hook surface — degraded enforcement is unavoidable today

### Out of Scope

- Audit log (Phase 2)
- Cursor, Windsurf, Antigravity, Zed, VS Code Copilot, Gemini CLI, Kiro, KiloCode adapters (Phase 2/3)
- Plugin system, advanced policy features

---

## Phase 2: Hardened Architecture — Security & Wave-2 Platforms

**Duration**: 2 weeks
**Theme**: Audit trail, enhanced isolation, second wave of adapters.

### Deliverables

- [ ] **M2.1** — HMAC-chained audit log (`@aegisctx/storage/audit`)
  - Append-only audit entries with UUIDv7 IDs
  - HMAC chain: each entry includes HMAC of previous entry
  - Audit key generated on first run, stored at `~/.aegisctx/audit-key` (0o600)
  - Separate SQLite database per project
  - `aegisctx audit show` CLI command with category/action/decision filters
  - `aegisctx audit verify` CLI command validates chain integrity
- [ ] **M2.2** — Enhanced sandbox isolation
  - Explicit env var allowlist (no credential passthrough by default)
  - Deny `AWS_*`, `GH_TOKEN`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, etc.
  - Filesystem scoping: no access to `~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg`
  - Restricted `PATH` with only declared runtimes
  - Temporary directories with `0o700` permissions
- [ ] **M2.3** — Wave-2 platform adapters
  - Cursor adapter (Tier 2 — `PreToolUse`/`PostToolUse` only)
  - Windsurf adapter (Tier 3 by default; promote to Tier 2 if hooks documented)
  - Antigravity adapter (Tier 3, MCP-only)
  - Generic MCP-only fallback adapter for unknown platforms (Tier 3)
  - Platform auto-detection via environment variables
  - Each adapter has fixture-based tests
- [ ] **M2.4** — Advanced policy features
  - `ask` mode: user confirmation prompt with decision recording
  - File path deny patterns with symlink resolution
  - Environment variable patterns (glob matching)
  - `aegisctx policy check <command>` CLI command
  - `aegisctx policy validate` CLI command
- [ ] **M2.5** — Migration system operational
  - Schema changes across DB versions tested
  - Upgrade path from Phase 1 schema to Phase 2 schema verified
  - Corruption detection: `SQLITE_CORRUPT` → rename, recreate, notify

### Acceptance Criteria

- `aegisctx audit verify` confirms chain integrity after full session
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
  - Gemini CLI adapter (Tier 1)
  - VS Code Copilot adapter (Tier 1)
  - KiloCode adapter (Tier 2)
  - Kiro adapter (Tier 2)
  - Zed adapter (Tier 3)
- [ ] **M3.2** — Plugin system with worker-thread isolation
  - `AegisPlugin` interface: `onToolCall`, `onToolResult`, `onSessionStart`, `onSessionCompact`
  - `PluginContext` with constrained API (read sessions, search, index — no policy/audit access)
  - Plugins loaded from `~/.aegisctx/plugins/` or `<project>/.aegisctx/plugins/`
  - Worker thread isolation with structured clone boundary
  - Plugin schema validation at load time
- [ ] **M3.3** — Platform config templates and init
  - `aegisctx init <platform>` for all supported platforms
  - Config templates in `configs/` directory
  - Routing instruction files (AGENTS.md, GEMINI.md, etc.) for Tier 3 platforms
  - Templates not auto-written to project directory (user-initiated only)
- [ ] **M3.4** — Comprehensive `aegisctx doctor`
  - Validates all platform-specific configurations
  - Reports capability tier for detected platform
  - Checks plugin validity and isolation
  - Provides actionable fix suggestions for all failure modes

### Acceptance Criteria

- `aegisctx init <platform>` works for all supported platforms
- Plugin loaded, executed in worker thread, constrained to declared API
- `aegisctx doctor` validates all platform configurations
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
  - `aegisctx stats` CLI with detailed report
- [ ] **M4.2** — Export / Import
  - `aegisctx export --session` → JSON (discriminated union schema)
  - `aegisctx export --audit` → JSONL
  - `aegisctx export --content` → Markdown
  - `aegisctx import --session <file>` with schema validation
  - Round-trip: export → purge → import → verify
- [ ] **M4.3** — Corruption recovery
  - Corruption detection in all DB operations
  - Corrupt DB renamed to `<name>.corrupt.<timestamp>.db`
  - Fresh DB created with current schema
  - `aegisctx doctor` checks for `.corrupt.*` files
  - Never silently delete — user may want recovery
- [ ] **M4.4** — Performance targets
  - Server startup to first MCP response: <100ms
  - FTS5 query on 10K chunks: <10ms p99
  - Sandbox spawn + execute + capture: <500ms (trivial script)
  - Policy evaluation: <1ms per command
  - Memory usage: <50MB for typical session (1000 events, 100 sources)
  - Benchmark suite in CI with regression detection

### Acceptance Criteria

- `aegisctx stats` produces accurate context savings report
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
  - Opt-in via `aegisctx config set sandbox.level 3`
  - Fallback to Level 1 with monitoring
- [ ] **M5.2** — Local analytics dashboard (`aegisctx insight`)
  - Local web UI served via `aegisctx insight`
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

- [ ] Zero `any` in `@aegisctx/core` (enforced by oxlint `typescript/no-explicit-any`)
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
- [ ] No filesystem access outside `~/.aegisctx/`, project dir, and OS temp
- [ ] No environment variable logging that could contain secrets
