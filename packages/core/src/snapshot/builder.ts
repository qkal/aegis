/**
 * Priority-tiered snapshot builder.
 *
 * Turns a chronological list of `SessionEvent`s into a compact, rendered
 * text block that fits inside a platform's `additionalContext` budget
 * (default 2 KiB, per ADR-0009). The rendering rules, in order:
 *
 *   1. Group events by priority tier (CRITICAL → HIGH → NORMAL → LOW).
 *   2. Within a tier, keep events in chronological order — most recent
 *      first, so the most useful context lands at the top.
 *   3. Render each event into a single short line (`renderLine`).
 *   4. Walk the rendered lines, accumulating bytes until we cross the
 *      budget. The line that would overflow is skipped, not truncated,
 *      so downstream consumers never see a partial event description.
 *   5. Return the included events + the final text (header + lines).
 *
 * The builder is pure (no I/O, no wall-clock dependency beyond inputs)
 * so it can be unit-tested deterministically and reused by both the
 * PreCompact path (live events) and the SessionStart restore path
 * (events rehydrated from the store).
 */
import { EventPriority } from "../events/priority.js";
import { assertNeverEvent, type SessionEvent } from "../events/session-event.js";

export const DEFAULT_SNAPSHOT_BUDGET_BYTES = 2048 as const;

/** The minimum budget we accept. Below this the snapshot is effectively empty. */
export const MIN_SNAPSHOT_BUDGET_BYTES = 128 as const;

export interface BuildSnapshotOptions {
	/** Maximum byte size of the rendered text (UTF-8). Default: 2 KiB. */
	readonly budgetBytes?: number;
	/** Prefix rendered at the top of the snapshot. Keep it short — counts toward the budget. */
	readonly header?: string;
	/** Override the current time (for deterministic tests). */
	readonly now?: () => Date;
}

export interface BuiltSnapshot {
	/** The events whose rendered lines fit inside the budget, in render order. */
	readonly includedEvents: readonly SessionEvent[];
	/** The events that were skipped because their line would overflow the budget. */
	readonly droppedEvents: readonly SessionEvent[];
	/** The fully rendered snapshot text (header + event lines, newline-joined). */
	readonly text: string;
	/** Byte size of the rendered text, for telemetry / assertion. */
	readonly byteLength: number;
	/** The budget used during construction (the effective value after clamping). */
	readonly budgetBytes: number;
}

/**
 * Build a snapshot from `events`. Input order does not matter — the
 * builder re-sorts by (priority ascending, timestamp descending) so the
 * highest-signal / most-recent context wins the budget.
 */
export function buildSnapshot(
	events: readonly SessionEvent[],
	options: BuildSnapshotOptions = {},
): BuiltSnapshot {
	const budgetBytes = Math.max(
		MIN_SNAPSHOT_BUDGET_BYTES,
		options.budgetBytes ?? DEFAULT_SNAPSHOT_BUDGET_BYTES,
	);
	const header = options.header ?? defaultHeader(options.now?.() ?? new Date());

	const sorted = [...events].sort(compareEvents);
	const included: SessionEvent[] = [];
	const dropped: SessionEvent[] = [];
	const renderedLines: string[] = [];

	let currentBytes = utf8ByteLength(header);

	for (const event of sorted) {
		const line = renderLine(event);
		// +1 accounts for the "\n" separator that will join this line to
		// the previous content. The header always precedes the first line,
		// so every included line incurs exactly one separator byte.
		const lineBytes = utf8ByteLength(line) + 1;
		if (currentBytes + lineBytes > budgetBytes) {
			dropped.push(event);
			continue;
		}
		included.push(event);
		renderedLines.push(line);
		currentBytes += lineBytes;
	}

	const text = renderedLines.length === 0
		? header
		: `${header}\n${renderedLines.join("\n")}`;

	return {
		includedEvents: included,
		droppedEvents: dropped,
		text,
		byteLength: utf8ByteLength(text),
		budgetBytes,
	};
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a single event into a one-line snapshot entry.
 *
 * Exposed (not purely internal) because Phase 2 will want to reuse it
 * when surfacing individual events in the CLI — keeping a single
 * renderer means CLI output and snapshot text never diverge.
 */
export function renderLine(event: SessionEvent): string {
	switch (event.kind) {
		case "file":
			return `file/${event.action} ${event.path}`;
		case "git":
			// `event.message` is the raw git commit message, which conventionally
			// spans `subject\n\nbody\n\n<trailers>`. Collapsing whitespace keeps
			// one event on one line so downstream parsers can rely on the
			// one-event-per-line invariant documented at the top of the file.
			return event.message !== undefined
				? `git/${event.action} ${singleLine(event.message, 200)}`
				: event.ref !== undefined
				? `git/${event.action} ${event.ref}`
				: `git/${event.action}`;
		case "task":
			// `event.description` comes straight from adapter-level `TodoWrite`
			// payloads (e.g. Claude Code), which are free-form user strings and
			// may contain embedded newlines.
			return `task/${event.action} ${singleLine(event.description, 200)}`;
		case "error":
			return event.exitCode !== undefined
				? `error ${event.tool} (exit=${event.exitCode}): ${singleLine(event.message, 200)}`
				: `error ${event.tool}: ${singleLine(event.message, 200)}`;
		case "decision":
			return `decision: ${singleLine(event.original, 80)} -> ${singleLine(event.correction, 80)}`;
		case "rule":
			return `rule ${event.path}: ${singleLine(event.content, 160)}`;
		case "environment":
			return `env/${event.action} ${event.variable} (redacted, len=${event.length ?? "?"})`;
		case "execution":
			return `exec ${event.language} (exit=${event.exitCode}, bytes=${event.outputSize})`;
		case "search":
			return `search [${event.queries.join(", ")}] -> ${event.resultCount}`;
		case "prompt":
			return `prompt: ${singleLine(event.content, 240)}`;
		default:
			return assertNeverEvent(event);
	}
}

function compareEvents(a: SessionEvent, b: SessionEvent): number {
	// Lower priority number wins (CRITICAL=0). Tie-break by timestamp
	// descending so the most recent event in the tier comes first.
	if (a.priority !== b.priority) return a.priority - b.priority;
	return b.timestamp.localeCompare(a.timestamp);
}

function singleLine(raw: string, maxLen: number): string {
	const collapsed = raw.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLen) return collapsed;
	return `${collapsed.slice(0, maxLen - 1)}…`;
}

function defaultHeader(now: Date): string {
	return `[aegis:session] snapshot generated ${now.toISOString()}`;
}

/**
 * Byte length of a string when encoded as UTF-8.
 *
 * Implemented without touching `TextEncoder` so `@aegis/core` does not
 * depend on `DOM` lib types or Node's `Buffer`. Walks the UTF-16 code
 * units, combines surrogate pairs, and counts the bytes each code
 * point contributes per the UTF-8 encoding rules.
 */
function utf8ByteLength(s: string): number {
	let bytes = 0;
	for (let i = 0; i < s.length; i += 1) {
		const codeUnit = s.charCodeAt(i);
		if (codeUnit < 0x80) {
			bytes += 1;
		} else if (codeUnit < 0x800) {
			bytes += 2;
		} else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			// High surrogate — paired with the following low surrogate
			// forms a single code point above U+FFFF, encoded in 4 bytes.
			const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				i += 1;
			} else {
				// Lone high surrogate — treat as replacement char (3 bytes).
				bytes += 3;
			}
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

/** Hard cap exported for tests and callers that want to validate the invariant. */
export function isWithinBudget(snapshot: BuiltSnapshot): boolean {
	return snapshot.byteLength <= snapshot.budgetBytes;
}

/** Group events by priority tier for telemetry / debugging output. */
export function groupByPriority(
	events: readonly SessionEvent[],
): Readonly<Record<number, readonly SessionEvent[]>> {
	const acc: Record<number, SessionEvent[]> = {
		[EventPriority.CRITICAL]: [],
		[EventPriority.HIGH]: [],
		[EventPriority.NORMAL]: [],
		[EventPriority.LOW]: [],
	};
	for (const event of events) {
		const bucket = acc[event.priority];
		if (bucket !== undefined) bucket.push(event);
	}
	return acc;
}
