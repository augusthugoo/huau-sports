# Phase 8.1 — Team Final Phase + Deep Knockout Rounds

Base authored against `phase-8` commit `aade6b1fa1db7972621a53593b17b8b5e2262cd9`.

## Scope

Phase 8.1 closes the post-group gap left by the original Team Tournament integration and removes the artificial naming ceiling in the standard knockout bracket.

### Standard tournament knockout labels

The standard engine keeps its existing power-of-two bracket behavior and now names deep rounds explicitly instead of falling back to `Preliminary round`:

- Round of 64
- Round of 32
- Round of 16
- Quarterfinal
- Semifinal
- Final

The label helper remains mathematical, so larger brackets do not have a hard-coded naming ceiling.

### Team final phase

Team categories now execute the persisted `competition.playoffMode` after every group encounter is finished.

Supported modes:

- `standard`: one or more groups; fixed qualifiers per group plus optional cross-group wildcards.
- `top2_final`: single group; first and second play the final. Optional third-place encounter uses positions 3 and 4 when present.
- `top4_semis`: single group; 1 vs 4 and 2 vs 3, then final; optional bronze from semifinal losers.
- `top3_step`: single group; 2 vs 3, winner vs 1 in the final.
- `league_only`: single group; champion is decided by the final standings and no knockout encounter is created.

Persisted Phase 5 Team formats remain compatible. Missing Team final-phase settings normalize to:

- qualifiers per group: `2`
- wildcards: `0`
- bronze: `false`

Each final-phase node is a full Team encounter and reuses the exact configured rubber list, order, BO, point target, conditional rules, weights and winner rule. A new lineup is therefore required for each resolved playoff encounter.

## Automatic progression

When the last group encounter finishes, HUAU generates the final-phase graph automatically. Winners flow through `source_encounter_*` references and bronze receives semifinal losers through `source_loser_*` references. First-round byes advance automatically.

Final-phase matches are also available to the Team schedule as dependency-aware placeholders before the teams are known. Their earliest start is constrained by the source encounters and configured rest, so resolving a semifinal changes the participants without moving the already generated final slot.

For categories whose group stage was already complete before installing Phase 8.1, the Team structure panel exposes `Generar fase final` (or `Cerrar liga por tabla`).

## Correction safety

A finished upstream Team encounter cannot be corrected after any downstream encounter already has a final/corrected rubber result. If no downstream result exists, correcting the upstream winner clears obsolete downstream lineups, updates the participants and reopens the correct first rubber.

A competition with bronze is not marked complete until both the final and the bronze encounter are finished (or auto-resolved by bye).

## Persistence

No new tables or columns are required. Phase 8.1 uses the existing Phase 3/5 persistence model:

- `competition_encounters.stage`
- `source_encounter_a_id` / `source_encounter_b_id`
- `source_loser_a_id` / `source_loser_b_id`
- nullable `entry_a_id` / `entry_b_id`
- Team lineups, matches and schedule items

**No D1 migration is included or required. Do not rerun migration 0008.**

## Acceptance focus

1. R32/R64 standard brackets show explicit round labels.
2. Standard Team with multiple groups generates qualifiers and a full knockout graph.
3. Wildcards are selected deterministically using normalized cross-group performance after fixed places.
4. Alternative Team modes are constrained to a single group.
5. Final-phase Team encounters use the same rubbers and require their own lineups.
6. Finishing a semifinal resolves the corresponding final/bronze participant automatically.
7. Unresolved future encounters do not pollute the Results work queue.
8. Final/bronze schedule slots survive participant resolution.
9. Downstream results block unsafe upstream corrections.
10. League-only finishes by standings without a phantom final.
