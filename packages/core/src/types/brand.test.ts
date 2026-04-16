/**
 * Tests for branded identifier constructors.
 *
 * Brand constructors are type-level — at runtime they are identity
 * functions. These tests exist to document that contract.
 */
import { describe, expect, it } from "vitest";
import { auditEntryId, contentSourceId, eventId, policyId, sessionId } from "./brand.js";

describe("brand constructors", () => {
	it("return the input unchanged at runtime", () => {
		expect(sessionId("sess-1")).toBe("sess-1");
		expect(eventId("evt-1")).toBe("evt-1");
		expect(policyId("pol-1")).toBe("pol-1");
		expect(auditEntryId("aud-1")).toBe("aud-1");
		expect(contentSourceId(42)).toBe(42);
	});
});
