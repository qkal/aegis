/**
 * Vitest configuration for benchmarks.
 *
 * The default config (`vitest.config.ts`) only includes `*.test.ts` so that
 * routine `pnpm test` runs stay fast and hardware-agnostic. Benchmarks live
 * in `*.bench.ts` files and are opt-in via `pnpm bench`, which passes
 * `--config vitest.bench.config.ts` to swap the include glob.
 *
 * Everything else (workspace aliases, strict test timeout) is inherited from
 * the default config.
 */

import { mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

export default mergeConfig(base, {
	test: {
		include: ["packages/*/src/**/*.bench.ts"],
		// Benchmarks index 10K chunks before measuring; the default 10s
		// hook timeout is tight once you add SQLite FTS5 insertion cost.
		hookTimeout: 60_000,
		testTimeout: 60_000,
	},
});
