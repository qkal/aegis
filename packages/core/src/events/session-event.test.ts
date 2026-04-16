/**
 * Tests for the session event discriminated union.
 *
 * These exercise the exhaustive-match helper and the priority map.
 */
import { describe, expect, it } from "vitest";
import { EventPriority } from "./priority.js";
import { assertNeverEvent, type SessionEvent } from "./session-event.js";

describe("EventPriority", () => {
	it("is strictly ordered from CRITICAL (0) to LOW (3)", () => {
		expect(EventPriority.CRITICAL).toBe(0);
		expect(EventPriority.HIGH).toBe(1);
		expect(EventPriority.NORMAL).toBe(2);
		expect(EventPriority.LOW).toBe(3);
	});
});

describe("assertNeverEvent", () => {
	it("throws when called with an unhandled event shape", () => {
		// Simulate the default branch of an exhaustive switch by casting.
		const unknownEvent = { kind: "future-event" } as unknown as never;
		expect(() => assertNeverEvent(unknownEvent)).toThrow(/Unhandled session event kind/);
	});

	it("enables exhaustive switching over the SessionEvent union", () => {
		const classify = (e: SessionEvent): string => {
			switch (e.kind) {
				case "file":
					return "file";
				case "git":
					return "git";
				case "task":
					return "task";
				case "error":
					return "error";
				case "decision":
					return "decision";
				case "rule":
					return "rule";
				case "environment":
					return "environment";
				case "execution":
					return "execution";
				case "search":
					return "search";
				case "prompt":
					return "prompt";
				default:
					return assertNeverEvent(e);
			}
		};

		const sample: SessionEvent = {
			kind: "file",
			action: "read",
			path: "/tmp/foo",
			timestamp: new Date().toISOString(),
			priority: EventPriority.CRITICAL,
		};
		expect(classify(sample)).toBe("file");
	});
});
