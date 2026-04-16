/**
 * Tests for branded identifier constructors.
 *
 * At runtime the safe constructors validate their input and throw
 * `InvalidIdError` on malformed values. The `*Unsafe` counterparts are
 * identity casts for trusted callers.
 */
import { describe, expect, it } from "vitest";
import {
	auditEntryId,
	auditEntryIdUnsafe,
	contentSourceId,
	contentSourceIdUnsafe,
	eventId,
	eventIdUnsafe,
	InvalidIdError,
	policyId,
	policyIdUnsafe,
	sessionId,
	sessionIdUnsafe,
} from "./brand.js";

describe("brand constructors — safe variants", () => {
	it("return the input unchanged at runtime on valid input", () => {
		expect(sessionId("sess-1")).toBe("sess-1");
		expect(eventId("evt-1")).toBe("evt-1");
		expect(policyId("pol-1")).toBe("pol-1");
		expect(auditEntryId("aud-1")).toBe("aud-1");
		expect(contentSourceId(42)).toBe(42);
	});

	it("reject empty strings", () => {
		expect(() => sessionId("")).toThrow(InvalidIdError);
	});

	it("reject strings containing whitespace", () => {
		expect(() => eventId("hello world")).toThrow(InvalidIdError);
		expect(() => policyId("\n")).toThrow(InvalidIdError);
	});

	it("reject strings containing NUL bytes", () => {
		expect(() => auditEntryId("aud\0null")).toThrow(InvalidIdError);
	});

	it("reject strings longer than 128 characters", () => {
		expect(() => sessionId("a".repeat(129))).toThrow(InvalidIdError);
	});

	it("reject non-integer or negative content source IDs", () => {
		expect(() => contentSourceId(-1)).toThrow(InvalidIdError);
		expect(() => contentSourceId(1.5)).toThrow(InvalidIdError);
		expect(() => contentSourceId("1" as never)).toThrow(InvalidIdError);
	});
});

describe("brand constructors — unsafe variants", () => {
	it("skip validation and act as identity casts", () => {
		// The Unsafe variants are for trusted callers where the value was
		// previously validated (e.g. re-read from local SQLite). They must
		// NOT throw even on values the safe variants would reject.
		expect(sessionIdUnsafe("")).toBe("");
		expect(eventIdUnsafe("has whitespace")).toBe("has whitespace");
		expect(policyIdUnsafe("\0")).toBe("\0");
		expect(auditEntryIdUnsafe("a".repeat(200))).toBe("a".repeat(200));
		expect(contentSourceIdUnsafe(-1)).toBe(-1);
	});
});
