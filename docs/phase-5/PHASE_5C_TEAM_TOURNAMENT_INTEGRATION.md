# Phase 5C — Team Tournament Integration

Version: `0.6.2-phase5c-team-integration`

## Goal

Promote Team Competition from an isolated admin workspace into a first-class HUAU Tournament competition type while keeping the approved standard Tournament flow intact.

## Included

### Tournament lifecycle
- Delete a complete tournament from the tournament list or Tournament settings danger zone.
- Destructive deletion requires explicit confirmation and is audited before the tournament row is removed.

### Canonical player profile
- Sport gender belongs to the tournament player / organization person profile.
- Team roster UI reads that canonical value instead of asking for gender again.
- Changing gender for a player already used in a generated Team structure is treated as a structural change and snapshots/invalidation rules apply.
- Deleting a player removes Team roster membership safely and protects generated structures with the same impact confirmation flow.

### Team roster exclusivity
- Team creation and editing select existing confirmed tournament players.
- A player already assigned to a Team entry disappears from the available list for other teams in the same Team category.
- Backend validation enforces the same exclusivity, so it is not only a UI rule.
- A player may still be used in another Team category (+40 / +50 / +60 are independent categories).

### Global scheduler
- Team generation immediately regenerates the tournament schedule.
- Each Team encounter is treated as a series; its configured rubbers become atomic `schedule_items` with time, court, match id and encounter id.
- Different Team encounters may use different courts in parallel.
- Rubbers within one encounter run sequentially on the selected court.
- The tournament-wide minimum rest configuration is applied between Team encounters for the same team.
- BO3 rubbers reserve a longer slot than BO1.
- Conditional rubbers reserve a slot and are cancelled automatically if the engine determines they are not required.
- Standard categories keep using the existing legacy-compatible scheduler. Team scheduling is appended safely without changing standard scheduling semantics.

### Global Competition / Results / TV
- `Equipos` is now primarily configuration, rosters, group generation and lineups.
- Team standings and encounter summaries are also exposed in `Competencia`.
- Team rubber result entry is exposed in `Resultados` and sorted by the global schedule.
- Saving a rubber result updates the encounter score, standings and schedule status.
- `Modo TV` can select a Team category and shows encounter score, rubbers, assigned players, upcoming scheduled rubbers, latest results and standings.
- The global Cronograma labels Team rows with group, rubber, BO and Team context.

## Persistence

No Phase 5C database migration is required. The integration reuses:
- `tournament_entries` / `entry_members`
- `competition_encounters` / `matches`
- `schedule_items`
- `team_encounter_lineups`
- `team_lineup_assignments`
- `match_side_members`

The existing `0004_phase5_team_competition.sql` remains the latest required schema migration for Phase 5.

## Deliberate follow-up / fine tuning

- More sophisticated interleaving of standard and Team categories inside the same day can be optimized later; Phase 5C guarantees conflict-free integrated scheduling first.
- Team playoff/bracket progression remains a later Phase 5 block.
- Club-level tournament creation can later ask Standard / Team / Mixed and pre-shape this workspace without changing the Team Engine domain model.
