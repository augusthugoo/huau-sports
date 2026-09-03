# HUAU Sports — Phase 7 Payments (7A–7D)

Updated: 2026-09-03

## Goal

Phase 7 makes tournament payment state independent from participation state and supports the complete V1 tournament payment surface:

- bank transfer;
- private proof upload and admin review;
- cash;
- Mercado Pago connected to the payment recipient selected for the tournament;
- free/courtesy adjustments inherited from Phase 6;
- cancellation requests for registrations that already have money attached;
- manual refund tracking and financial audit history.

A payment order may cover several category registrations for the same payer. Manual tournament players also receive payment orders, so the first real tournament can be operated entirely through manual player entry + bank transfer without requiring every participant to have a HUAU account.

## 7A — Payment Core + manual payments

### Financial model

`payment_orders` is the financial aggregate. `payment_order_items` links the amount to online registrations or manually-entered player/category assignments.

Participation and payment state are deliberately separate. A registration can therefore be cancelled while its payment remains paid/refund-pending, rather than destroying financial history.

Supported payment-order states:

- `draft`
- `awaiting_payment`
- `pending_review`
- `paid`
- `cancelled`
- `partially_refunded`
- `refunded`

Supported methods:

- `bank_transfer`
- `cash`
- `mercado_pago`

The Payments workspace is the source of truth for the old manual player `payment_status` field. Manual player rows mirror the resulting paid/pending state for compatibility, but payment operations are performed in Payments.

### Manual players

When the organizer adds players and assigns categories manually, `Sincronizar cobros` creates or updates one outstanding payment order per player. If a manual profile is linked to a HUAU user that already owns the same online registration, Phase 7 avoids charging the same category twice.

Deleting a manual player with real financial activity is blocked with `PLAYER_HAS_PAYMENT_HISTORY`. An unpaid auto-created order with no meaningful payment activity can be cleaned up as part of player deletion.

## 7B — Transfer proofs

Transfer proof files are stored privately in the tournament R2 bucket.

Accepted formats:

- JPEG
- PNG
- WEBP
- PDF

Maximum file size: 8 MiB.

The player can upload a proof from `Mis pagos`. Administration can also upload a proof received externally, which is important for manual-player tournaments.

A proof creates a submitted transfer attempt and moves the order to `pending_review`. Administration can approve or reject it. Rejection returns the order to `awaiting_payment` and allows a new proof.

Proofs are served only through an authenticated/authorized API response with private/no-store headers; there is no public R2 URL.

## 7C — Mercado Pago

### Connection model

Mercado Pago accounts belong to the organizer Organization and are connected using OAuth Authorization Code + PKCE. Access and refresh tokens are encrypted at rest with AES-GCM using `PAYMENT_ENCRYPTION_KEY`.

A tournament selects one connected Mercado Pago account as its receiver. HUAU does not act as a wallet or intermediary.

### Checkout

HUAU creates an Orders API checkout using:

- `POST /v1/orders`
- `type: online`
- `processing_mode: manual`
- an idempotency key;
- HUAU payment order ID as `external_reference`;
- server-owned amount and item breakdown.

Returning from the browser never marks a payment as approved.

The webhook is signature-verified, then HUAU retrieves the Mercado Pago order server-side and validates:

- external reference;
- expected amount;
- recipient account;
- provider payment status.

Only then can the HUAU order become `paid`.

### Duplicate protection

An active Mercado Pago checkout is reused rather than creating another external order. The payer must explicitly cancel the active checkout before switching to bank transfer or cash. Cancellation uses the Mercado Pago order cancellation endpoint with its own idempotency key. This prevents abandoned screens from silently creating multiple payable orders.

## 7D — Cancellation + refunds + hardening

An unpaid online registration can still cancel immediately.

A registration with net paid money creates a `registration_cancellation_request` instead. The organizer reviews it before participation is cancelled.

Refund policies:

- `manual`: admin chooses a refund from zero up to the net paid amount;
- `none`: cancellation may be approved but refund must be zero;
- `full_before_deadline`: before the configured deadline the refund must be the full net paid amount; after the deadline it must be zero.

Refunds remain manual in V1. HUAU records pending/completed refund state, method, amount, reference and audit events; it does not automatically send money back from Mercado Pago.

Manual transfer/cash approvals can be reversed when recorded by mistake. Historical financial activity is never silently erased.

## Database

Migration: `packages/db/drizzle/0008_phase7_payments.sql`

Adds:

- `paid_amount_minor` and `refunded_amount_minor` to `tournament_registrations`;
- `payment_accounts`;
- `tournament_payment_settings`;
- `payment_orders`;
- `payment_order_items`;
- `payment_attempts`;
- `payment_proofs`;
- `payment_events`;
- `payment_oauth_states`;
- `registration_cancellation_requests`;
- `payment_refunds`.

Schema marker: `phase7-payments`.

Because the historical Wrangler migration ledger for this project is incomplete, do not run a blanket remote `d1 migrations apply`. Apply only `0008_phase7_payments.sql` after backing up `huau-dev`.

## Required Cloudflare configuration for Mercado Pago

Transfer and cash work without Mercado Pago secrets. Keep Mercado Pago disabled until all values below are configured in the Worker environment:

- `MERCADO_PAGO_CLIENT_ID`
- `MERCADO_PAGO_CLIENT_SECRET`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `MERCADO_PAGO_REDIRECT_URI`
- `PAYMENT_ENCRYPTION_KEY` — exactly 32 random bytes encoded as Base64/Base64URL

Dev OAuth callback:

`https://huau-sports-dev.augusthugoo.workers.dev/api/payments/mercado-pago/oauth/callback`

Dev webhook:

`https://huau-sports-dev.augusthugoo.workers.dev/api/payments/mercado-pago/webhook`

The redirect URI configured in Mercado Pago and the Worker value must match exactly.

## Acceptance QA

### First tournament: manual players + transfer

1. Enable transfer and configure bank data.
2. Add manual players and category assignments.
3. Open Payments and synchronize charges.
4. Confirm one order aggregates all payable categories for a player.
5. Upload a proof from administration.
6. Verify it appears under review.
7. Approve it and verify paid state + KPI changes.
8. Reverse one deliberately-created manual approval and verify the charge returns to pending.
9. Reject a proof and verify a replacement can be uploaded.

### Cash

1. Enable cash.
2. Select/register a cash payment.
3. Admin marks it collected.
4. Verify audit state and paid amount.
5. Reverse a mistaken manual cash approval.

### Online user

1. Register a HUAU user in multiple payable categories.
2. Confirm one payment order covers the outstanding categories.
3. Test transfer proof from the user account.
4. Test cancellation before payment.
5. After payment, cancel and verify a cancellation request is created instead of immediate destructive cancellation.
6. Exercise each refund policy.

### Mercado Pago

1. Configure Cloudflare secrets and exact OAuth redirect/webhook URLs.
2. Connect a Mercado Pago receiver from tournament Payments settings.
3. Enable Mercado Pago for the tournament.
4. Create a checkout.
5. Re-open the action and verify the existing checkout is reused.
6. Cancel the checkout and switch method successfully.
7. Complete a sandbox/test-user payment.
8. Confirm browser return alone does not mark paid; server webhook/lookup does.
9. Verify repeated webhook delivery is idempotent.

## Promotion rule

Do not touch `huau-staging` until dev code gates, migration verification and the focused Phase 7 QA above are green.
