# Plan 02 — Relicense to `BSD-2-Clause-Patent`

**Priority:** P0-11. Blocks the publish pipeline (plan 13).
**Size:** Small.
**Dependencies:** None.

## Why

Decision locked in `00-mvp-release.md`: the explicit patent grant in
`BSD-2-Clause-Patent` (also known as the OpenSSL/OpenID-Patent variant)
matters for AI-agent tooling, which sits in a patent-minefield. It's
GPL-compatible and explicitly grants patent rights, which Apache-2.0 also
does but with more ceremony. Simpler text, same protection class.

## Deliverables

1. **Root `LICENSE`**
   - [ ] Replace Apache-2.0 text with the SPDX-identifier-matching
     BSD-2-Clause-Patent text. Copyright line: `Copyright (c) 2026, Qkal
     and contributors`.
2. **`package.json` files (all six)**
   - [ ] `"license": "BSD-2-Clause-Patent"` in root `package.json`.
   - [ ] Same in `packages/{core,engine,storage,adapters,server,cli}/package.json`.
3. **README**
   - [ ] Update the `## License` section to `BSD-2-Clause-Patent` with a
     one-sentence explanation and a link to the SPDX text.
4. **ADR**
   - [ ] New ADR: `docs/adr/0018-license-bsd-2-clause-patent.md`.
     Content: why the explicit patent grant, why BSD-2 over Apache-2.0
     for brevity, compatibility notes (GPL-compatible, MIT-compatible
     for downstream users).
5. **SPDX headers (optional, not required)**
   - If we want SPDX headers in source, land them here as
     `// SPDX-License-Identifier: BSD-2-Clause-Patent`. Default: skip,
     document the top-level license only.
6. **CI license-compat check**
   - [ ] New `license-check` job in `.github/workflows/ci.yml` using
     `license-checker-rseidelsohn` (or `pnpm licenses list` + a script)
     that fails if any transitive production dep carries a license not
     in the allowlist.
   - Allowlist (initial): `BSD-2-Clause`, `BSD-2-Clause-Patent`,
     `BSD-3-Clause`, `ISC`, `MIT`, `MIT-0`, `Apache-2.0`, `0BSD`,
     `BlueOak-1.0.0`, `CC0-1.0`, `Unlicense`, `Python-2.0`.
   - Denylist (explicit, just to make it obvious): `AGPL-*`, `SSPL-*`,
     `GPL-2.0-only`, `GPL-3.0-only` in prod deps (dev deps ok).

## Acceptance criteria

- `LICENSE` at repo root is the SPDX-canonical BSD-2-Clause-Patent text.
- `grep -r 'Apache-2.0' packages/ | grep -v '^Binary'` returns no
  matches.
- CI `license-check` job is green on `main`.
- GitHub's license detection sidebar on the repo homepage picks up
  `BSD-2-Clause-Patent` (may take a few minutes after merge).
- `npm show aegisctx license` (after publish) reports
  `BSD-2-Clause-Patent`.

## Test strategy

- A small Node script (`scripts/ci/license-check.mjs`) that calls
  `pnpm licenses list --json --prod`, filters to the allowlist, and
  exits non-zero on a violation. Snapshot test over a fixture.

## Out of scope

- Retroactive re-licensing of dependencies (we can't; we just avoid
  incompatible ones in prod deps).
- GPL-style copyleft. BSD-2-Clause-Patent is permissive.

## Risks

- **Dual-licensing downstream deps** — some deps declare
  `(MIT OR Apache-2.0)` which is fine. The allowlist check must handle
  SPDX expressions, not just single identifiers. Mitigation: use
  `spdx-expression-parse` to normalize before checking.
- **ADR-0009 (zero-telemetry) drift** — does not reference license;
  safe.

## Follow-ups

- Plan 13 (publish pipeline) will include a `--provenance` attestation
  that also records the license metadata.
