# HUAU Sports — Phase 3 Status

Status: **IN PROGRESS**  
Version target: `0.4.0-phase3`

## Implemented in this block

- D1/Drizzle tournament persistence schema.
- Migration `0002_phase3_tournament_persistence.sql`.
- Tournament/category/entry/entry-member persistence model.
- Versioned competition format storage.
- Materialized competitions, groups and group memberships.
- Encounters, atomic matches, results and sets.
- Schedule items + schedule revisions.
- Tournament mutations, snapshots and critical audit tables.
- Pure legacy `tournament-state.json` transformer.
- Legacy source snapshot preservation during import.
- HUAU Phase 3 backup export/import format.
- Round-trip regression tests.
- Source immutability test: importer never mutates legacy JSON.

## Legacy mapping guarantees

The importer preserves or normalizes:

- organization people from legacy players;
- category order and scheduled day;
- individual/pair entries and member links;
- generated groups;
- group/final encounters;
- winner/source links in the bracket;
- BO1/BO3 rules and set scores;
- completed results;
- bound and reserved schedule items;
- original legacy state as a recovery snapshot.

## Remaining Phase 3 exit-gate work

1. Run typecheck/lint/tests on the real branch.
2. Apply the Phase 3 migration to `huau-dev`.
3. Validate the importer against the known real `tournament-state.json` fixture.
4. Add the server-side persistence/import endpoint or import utility.
5. Import the known tournament into dev/staging and compare counts/core structure.
6. Export a HUAU backup and verify round-trip restore.
7. Apply the migration to staging only after dev validation.

Do not merge Phase 3 to `main` until the migration and real-state import are validated.
