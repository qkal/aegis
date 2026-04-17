import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Resolve every `@aegis/*` workspace import directly to its TypeScript source
// so that vitest does not require a prior `pnpm build` to populate `dist/`.
// Production consumers continue to use the built `dist/` entrypoints via the
// `exports` field in each package's `package.json`.
// Order matters: longer / more-specific aliases must come before the
// base package alias, otherwise a plain `@aegis/adapters` match would
// swallow `@aegis/adapters/testing`.
const workspaceAliases = {
	"@aegis/adapters/testing": fromRoot("./packages/adapters/src/testing.ts"),
	"@aegis/core": fromRoot("./packages/core/src/index.ts"),
	"@aegis/storage": fromRoot("./packages/storage/src/index.ts"),
	"@aegis/engine": fromRoot("./packages/engine/src/index.ts"),
	"@aegis/adapters": fromRoot("./packages/adapters/src/index.ts"),
	"@aegis/server": fromRoot("./packages/server/src/index.ts"),
	"@aegis/cli": fromRoot("./packages/cli/src/index.ts"),
};

export default defineConfig({
	resolve: {
		alias: workspaceAliases,
	},
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
