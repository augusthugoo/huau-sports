# Phase 4.1 Recovery P0.2 — mutation latency

This pass removes the main artificial latency pattern found during acceptance testing.

## Frontend

- Tournament mutations no longer block on a complete tournament detail reload.
- A coalesced background refresh reconciles the screen after normal mutations.
- Stale in-flight detail responses are discarded after a newer mutation.
- Live Draw keeps its own returned state and does not reload the entire tournament on every reveal.

## Worker

- Live Draw `next` now reads/writes only the draw session; it no longer rebuilds derived entries or loads format/entries on every reveal.
- Format simulation no longer rewrites derived entries before every simulation.
- Player edits refresh derived displays only for affected categories instead of every category in the tournament.
- Affected category entry syncs are parallelized.
- Cosmetic category edits no longer regenerate the tournament schedule.
- Category creation persists its scheduled date in the initial insert, removing the second request previously made by the UI.

## Expected acceptance behavior

- Add/edit player: the control should release as soon as the mutation succeeds; full reconciliation happens in the background.
- Add category: one mutation request instead of create + edit.
- Live Draw / Draw next: should feel near-instant on a normal connection.
- Format simulation: should respond without entry-resync writes.

No database migration is required.
