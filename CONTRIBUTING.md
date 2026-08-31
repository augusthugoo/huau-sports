# Contributing to HUAU Sports

## Branching

- `main`: production-ready baseline only.
- `feature/*`: scoped development.
- `release/sept-2026`: only if event stabilization requires it.

## Commits

Use Conventional Commit-style prefixes where practical: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.

## Before merge

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and the relevant Playwright smoke tests.

Architectural or scope changes must update the applicable foundation docs/ADR rather than living only in code.
