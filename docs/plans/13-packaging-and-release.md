# Plan 13 — Packaging and release pipeline

**Priority:** P0-4. The release itself.
**Size:** Medium.
**Dependencies:** Plans 01, 02, 03 (name, license, milestones). Plans
08–11 (adapters + capabilities).

## Why

At MVP we ship `aegisctx@0.1.0` + `@aegisctx/*@0.1.0` on npm with
provenance attestations and an SBOM. Zero lifecycle scripts. Only
`dist/`, `LICENSE`, `README.md` ship.

## Design

### Published packages

| Package                     | Why ship                    | Contents                                  |
| --------------------------- | --------------------------- | ----------------------------------------- |
| `aegisctx`                  | User install target         | CLI bin + runtime deps on scoped packages |
| `@aegisctx/core`            | Reusable pure logic         | `dist/index.js` + types                   |
| `@aegisctx/engine`          | Reusable sandbox primitives | ditto                                     |
| `@aegisctx/storage`         | Reusable SQLite layer       | ditto                                     |
| `@aegisctx/adapters`        | Platform abstractions       | ditto                                     |
| `@aegisctx/server`          | MCP server core             | ditto                                     |
| `@aegisctx/opencode-plugin` | OpenCode plugin entrypoint  | ditto                                     |

### Versioning

- `changesets` for per-package version bumps + changelog generation.
- Initial MVP: `0.1.0` for all seven; after release we follow semver.
- PRs that change user-facing behavior include a `.changeset/*.md`
  file — enforced by a CI check.

### Release workflow

`.github/workflows/release.yml`:

1. Triggered on push of a `v*` tag.
2. Job `build`:
   - checkout, setup-node + pnpm, `pnpm install --frozen-lockfile`.
   - `pnpm -r build`.
   - `pnpm -r test`.
   - generate SBOM with `@cyclonedx/cyclonedx-npm`.
3. Job `publish` (needs `build`):
   - npm auth via GitHub OIDC (`id-token: write`).
   - `pnpm publish --recursive --access public --provenance`.
4. Job `github-release`:
   - Create GitHub release with:
     - changelog (from changesets).
     - SBOM attached.
     - signed SHA256SUMS of the published tarballs.

### Lifecycle-script ban

CI guard `scripts/ci/no-lifecycle-scripts.mjs` walks every
`package.json` and fails if any has `scripts.preinstall`,
`scripts.install`, `scripts.postinstall`, `scripts.prepare` _for the
published packages_ (dev deps and the root `package.json` `prepare`
used for husky-equivalent setup can be allowlisted).

### `npm pack` hygiene

For each published package, CI runs `npm pack --dry-run --json` and:

- asserts the `files` list contains only `LICENSE`, `README.md`,
  `dist/**`, `package.json`.
- asserts no `src/`, no fixtures, no tests.

## Deliverables

1. **Changesets**
   - [ ] `.changeset/config.json`: `access: public`, ignore root
         package, `privatePackages: { version: false, tag: false }`.
   - [ ] `pnpm add -D -w @changesets/cli` and run `pnpm changeset init`.
   - [ ] CI check: require a changeset on any PR touching `packages/**`
         unless labeled `no-changeset`.
2. **Release workflow**
   - [ ] `.github/workflows/release.yml` per the design.
   - [ ] `.github/workflows/release-rc.yml` for `v*-rc.*` tags that
         publish under the `next` dist-tag.
3. **Hygiene checks**
   - [ ] `scripts/ci/no-lifecycle-scripts.mjs`.
   - [ ] `scripts/ci/pack-check.mjs`.
   - [ ] `scripts/ci/zero-deps-core.mjs` (verifies
         `@aegisctx/core` has no runtime deps).
4. **Docs**
   - [ ] `CHANGELOG.md` auto-generated at the root.
   - [ ] `docs/releasing.md` — how to cut a release (maintainer
         playbook).
5. **SBOM**
   - [ ] `@cyclonedx/cyclonedx-npm` added as a dev dep; invoked in the
         release workflow.

## Acceptance criteria

- A `v0.1.0-rc.1` tag on a branch publishes all seven packages to npm
  under the `next` dist-tag with provenance, and the release URL
  appears on the PR.
- `npm view aegisctx@0.1.0-rc.1 --json` reports `license:
  BSD-2-Clause-Patent`, no `scripts.install*`, and a files list
  limited to `LICENSE`, `README.md`, `dist`, `package.json`.
- CI lifecycle-script guard blocks a PR that adds a `postinstall`
  script (verified by a deliberately-failing canary branch).
- CI pack-check blocks a PR that widens the `files` list (same).

## Test strategy

- Dry-run publish in CI on every PR (`pnpm publish --dry-run
  --recursive`).
- `release-rc.yml` publishes an RC on tag; we gate the real `v*`
  release behind one RC passing the full smoke matrix on all three
  OSes.

## Out of scope

- Chocolatey/Homebrew distribution (post-MVP).
- Docker image (post-MVP; our install target is npm).

## Risks

- **npm OIDC auth.** Requires the npm org-owner to link GitHub.
  Mitigation: walkthrough in `docs/releasing.md`; fall back to a
  classic automation token stored as an Actions secret if OIDC is
  unavailable.
- **Provenance on the scoped packages.** `npm publish --provenance`
  requires OIDC + public repo + GitHub-hosted runner. All three are
  met. Still, the flag is silently ignored on older npm CLIs —
  hard-fail CI on `npm --version` < `10.1.0`.
