# Plan 16 — Release documentation

**Priority:** P0-8.
**Size:** Medium.
**Dependencies:** Plans 01, 02, 08–11, 15 (references need to exist).

## Why

Public MVP requires docs users can actually follow. Minimum: per-
platform getting-started, security posture, policy reference, Windows
notes, and the usual repo-hygiene docs (SECURITY.md, CONTRIBUTING.md,
CODE_OF_CONDUCT.md).

## Structure

```
docs/
├── getting-started/
│   ├── claude-code.md
│   ├── codex-cli.md
│   ├── codex-gui.md
│   └── opencode.md
├── security.md
├── policy.md
├── windows.md
├── releasing.md            # maintainer-only (plan 13)
├── adr/...                 # existing
└── plans/...               # existing
SECURITY.md                 # disclosure address only (links to docs/security.md)
CONTRIBUTING.md
CODE_OF_CONDUCT.md
CHANGELOG.md                # auto-generated (plan 13)
README.md                   # refreshed
```

## Per-platform getting-started template

Each `docs/getting-started/<platform>.md` follows the same structure:

1. **Prerequisites** — OS, Node version, the platform itself installed.
2. **Install** — `npm install -g aegisctx`.
3. **Init** — `aegisctx init <platform>` with `--dry-run` first,
   showing sample output.
4. **First tool call** — "open <platform>, say `run
   console.log("hi")` and watch Aegis intercept." Expected output.
5. **Capability tier for this platform** — link back to
   `docs/plans/11-tier-aware-capabilities.md` explanation.
6. **Troubleshooting** — five most-likely failure modes with the
   relevant `aegisctx doctor` check id, per-OS variants.
7. **Next steps** — policy reference, security model, updating.

## `docs/security.md`

- Threat model summary (references `PLAN.md §6`).
- Level 1 sandbox: what it protects against (accidental leakage,
  casual attackers) and what it does not (determined malicious code).
- Level 3 sandbox deferred to Phase 5.
- Audit log: HMAC chain, key management, how to verify.
- Network posture: default-deny, `aegisctx_fetch` the only explicit
  egress, `AEGISCTX_NO_NETWORK=1` kill-switch.
- Supply chain: no lifecycle scripts, provenance, SBOM, BSD-2-Clause-
  Patent license with explicit patent grant.
- Disclosure: contact email + PGP key + SLA.

## `docs/policy.md`

- Syntax reference with every key explained.
- Scope precedence (project → user → global).
- Worked examples:
  1. Default deny set.
  2. Allowing a specific command family (`git:*`, `pnpm:*`).
  3. Reading an env var into a tool call.
  4. `ask` mode (when shipped in Phase 1.5).
- Anti-patterns — what not to do (wildcarding `*` in env allow, etc.).

## `docs/windows.md`

- `py` launcher, PowerShell execution policy, WSL interop.
- ACL model for `audit-key`; how to verify with `icacls`.
- Git Bash vs WSL vs PowerShell for `language: "shell"`.
- Known-issue list.

## README refresh

Update `README.md` with:

- New name everywhere (`aegisctx`).
- New license callout (`BSD-2-Clause-Patent`).
- Platform × OS × tier matrix.
- Link to each getting-started guide.
- `AEGISCTX_NO_NETWORK=1` mentioned under "Offline mode."

## Deliverables

1. **`docs/getting-started/`** — four files.
2. **`docs/security.md`**, **`docs/policy.md`**, **`docs/windows.md`**.
3. **`SECURITY.md`** (top-level disclosure redirect).
4. **`CONTRIBUTING.md`** — setup, branching, PR flow, changeset
   requirement.
5. **`CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1.
6. **`.github/ISSUE_TEMPLATE/`** — bug report + feature request +
   security (pointing to `SECURITY.md`).
7. **`.github/PULL_REQUEST_TEMPLATE.md`** — changeset checklist, linked
   plan file.
8. **README refresh.**

## Acceptance criteria

- Every `docs/getting-started/<platform>.md` has been followed verbatim
  by a second engineer on a clean Windows, macOS, and Linux VM, and
  each walkthrough completed successfully.
- `docs/security.md` doesn't overclaim (matches what the code
  actually does).
- `aegisctx doctor` check IDs referenced in troubleshooting match the
  IDs emitted by the implementation (plan 15).

## Test strategy

- Lint markdown with `markdownlint-cli2` in CI.
- Link-check with `lychee` in CI; fail on 404s.
- Snapshot-style test: grep the rendered README for "aegis " (with
  trailing space) and fail if found — that catches missed renames.

## Out of scope

- A full documentation site (VitePress / Docusaurus) — MVP ships
  Markdown in-tree only.
- Translations.

## Risks

- **Screenshots in getting-started docs go stale.** Mitigation: avoid
  screenshots in the first pass; use terminal transcripts which are
  easier to regenerate.
