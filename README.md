# Aegis

Security-first, local-first context infrastructure engine for AI coding agents.

Aegis sits between AI coding agents (Claude Code, Codex CLI, OpenCode, AmpCode, and others) and the operating system, providing:

- **Context routing** — intercept tool I/O and route data-heavy operations through sandboxed execution
- **Session memory** — persist structured session events and rebuild working state across context compactions
- **Intelligent retrieval** — index content into a local knowledge base with BM25-ranked search
- **Policy enforcement** — evaluate every tool invocation against a declarative security policy before execution
- **Audit provenance** — record every security-relevant decision with cryptographic chain integrity

## Quick Start

```bash
# Install
npm install -g aegisctx

# Set up for your platform (specify one of: claude-code, codex, opencode, amp, generic)
aegisctx init <platform>

# Verify installation
aegisctx doctor
```

## Architecture

Aegis is structured as a pnpm monorepo with strict dependency direction:

```text
packages/
  core/        Pure logic: policy engine, event model, routing (zero dependencies)
  engine/      Sandbox execution, runtime detection, output processing
  storage/     SQLite persistence: sessions, FTS5 content index, HMAC audit log
  adapters/    Platform-specific: Claude Code, Codex CLI, OpenCode, AmpCode (MVP); Cursor, Windsurf, Antigravity, Gemini CLI, VS Code Copilot, ... (later phases)
  server/      MCP server: tool registration, transport, hook orchestration
  cli/         CLI: aegisctx doctor, aegisctx init, aegisctx config, aegisctx audit
```

Dependency direction: `core` ← `engine` ← `storage` ← `server` ← `cli`

`@aegisctx/core` has **zero npm dependencies** — pure TypeScript logic that is testable with just `import` and `assert`.

## MCP Tools

| Tool                    | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `aegisctx_execute`      | Sandboxed code execution in 11 languages         |
| `aegisctx_execute_file` | Process a file through sandboxed code            |
| `aegisctx_batch`        | Multiple commands + queries in one call          |
| `aegisctx_index`        | Index markdown/text into the knowledge base      |
| `aegisctx_search`       | BM25-ranked search across indexed content        |
| `aegisctx_fetch`        | Fetch URL, convert to markdown, index with cache |
| `aegisctx_stats`        | Context savings, call counts, session statistics |
| `aegisctx_doctor`       | Diagnostics: runtimes, hooks, FTS5, policy       |
| `aegisctx_audit`        | Query recent audit events                        |

## Platform Support

The MVP (Phase 1) supports four platforms; the rest are scheduled for
Phase 2 / 3. See [ADR-0007](./docs/adr/0007-platform-adapter-tier-system.md)
and [ADR-0016](./docs/adr/0016-mvp-adapter-scope.md) for the tier system
and MVP rationale.

| Tier        | Capabilities                                                       | MVP platforms                 | Phase 2 / 3 platforms                        |
| ----------- | ------------------------------------------------------------------ | ----------------------------- | -------------------------------------------- |
| **Tier 1**  | MCP + full hooks + policy + session continuity                     | Claude Code, OpenCode         | Gemini CLI, VS Code Copilot                  |
| **Tier 1L** | Tier 1 wiring; PreToolUse/PostToolUse limited to a subset of tools | Codex CLI (`Bash` only today) | —                                            |
| **Tier 2**  | MCP + partial hooks + policy + partial session                     | —                             | Cursor, Kiro, KiloCode                       |
| **Tier 3**  | MCP tools only, instruction-file routing                           | AmpCode                       | Windsurf, Antigravity, Zed, generic fallback |

## Security Model

- **Default deny** — sandbox starts with nothing; users explicitly grant access
- **No credential passthrough** — `AWS_*`, `GH_TOKEN`, `OPENAI_API_KEY` blocked by default
- **HMAC-chained audit log** — every policy decision recorded with tamper detection
- **No telemetry** — zero network calls in default configuration
- **No postinstall scripts** — all setup via explicit `aegisctx init`

See [PLAN.md](./PLAN.md) for the full architecture plan, threat model, and security analysis.

## CLI

```bash
aegisctx init <platform>       # Set up for your platform (required: claude-code, codex, opencode, amp, or generic)
aegisctx doctor                # Full health check
aegisctx config show           # Display resolved configuration
aegisctx config validate       # Validate all config files
aegisctx policy show           # Display resolved policy
aegisctx policy check <cmd>    # Test a command against policy
aegisctx audit show            # Recent audit events
aegisctx audit verify          # Verify HMAC chain integrity
aegisctx stats                 # Session statistics
aegisctx purge [--expired]     # Clean up indexed content
```

## Configuration

```jsonc
// ~/.aegisctx/config.json
{
	"version": 1,
	"policy": {
		"tools": {
			"deny": ["Bash(sudo *)", "Bash(rm -rf /*)"],
			"allow": ["Bash(git *)", "Bash(npm *)"],
		},
		"sandbox": {
			"env": { "allow": ["PATH", "HOME"], "deny": ["AWS_*", "GH_TOKEN"] },
			"net": { "deny": ["*"] },
		},
	},
	"execution": {
		"timeout": 30000,
		"maxOutput": 5242880,
	},
}
```

Precedence: CLI flags > env vars > project `.aegisctx/config.json` > user `~/.aegisctx/config.json` > built-in defaults.

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run CI test shards individually
pnpm test:core
pnpm test:storage
pnpm test:rest

# Format and lint
pnpm format
pnpm format:check
pnpm lint

# Type check
pnpm typecheck
```

## Architecture Decisions

All key decisions are recorded as ADRs in [`docs/adr/`](./docs/adr/):

| ADR                                                                     | Decision                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| [0001](./docs/adr/0001-monorepo-with-pnpm-workspaces.md)                | Monorepo with pnpm workspaces                                |
| [0002](./docs/adr/0002-pure-core-package-zero-dependencies.md)          | Pure core package, zero dependencies                         |
| [0003](./docs/adr/0003-capability-based-policy-engine.md)               | Capability-based policy engine                               |
| [0004](./docs/adr/0004-discriminated-union-event-model.md)              | Discriminated union event model                              |
| [0005](./docs/adr/0005-hmac-chained-audit-log.md)                       | HMAC-chained audit log                                       |
| [0006](./docs/adr/0006-three-backend-sqlite-strategy.md)                | Three-backend SQLite strategy                                |
| [0007](./docs/adr/0007-platform-adapter-tier-system.md)                 | Platform adapter tier system                                 |
| [0008](./docs/adr/0008-sandbox-isolation-levels.md)                     | Sandbox isolation levels                                     |
| [0009](./docs/adr/0009-zero-telemetry-local-first.md)                   | Zero telemetry, local-first                                  |
| [0010](./docs/adr/0010-biome-for-linting-and-formatting.md)             | Biome for linting and formatting (superseded)                |
| [0017](./docs/adr/0017-oxlint-and-dprint-toolchain.md)                  | Oxlint + dprint toolchain and parallel Linux CI              |
| [0011](./docs/adr/0011-versioned-schema-migrations.md)                  | Versioned schema migrations                                  |
| [0012](./docs/adr/0012-dual-fts5-search-with-rrf.md)                    | Dual FTS5 search with RRF                                    |
| [0013](./docs/adr/0013-branded-types-for-domain-identifiers.md)         | Branded types for domain identifiers                         |
| [0014](./docs/adr/0014-explicit-failure-modes-no-silent-degradation.md) | Explicit failure modes                                       |
| [0015](./docs/adr/0015-no-postinstall-no-preload-no-monkey-patching.md) | No postinstall, no preload, no monkey-patching               |
| [0016](./docs/adr/0016-mvp-adapter-scope.md)                            | MVP adapter scope: Claude Code, Codex CLI, OpenCode, AmpCode |

## Milestones

See [MILESTONES.md](./MILESTONES.md) for the phased implementation plan.

## Ground Rules

These are non-negotiable. See [PLAN.md Section 5](./PLAN.md#5-ground-up-rules) for details.

1. **Secure by design** — policy engine evaluates every tool invocation
2. **Least privilege** — sandbox starts with nothing, user grants access
3. **Local-first** — all data on user's machine, no cloud dependency
4. **Privacy-first** — zero telemetry, zero network calls by default
5. **Deterministic** — same policy + same input = same decision
6. **Auditable** — every security decision recorded with HMAC chain
7. **Composable** — typed contracts between isolated layers
8. **Explicit failures** — no silent swallowing in security-critical paths

## License

Apache-2.0
