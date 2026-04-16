# ADR-0010: Biome for Linting and Formatting

## Status

Superseded by ADR-0017

## Date

2025-01-15

## Context

The project needs a linter and formatter. Common options:

1. **ESLint + Prettier** — Industry standard, massive plugin ecosystem, slower
2. **Biome** — Fast, TypeScript-native, single tool replaces both ESLint and Prettier
3. **oxlint** — Very fast linter, but no formatter

## Decision

Use **Biome** as the single linting and formatting tool.

Key configuration:

- `noExplicitAny: "error"` — enforces the zero-`any` rule in core packages
- Tabs for indentation (Biome default, accessible)
- Double quotes, semicolons
- Organize imports automatically

## Rationale

- **Speed**: Biome is 10-100x faster than ESLint + Prettier. Linting the entire monorepo completes in <1 second.
- **Single tool**: One configuration file (`biome.json`) replaces `.eslintrc`, `.prettierrc`, and their respective ignore files.
- **TypeScript-native**: Biome understands TypeScript natively. No `@typescript-eslint` parser configuration.
- **`noExplicitAny` enforcement**: Critical for Aegis's type safety goals (Rule R11). Biome enforces this as an error, not a warning.
- **Zero dependencies**: Biome is a single binary. No transitive dependency tree.

## Consequences

- Biome's rule set is smaller than ESLint's plugin ecosystem. Some niche rules may not be available.
- Contributors must use Biome, not Prettier, for formatting. Editor integrations are available for VS Code, JetBrains, and Neovim.
- Biome is newer than ESLint. There is some risk of API instability, though the project is mature enough for production use.
