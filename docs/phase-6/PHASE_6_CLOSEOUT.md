# Phase 6 closeout — operational registration history

Date: 2026-09-03

This closeout pass keeps cancelled data for traceability while removing it from the live tournament operation.

## Registration workspace

`Mis inscripciones` now separates:

- current registrations;
- cancellations/history.

Cancelled or rejected registrations remain queryable but no longer sit beside live participation.

Tournament Admin → `Inscripciones` now separates:

- **Jugadores efectivos** — confirmed registrations;
- **En proceso** — awaiting payment, pairing/team formation, waitlist or other non-final states;
- **Cancelaciones e historial** — cancelled/rejected records kept for audit.

History rows are read-only in this Phase 6 surface. Operational discount/courtesy/waitlist actions are not shown on cancelled/rejected rows.

## Team roster cleanup

Team admin/detail queries now exclude `tournament_entries` whose status is `withdrawn` or `rejected` from the operational roster surface.

The records are not deleted. This means repeated QA cycles such as create team → dissolve/cancel → create another team no longer leave obsolete teams mixed into current rosters, while preserving the database history.

## Payment/cancellation boundary

Phase 6 still performs immediate cancellation because payment execution is not implemented yet.

Phase 7 must keep **participation state** separate from **financial state**. A paid cancellation should become a cancellation/refund workflow rather than deleting history. Expected concepts include:

- cancellation requested;
- participation cancelled;
- payment still paid while a refund decision is pending;
- refunded when the organizer resolves the refund according to tournament policy.

Automatic refunds remain out of Phase 6 scope.

## Database

No migration is required for this closeout pass. Existing `cancelled`, `rejected`, and `withdrawn` states are reused.
