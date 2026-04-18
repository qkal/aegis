# Plan 17 — Reproducible context-savings benchmark

**Priority:** P0-9.
**Size:** Small.
**Dependencies:** Plans 01, 07 (benchmark runs on all three OSes).

## Why

`PLAN.md` and the README tout "56 KB Playwright snapshot → <500 B".
This must be reproducible and regression-tested. A user or skeptic
must be able to check the claim in two commands.

## Design

### Inputs

`benchmarks/context-savings/inputs/` — ships a set of representative
large tool outputs:

- `playwright-snapshot.xml` (56 KB)
- `jq-full-package-json.json` (typical large JSON payload)
- `grep-noisy-find.txt` (wide directory tree)
- `node-types-d-ts.txt` (single large module types file)

Each input simulates an output that a naive tool call would return
directly to the LLM.

### Benchmark

`benchmarks/context-savings/run.mjs`:

1. For each input:
   a. `rawSize = Buffer.byteLength(input, 'utf8')`.
   b. Feed it through `aegisctx_execute` with a canned script that
   produces the same content, or directly through the output
   processor for a pure unit measurement.
   c. Measure the bytes actually returned to the MCP client
   (`returnedSize`).
2. Print a table: input, rawSize, returnedSize, savings %.
3. Write `benchmarks/context-savings/latest.json` with the machine-
   readable output.
4. Non-zero exit if any input violates its budget.

### Budgets (committed in `benchmarks/context-savings/budgets.json`)

| Input                     | Max returned bytes |
| ------------------------- | ------------------ |
| playwright-snapshot.xml   | 500                |
| jq-full-package-json.json | 2048               |
| grep-noisy-find.txt       | 1024               |
| node-types-d-ts.txt       | 4096               |

### CI wiring

- New **non-blocking / report-only** CI job
  `benchmark-context-savings`:
  - Runs the benchmark.
  - Compares `latest.json` against the last committed baseline
    (`benchmarks/context-savings/baseline.json`).
  - On any regression >20%: **reports a failure annotation and posts
    a summary comment on the PR with the table, but does not block
    merge.** The job exits non-zero so the annotation is visible, but
    branch protection for `main` does _not_ require this job.
  - On any regression ≤20%: posts the summary comment silently.
- Landing a PR that updates `baseline.json` requires a maintainer
  label.
- Rationale: context savings are a real product claim but the
  benchmark is sensitive to platform variance (CPU load, disk
  caching). Keeping it advisory avoids merge-blocking noise while
  still surfacing regressions on every PR. If the numbers become
  stable enough post-MVP to promote the job to a required gate, flip
  the branch-protection requirement and drop this rationale.

## Deliverables

1. **Inputs** — the four listed above, anonymized and committed.
2. **`benchmarks/context-savings/run.mjs`** — the benchmark.
3. **`benchmarks/context-savings/budgets.json`** — the budgets.
4. **`benchmarks/context-savings/baseline.json`** — the reference
   numbers.
5. **CI job** — report-only (advisory); surfaces regressions via
   annotations and PR comments but is not a required gate.
6. **Docs** — a section in `README.md` under "Context savings" with a
   link to how to reproduce.

## Acceptance criteria

- Fresh clone + `pnpm install` + `pnpm benchmark:context-savings`
  prints the table and exits 0.
- Deliberately regressing the output processor (e.g., removing the
  snapshot truncation) fails the benchmark in CI.
- The README's claim ("56 KB → <500 B") matches the committed
  baseline for `playwright-snapshot.xml`.

## Test strategy

- A small unit test in `benchmarks/context-savings/run.test.mjs`
  asserts the baseline numbers are below the budgets (so the budgets
  file itself stays honest).

## Out of scope

- End-to-end LLM-in-the-loop benchmarks (too noisy for CI, worth
  revisiting in Phase 4).
- Benchmarking policy eval or FTS5 query latency (separate SLOs from
  plan 05 / `PLAN.md §13`; they land in Phase 4's `M4.4`).

## Risks

- **Input drift.** Playwright's snapshot format may change. Mitigation:
  the committed input is a frozen fixture, not a live capture; we
  update it intentionally via a dedicated PR with a new baseline.
- **Platform size variance.** Line endings, encoding. Mitigation:
  normalize to LF + UTF-8 in the benchmark; assert byte counts after
  normalization.
