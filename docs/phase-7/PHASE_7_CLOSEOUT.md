# Phase 7 — Operational closeout

## Validated in preview

- Manual player creates the correct financial obligation.
- Bank transfer instructions and amount.
- Proof upload to R2, review, rejection/resubmission and approval.
- Cash payment, manual approval and reversal.
- Paid-registration cancellation request and manual refund workflow.
- Financial history remains auditable when participation changes.

## Closeout adjustments

- `My payments` is compact by default; line-item detail is collapsible.
- Transfer panel is denser and proof upload states the 8 MB limit.
- `My HUAU` can cancel all active registrations for the same tournament in one action. Paid registrations create organizer review requests instead of being destructively cancelled.
- Tournament `Players` now calls removal `Remove from setup` and explicitly states that it does not cancel online registrations or erase financial history.

## Mercado Pago

The Mercado Pago implementation remains in the Phase 7 codebase, but connection/credentials and end-to-end sandbox acceptance are intentionally deferred. It is not required for the first event, which will operate with manual players and bank transfer. Track Mercado Pago as `Phase 7C — deferred acceptance` and validate it before enabling the method for a real tournament.

No D1 migration is required by this closeout hotfix. Schema remains `phase7-payments`.
