# ADR-020 - Runtime and package manager foundation

**Status:** ACCEPTED  
**Date:** 2026-08-30

## Context

Phase 0 requires a reproducible monorepo baseline before auth, tenancy, Tournament migration and Club work begin.

## Decision

- Node.js is pinned to `22.16.0` for the first cloud foundation.
- pnpm is the workspace package manager, pinned to `11.24.0` through `packageManager` and Corepack.
- Exact direct dependency versions are used in package manifests.
- A generated `pnpm-lock.yaml` becomes mandatory before the repository is promoted from bootstrap to shared CI/staging use.

## Consequences

- Developers use one runtime/package-manager combination.
- Workspace boundaries remain explicit.
- The first networked install must generate and commit the lockfile before `--frozen-lockfile` is enabled in CI.
