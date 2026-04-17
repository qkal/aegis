#!/usr/bin/env node
/**
 * Executable entry point for the `aegis` binary.
 *
 * Kept as a separate module from `cli.ts` on purpose: tsup can hoist
 * shared code into a chunk that both `cli.ts` and `index.ts` import,
 * and a module-level `run()` call here must *never* execute on plain
 * library imports. By isolating it in `bin.ts`, the top-level side
 * effect runs exactly when the `aegis` bin is invoked, and never when
 * an external consumer imports `@aegis/cli` for its typed API.
 */

import { run } from "./cli.js";

run().then(
	(code) => process.exit(code),
	(err: unknown) => {
		process.stderr.write(`aegis: fatal: ${(err as Error).stack ?? String(err)}\n`);
		process.exit(1);
	},
);
