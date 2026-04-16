# Oxlint, Dprint, and CI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully remove Biome, replace it with `oxlint` + `dprint`, and ship a faster Linux-first CI workflow with built-artifact smoke checks, stable test sharding, and hygiene validation.

**Architecture:** Keep the workflow YAML thin by moving shard, smoke, and hygiene logic into small repo-owned Node scripts under `scripts/ci/`, each backed by Vitest tests under `tests/ci/`. Keep `tsc --noEmit` separate from linting in the first migration, and make documentation/ADR changes part of the same work so the repo’s stated architecture matches its actual toolchain.

**Tech Stack:** Node 22 ESM, pnpm 9, Oxlint, dprint with npm-hosted WASM plugins, Vitest 4, GitHub Actions v4, TypeScript 5.7, tsup

---

## File Structure

**Create:**

- `.oxlintrc.json` — root Oxlint config with ignore patterns and repo-specific rules.
- `dprint.json` — root formatter config using npm-hosted dprint plugins.
- `scripts/ci/test-shards.mjs` — canonical mapping from shard names to test file patterns.
- `scripts/ci/run-vitest-shard.mjs` — CLI entrypoint that expands shard files and invokes Vitest.
- `scripts/ci/smoke.mjs` — built-artifact smoke checks for CLI and server outputs.
- `scripts/ci/hygiene.mjs` — publish-surface and packaging integrity checks.
- `tests/ci/tooling-config.test.ts` — regression test for root scripts and config files.
- `tests/ci/test-shards.test.ts` — regression test for test-shard partitioning.
- `tests/ci/smoke.test.ts` — regression test for smoke artifact expectations.
- `tests/ci/hygiene.test.ts` — regression test for hygiene package manifests.
- `docs/adr/0017-oxlint-and-dprint-toolchain.md` — superseding ADR for the new toolchain and CI direction.

**Modify:**

- `package.json` — replace Biome scripts, add new CI helper scripts, add/remove dev dependencies.
- `pnpm-lock.yaml` — record the dependency swap.
- `.github/workflows/ci.yml` — replace the monolithic job with parallel Linux jobs and artifact handoff.
- `README.md` — update development commands and ADR table.
- `PLAN.md` — replace Biome references with Oxlint + dprint and update CI expectations.
- `MILESTONES.md` — update milestone language from “Biome lint passes” to the new toolchain and CI lanes.
- `docs/adr/0010-biome-for-linting-and-formatting.md` — mark as superseded and point to ADR-0017.

**Delete:**

- `biome.json`

## Task 1: Replace The Root Toolchain Contract

**Files:**

- Create: `tests/ci/tooling-config.test.ts`
- Create: `.oxlintrc.json`
- Create: `dprint.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Delete: `biome.json`

- [ ] **Step 1: Write the failing toolchain contract test**

Create `tests/ci/tooling-config.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
	readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
	scripts: Record<string, string>;
	devDependencies: Record<string, string | undefined>;
};

describe("tooling migration contract", () => {
	it("replaces biome scripts with oxlint and dprint", () => {
		expect(packageJson.scripts.lint).toBe("oxlint .");
		expect(packageJson.scripts["lint:fix"]).toBe("oxlint --fix .");
		expect(packageJson.scripts.format).toBe("dprint fmt");
		expect(packageJson.scripts["format:check"]).toBe("dprint check");
	});

	it("adds the shard and CI helper scripts", () => {
		expect(packageJson.scripts["test:core"]).toBe(
			"node ./scripts/ci/run-vitest-shard.mjs core",
		);
		expect(packageJson.scripts["test:storage"]).toBe(
			"node ./scripts/ci/run-vitest-shard.mjs storage",
		);
		expect(packageJson.scripts["test:rest"]).toBe(
			"node ./scripts/ci/run-vitest-shard.mjs rest",
		);
		expect(packageJson.scripts["ci:smoke"]).toBe("node ./scripts/ci/smoke.mjs");
		expect(packageJson.scripts["ci:hygiene"]).toBe("node ./scripts/ci/hygiene.mjs");
	});

	it("drops biome and adds oxlint plus dprint packages", () => {
		expect(packageJson.devDependencies["@biomejs/biome"]).toBeUndefined();
		expect(packageJson.devDependencies.oxlint).toBeDefined();
		expect(packageJson.devDependencies.dprint).toBeDefined();
		expect(packageJson.devDependencies["@dprint/typescript"]).toBeDefined();
		expect(packageJson.devDependencies["@dprint/json"]).toBeDefined();
		expect(packageJson.devDependencies["@dprint/markdown"]).toBeDefined();
	});

	it("creates repo-owned config files", () => {
		expect(existsSync(new URL("../../.oxlintrc.json", import.meta.url))).toBe(true);
		expect(existsSync(new URL("../../dprint.json", import.meta.url))).toBe(true);
		expect(existsSync(new URL("../../biome.json", import.meta.url))).toBe(false);
	});
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/ci/tooling-config.test.ts
```

Expected: FAIL with missing config files and script mismatches such as `expected "biome check ." to be "oxlint ."`.

- [ ] **Step 3: Replace the root scripts and dev dependencies**

Install the new tools:

```bash
pnpm add -D oxlint dprint @dprint/typescript @dprint/json @dprint/markdown
pnpm remove @biomejs/biome
```

Then update the `scripts` section in `package.json` to:

```json
{
	"scripts": {
		"build": "pnpm -r run build",
		"test": "vitest run",
		"test:watch": "vitest watch",
		"test:coverage": "vitest run --coverage",
		"test:core": "node ./scripts/ci/run-vitest-shard.mjs core",
		"test:storage": "node ./scripts/ci/run-vitest-shard.mjs storage",
		"test:rest": "node ./scripts/ci/run-vitest-shard.mjs rest",
		"test:ci": "vitest run --reporter=default --reporter=junit --outputFile=test-report.junit.xml",
		"lint": "oxlint .",
		"lint:fix": "oxlint --fix .",
		"format": "dprint fmt",
		"format:check": "dprint check",
		"typecheck": "pnpm -r run typecheck",
		"clean": "pnpm -r run clean",
		"doctor": "pnpm -r run build && node packages/cli/dist/cli.js doctor",
		"ci:smoke": "node ./scripts/ci/smoke.mjs",
		"ci:hygiene": "node ./scripts/ci/hygiene.mjs"
	}
}
```

- [ ] **Step 4: Add the Oxlint config**

Create `.oxlintrc.json`:

```json
{
	"$schema": "./node_modules/oxlint/configuration_schema.json",
	"plugins": ["typescript", "import", "vitest"],
	"ignorePatterns": [
		"**/dist/**",
		"**/node_modules/**",
		"coverage/**",
		"test-report.junit.xml"
	],
	"rules": {
		"typescript/no-explicit-any": "error",
		"import/first": "error",
		"import/no-duplicates": ["error", { "preferInline": true }],
		"vitest/no-focused-tests": "error"
	}
}
```

- [ ] **Step 5: Add the dprint config and remove Biome’s config**

Create `dprint.json`:

```json
{
	"$schema": "https://dprint.dev/schemas/v0.json",
	"lineWidth": 100,
	"indentWidth": 2,
	"useTabs": true,
	"includes": [
		"**/*.{ts,tsx,js,jsx,mjs,cjs,json,jsonc,md}",
		"!**/dist/**",
		"!**/node_modules/**"
	],
	"typescript": {
		"quoteStyle": "preferDouble",
		"semiColons": "always"
	},
	"plugins": [
		"./node_modules/@dprint/typescript/plugin.wasm",
		"./node_modules/@dprint/json/plugin.wasm",
		"./node_modules/@dprint/markdown/plugin.wasm"
	]
}
```

Delete the old config:

```bash
git rm biome.json
```

- [ ] **Step 6: Run the targeted test to verify the contract passes**

Run:

```bash
pnpm exec vitest run tests/ci/tooling-config.test.ts
```

Expected: PASS with 4 passing assertions.

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json pnpm-lock.yaml .oxlintrc.json dprint.json tests/ci/tooling-config.test.ts biome.json
git commit -m "chore: replace biome with oxlint and dprint"
```

## Task 2: Add Stable Test Shards

**Files:**

- Create: `scripts/ci/test-shards.mjs`
- Create: `scripts/ci/run-vitest-shard.mjs`
- Create: `tests/ci/test-shards.test.ts`

- [ ] **Step 1: Write the failing shard manifest test**

Create `tests/ci/test-shards.test.ts`:

```ts
import { globSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveShardFiles, TEST_SHARDS } from "../../scripts/ci/test-shards.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("vitest shard manifest", () => {
	it("defines the three Linux CI shards", () => {
		expect(Object.keys(TEST_SHARDS)).toEqual(["core", "storage", "rest"]);
	});

	it("partitions all current tests without overlap", () => {
		const allTests = [
			...globSync("packages/*/src/**/*.test.ts", { cwd: root, posix: true }),
			...globSync("tests/**/*.test.ts", { cwd: root, posix: true }),
		].sort();

		const shardFiles = Object.keys(TEST_SHARDS)
			.flatMap((name) => resolveShardFiles(root, name))
			.sort();

		expect(shardFiles).toEqual(allTests);
		expect(new Set(shardFiles).size).toBe(shardFiles.length);
	});
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/ci/test-shards.test.ts
```

Expected: FAIL with `Cannot find module '../../scripts/ci/test-shards.mjs'`.

- [ ] **Step 3: Add the shard manifest**

Create `scripts/ci/test-shards.mjs`:

```js
import { globSync } from "node:fs";

export const TEST_SHARDS = Object.freeze({
	core: ["packages/core/src/**/*.test.ts"],
	storage: ["packages/storage/src/**/*.test.ts"],
	rest: [
		"packages/adapters/src/**/*.test.ts",
		"packages/cli/src/**/*.test.ts",
		"packages/engine/src/**/*.test.ts",
		"packages/server/src/**/*.test.ts",
		"tests/**/*.test.ts",
	],
});

export function getShardPatterns(name) {
	const patterns = TEST_SHARDS[name];
	if (!patterns) {
		throw new Error(`Unknown test shard: ${name}`);
	}
	return patterns;
}

export function resolveShardFiles(root, name) {
	return getShardPatterns(name)
		.flatMap((pattern) => globSync(pattern, { cwd: root, posix: true }))
		.sort();
}
```

- [ ] **Step 4: Add the shard runner**

Create `scripts/ci/run-vitest-shard.mjs`:

```js
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveShardFiles } from "./test-shards.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const shardName = process.argv[2];

if (!shardName) {
	console.error("Usage: node scripts/ci/run-vitest-shard.mjs <core|storage|rest>");
	process.exit(1);
}

const files = resolveShardFiles(root, shardName);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
	pnpmCommand,
	["exec", "vitest", "run", "--passWithNoTests", ...files],
	{
		cwd: root,
		stdio: "inherit",
		shell: false,
	},
);

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
```

- [ ] **Step 5: Run the targeted shard test to verify it passes**

Run:

```bash
pnpm exec vitest run tests/ci/test-shards.test.ts
```

Expected: PASS with both shard assertions green.

- [ ] **Step 6: Run each shard script once**

Run:

```bash
node scripts/ci/run-vitest-shard.mjs core
node scripts/ci/run-vitest-shard.mjs storage
node scripts/ci/run-vitest-shard.mjs rest
```

Expected:

- `core` executes `packages/core` tests
- `storage` executes `packages/storage` tests
- `rest` succeeds even if some package globs currently contain zero tests

- [ ] **Step 7: Commit**

Run:

```bash
git add scripts/ci/test-shards.mjs scripts/ci/run-vitest-shard.mjs tests/ci/test-shards.test.ts package.json
git commit -m "test: add stable vitest shard runner"
```

## Task 3: Add Smoke And Hygiene Helpers

**Files:**

- Create: `scripts/ci/smoke.mjs`
- Create: `scripts/ci/hygiene.mjs`
- Create: `tests/ci/smoke.test.ts`
- Create: `tests/ci/hygiene.test.ts`

- [ ] **Step 1: Write the failing smoke and hygiene tests**

Create `tests/ci/smoke.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSmokeFiles, REQUIRED_SMOKE_FILES } from "../../scripts/ci/smoke.mjs";

describe("smoke artifact manifest", () => {
	it("covers the built CLI and server entrypoints", () => {
		expect(REQUIRED_SMOKE_FILES).toEqual([
			"packages/cli/dist/cli.js",
			"packages/cli/dist/index.js",
			"packages/server/dist/index.js",
			"packages/server/dist/server.js",
			"packages/server/package.json",
		]);
	});

	it("throws when any required build artifact is missing", () => {
		const root = mkdtempSync(join(tmpdir(), "aegis-smoke-"));
		mkdirSync(join(root, "packages", "cli", "dist"), { recursive: true });
		writeFileSync(
			join(root, "packages", "cli", "dist", "cli.js"),
			"export const CLI_DESCRIPTION = 'ok';\n",
		);

		expect(() => assertSmokeFiles(root)).toThrow(/packages\/cli\/dist\/index\.js/);
	});
});
```

Create `tests/ci/hygiene.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PACK_TARGETS, requiredDistFiles } from "../../scripts/ci/hygiene.mjs";

describe("hygiene package manifest", () => {
	it("packs every publishable workspace package", () => {
		expect(PACK_TARGETS).toEqual([
			"packages/adapters",
			"packages/cli",
			"packages/core",
			"packages/engine",
			"packages/server",
			"packages/storage",
		]);
	});

	it("requires extra entrypoints for cli and server", () => {
		expect(requiredDistFiles("packages/cli")).toEqual(["dist/index.js", "dist/cli.js"]);
		expect(requiredDistFiles("packages/server")).toEqual(["dist/index.js", "dist/server.js"]);
		expect(requiredDistFiles("packages/core")).toEqual(["dist/index.js"]);
	});
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
pnpm exec vitest run tests/ci/smoke.test.ts tests/ci/hygiene.test.ts
```

Expected: FAIL with missing `scripts/ci/smoke.mjs` and `scripts/ci/hygiene.mjs`.

- [ ] **Step 3: Add the smoke helper**

Create `scripts/ci/smoke.mjs`:

```js
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_SMOKE_FILES = Object.freeze([
	"packages/cli/dist/cli.js",
	"packages/cli/dist/index.js",
	"packages/server/dist/index.js",
	"packages/server/dist/server.js",
	"packages/server/package.json",
]);

export function assertSmokeFiles(root = process.cwd(), requiredFiles = REQUIRED_SMOKE_FILES) {
	const missing = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
	if (missing.length > 0) {
		throw new Error(
			`Missing smoke-test artifacts:\n${missing.map((file) => `- ${file}`).join("\n")}`,
		);
	}
}

export async function importBuiltModule(root, relativePath) {
	return import(pathToFileURL(resolve(root, relativePath)).href);
}

export async function runSmoke(root = process.cwd()) {
	assertSmokeFiles(root);

	const cliBin = await importBuiltModule(root, "packages/cli/dist/cli.js");
	const cliModule = await importBuiltModule(root, "packages/cli/dist/index.js");
	const serverModule = await importBuiltModule(root, "packages/server/dist/index.js");
	const serverEntry = await importBuiltModule(root, "packages/server/dist/server.js");

	if (cliModule.CLI_NAME !== "aegis" || typeof cliModule.CLI_VERSION !== "string") {
		throw new Error("CLI dist exports are missing expected identifiers.");
	}

	if (serverModule.SERVER_NAME !== "aegis" || typeof serverModule.SERVER_VERSION !== "string") {
		throw new Error("Server dist exports are missing expected identifiers.");
	}

	if (typeof cliBin.CLI_DESCRIPTION !== "string") {
		throw new Error("CLI entrypoint failed to load.");
	}

	if (typeof serverEntry.SERVER_VERSION !== "string") {
		throw new Error("Server entrypoint failed to load.");
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runSmoke().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
```

- [ ] **Step 4: Add the hygiene helper**

Create `scripts/ci/hygiene.mjs`:

```js
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PACK_TARGETS = Object.freeze([
	"packages/adapters",
	"packages/cli",
	"packages/core",
	"packages/engine",
	"packages/server",
	"packages/storage",
]);

export function requiredDistFiles(packageDir) {
	switch (packageDir) {
		case "packages/cli":
			return ["dist/index.js", "dist/cli.js"];
		case "packages/server":
			return ["dist/index.js", "dist/server.js"];
		default:
			return ["dist/index.js"];
	}
}

export function assertPackInputs(root = process.cwd(), packageDirs = PACK_TARGETS) {
	const missing = packageDirs.flatMap((packageDir) =>
		requiredDistFiles(packageDir)
			.filter((relativeFile) => !existsSync(resolve(root, packageDir, relativeFile)))
			.map((relativeFile) => `${packageDir}/${relativeFile}`)
	);

	if (missing.length > 0) {
		throw new Error(`Missing package artifacts:\n${missing.map((file) => `- ${file}`).join("\n")}`);
	}
}

export function packWorkspacePackages(
	root = process.cwd(),
	packageDirs = PACK_TARGETS,
	outputDir = resolve(root, ".artifacts", "packs"),
) {
	rmSync(outputDir, { recursive: true, force: true });
	mkdirSync(outputDir, { recursive: true });

	const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

	for (const packageDir of packageDirs) {
		const result = spawnSync(pnpmCommand, ["pack", "--pack-destination", outputDir], {
			cwd: resolve(root, packageDir),
			stdio: "inherit",
			shell: false,
		});

		if (result.error) {
			throw result.error;
		}

		if (result.status !== 0) {
			throw new Error(`pnpm pack failed for ${packageDir}`);
		}
	}
}

export function runHygiene(root = process.cwd()) {
	assertPackInputs(root);
	packWorkspacePackages(root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		runHygiene();
	} catch (error) {
		console.error(error);
		process.exit(1);
	}
}
```

- [ ] **Step 5: Run the targeted tests to verify they pass**

Run:

```bash
pnpm exec vitest run tests/ci/smoke.test.ts tests/ci/hygiene.test.ts
```

Expected: PASS with 4 passing assertions.

- [ ] **Step 6: Run the helper scripts against a built workspace**

Run:

```bash
pnpm build
node scripts/ci/smoke.mjs
node scripts/ci/hygiene.mjs
```

Expected:

- `pnpm build` succeeds
- `smoke.mjs` exits 0 after importing the built CLI and server outputs
- `hygiene.mjs` exits 0 and writes `.artifacts/packs/*.tgz`

- [ ] **Step 7: Commit**

Run:

```bash
git add scripts/ci/smoke.mjs scripts/ci/hygiene.mjs tests/ci/smoke.test.ts tests/ci/hygiene.test.ts package.json
git commit -m "feat(ci): add smoke and hygiene helpers"
```

## Task 4: Supersede The Biome ADR And Update Docs

**Files:**

- Create: `docs/adr/0017-oxlint-and-dprint-toolchain.md`
- Modify: `docs/adr/0010-biome-for-linting-and-formatting.md`
- Modify: `README.md`
- Modify: `PLAN.md`
- Modify: `MILESTONES.md`

- [ ] **Step 1: Add the new ADR**

Create `docs/adr/0017-oxlint-and-dprint-toolchain.md`:

```md
# ADR-0017: Oxlint and Dprint for Linting and Formatting

## Status

Accepted

## Date

2026-04-17

## Supersedes

ADR-0010: Biome for Linting and Formatting

## Context

The project has outgrown the "single tool does everything" decision captured in ADR-0010.
We now want:

1. `oxlint` for linting
2. `dprint` for formatting
3. Linux-first CI that runs formatting, linting, type checking, tests, build, smoke, and hygiene as separate jobs

This split gives us a faster linter, a formatter that stays deterministic in CI without external plugin downloads, and a clearer separation of responsibilities.

## Decision

Use:

- `oxlint` as the only linter
- `dprint` as the only formatter
- `tsc --noEmit` as a separate type-checking lane for now

Use npm-hosted dprint plugins instead of remote plugin URLs so CI does not need to fetch formatter plugins from a second distribution channel.

Keep CI Linux-first, but restructure it into parallel jobs:

- `format`
- `lint`
- `typecheck`
- `test-core`
- `test-storage`
- `test-rest`
- `build`
- `hygiene`
- `smoke`

## Rationale

- `oxlint` is optimized for large repos and CI workloads.
- `dprint` gives us fast formatting across TypeScript, JSON, and Markdown with one config file.
- Keeping `tsc` separate avoids forcing an immediate TypeScript 7 migration just to adopt Oxlint type-aware linting.
- Repo-owned smoke and hygiene scripts are easier to test than embedding all behavior directly in YAML.

## Consequences

- Contributors use `dprint` for formatting instead of Biome.
- CI gains more breadth without keeping all checks serialized in one job.
- ADR-0010 becomes historical context, not the current standard.
- A future ADR or follow-up decision may replace `tsc --noEmit` after a TypeScript 7 migration.
```

- [ ] **Step 2: Mark ADR-0010 as superseded**

Update `docs/adr/0010-biome-for-linting-and-formatting.md` so the top of the file becomes:

```md
# ADR-0010: Biome for Linting and Formatting

## Status

Superseded by ADR-0017
```

Leave the historical context and rationale intact below that status change.

- [ ] **Step 3: Update the README toolchain and ADR table**

In `README.md`, replace the development commands block with:

````md
## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run CI test shards individually
pnpm test:core
pnpm test:storage
pnpm test:rest

# Format and lint
pnpm format
pnpm format:check
pnpm lint

# Type check
pnpm typecheck
```
````

Update the ADR table rows so they include:

```md
| [0010](./docs/adr/0010-biome-for-linting-and-formatting.md) | Biome for linting and formatting (superseded) |
| [0017](./docs/adr/0017-oxlint-and-dprint-toolchain.md) | Oxlint + dprint toolchain and parallel Linux CI |
```

- [ ] **Step 4: Update PLAN.md and MILESTONES.md**

In `PLAN.md`, replace the toolchain summary row:

```md
| **Linting** | Biome | Fast, TypeScript-native, replaces ESLint + Prettier |
```

with:

```md
| **Linting** | Oxlint | Fast Rust-native linting with TypeScript and import rules for CI-scale repos |
| **Formatting** | dprint | Deterministic multi-language formatting for TS, JSON, and Markdown via npm-hosted WASM plugins |
```

Also replace references such as:

```md
- Biome lint passes
```

with:

```md
- `pnpm format:check` passes
- `pnpm lint` passes
```

In `MILESTONES.md`, replace:

```md
- Biome lint passes
```

with:

```md
- `pnpm format:check` passes
- `pnpm lint` passes
```

- [ ] **Step 5: Verify there are no active Biome references outside ADR history**

Run:

```bash
rg -n "Biome|biome" README.md PLAN.md MILESTONES.md docs/adr
```

Expected:

- active references remain only in ADR-0010’s historical content
- current-state docs point at `oxlint` and `dprint`

- [ ] **Step 6: Commit**

Run:

```bash
git add docs/adr/0017-oxlint-and-dprint-toolchain.md docs/adr/0010-biome-for-linting-and-formatting.md README.md PLAN.md MILESTONES.md
git commit -m "docs: supersede biome ADR and document new toolchain"
```

## Task 5: Rewrite The GitHub Actions Workflow

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace the workflow with a parallel Linux-first pipeline**

Update `.github/workflows/ci.yml` to:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: "22"
  PNPM_VERSION: "9.15.4"

jobs:
  format:
    name: Format
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Check formatting
        run: pnpm format:check

  lint:
    name: Lint
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run Oxlint
        run: pnpm lint

  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run TypeScript
        run: pnpm typecheck

  test-core:
    name: Test core
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run core shard
        run: pnpm test:core
 
  test-storage:
    name: Test storage
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run storage shard
        run: pnpm test:storage

  test-rest:
    name: Test rest
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run rest shard
        run: pnpm test:rest

  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build packages
        run: pnpm build

      - name: Upload build artifacts
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: build-artifacts
          path: |
            packages/*/dist
            packages/*/package.json
          if-no-files-found: error
          retention-days: 7

  smoke:
    name: Smoke
    runs-on: ubuntu-latest
    timeout-minutes: 10
    needs: [build]
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Download build artifacts
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: build-artifacts
          path: .

      - name: Run smoke checks
        run: node scripts/ci/smoke.mjs

  hygiene:
    name: Hygiene
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5

      - name: Install pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build packages
        run: pnpm build

      - name: Run hygiene checks
        run: node scripts/ci/hygiene.mjs
```

- [ ] **Step 2: Validate the workflow locally by running every referenced command**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:core
pnpm test:storage
pnpm test:rest
pnpm build
node scripts/ci/smoke.mjs
node scripts/ci/hygiene.mjs
```

Expected: every command exits 0 and matches the new workflow exactly.

- [ ] **Step 3: Commit**

Run:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: parallelize Linux checks and add smoke coverage"
```

## Task 6: Final Validation And Cleanup

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.oxlintrc.json`
- Modify: `dprint.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `PLAN.md`
- Modify: `MILESTONES.md`
- Modify: `docs/adr/0010-biome-for-linting-and-formatting.md`
- Modify: `docs/adr/0017-oxlint-and-dprint-toolchain.md`
- Modify: `scripts/ci/*.mjs`
- Modify: `tests/ci/*.test.ts`

- [ ] **Step 1: Run the full local verification suite**

Run:

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/ci/smoke.mjs
node scripts/ci/hygiene.mjs
```

Expected:

- `dprint` rewrites the repo once, then `format:check` passes
- `oxlint` passes without Biome-specific ignore comments left behind
- `vitest` passes for both package tests and `tests/ci/*.test.ts`
- build, smoke, and hygiene all pass on the same checkout

- [ ] **Step 2: Confirm the repo is fully off Biome**

Run:

```bash
rg -n "biome" package.json pnpm-lock.yaml .oxlintrc.json dprint.json .github/workflows README.md PLAN.md MILESTONES.md docs/adr packages scripts tests
```

Expected:

- no matches in active tooling, scripts, CI, or current-state docs
- remaining matches are acceptable historical references inside ADR-0010 only

- [ ] **Step 3: Confirm the new CI wall-clock shape is visible in the workflow graph**

Push the branch and inspect the workflow graph in GitHub Actions.

Expected:

- separate jobs for `format`, `lint`, `typecheck`, `test-core`, `test-storage`, `test-rest`, `build`, `smoke`, and `hygiene`
- `smoke` waits only on `build`
- the test jobs no longer wait on formatting or typecheck

- [ ] **Step 4: Commit the final polish**

Run:

```bash
git add package.json pnpm-lock.yaml .oxlintrc.json dprint.json .github/workflows/ci.yml README.md PLAN.md MILESTONES.md docs/adr/0010-biome-for-linting-and-formatting.md docs/adr/0017-oxlint-and-dprint-toolchain.md scripts/ci tests/ci
git commit -m "chore: finish oxlint and CI modernization"
```
