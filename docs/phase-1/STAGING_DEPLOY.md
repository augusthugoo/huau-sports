# Phase 1 — Staging Deploy

## 1. Dependency lockfile
After replacing the repo with this Phase 1 package, use Node 22.16.0 and run:

```bash
nvm use 22.16.0
pnpm install --ignore-scripts
```

This updates `pnpm-lock.yaml` without trying to execute modern esbuild/workerd binaries on macOS Catalina. Cloudflare will execute the required build scripts in Linux during the remote build.

## 2. Bootstrap Platform Admin
Edit `apps/web/wrangler.jsonc` and set the staging `PLATFORM_ADMIN_EMAILS` value to the email that will own the first HUAU Platform Admin account.

This allowlist is only bootstrap/operations configuration. Platform admins can also live in `platform_admins`; there is no self-promotion endpoint.

## 3. Better Auth secret
Generate a strong random secret (32+ bytes) and set it as a Cloudflare Worker secret for staging under the binding name:

```text
BETTER_AUTH_SECRET
```

Never commit the secret to Git.

## 4. D1 migration
Apply `packages/db/drizzle/0001_phase1_identity_orgs.sql` to `huau-staging` using the Cloudflare D1 console or Wrangler from a supported environment.

Expected `app_meta.schema_version`: `phase1`.

## 5. Deploy
Cloudflare build settings remain:

```text
Root directory: /apps/web
Build: CLOUDFLARE_ENV=staging pnpm run build
Deploy: pnpm exec wrangler deploy --env staging
Version: pnpm exec wrangler versions upload --env staging
```

## 6. Validation
- `/api/health` returns `0.2.0-phase1` / staging.
- `/api/db-health` returns schema_version `phase1`.
- Sign up a Platform Admin account with the allowlisted email.
- Create an organization.
- Sign up another account.
- Request organization access.
- Approve from Organization Admin.
- Second account sees the organization in My HUAU.
