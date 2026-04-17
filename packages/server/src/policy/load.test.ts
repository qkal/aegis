import { DEFAULT_POLICY } from "@aegis/core";
import { describe, expect, it } from "vitest";

import { loadPolicy, PolicyConfigError } from "./load.js";

function readerFor(files: Record<string, string | undefined>) {
	return (path: string) => files[path];
}

describe("loadPolicy", () => {
	it("returns the default policy when no configs exist", () => {
		const { policy, sources } = loadPolicy({
			userConfigPath: "/home/u/.aegis/config.json",
			projectConfigPath: "/repo/.aegis/config.json",
			readFile: readerFor({}),
		});
		expect(policy).toEqual(DEFAULT_POLICY);
		expect(sources).toEqual([{ scope: "defaults", path: null }]);
	});

	it("layers user config on top of defaults", () => {
		const userPath = "/home/u/.aegis/config.json";
		const { policy, sources } = loadPolicy({
			userConfigPath: userPath,
			projectConfigPath: "/repo/.aegis/config.json",
			readFile: readerFor({
				[userPath]: JSON.stringify({
					execution: { maxTimeoutMs: 60_000 },
				}),
			}),
		});
		expect(policy.execution.maxTimeoutMs).toBe(60_000);
		expect(sources.map((s) => s.scope)).toEqual(["defaults", "user"]);
	});

	it("layers project config on top of user config", () => {
		const userPath = "/home/u/.aegis/config.json";
		const projectPath = "/repo/.aegis/config.json";
		const { policy, sources } = loadPolicy({
			userConfigPath: userPath,
			projectConfigPath: projectPath,
			readFile: readerFor({
				[userPath]: JSON.stringify({
					tools: { allow: ["Bash(git *)"] },
					execution: { maxTimeoutMs: 60_000 },
				}),
				[projectPath]: JSON.stringify({
					tools: { allow: ["Bash(pnpm *)"] },
				}),
			}),
		});
		expect(policy.tools.allow).toEqual(["Bash(pnpm *)"]);
		// project doesn't touch maxTimeoutMs, so user's value wins over defaults
		expect(policy.execution.maxTimeoutMs).toBe(60_000);
		expect(sources.map((s) => s.scope)).toEqual(["defaults", "user", "project"]);
	});

	it("throws on malformed JSON with the offending path", () => {
		const userPath = "/home/u/.aegis/config.json";
		expect(() =>
			loadPolicy({
				userConfigPath: userPath,
				projectConfigPath: null,
				readFile: readerFor({ [userPath]: "{ not json" }),
			})
		).toThrow(PolicyConfigError);
	});

	it("throws on structurally invalid config", () => {
		const userPath = "/home/u/.aegis/config.json";
		expect(() =>
			loadPolicy({
				userConfigPath: userPath,
				projectConfigPath: null,
				readFile: readerFor({
					[userPath]: JSON.stringify({ execution: { maxTimeoutMs: -1 } }),
				}),
			})
		).toThrow(PolicyConfigError);
	});

	it("propagates non-ENOENT I/O errors as PolicyConfigError", () => {
		const userPath = "/home/u/.aegis/config.json";
		const failingReader = (p: string): string | undefined => {
			if (p === userPath) throw new Error("permission denied");
			return undefined;
		};
		expect(() =>
			loadPolicy({
				userConfigPath: userPath,
				projectConfigPath: null,
				readFile: failingReader,
			})
		).toThrow(PolicyConfigError);
	});

	it("treats `userConfigPath: null` and `projectConfigPath: null` as disabled", () => {
		const { policy, sources } = loadPolicy({
			userConfigPath: null,
			projectConfigPath: null,
			readFile: () => {
				throw new Error("must not read");
			},
		});
		expect(policy).toEqual(DEFAULT_POLICY);
		expect(sources).toEqual([{ scope: "defaults", path: null }]);
	});

	it("skips the project config if it resolves to the same path as user config", () => {
		const path = "/home/u/.aegis/config.json";
		const { sources } = loadPolicy({
			userConfigPath: path,
			projectConfigPath: path,
			readFile: readerFor({
				[path]: JSON.stringify({ execution: { maxTimeoutMs: 7_000 } }),
			}),
		});
		expect(sources.map((s) => s.scope)).toEqual(["defaults", "user"]);
	});
});
