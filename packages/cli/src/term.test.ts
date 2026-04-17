import { describe, expect, it } from "vitest";
import { bold, green, red, shouldUseColor, statusSymbol, yellow } from "./term.js";

const COLOR = { useColor: true };
const PLAIN = { useColor: false };

describe("term color helpers", () => {
	it("wraps text with ANSI codes when useColor is true", () => {
		expect(bold("x", COLOR)).toBe("\u001b[1mx\u001b[22m");
		expect(red("x", COLOR)).toBe("\u001b[31mx\u001b[39m");
		expect(green("x", COLOR)).toBe("\u001b[32mx\u001b[39m");
		expect(yellow("x", COLOR)).toBe("\u001b[33mx\u001b[39m");
	});

	it("passes text through unchanged when useColor is false", () => {
		expect(bold("x", PLAIN)).toBe("x");
		expect(red("x", PLAIN)).toBe("x");
	});

	it("returns empty string unchanged even with useColor (no empty escape)", () => {
		expect(bold("", COLOR)).toBe("");
	});
});

describe("statusSymbol", () => {
	it("renders ok/warn/fail tokens with a fixed 6-char width", () => {
		expect(statusSymbol("ok", PLAIN)).toBe("[OK]  ");
		expect(statusSymbol("warn", PLAIN)).toBe("[WARN]");
		expect(statusSymbol("fail", PLAIN)).toBe("[FAIL]");
	});

	it("colorizes the symbol when useColor is true", () => {
		expect(statusSymbol("ok", COLOR)).toContain("\u001b[32m");
		expect(statusSymbol("warn", COLOR)).toContain("\u001b[33m");
		expect(statusSymbol("fail", COLOR)).toContain("\u001b[31m");
	});
});

describe("shouldUseColor", () => {
	it("disables color when NO_COLOR is set", () => {
		expect(shouldUseColor({ NO_COLOR: "1" }, { isTTY: true })).toBe(false);
	});

	it("forces color when FORCE_COLOR is set, even without isTTY", () => {
		expect(shouldUseColor({ FORCE_COLOR: "1" }, { isTTY: false })).toBe(true);
	});

	it("falls back to isTTY when no override is set", () => {
		expect(shouldUseColor({}, { isTTY: true })).toBe(true);
		expect(shouldUseColor({}, { isTTY: false })).toBe(false);
		expect(shouldUseColor({}, {})).toBe(false);
	});

	it("treats empty NO_COLOR / FORCE_COLOR as unset", () => {
		expect(shouldUseColor({ NO_COLOR: "" }, { isTTY: true })).toBe(true);
		expect(shouldUseColor({ FORCE_COLOR: "" }, { isTTY: false })).toBe(false);
	});
});
