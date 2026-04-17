/**
 * Tests for the priority-tiered snapshot builder.
 */
import { describe, expect, it } from "vitest";

import { EventPriority } from "../events/priority.js";
import type {
	FileEvent,
	GitEvent,
	PromptEvent,
	SessionEvent,
	TaskEvent,
} from "../events/session-event.js";
import {
	buildSnapshot,
	DEFAULT_SNAPSHOT_BUDGET_BYTES,
	groupByPriority,
	isWithinBudget,
	MIN_SNAPSHOT_BUDGET_BYTES,
	renderLine,
} from "./builder.js";

const criticalFile = (ts: string, path: string): FileEvent => ({
	kind: "file",
	action: "write",
	path,
	timestamp: ts,
	priority: EventPriority.CRITICAL,
});

const highGit = (ts: string, action: GitEvent["action"], message?: string): GitEvent => ({
	kind: "git",
	action,
	message,
	timestamp: ts,
	priority: EventPriority.HIGH,
});

const criticalTask = (ts: string, description: string): TaskEvent => ({
	kind: "task",
	action: "create",
	description,
	timestamp: ts,
	priority: EventPriority.CRITICAL,
});

const criticalPrompt = (ts: string, content: string): PromptEvent => ({
	kind: "prompt",
	content,
	timestamp: ts,
	priority: EventPriority.CRITICAL,
});

const fixedNow = (): Date => new Date("2025-01-01T00:00:00.000Z");

describe("buildSnapshot", () => {
	it("renders an empty snapshot when given no events", () => {
		const built = buildSnapshot([], { now: fixedNow });
		expect(built.includedEvents).toEqual([]);
		expect(built.droppedEvents).toEqual([]);
		expect(built.byteLength).toBe(built.text.length);
		expect(built.text).toMatch(/\[aegis:session\] snapshot generated /);
	});

	it("orders events by priority ascending, then timestamp descending", () => {
		const events: SessionEvent[] = [
			highGit("2025-01-01T00:00:02.000Z", "commit", "wip"),
			criticalFile("2025-01-01T00:00:01.000Z", "src/a.ts"),
			criticalTask("2025-01-01T00:00:03.000Z", "Ship M1.4"),
		];
		const built = buildSnapshot(events, { now: fixedNow });
		// CRITICAL tier first, newer (Ship M1.4 @ :03) before older (src/a.ts @ :01), then HIGH tier.
		expect(built.includedEvents.map((e) => e.kind)).toEqual(["task", "file", "git"]);
		expect(built.text).toContain("task/create Ship M1.4");
		expect(built.text).toContain("file/write src/a.ts");
		expect(built.text).toContain("git/commit wip");
	});

	it("includes every event when the budget is generous", () => {
		const events: SessionEvent[] = [
			criticalFile("2025-01-01T00:00:01.000Z", "src/a.ts"),
			criticalFile("2025-01-01T00:00:02.000Z", "src/b.ts"),
			highGit("2025-01-01T00:00:03.000Z", "commit", "ok"),
		];
		const built = buildSnapshot(events, { budgetBytes: 2048, now: fixedNow });
		expect(built.includedEvents).toHaveLength(3);
		expect(built.droppedEvents).toHaveLength(0);
		expect(isWithinBudget(built)).toBe(true);
	});

	it("drops events whose rendered line would exceed the budget", () => {
		// Build 200 critical events; each line is ~20-25 bytes plus "\n".
		// With a tiny budget only a handful survive.
		const events: SessionEvent[] = [];
		for (let i = 0; i < 200; i += 1) {
			events.push(
				criticalFile(`2025-01-01T00:00:${String(i).padStart(2, "0")}.000Z`, `src/f${i}.ts`),
			);
		}
		const built = buildSnapshot(events, { budgetBytes: 256, now: fixedNow });
		expect(built.includedEvents.length).toBeGreaterThan(0);
		expect(built.includedEvents.length).toBeLessThan(events.length);
		expect(built.droppedEvents.length).toBe(events.length - built.includedEvents.length);
		expect(isWithinBudget(built)).toBe(true);
	});

	it("clamps the budget below MIN_SNAPSHOT_BUDGET_BYTES", () => {
		const built = buildSnapshot([], { budgetBytes: 32, now: fixedNow });
		expect(built.budgetBytes).toBe(MIN_SNAPSHOT_BUDGET_BYTES);
	});

	it("uses the default budget when options are omitted", () => {
		const built = buildSnapshot([], { now: fixedNow });
		expect(built.budgetBytes).toBe(DEFAULT_SNAPSHOT_BUDGET_BYTES);
	});

	it("preserves CRITICAL events preferentially under tight budgets", () => {
		const events: SessionEvent[] = [
			// 50 HIGH events (should be dropped first)
			...Array.from(
				{ length: 50 },
				(_, i) => highGit(`2025-01-01T00:10:${String(i).padStart(2, "0")}.000Z`, "diff"),
			),
			// 5 CRITICAL events (should survive)
			...Array.from(
				{ length: 5 },
				(_, i) =>
					criticalFile(`2025-01-01T00:00:${String(i).padStart(2, "0")}.000Z`, `crit${i}.ts`),
			),
		];
		const built = buildSnapshot(events, { budgetBytes: 256, now: fixedNow });
		const criticals = built.includedEvents.filter((e) => e.priority === EventPriority.CRITICAL);
		expect(criticals.length).toBe(5);
	});

	it("handles multi-byte UTF-8 paths without overflowing the budget", () => {
		const longUnicode = "src/测试/🚀/".repeat(20) + "file.ts";
		const events: SessionEvent[] = [
			criticalFile("2025-01-01T00:00:01.000Z", longUnicode),
			criticalFile("2025-01-01T00:00:02.000Z", longUnicode),
		];
		const built = buildSnapshot(events, { budgetBytes: 256, now: fixedNow });
		expect(built.byteLength).toBeLessThanOrEqual(built.budgetBytes);
		expect(isWithinBudget(built)).toBe(true);
	});

	it("replaces newlines and whitespace runs in event content", () => {
		const prompt: PromptEvent = criticalPrompt(
			"2025-01-01T00:00:01.000Z",
			"hello\n\nworld\t\ttabbed",
		);
		const built = buildSnapshot([prompt], { now: fixedNow });
		expect(built.text).toContain("prompt: hello world tabbed");
		expect(built.text).not.toMatch(/prompt:[^\n]*\n[^\n]*world/);
	});
});

describe("renderLine", () => {
	it("renders each kind with its discriminant prefix", () => {
		expect(renderLine(criticalFile("t", "x.ts"))).toBe("file/write x.ts");
		expect(renderLine(highGit("t", "commit", "subject"))).toBe("git/commit subject");
		expect(renderLine(highGit("t", "status"))).toBe("git/status");
		expect(renderLine(criticalTask("t", "do stuff"))).toBe("task/create do stuff");
		expect(
			renderLine({
				kind: "error",
				tool: "Bash",
				message: "bad",
				exitCode: 2,
				timestamp: "t",
				priority: EventPriority.HIGH,
			}),
		).toBe("error Bash (exit=2): bad");
	});

	it("truncates over-long content with a horizontal ellipsis", () => {
		const big = "x".repeat(5000);
		const line = renderLine(criticalPrompt("t", big));
		expect(line.endsWith("…")).toBe(true);
		expect(line.length).toBeLessThan(big.length);
	});

	it("collapses newlines in multi-line git commit messages to a single line", () => {
		// Real git commit messages are `subject\n\nbody\n\ntrailer`-shaped;
		// leaking a newline into the rendered snapshot would split one event
		// across multiple lines and break downstream parsers that rely on
		// the one-event-per-line contract.
		const line = renderLine(
			highGit(
				"t",
				"commit",
				"feat: subject line\n\nbody paragraph 1\n\nbody paragraph 2\n\nSigned-off-by: me",
			),
		);
		expect(line).not.toContain("\n");
		expect(line).toBe(
			"git/commit feat: subject line body paragraph 1 body paragraph 2 Signed-off-by: me",
		);
	});

	it("collapses newlines in task descriptions from TodoWrite payloads", () => {
		// Adapter-level TodoWrite hands us the user's raw description verbatim
		// (see packages/adapters/src/claude-code/events.ts), which may contain
		// explicit newlines when the user pastes a multi-line checklist.
		const line = renderLine(
			criticalTask("t", "step one\nstep two\nstep three"),
		);
		expect(line).not.toContain("\n");
		expect(line).toBe("task/create step one step two step three");
	});
});

describe("groupByPriority", () => {
	it("buckets events into CRITICAL/HIGH/NORMAL/LOW with empty arrays for missing tiers", () => {
		const events: SessionEvent[] = [
			criticalFile("t", "a.ts"),
			highGit("t", "diff"),
		];
		const grouped = groupByPriority(events);
		expect(grouped[EventPriority.CRITICAL]).toHaveLength(1);
		expect(grouped[EventPriority.HIGH]).toHaveLength(1);
		expect(grouped[EventPriority.NORMAL]).toEqual([]);
		expect(grouped[EventPriority.LOW]).toEqual([]);
	});
});
