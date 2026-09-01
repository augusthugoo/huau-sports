# HUAU Sports — Phase 4 Tournament Admin UI

**Status:** IMPLEMENTED — pending validation on the real branch  
**Version target:** `0.5.0-phase4`

## Scope delivered

Phase 4 turns the Phase 2 engine and Phase 3 persistence model into an operational Tournament workspace.

### Admin flow

- organization tournament list;
- create tournament from blank;
- tournament workspace with preparation checklist;
- categories and manual individual/pair entries;
- standard format builder with simple + advanced controls;
- deterministic seeded group distribution;
- group/draw generation through `@huau/core`;
- tournament schedule generation across generated categories;
- schedule view;
- BO1 / BO3 result entry and corrections;
- final-phase generation after groups close;
- basic publish/status controls;
- operator mode focused on schedule + results;
- automatic category snapshots before structural changes;
- recovery UI for restoring category snapshots.

### Safety behavior

- cosmetic tournament status/visibility edits do not regenerate structure;
- adding a participant to a locked category requires an explicit impact confirmation;
- regenerating a locked category requires an explicit impact confirmation;
- a category snapshot is created before destructive structural work;
- invalidation is category-scoped;
- restore first snapshots the current state, then restores the selected category snapshot;
- critical generate/final/result/restore actions are written to the audit log.

### Architecture

No Phase 4 database migration is required. The UI and Worker API use the Phase 3 tables already present in `huau-dev` and `huau-staging`.

New core helpers live in:

`packages/core/src/tournament/admin.ts`

New Worker API surface lives in:

`apps/web/src/worker/tournament-admin.ts`

## Validation before merge

Run on the real `phase-4` branch:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`
4. Cloudflare branch preview
5. create a disposable tournament in the preview/dev database;
6. create a category and entries;
7. generate groups + schedule;
8. enter group results;
9. generate the final phase;
10. verify recovery snapshot creation/restore.

## Exit gate

A non-developer can create a standard tournament from blank through generated groups and schedule without opening the legacy Tournament app.

Team categories intentionally stop at a Phase 5 notice; roster/rubber configuration belongs to the Team Competition Engine.
