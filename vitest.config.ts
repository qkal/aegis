import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Resolve every `@aegisctx/*` workspace import directly to its TypeScript source
// so that vitest does not require a prior `pnpm build` to populate `dist/`.
// Production consumers continue to use the built `dist/` entrypoints via the
// `exports` field in each package's `package.json`.
// Order matters: longer / more-specific aliases must come before the
// base package alias, otherwise a plain `@aegisctx/adapters` match would
// swallow `@aegisctx/adapters/testing`.
const workspaceAliases = {
	"@aegisctx/adapters/testing": fromRoot("./packages/adapters/src/testing.ts"),
	"@aegisctx/core": fromRoot("./packages/core/src/index.ts"),
	"@aegisctx/storage": fromRoot("./packages/storage/src/index.ts"),
	"@aegisctx/engine": fromRoot("./packages/engine/src/index.ts"),
	"@aegisctx/adapters": fromRoot("./packages/adapters/src/index.ts"),
	"@aegisctx/server": fromRoot("./packages/server/src/index.ts"),
	"@aegisctx/cli": fromRoot("./packages/cli/src/index.ts"),
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
