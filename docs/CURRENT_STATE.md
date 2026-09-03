# HUAU Sports — Current State

Updated: 2026-09-03

## Current phase

Phase 7 — Tournament Payments (manual-payment acceptance closed; Mercado Pago deferred)

Version: `0.8.0-phase7-payments`

Validation branch: `phase-7`

## Accepted foundation

- Phase 0 — Foundation: complete.
- Phase 1 — Account/Auth: complete.
- Phase 2 — Organizations: complete.
- Phase 3 — Tournament Core/Migration: complete.
- Phase 4 — Tournament legacy parity: complete.
- Phase 5 — Team Competition Engine: complete.
- Phase 6 — Online Registration: complete, QA accepted and merged to `main`.

Phase 6 established the personal-registration-first model, multi-category basket, doubles matching, Team free/captain flows, team pricing, capacity/waitlist, admin registration operations, cancellation history and reversible courtesy adjustments.

## Phase 7 scope

Phase 7 is delivered as one integrated 7A–7D validation package:

### 7A — Payment Core

- financial state separated from participation state;
- one payment order can cover multiple category registrations;
- online users and manually-entered tournament players are both supported;
- bank transfer and cash manual-payment flows;
- tournament-level payment settings and recipient configuration;
- Payments admin workspace with expected/paid/pending/review/refunded KPIs.

### 7B — Transfer proofs

- private R2 upload for JPG/PNG/WEBP/PDF proofs;
- upload by player or admin;
- approve/reject/resubmit flow;
- financial audit events;
- no public proof URL.

### 7C — Mercado Pago

- OAuth Authorization Code + PKCE connection per organizer Organization;
- encrypted access/refresh tokens;
- tournament chooses the connected payment receiver;
- Orders API checkout with idempotency;
- signed webhook + server-side order lookup before approval;
- active checkout reuse to prevent duplicate payable orders;
- explicit external checkout cancellation before switching methods.

### 7D — Cancellation/refunds/hardening

- paid online registration creates a cancellation request rather than destructive immediate cancellation;
- policies: manual / no refund / full before deadline;
- manual refund ledger with pending/completed state;
- reversible manually-approved transfer/cash payments;
- manual player deletion is blocked once meaningful financial history exists.

## Database state

Before Phase 7 migration:

- `huau-dev` is through `0007_phase6_registration_redesign.sql`.
- `huau-staging` remains untouched for Phase 7.

Phase 7 adds only:

- `0008_phase7_payments.sql`
- schema marker: `phase7-payments`.

Because the historical Wrangler migration ledger is incomplete/empty, remote environments must not use a blanket `wrangler d1 migrations apply`. Back up the database and apply only the intended migration file.

## Preview acceptance completed

Validated interactively in the Phase 7 preview:

- manual player -> expected balance and correct per-player amount;
- bank transfer -> proof upload -> review -> open proof -> approve;
- rejected proof returns the player to a payable state and allows resubmission;
- cash -> mark paid -> reverse manual collection;
- paid registration -> cancellation request -> admin review -> manual refund;
- financial history survives competitive-player removal;
- closeout adds compact payment UI, explicit 8 MB proof limit, cancel-all-per-tournament, and clearer competitive-profile removal wording.

Mercado Pago code remains present but its credentials, OAuth connection and sandbox end-to-end acceptance are deferred. It must stay disabled until that QA is performed. This does not block moving product development to Phase 8 for the first tournament scope.

## Validation completed before packaging

- TypeScript semantic checks: core, DB, web app, web node and worker: green.
- static D1 SQL placeholder/bind scan across worker source: green.
- clean SQLite migration chain `0000` through `0008`: green.
- `PRAGMA foreign_key_check`: green.
- Phase 7 payment-domain smoke checks: green.

The user's real repository remains the definitive gate with `pnpm typecheck && pnpm lint && pnpm test` before remote migration.

## First real tournament path

The first event can run without Mercado Pago:

1. organizer/admin enters players manually;
2. assigns their categories;
3. Payments synchronizes one outstanding order per player;
4. all payments use bank transfer;
5. proof can be uploaded by admin if received externally;
6. admin approves/rejects proof and HUAU maintains the financial ledger.

Mercado Pago can remain disabled until the Cloudflare secrets and receiver account are configured. No Phase 7 schema change is required to turn it on later.

## Next after Phase 7 acceptance

Phase 8 — Explanation Engine / ES-EN.

Then Phase 9 — public HUAU Live / TV, followed by Phase 10 — PWA/offline/sync.
