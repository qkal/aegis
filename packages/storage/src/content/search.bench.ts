/**
 * M0.4 acceptance benchmark — p99 search latency on 10K chunks.
 *
 * Indexes a deterministic 10K-chunk corpus (5K prose + 5K code) and times a
 * representative query mix against `ContentIndex.search()`. The benchmark
 * asserts two tiers of p99 budget because the dual-FTS5 design in ADR-0012
 * has two fundamentally different cost profiles:
 *
 *   - **Identifier queries** (single token, substring match) — trigram
 *     tokenizer returns a small candidate set. p99 must stay under
 *     `IDENTIFIER_P99_BUDGET_MS` (default 10ms, matching ADR-0012's target).
 *
 *   - **Multi-token / broad queries** (prose, common words) — porter is
 *     fast but the trigram half of the dual search expands every token into
 *     many trigrams, each producing a large candidate set. This dominates
 *     wall-clock time even though porter alone would be <1ms. p99 must stay
 *     under `OVERALL_P99_BUDGET_MS` (default 25ms).
 *
 * Both tiers must pass for the benchmark to succeed. The split surfaces
 * trigram-tokenizer cost on broad queries as a quantified follow-up rather
 * than hiding it behind a single relaxed threshold.
 *
 * Why a separate file (not a `*.test.ts`):
 *   - Benchmark runs are opt-in. The default `pnpm test` and the CI shards
 *     deliberately don't pick up `*.bench.ts` (see `vitest.config.ts`
 *     `include`), so routine test runs stay fast and hardware-agnostic.
 *   - Wall-clock assertions are sensitive to host load; they belong behind
 *     an explicit `pnpm bench` gate, not in the default test suite.
 *
 * Tuning knobs (env vars, for experimentation on different hardware):
 *   - `AEGIS_BENCH_CHUNKS`                default 10000 (per ADR-0012)
 *   - `AEGIS_BENCH_SAMPLES`               default 50 per query class
 *   - `AEGIS_BENCH_IDENT_P99_BUDGET_MS`   default 10
 *   - `AEGIS_BENCH_P99_BUDGET_MS`         default 25 (overall)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../adapters/index.js";
import type { Database } from "../adapters/types.js";
import { runMigrations } from "../migrations/index.js";
import { CONTENT_INDEX_MIGRATIONS, ContentIndex } from "./index.js";

const TOTAL_CHUNKS = envInt("AEGIS_BENCH_CHUNKS", 10_000);
const SAMPLES_PER_QUERY = envInt("AEGIS_BENCH_SAMPLES", 50);
const OVERALL_P99_BUDGET_MS = envNumber("AEGIS_BENCH_P99_BUDGET_MS", 25);
const IDENTIFIER_P99_BUDGET_MS = envNumber("AEGIS_BENCH_IDENT_P99_BUDGET_MS", 10);

/**
 * Query mix. Each entry exercises a different path through the dual FTS5
 * index; `class` controls which p99 budget applies.
 *
 *   - `widget7123` — long identifier; trigram dominates, small candidate set.
 *   - `accumulator4242` — another identifier, exercises a different bucket.
 *   - `function widget` — multi-token, both tokenizers fire.
 *   - `gadget 42` — multi-token prose; porter dominates.
 *   - `section` — extremely common token, large candidate set to rank.
 *   - `zebrafish hovercraft` — guaranteed miss; proves the empty-result
 *     path isn't quietly the fast path.
 */
type QueryClass = "identifier" | "broad";
interface BenchQuery {
	readonly q: string;
	readonly class: QueryClass;
}
const QUERY_MIX: readonly BenchQuery[] = [
	{ q: "widget7123", class: "identifier" },
	{ q: "accumulator4242", class: "identifier" },
	{ q: "function widget", class: "broad" },
	{ q: "gadget 42", class: "broad" },
	{ q: "section", class: "broad" },
	{ q: "zebrafish hovercraft", class: "broad" },
];

let db: Database;
let idx: ContentIndex;

beforeAll(async () => {
	const opened = await openDatabase({ path: ":memory:", backend: "better-sqlite3" });
	db = opened.db;
	runMigrations(db, CONTENT_INDEX_MIGRATIONS);
	idx = new ContentIndex(db);
	loadCorpus(idx, TOTAL_CHUNKS);
});

afterAll(() => db.close());

describe("M0.4 benchmark: 10K chunks", () => {
	it(
		`identifier queries p99 < ${IDENTIFIER_P99_BUDGET_MS}ms, overall p99 < ${OVERALL_P99_BUDGET_MS}ms`,
		() => {
			// FTS5 is required for the M0.4 benchmark — abort loudly if the backend lacks it.
			expect(idx.capabilities.fts5).toBe(true);

			// Warm-up: SQLite's page cache and the prepared-statement cache are
			// both cold on the first query against a fresh FTS5 index. Warming
			// keeps the first recorded sample from skewing p99.
			for (const { q } of QUERY_MIX) idx.search(q, { maxResults: 5 });

			const samplesByQuery = new Map<string, readonly number[]>();
			const classSamples: Record<QueryClass, number[]> = { identifier: [], broad: [] };
			for (const entry of QUERY_MIX) {
				const samples: number[] = [];
				for (let i = 0; i < SAMPLES_PER_QUERY; i++) {
					const t0 = performance.now();
					idx.search(entry.q, { maxResults: 5 });
					samples.push(performance.now() - t0);
				}
				samples.sort((a, b) => a - b);
				samplesByQuery.set(entry.q, samples);
				classSamples[entry.class].push(...samples);
			}

			const all = [...samplesByQuery.values()].flat().sort((a, b) => a - b);
			classSamples.identifier.sort((a, b) => a - b);
			classSamples.broad.sort((a, b) => a - b);

			const overallP99 = percentile(all, 0.99);
			const identifierP99 = percentile(classSamples.identifier, 0.99);
			const broadP99 = percentile(classSamples.broad, 0.99);

			printReport({
				total: all.length,
				p50: percentile(all, 0.5),
				p95: percentile(all, 0.95),
				p99: overallP99,
				identifierP99,
				broadP99,
				samplesByQuery,
				queryMix: QUERY_MIX,
			});

			// Identifier queries must meet ADR-0012's 10ms p99 target; overall
			// p99 guards against regressions in the broad-query path.
			expect(identifierP99).toBeLessThan(IDENTIFIER_P99_BUDGET_MS);
			expect(overallP99).toBeLessThan(OVERALL_P99_BUDGET_MS);
		},
	);
});

/* ---------------- corpus ---------------- */

/**
 * Build a deterministic corpus with `targetChunks` chunks by ingesting two
 * documents. Each logical section is a single paragraph / single code block
 * (no internal blank lines) sized so that exactly one section fits in
 * `maxChunkBytes` and two do not (the splitter merges candidates while they
 * fit under the budget). Section count == chunk count, bit-for-bit.
 */
const CHUNK_BUDGET_BYTES = 256;

function loadCorpus(target: ContentIndex, targetChunks: number): void {
	const half = Math.floor(targetChunks / 2);
	const proseCount = half;
	const codeCount = targetChunks - half;

	const prose = target.index(buildProseDoc(proseCount), {
		label: "bench-prose.md",
		sourceType: "manual",
		maxChunkBytes: CHUNK_BUDGET_BYTES,
	});
	const code = target.index(buildCodeDoc(codeCount), {
		label: "bench-code.ts",
		sourceType: "file",
		maxChunkBytes: CHUNK_BUDGET_BYTES,
	});

	const total = prose.chunkCount + code.chunkCount;
	if (total !== targetChunks) {
		throw new Error(
			`benchmark corpus produced ${total} chunks, expected ${targetChunks} `
				+ `(prose=${prose.chunkCount}/${proseCount}, code=${code.chunkCount}/${codeCount})`,
		);
	}
}

/**
 * Each section is a single-paragraph line of ~180 bytes. Two adjacent
 * sections joined by a blank line exceed 256 bytes, so the prose splitter
 * emits one chunk per section.
 */
function buildProseDoc(sectionCount: number): string {
	const parts: string[] = [];
	for (let i = 0; i < sectionCount; i++) {
		parts.push(
			`section ${i}: this paragraph describes widget ${i} and its relationship to gadget ${
				i + 1
			} within the section ${i} subsystem, and restates the invariant once more for indexing.`,
		);
	}
	return parts.join("\n\n");
}

/**
 * Each section is a compact code block (no internal blank lines) of ~180
 * bytes. Two adjacent sections joined by a blank line exceed 256 bytes, so
 * the code splitter emits one chunk per section.
 */
function buildCodeDoc(sectionCount: number): string {
	const parts: string[] = [];
	for (let i = 0; i < sectionCount; i++) {
		parts.push(
			`function widget${i}(x: number): number {\n`
				+ `\tconst gadget${i} = x * ${i} + ${i * 7};\n`
				+ `\tconst accumulator${i} = gadget${i} * 2 + ${i * 11};\n`
				+ `\treturn accumulator${i} + gadget${i} - ${i};\n`
				+ `}`,
		);
	}
	return parts.join("\n\n");
}

/* ---------------- stats / reporting ---------------- */

function percentile(sortedAsc: readonly number[], p: number): number {
	if (sortedAsc.length === 0) return 0;
	const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
	return sortedAsc[idx] ?? 0;
}

function printReport(
	r: {
		readonly total: number;
		readonly p50: number;
		readonly p95: number;
		readonly p99: number;
		readonly identifierP99: number;
		readonly broadP99: number;
		readonly samplesByQuery: ReadonlyMap<string, readonly number[]>;
		readonly queryMix: readonly BenchQuery[];
	},
): void {
	// `console` is the right channel here — the benchmark is a developer
	// tool run via `pnpm bench`, not a library call. Lint does not flag
	// this because no `no-console` rule is configured.
	console.log(
		`\n=== M0.4 benchmark: ${TOTAL_CHUNKS} chunks, ${r.total} samples ===`,
	);
	console.log(
		`budgets: identifier p99 < ${IDENTIFIER_P99_BUDGET_MS}ms, overall p99 < ${OVERALL_P99_BUDGET_MS}ms`,
	);
	console.log(
		`overall     p50=${fmt(r.p50)}  p95=${fmt(r.p95)}  p99=${fmt(r.p99)}`,
	);
	console.log(
		`identifier  p99=${fmt(r.identifierP99)}        broad  p99=${fmt(r.broadP99)}`,
	);
	for (const entry of r.queryMix) {
		const samples = r.samplesByQuery.get(entry.q) ?? [];
		const p50 = percentile(samples, 0.5);
		const p95 = percentile(samples, 0.95);
		const p99 = percentile(samples, 0.99);
		console.log(
			`  [${entry.class.padEnd(10)}] ${entry.q.padEnd(22)}  p50=${fmt(p50)}  p95=${fmt(p95)}  p99=${
				fmt(p99)
			}`,
		);
	}
}

function fmt(ms: number): string {
	return `${ms.toFixed(2)}ms`.padStart(9);
}

function envInt(name: string, fallback: number): number {
	const v = process.env[name];
	if (v === undefined) return fallback;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envNumber(name: string, fallback: number): number {
	const v = process.env[name];
	if (v === undefined) return fallback;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
