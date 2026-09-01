# HUAU Sports

Cloud-first foundation for the HUAU Sports ecosystem: Club + Tournament + Ref.

## Current status

- Phase 0 Foundation: **DONE**.
- Phase 1 Identity, Organizations & Platform Shell: **DONE and validated on staging**.
- Phase 2 Tournament Engine: **DONE and regression-tested**.
- Phase 3 Tournament Persistence & Legacy Import: **DONE and validated on staging**.
- Phase 4 / 4.1 Tournament Admin + Full Legacy Parity: **IMPLEMENTED — branch validation required before merge**.

The functional baseline for Tournament parity is **HUAU Tournament V2.4.2**. See:

- `docs/phase-4.1/PARITY_MATRIX.md`
- `docs/phase-4.1/FULL_LEGACY_PARITY_PACK.md`

## Local environment

Pinned runtime:
- Node 22.16.x
- pnpm 11.24.x

The development Mac may not execute modern esbuild/workerd binaries reliably because of its macOS version. Canonical deploy builds run in GitHub/Cloudflare Linux environments.

## Source of truth

Product, architecture, UX and migration baselines live under `docs/foundation`.
