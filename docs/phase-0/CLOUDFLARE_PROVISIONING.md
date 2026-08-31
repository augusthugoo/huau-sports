# Cloudflare provisioning runbook - Phase 0

Run from the repository root after installing dependencies and authenticating Wrangler.

```bash
corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install

pnpm --filter @huau/web exec wrangler login

pnpm --filter @huau/web exec wrangler d1 create huau-dev
pnpm --filter @huau/web exec wrangler d1 create huau-staging

pnpm --filter @huau/web exec wrangler r2 bucket create huau-dev-assets
pnpm --filter @huau/web exec wrangler r2 bucket create huau-staging-assets
```

Copy the two D1 IDs returned by Wrangler into `apps/web/wrangler.jsonc`, replacing the `REPLACE_WITH_*_D1_ID` placeholders.

Then:

```bash
pnpm db:migrate:local
pnpm db:migrate:staging
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @huau/web deploy:staging
```

After the first successful install, commit `pnpm-lock.yaml` and change the CI install step from `--no-frozen-lockfile` to `--frozen-lockfile`.
