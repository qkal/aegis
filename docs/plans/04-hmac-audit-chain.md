# Plan 04 — HMAC-chained audit log (M2.1)

**Priority:** P0-2. Pulled forward into MVP so the README's "auditable"
claim is real.
**Size:** Medium.
**Dependencies:** Plan 01 (new storage paths land under `~/.aegisctx/`);
plan 03 (so this is added as M2.1 in the updated MILESTONES).

## Why

Every policy decision, every sandbox exec, every deny — must be
append-only and tamper-evident. The README and `PLAN.md` §6.8 specify an
HMAC chain; we implement it fully so `aegisctx audit verify` is a
meaningful command at v0.1.0.

## Design

### Schema (SQLite)

```sql
CREATE TABLE audit_entries (
  id            BLOB PRIMARY KEY,     -- UUIDv7 as 16 raw bytes (sortable)
  ts            TEXT NOT NULL,        -- ISO-8601 UTC with millisecond precision
  session_id    BLOB NOT NULL,        -- UUIDv7 as 16 raw bytes
  category      TEXT NOT NULL,        -- 'policy_eval' | 'sandbox_exec' | ...
  action        TEXT NOT NULL,        -- 'deny_command' | 'execute_sandbox' | ...
  subject       TEXT NOT NULL,        -- evaluated command / path / tool name
  decision      TEXT NOT NULL,        -- 'allow' | 'deny' | 'ask' | 'error'
  reason        TEXT NOT NULL,        -- human-readable
  context_json  TEXT NOT NULL,        -- structured metadata, canonical JSON
  prev_hmac     BLOB NOT NULL,        -- 32 bytes; zero for the genesis entry
  hmac          BLOB NOT NULL,        -- 32 bytes; HMAC-SHA256(key, canonical(row ‖ prev_hmac))
  schema_version INTEGER NOT NULL     -- starts at 1
);

CREATE INDEX audit_entries_session_ts ON audit_entries (session_id, ts);
CREATE INDEX audit_entries_category_ts ON audit_entries (category, ts);
```

### Key management

- File: `~/.aegisctx/audit-key` (POSIX `0o600`; Windows ACL: remove
  inheritance, grant `FullControl` only to the current user via
  `icacls /inheritance:r /grant:r "$USERNAME:F"` wrapper).
- Content: 32 bytes, hex-encoded, on a single line. Generated via
  `crypto.randomBytes(32)` on first use.
- Rotation: out of scope for MVP. Document "rotate by purging the DB
  and regenerating the key" in `docs/security.md`.

### HMAC computation

```
canonical(entry) := JSON.stringify({
  id, ts, session_id, category, action, subject, decision, reason,
  context: <canonical JSON of context>, schema_version
})

hmac(entry) := HMAC-SHA256(key, prev_hmac || SHA256(canonical(entry)))
```

Canonical JSON: keys sorted lexicographically, no whitespace, `undefined`
omitted, numbers finite, Unicode normalized (NFC). Implemented with
`safe-stable-stringify` (dev-only) or hand-rolled (preferred — `core` has
zero deps).

### Genesis entry

- Written once per DB. `category = 'audit_lifecycle'`, `action =
  'genesis'`, `subject = <db_path>`, `prev_hmac = zeros(32)`.
- `aegisctx audit verify` uses this as the chain anchor.

## Deliverables

1. **`@aegisctx/storage/audit`**
   - [ ] `audit/chain.ts`: HMAC, canonical JSON, entry builder.
   - [ ] `audit/store.ts`: DB open/migrate, insert, query, verify.
   - [ ] `audit/types.ts`: discriminated union of
     `AuditCategory`/`AuditAction` pairs.
   - [ ] `audit/key.ts`: load-or-create key file with correct perms on
     POSIX and Windows.
   - [ ] `audit/migrations/001_init.sql` via the existing migrations
     runner.
2. **`@aegisctx/core`**
   - [ ] `events/audit-event.ts`: pure (no I/O) types and builders so
     other packages can construct entries without importing storage.
3. **Server integration**
   - [ ] `packages/server/src/hooks/policy.ts` writes an audit entry on
     every deny/ask/allow decision.
   - [ ] `packages/server/src/tools/execute.ts` writes `sandbox_exec`
     entries on spawn/complete/timeout/kill.
   - [ ] Content indexing + URL fetch write `content_index` entries.
   - [ ] Session lifecycle writes `session_lifecycle` entries.
4. **CLI**
   - [ ] `aegisctx audit show` (category/action filters,
     `--session <id>`, `--since <duration>`, `--limit N`).
   - [ ] `aegisctx audit verify` — walks the chain from genesis, reports
     "chain intact through <id>" or the first break point.
   - [ ] `aegisctx audit purge --before <ISO-date>` (user-initiated
     only).
5. **`aegisctx doctor` integration**
   - [ ] New doctor check: audit key exists, correct perms, DB
     reachable, chain head verifies. Failure modes snapshot-tested
     (plan 15).

## Acceptance criteria

- Fresh run on an empty repo creates `~/.aegisctx/audit-key` with the
  right perms (verified in a platform-aware test).
- `aegisctx audit verify` on an untouched DB prints "chain intact".
- Mutate one row's `reason` column directly in the DB; `verify` must
  report the exact failing entry ID.
- Truncate the last row's `hmac`; `verify` must report the break.
- CI test on all three OSes (Ubuntu, macOS, Windows — see plan 06).

## Test strategy

- `packages/storage/src/audit/chain.test.ts`: canonical JSON golden,
  HMAC test vectors (seed a known key + fixed entries, assert output).
- `packages/storage/src/audit/store.test.ts`: `:memory:` DB,
  insert-then-verify, tamper-then-verify, concurrent insert test.
- `packages/cli/src/commands/audit.test.ts`: CLI snapshot tests.
- `packages/server/src/hooks/policy.test.ts`: assert audit write on
  deny + allow + ask paths.

## Out of scope

- Key rotation workflow.
- Cross-machine integrity (the key is machine-local; this is forensic,
  not DRM).
- Streaming audit to external SIEMs.

## Risks

- **HMAC perf on high-frequency writes.** Mitigation: batch writes with
  a small debounce (16 ms) — the chain is still correct because the
  batch is inserted in a transaction and `prev_hmac` is computed on the
  in-memory sequence. Benchmark in CI with 10k entries/sec target.
- **Key file permissions on Windows.** Mitigation: dedicated
  `audit/key-perms-windows.ts` using `child_process.spawnSync('icacls',
  …)`; integration test on Windows CI.
