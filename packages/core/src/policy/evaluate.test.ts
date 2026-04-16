/**
 * Unit + property-based tests for the policy evaluation engine.
 *
 * Goals (M0.2):
 * - Exercise every branch of evaluateToolCall, evaluateEnvVar,
 *   evaluateFilePath, evaluateNetAccess, matchToolPattern, matchGlob.
 * - Confirm deny → ask → allow → default-deny ordering.
 * - Verify glob metacharacters (`*`, `?`) and literal escaping.
 * - Use fast-check to assert deterministic behavior across 1K+ random inputs.
 */
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AegisPolicy } from "./index.js";
import {
	DEFAULT_POLICY,
	evaluateEnvVar,
	evaluateFilePath,
	evaluateNetAccess,
	evaluateToolCall,
	matchGlob,
	matchToolPattern,
	normalizePathForPolicy,
} from "./index.js";

function policy(overrides: Partial<AegisPolicy> = {}): AegisPolicy {
	return {
		...DEFAULT_POLICY,
		...overrides,
		tools: { ...DEFAULT_POLICY.tools, ...(overrides.tools ?? {}) },
		sandbox: { ...DEFAULT_POLICY.sandbox, ...(overrides.sandbox ?? {}) },
		execution: { ...DEFAULT_POLICY.execution, ...(overrides.execution ?? {}) },
	};
}

describe("matchGlob", () => {
	it("matches literal strings exactly", () => {
		expect(matchGlob("foo", "foo")).toBe(true);
		expect(matchGlob("foo", "bar")).toBe(false);
	});

	it("treats * as any-character sequence", () => {
		expect(matchGlob("anything goes", "*")).toBe(true);
		expect(matchGlob("", "*")).toBe(true);
		expect(matchGlob("foo-bar-baz", "foo-*-baz")).toBe(true);
		expect(matchGlob("foo-baz", "foo-*-baz")).toBe(false);
	});

	it("treats ? as exactly one character", () => {
		expect(matchGlob("cat", "c?t")).toBe(true);
		expect(matchGlob("coat", "c?t")).toBe(false);
		expect(matchGlob("ct", "c?t")).toBe(false);
	});

	it("escapes regex metacharacters as literals", () => {
		// A period in the pattern must match a literal period, not any char.
		expect(matchGlob(".env", ".env")).toBe(true);
		expect(matchGlob("aenv", ".env")).toBe(false);
		// Parens, plus, dollar, caret, pipe are literal.
		expect(matchGlob("a+b", "a+b")).toBe(true);
		expect(matchGlob("ab", "a+b")).toBe(false);
		expect(matchGlob("$HOME", "$HOME")).toBe(true);
		expect(matchGlob("^start", "^start")).toBe(true);
		expect(matchGlob("a|b", "a|b")).toBe(true);
		expect(matchGlob("a\\b", "a\\b")).toBe(true);
		expect(matchGlob("[abc]", "[abc]")).toBe(true);
		expect(matchGlob("{x}", "{x}")).toBe(true);
	});

	it("is anchored at both ends", () => {
		expect(matchGlob("foobar", "foo")).toBe(false);
		expect(matchGlob("foobar", "bar")).toBe(false);
	});

	it("is a total function over arbitrary strings (property)", () => {
		fc.assert(
			fc.property(fc.string(), fc.string(), (input, pattern) => {
				const result = matchGlob(input, pattern);
				return result === true || result === false;
			}),
			{ numRuns: 1000 },
		);
	});

	it("is deterministic: identical inputs always produce identical outputs (property)", () => {
		fc.assert(
			fc.property(fc.string(), fc.string(), (input, pattern) => {
				const first = matchGlob(input, pattern);
				const second = matchGlob(input, pattern);
				return first === second;
			}),
			{ numRuns: 1000 },
		);
	});

	it("wildcard-only pattern matches every string (property)", () => {
		fc.assert(
			fc.property(fc.string(), (input) => {
				return matchGlob(input, "*") === true;
			}),
			{ numRuns: 1000 },
		);
	});
});

describe("matchToolPattern", () => {
	it("matches same tool name and globbed argument", () => {
		expect(matchToolPattern("Bash(sudo rm -rf /)", "Bash(sudo *)")).toBe(true);
		expect(matchToolPattern("Read(.env.local)", "Read(.env*)")).toBe(true);
		expect(matchToolPattern("Bash(git status)", "Bash(git *)")).toBe(true);
	});

	it("fails when tool names differ", () => {
		expect(matchToolPattern("Bash(sudo *)", "Read(sudo *)")).toBe(false);
	});

	it("fails when argument does not match glob", () => {
		expect(matchToolPattern("Bash(npm install)", "Bash(git *)")).toBe(false);
	});

	it("falls back to exact string equality when either side is malformed", () => {
		expect(matchToolPattern("plain", "plain")).toBe(true);
		expect(matchToolPattern("plain", "other")).toBe(false);
		expect(matchToolPattern("Bash(x)", "BashX")).toBe(false);
	});
});

describe("evaluateToolCall", () => {
	it("allows tool calls matching an allow rule", () => {
		const result = evaluateToolCall("Bash(git status)", DEFAULT_POLICY);
		expect(result.verdict).toBe("allow");
		if (result.verdict === "allow") {
			expect(result.matchedRule).toBe("Bash(git *)");
		}
	});

	it("denies tool calls matching a deny rule", () => {
		const result = evaluateToolCall("Bash(sudo apt install)", DEFAULT_POLICY);
		expect(result.verdict).toBe("deny");
		if (result.verdict === "deny") {
			expect(result.matchedRule).toBe("Bash(sudo *)");
			expect(result.reason).toContain("deny rule");
		}
	});

	it("returns default_deny when no rule matches", () => {
		const result = evaluateToolCall("Unknown(whatever)", DEFAULT_POLICY);
		expect(result.verdict).toBe("default_deny");
		if (result.verdict === "default_deny") {
			expect(result.reason).toContain("No matching allow rule");
		}
	});

	it("prioritizes deny over ask and allow (ordering contract)", () => {
		// Construct a policy where the same pattern appears in all three buckets.
		const p = policy({
			tools: {
				deny: ["Bash(dangerous *)"],
				ask: ["Bash(dangerous *)"],
				allow: ["Bash(dangerous *)"],
			},
		});
		const result = evaluateToolCall("Bash(dangerous op)", p);
		expect(result.verdict).toBe("deny");
	});

	it("prioritizes ask over allow when no deny matches", () => {
		const p = policy({
			tools: {
				deny: [],
				ask: ["Bash(risky *)"],
				allow: ["Bash(risky *)"],
			},
		});
		const result = evaluateToolCall("Bash(risky op)", p);
		expect(result.verdict).toBe("ask");
		if (result.verdict === "ask") {
			expect(result.prompt).toContain("confirmation");
		}
	});

	it("is deterministic across arbitrary inputs (property)", () => {
		fc.assert(
			fc.property(
				fc.string(),
				fc.array(fc.string(), { maxLength: 5 }),
				fc.array(fc.string(), { maxLength: 5 }),
				fc.array(fc.string(), { maxLength: 5 }),
				(call, deny, ask, allow) => {
					const p = policy({
						tools: { deny, ask, allow },
					});
					const a = evaluateToolCall(call, p);
					const b = evaluateToolCall(call, p);
					return a.verdict === b.verdict;
				},
			),
			{ numRuns: 500 },
		);
	});

	it("never allows a call also listed in deny (property)", () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[A-Za-z]+\([^()]{0,20}\)$/),
				fc.array(fc.stringMatching(/^[A-Za-z]+\([^()]{0,20}\)$/), { maxLength: 3 }),
				(call, allowRules) => {
					const p = policy({
						tools: { deny: [call], ask: [], allow: allowRules },
					});
					const result = evaluateToolCall(call, p);
					return result.verdict === "deny";
				},
			),
			{ numRuns: 500 },
		);
	});
});

describe("evaluateEnvVar", () => {
	it("denies credential-like vars by default", () => {
		expect(evaluateEnvVar("AWS_SECRET_ACCESS_KEY", DEFAULT_POLICY)).toBe(false);
		expect(evaluateEnvVar("GH_TOKEN", DEFAULT_POLICY)).toBe(false);
		expect(evaluateEnvVar("OPENAI_API_KEY", DEFAULT_POLICY)).toBe(false);
	});

	it("allows listed safe vars", () => {
		expect(evaluateEnvVar("PATH", DEFAULT_POLICY)).toBe(true);
		expect(evaluateEnvVar("HOME", DEFAULT_POLICY)).toBe(true);
	});

	it("default-denies variables not listed anywhere", () => {
		expect(evaluateEnvVar("SOME_UNLISTED_VAR", DEFAULT_POLICY)).toBe(false);
	});

	it("deny patterns take precedence over allow patterns", () => {
		const p = policy({
			sandbox: {
				...DEFAULT_POLICY.sandbox,
				env: { allow: ["*"], deny: ["SECRET_*"] },
			},
		});
		expect(evaluateEnvVar("PATH", p)).toBe(true);
		expect(evaluateEnvVar("SECRET_TOKEN", p)).toBe(false);
	});
});

describe("evaluateFilePath", () => {
	const withFs = (fs: AegisPolicy["sandbox"]["fs"]): AegisPolicy =>
		policy({ sandbox: { ...DEFAULT_POLICY.sandbox, fs } });

	it("denies reads to dotfiles under default policy", () => {
		expect(evaluateFilePath(".env", "read", DEFAULT_POLICY)).toBe("deny");
		expect(evaluateFilePath("~/.ssh/id_rsa", "read", DEFAULT_POLICY)).toBe("deny");
	});

	it("allows reads under listed allow globs", () => {
		const p = withFs({ read: ["/workspace/*"], write: [], deny: [] });
		expect(evaluateFilePath("/workspace/src", "read", p)).toBe("allow");
		expect(evaluateFilePath("/etc/passwd", "read", p)).toBe("deny");
	});

	it("uses the write allow list when operation is write", () => {
		const p = withFs({
			read: ["/workspace/*"],
			write: ["/workspace/out/*"],
			deny: [],
		});
		expect(evaluateFilePath("/workspace/out/x", "write", p)).toBe("allow");
		expect(evaluateFilePath("/workspace/src", "write", p)).toBe("deny");
	});

	it("deny globs override both read and write allows", () => {
		const p = withFs({
			read: ["*"],
			write: ["*"],
			deny: ["/secret/*"],
		});
		expect(evaluateFilePath("/secret/x", "read", p)).toBe("deny");
		expect(evaluateFilePath("/secret/x", "write", p)).toBe("deny");
		expect(evaluateFilePath("/other/x", "read", p)).toBe("allow");
	});

	it("resolves traversal segments before matching (cannot bypass deny via ..)", () => {
		const p = withFs({
			read: ["/workspace/*"],
			write: [],
			deny: ["/etc/*"],
		});
		// Naive glob matching would see the path as starting with "/workspace/"
		// and return "allow". Normalization must collapse ".." first.
		expect(evaluateFilePath("/workspace/../etc/passwd", "read", p)).toBe("deny");
		// Legitimate traversal inside the allowed subtree still allows.
		expect(evaluateFilePath("/workspace/a/../b", "read", p)).toBe("allow");
	});

	it("rejects paths that escape root via ..", () => {
		const p = withFs({ read: ["*"], write: [], deny: [] });
		expect(evaluateFilePath("/../etc/passwd", "read", p)).toBe("deny");
	});

	it("rejects paths containing NUL bytes", () => {
		const p = withFs({ read: ["*"], write: [], deny: [] });
		expect(evaluateFilePath("/workspace/file\0.txt", "read", p)).toBe("deny");
	});
});

describe("normalizePathForPolicy", () => {
	it("collapses . and .. segments for relative paths", () => {
		expect(normalizePathForPolicy("a/./b/../c")).toBe("a/c");
	});

	it("preserves the absolute anchor and resolves inside it", () => {
		expect(normalizePathForPolicy("/workspace/src/../lib")).toBe("/workspace/lib");
	});

	it("refuses to escape above an absolute root", () => {
		expect(normalizePathForPolicy("/../etc")).toBeNull();
		expect(normalizePathForPolicy("/a/../../etc")).toBeNull();
	});

	it("preserves a ~/ anchor for home-relative paths", () => {
		expect(normalizePathForPolicy("~/.ssh/id_rsa")).toBe("~/.ssh/id_rsa");
		expect(normalizePathForPolicy("~/a/../b")).toBe("~/b");
	});

	it("leaves relative .. in a relative path (no anchor to escape)", () => {
		expect(normalizePathForPolicy("../sibling")).toBe("../sibling");
	});

	it("returns null for NUL-containing input", () => {
		expect(normalizePathForPolicy("/a\0b")).toBeNull();
	});

	it("collapses redundant slashes", () => {
		expect(normalizePathForPolicy("/a//b///c")).toBe("/a/b/c");
	});
});

describe("evaluateNetAccess", () => {
	it("denies all network access by default", () => {
		expect(evaluateNetAccess("example.com:443", DEFAULT_POLICY)).toBe(false);
		expect(evaluateNetAccess("localhost:80", DEFAULT_POLICY)).toBe(false);
	});

	it("allows listed host:port patterns", () => {
		const p = policy({
			sandbox: {
				...DEFAULT_POLICY.sandbox,
				net: { allow: ["registry.npmjs.org:443"], deny: [] },
			},
		});
		expect(evaluateNetAccess("registry.npmjs.org:443", p)).toBe(true);
		expect(evaluateNetAccess("evil.example.com:443", p)).toBe(false);
	});

	it("deny beats allow", () => {
		const p = policy({
			sandbox: {
				...DEFAULT_POLICY.sandbox,
				net: { allow: ["*"], deny: ["evil.*:*"] },
			},
		});
		expect(evaluateNetAccess("good.example.com:443", p)).toBe(true);
		expect(evaluateNetAccess("evil.example.com:443", p)).toBe(false);
	});
});

describe("DEFAULT_POLICY", () => {
	it("is version 1", () => {
		expect(DEFAULT_POLICY.version).toBe(1);
	});

	it("has secure defaults for env, fs, and net", () => {
		expect(DEFAULT_POLICY.sandbox.env.allow).toContain("PATH");
		expect(DEFAULT_POLICY.sandbox.env.deny).toContain("AWS_*");
		expect(DEFAULT_POLICY.sandbox.net.deny).toContain("*");
		expect(DEFAULT_POLICY.sandbox.fs.read).toHaveLength(0);
		expect(DEFAULT_POLICY.sandbox.fs.write).toHaveLength(0);
	});

	it("denies sudo and recursive deletes by default", () => {
		expect(DEFAULT_POLICY.tools.deny).toContain("Bash(sudo *)");
		// Patterns were broadened so variants like "rm -rf ." / "rm -rf foo"
		// also match; the check targets the generalised glob directly.
		expect(DEFAULT_POLICY.tools.deny).toContain("Bash(rm -rf *)");
	});

	it("has a reasonable execution budget", () => {
		expect(DEFAULT_POLICY.execution.maxTimeoutMs).toBeGreaterThan(0);
		expect(DEFAULT_POLICY.execution.maxOutputBytes).toBeGreaterThan(0);
		expect(DEFAULT_POLICY.execution.allowBackground).toBe(false);
	});
});
