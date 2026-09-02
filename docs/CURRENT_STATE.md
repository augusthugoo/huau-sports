# HUAU Sports — Current State

Updated: 2026-09-02

## Current phase

Phase 6 — Online Registration

Version: `0.7.0-phase6-online-registration`

Expected branch during validation: `phase-6`

## Completed before Phase 6

- Phase 0–3 platform, identity/org and Tournament persistence foundations.
- Phase 4 Tournament legacy parity and performance recovery.
- Phase 5 Team Competition Engine + Team Tournament integration.
- Standard and Team Tournament flows are considered operationally approved; fine-grained large-dataset QA remains a later hardening task.

## Phase 6 implementation status

Implementation package prepared for user gates and preview QA.

Included:
- public Tournament registration route;
- singles direct registration;
- pair invitations and acceptance/decline;
- Team captain/roster invitations and Team Engine readiness validation;
- user profile birth date + sport gender eligibility;
- explicit category min/max age;
- capacity + waitlist + admin promotion;
- free/per-entry/per-person pricing boundary;
- `awaiting_payment` state for Phase 7 without fake payment confirmation;
- admin courtesy/discount/fixed-total adjustments;
- `Mis inscripciones`;
- Tournament admin `Inscripciones` workspace;
- Phase 6 snapshot/restore persistence;
- migration `0005_phase6_online_registration.sql`.

## Database state before user applies Phase 6

- `huau-dev`: Phase 5 schema expected; apply `0005` only after project gates pass.
- `huau-staging`: Phase 5 schema expected; do not apply `0005` until Phase 6 preview acceptance passes.

## Immediate next actions

1. Apply the Phase 6 ZIP to branch `phase-6`.
2. Run `pnpm typecheck && pnpm lint && pnpm test`.
3. If green, apply `0005_phase6_online_registration.sql` to `huau-dev`.
4. Verify `schema_version = phase6-online-registration` and Phase 6 tables.
5. Push `phase-6` and test Cloudflare preview with three HUAU accounts: singles, pair invitation, Team roster.
6. Test waitlist/promotion and paid category `awaiting_payment` boundary.
7. Only after preview acceptance, apply `0005` to `huau-staging`, merge `phase-6` to `main`, and mark Phase 6 closed.

## Next planned phase

Phase 7 — Payments / Mercado Pago + payments admin.

Do not begin Phase 7 until Phase 6 is committed, preview-approved, staging-migrated and merged to `main`.

## Phase 6 preview QA continuity — 2026-09-02

Second QA hardening batch prepared after live preview testing:

- persistent pair/team entry management in `Mis inscripciones`;
- accepted invitees keep seeing the shared registration;
- paid pair/team entries remain `awaiting_payment` until the payment phase confirms them;
- organizer and player invitation management after initial entry creation;
- tournament-wide `max_categories_per_player`;
- Mi HUAU organization-card overflow fix;
- migration `0006_phase6_registration_continuity.sql`.

Next gate: local typecheck/lint/tests -> apply only `0006` to `huau-dev` -> Cloudflare `phase-6` preview -> focused QA. Staging remains untouched until preview acceptance.
