# Phase 5A — Team Competition Engine foundation

Version: `0.6.0-phase5-team-engine`

## Scope

This block starts Phase 5 on top of the approved Phase 4 Tournament baseline. It deliberately does not reopen the standard Tournament workspace.

Implemented in `@huau/core`:

- versioned `TeamFormat` domain model;
- runtime JSON parser/validator before persisted team config reaches the engine;
- configurable roster size/composition/gender quotas;
- roster validation including substitutes/captain rules;
- ordered rubber definitions with singles/doubles, gender, BO1/BO3, scoring metadata and weight;
- `always` and generic `if_tied` conditional rubbers;
- lineup validation against roster, modality and gender requirements;
- lineup lock/administrative override policy;
- encounter scoring for `majority` and configurable `first_to` winner rules;
- early-clinch handling controlled by `playRemainingAfterClinched`;
- generic mixed five-rubber preset (MD / WD / MS / WS / XD) without event-name branching;
- team round-robin generation using the same one/two-leg competition semantics;
- derived team standings with ordered criteria and explanation payload.

## Persistence migration

`packages/db/drizzle/0004_phase5_team_competition.sql`

Adds:

- `match_side_members` — historical snapshot of the players who actually occupied each side of an atomic rubber;
- `team_encounter_lineups` — one persisted lineup per encounter + team entry;
- `team_lineup_assignments` — ordered player assignments per rubber;
- schema marker `phase5-team-engine`.

The existing Phase 3 schema already supports:

- `tournament_entries.entry_type = team`;
- team rosters through `entry_members`;
- `competition_format_versions.format_kind = team` + `config_json`;
- group/playoff entries and `competition_encounters`;
- atomic `matches` with `rubber_key` and `rubber_order`.

No duplicate parallel team competition tables are introduced.

## Acceptance coverage in this block

Automated fixtures target the Phase 5 Gate C requirements:

- TEAM-AT-001 configurable roster;
- TEAM-AT-002 ordered rubbers;
- TEAM-AT-003 five-rubber mixed fixture;
- TEAM-AT-004 conditional tiebreak rubber;
- TEAM-AT-005 encounter winner;
- TEAM-AT-006 team standings;
- TEAM-AT-007 groups/two-leg reuse;
- TEAM-AT-008 lineup lock policy.

## Database rollout rule

Apply `0004` to **huau-dev only** while Phase 5 is under development.

Do not apply Phase 5 schema to `huau-staging` until the Phase 5 preview and acceptance flow are approved, following the same promotion discipline used for Phase 4.

## Next block — Phase 5B

Build the cloud/admin surface on this domain:

1. create/select a team category;
2. team format + roster rules editor;
3. ordered rubber builder;
4. team entry/roster CRUD;
5. generate team groups/encounters and materialize atomic rubbers;
6. lineup editor + lock;
7. result entry and live encounter score;
8. team standings projection.
