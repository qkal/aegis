import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.ts"],
			exclude: ["**/*.test.ts", "**/*.d.ts", "**/index.ts"],
		},
		testTimeout: 10_000,
		hookTimeout: 10_000,
	},
});
