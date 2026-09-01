# HUAU Sports

Cloud-first foundation for the HUAU Sports ecosystem: Club + Tournament + Ref.

## Current status

- Phase 0 Foundation: **DONE**.
- Phase 1 Identity, Organizations & Platform Shell: **DONE and validated on staging**.
- Phase 2 Tournament Engine: **DONE, regression-tested and merged to main**.
- Phase 3 Tournament Persistence & Migration: **IN PROGRESS — persistence schema + legacy import/export layer implemented**.

See `docs/phase-3/PHASE_3_STATUS.md`.

## Local environment

Pinned runtime:
- Node 22.16.x
- pnpm 11.24.x

The current development Mac may not execute modern esbuild/workerd binaries because of its macOS version. Canonical builds and deploys therefore run in GitHub/Cloudflare Linux environments.

## Source of truth

Product, architecture, UX and migration baselines live under `docs/foundation`.
