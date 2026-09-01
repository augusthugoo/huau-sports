# Phase 1 Status — IMPLEMENTED / PENDING STAGING VALIDATION

## Scope implemented
- Better Auth email/password integration using D1 + Drizzle adapter.
- Global HUAU session and user profile extension.
- Organization root tenant model.
- Organization people abstraction.
- Membership request -> approve/reject flow.
- Organization membership creation on approval.
- Organization capabilities with `org_admin`.
- Platform Admin table + bootstrap email allowlist.
- Module entitlements for Club / Tournament / Ref.
- Tenant authorization primitives and isolation tests.
- Explicit Platform Admin support context behavior (no silent tenant access).
- Public organization route.
- My HUAU shell.
- Organization Admin shell.
- Platform Admin shell.
- ES/EN translation dictionaries and CI parity check.
- Phase 1 D1 migration.

## Remaining validation gate
1. Install/update dependency lockfile.
2. Configure `BETTER_AUTH_SECRET` in Cloudflare staging.
3. Configure initial `PLATFORM_ADMIN_EMAILS` bootstrap email.
4. Apply migration `0001_phase1_identity_orgs.sql` to `huau-staging`.
5. Deploy staging.
6. Verify sign-up/sign-in/sign-out.
7. Create a test organization as Platform Admin.
8. Register a second test user and request membership.
9. Approve request from Organization Admin.
10. Verify the second user receives active membership.
11. Verify tenant isolation with tests/HTTP checks.

## Note on password recovery
The route and UX surface are reserved in Phase 1, but transactional email delivery is intentionally not enabled until the email provider block is configured. Password reset must not be presented as operational until a verified sender and `sendResetPassword` callback are enabled.
