# HUAU Sports

Cloud foundation for HUAU Sports: Club + Tournament + Ref.

## Status
Phase 0 bootstrap is **READY FOR PROVISIONING**. See `docs/phase-0/PHASE_0_STATUS.md`.

## Local setup

```bash
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install
pnpm db:migrate:local
pnpm dev
```

Open the local URL printed by Vite. `/api/health` should report the Worker environment; `/api/db-health` reports D1 migration status.

## Source of truth
The frozen product/architecture baseline lives under `docs/foundation`. Changes to product behavior, persistence, architecture or UX must follow the hierarchy in `docs/foundation/00_README_SOURCE_OF_TRUTH.md`.

## Cloudflare
See `docs/phase-0/CLOUDFLARE_PROVISIONING.md` for D1/R2/staging provisioning.
