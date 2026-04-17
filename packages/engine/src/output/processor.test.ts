import { describe, expect, it } from "vitest";
import {
	DEFAULT_OUTPUT_OPTIONS,
	processOutput,
	stripAnsi,
	stripControlCharacters,
	truncateToByteLength,
} from "./processor.js";

describe("stripAnsi", () => {
	it("removes SGR colour codes", () => {
		expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
		expect(stripAnsi("\u001b[1;32mbold green\u001b[22;39m"))
			.toBe("bold green");
	});

	it("removes cursor movement and clear sequences", () => {
		expect(stripAnsi("start\u001b[2Kend")).toBe("startend");
		expect(stripAnsi("\u001b[2J\u001b[H\u001b[?25l")).toBe("");
	});

	it("removes OSC title-setting sequences (BEL + ST terminators)", () => {
		expect(stripAnsi("\u001b]0;my title\u0007after")).toBe("after");
		expect(stripAnsi("\u001b]2;title\u001b\\after")).toBe("after");
	});

	it("preserves printable text, tabs, and newlines", () => {
		const s = "line1\n\tline2\r\nline3";
		expect(stripAnsi(s)).toBe(s);
	});

	it("is idempotent", () => {
		const raw = "\u001b[31;1merr\u001b[0m and \u001b[32mok\u001b[0m";
		expect(stripAnsi(stripAnsi(raw))).toBe(stripAnsi(raw));
	});

	it("runs in linear time on adversarial input", () => {
		// Guard against catastrophic backtracking. 50k characters must
		// finish well under the vitest hook timeout.
		const big = "a".repeat(50_000) + "\u001b[31m" + "b".repeat(50_000);
		const start = performance.now();
		const out = stripAnsi(big);
		const elapsed = performance.now() - start;
		expect(out).toBe("a".repeat(50_000) + "b".repeat(50_000));
		expect(elapsed).toBeLessThan(200);
	});
});

describe("stripControlCharacters", () => {
	it("removes C0 controls except tab / newline / carriage return", () => {
		expect(stripControlCharacters("a\u0000b\u0001c\u0007d")).toBe("abcd");
		expect(stripControlCharacters("keep\ttabs\nand\rnewlines")).toBe(
			"keep\ttabs\nand\rnewlines",
		);
	});

	it("removes DEL (0x7f)", () => {
		expect(stripControlCharacters("a\u007fb")).toBe("ab");
	});
});

describe("truncateToByteLength", () => {
	it("returns the input unchanged when within the cap", () => {
		const r = truncateToByteLength("hello", 10);
		expect(r).toEqual({ text: "hello", truncated: false, originalByteLength: 5 });
	});

	it("truncates strictly by UTF-8 byte length", () => {
		const r = truncateToByteLength("abcdef", 3);
		expect(r.text).toBe("abc");
		expect(r.truncated).toBe(true);
		expect(r.originalByteLength).toBe(6);
	});

	it("never splits a multibyte character", () => {
		// "é" is 2 bytes in UTF-8, "😀" is 4 bytes.
		const input = "aéb😀c";
		const r = truncateToByteLength(input, 4);
		// 'a' (1) + 'é' (2) = 3 bytes; next char is 'b' (1 byte) → fits at 4.
		expect(r.text).toBe("aéb");
		expect(r.truncated).toBe(true);
	});

	it("drops a full multibyte character when its first byte overflows", () => {
		// Budget of 1 byte before "😀" — must drop the whole emoji.
		const r = truncateToByteLength("a😀", 2);
		expect(r.text).toBe("a");
		expect(r.truncated).toBe(true);
		expect(r.originalByteLength).toBe(5);
	});

	it("handles an exact-boundary truncation without dropping valid chars", () => {
		// "aé" is exactly 3 UTF-8 bytes.
		const r = truncateToByteLength("aé", 3);
		expect(r.text).toBe("aé");
		expect(r.truncated).toBe(false);
	});

	it("rejects negative or non-integer budgets", () => {
		expect(() => truncateToByteLength("abc", -1)).toThrow(RangeError);
		expect(() => truncateToByteLength("abc", 1.5)).toThrow(RangeError);
	});
});

describe("processOutput", () => {
	it("applies defaults: strip ANSI, trim, enforce 5 MiB cap", () => {
		const r = processOutput("  \u001b[31mhello\u001b[0m  ");
		expect(r).toEqual({
			text: "hello",
			truncated: false,
			originalByteLength: 5,
		});
	});

	it("respects stripAnsi=false", () => {
		const r = processOutput("\u001b[31mhi\u001b[0m", {
			...DEFAULT_OUTPUT_OPTIONS,
			stripAnsi: false,
		});
		expect(r.text).toBe("\u001b[31mhi\u001b[0m");
	});

	it("respects trimWhitespace=false", () => {
		const r = processOutput("  hi  ", {
			...DEFAULT_OUTPUT_OPTIONS,
			trimWhitespace: false,
		});
		expect(r.text).toBe("  hi  ");
	});

	it("strips before trimming so trimmed whitespace reveals under ANSI", () => {
		const r = processOutput("\u001b[31m  content  \u001b[0m");
		expect(r.text).toBe("content");
	});

	it("enforces the byte cap after stripping and trimming", () => {
		const r = processOutput("\u001b[31m" + "x".repeat(1000) + "\u001b[0m", {
			...DEFAULT_OUTPUT_OPTIONS,
			maxBytes: 10,
		});
		expect(r.truncated).toBe(true);
		expect(r.text).toBe("x".repeat(10));
	});

	it("is deterministic: identical input produces identical output", () => {
		const input = "\u001b[31m hello\nworld \u001b[0m";
		const a = processOutput(input);
		const b = processOutput(input);
		expect(a).toEqual(b);
	});
});
