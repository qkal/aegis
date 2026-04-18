/**
 * Aegis CLI dispatcher.
 *
 * Routes the first positional argument to a command module. Each
 * command module owns its own argv parsing so this file stays small
 * and the dispatch table is trivially auditable.
 *
 * This module only *defines* the dispatcher. The executable entry
 * point lives in `bin.ts` so tsup doesn't hoist the `run()` call
 * into a shared chunk that would also execute on plain library
 * imports (via `./index.ts`).
 */

import { run as runDoctor } from "./commands/doctor.js";
import {
	COMMAND_DESCRIPTION as INIT_DESCRIPTION,
	INIT_PLATFORMS,
	run as runInit,
} from "./commands/init.js";
import { bold, cyan, shouldUseColor, type TermStyle } from "./term.js";

export const CLI_NAME = "aegisctx" as const;
export const CLI_VERSION = "0.1.0" as const;
export const CLI_DESCRIPTION = "Context infrastructure engine for AI coding agents";

/** Usage banner, also shown on `--help`. */
export function renderUsage(term: TermStyle): string {
	const lines = [
		bold(`${CLI_NAME} ${CLI_VERSION}`, term),
		CLI_DESCRIPTION,
		"",
		bold("USAGE", term),
		`  ${CLI_NAME} <command> [options]`,
		"",
		bold("COMMANDS", term),
		`  doctor               Run a full health check on your Aegis installation`,
		`  init <platform>      ${INIT_DESCRIPTION}`,
		`                       Platforms: ${INIT_PLATFORMS.join(", ")}`,
		"",
		bold("GLOBAL OPTIONS", term),
		"  --help, -h           Show this usage banner",
		"  --version, -v        Show the CLI version",
		"",
		`Run \`${CLI_NAME} <command> --help\` for command-specific help.`,
	];
	return lines.join("\n");
}

export interface CliDeps {
	readonly argv: readonly string[];
	readonly write: (line: string) => void;
	readonly writeError: (line: string) => void;
	readonly term: TermStyle;
}

/**
 * Core dispatcher. Returns the exit code — `run()` below wires the
 * defaults and calls `process.exit`. Tests use this directly.
 */
export async function dispatch(deps: CliDeps): Promise<number> {
	const [command, ...rest] = deps.argv;
	if (command === undefined || command === "--help" || command === "-h" || command === "help") {
		deps.write(renderUsage(deps.term));
		return command === undefined ? 2 : 0;
	}
	if (command === "--version" || command === "-v" || command === "version") {
		deps.write(CLI_VERSION);
		return 0;
	}
	switch (command) {
		case "doctor":
			return runDoctor(undefined, deps.write, deps.term);
		case "init":
			return runInit(rest, undefined, deps.write, deps.term);
		default:
			deps.writeError(`${cyan("error:", deps.term)} unknown command: ${command}`);
			deps.writeError(renderUsage(deps.term));
			return 2;
	}
}

/** Default entry used by `bin.ts`. */
export async function run(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
	const term: TermStyle = { useColor: shouldUseColor(process.env, process.stdout) };
	return dispatch({
		argv,
		write: (s) => process.stdout.write(`${s}\n`),
		writeError: (s) => process.stderr.write(`${s}\n`),
		term,
	});
}
