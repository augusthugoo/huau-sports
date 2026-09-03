# Phase 7.1 — Participant Admin Consolidation

## Objective

Keep the domain boundaries introduced by Phases 4, 6 and 7 while presenting tournament people to the organizer in one person-centric workspace.

The database concepts remain separate:

- `tournament_player_profiles` / `tournament_player_categories`: competitive setup, seeding and legacy-parity controls;
- `tournament_registrations`: online participation, category status, pair/team lifecycle and cancellation history;
- `payment_orders` and related tables: financial ledger, proofs and refunds.

The organizer should not need to understand those tables to answer “what is happening with this person in my tournament?”.

## Admin navigation

`Jugadores` and `Inscripciones` are replaced by one **Participantes** tab.

`Pagos` remains separate because reviewing proofs, cash collections and refunds is a genuine batch financial workflow.

## Participantes capabilities

The participant list joins people by stable identifiers when possible:

- HUAU account: `user_id`;
- manual tournament participant: `tournament_player_profile.id`.

Each participant card exposes:

1. **Inscripción**
   - active registrations and history;
   - category/grouping state;
   - waitlist promotion;
   - discount/courtesy/restore-charge actions.
2. **Armado competitivo**
   - display name, club, contact and DUPR;
   - standard category assignments and pair links;
   - competitive status;
   - explicit `Quitar del armado`, which does not cancel registrations or payments.
3. **Pago**
   - aggregate total and net paid amount;
   - current order status and covered concepts;
   - shortcut to the full Payments queue.

The top-level workspace also supports:

- search by name/email/club/category;
- filters for current, in-progress and history;
- manual participant creation;
- public registration-link copy.

## Online participant after competitive-profile removal

If a HUAU user still has an active registration but their competitive profile was manually removed, Participantes shows that state explicitly and offers **Recrear ficha desde HUAU**.

The backend only accepts `sourceUserId` when that user has an active registration in the same tournament. It reuses the Organization person linked to the HUAU account and attempts to restore an existing pair link. No new database migration is required.

## Safety boundary

- Removing a competitive profile never cancels an online registration.
- Payment history remains protected by the Phase 7 financial-history guard.
- Cancelling an online singles/pairs registration removes that category from the linked competitive profile so a cancelled registration cannot silently remain assigned for future competition generation.
- Structural competitive edits continue using the existing impact-confirmation/snapshot behavior.
- Payment state remains owned by the Phase 7 payment ledger; the legacy `payment_status` field on the competitive profile is not exposed as the financial source of truth.

## Database

No migration.

Phase 7.1 is an API projection + organizer UX consolidation on top of schema version `phase7-payments`.

## Acceptance

- one participant appears once even when they have online registrations, a competitive profile and a payment order;
- manual players remain manageable and billable;
- online registrations remain visible even if the competitive profile is removed;
- registration actions still work from the participant card;
- competitive edit/removal still honors structural-impact safeguards;
- payment summary matches the Payments tab;
- full financial operations remain available in Payments;
- old standalone Jugadores/Inscripciones tabs are no longer needed.
