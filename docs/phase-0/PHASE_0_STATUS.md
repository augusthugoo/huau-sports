# Phase 0 - Governance & Repository Foundation

**Build:** `0.1.0-phase0`  
**Prepared:** 2026-08-30

## Completed in this bootstrap

- New monorepo structure created.
- Foundation documents copied to `/docs/foundation`.
- ADR directory created; runtime/package-manager and Cloudflare app-shape decisions recorded.
- Node pinned to `22.16.0`.
- pnpm pinned to `11.24.0`.
- React + TypeScript + Vite + official Cloudflare Vite plugin scaffolded.
- TypeScript strict baseline configured.
- ESLint + Prettier configuration added.
- Vitest unit smoke added.
- Playwright desktop/mobile smoke configuration added.
- GitHub Actions CI workflow added.
- D1/R2 bindings and dev/staging environment structure added.
- Initial Drizzle schema + SQL migration added.
- `.env.example` added; no secrets included.
- Basic Worker `/api/health` and `/api/db-health` endpoints scaffolded.
- HUAU Phase 0 shell added as a non-final visual smoke surface.

## External steps still required to close the Phase 0 exit gate

These cannot be truthfully completed without network access and the HUAU Cloudflare/GitHub accounts:

1. Run first `pnpm install` and commit the generated `pnpm-lock.yaml`.
2. Switch CI install to `pnpm install --frozen-lockfile` after the lock is committed.
3. Authenticate Wrangler with the target Cloudflare account.
4. Create `huau-dev` and `huau-staging` D1 databases and replace placeholder IDs.
5. Create `huau-dev-assets` and `huau-staging-assets` R2 buckets.
6. Apply migrations to dev/staging.
7. Deploy staging and record the URL.
8. Connect a GitHub repository and verify CI runs on a clean clone.

## Exit-gate rule
Do not label Phase 0 fully **DONE** until all eight external items above are verified. Local scaffold status is **READY FOR PROVISIONING**.
