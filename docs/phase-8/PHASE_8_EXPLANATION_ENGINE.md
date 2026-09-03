# Phase 8 — Format Explanation Engine / ES-EN

## Goal

Turn the competition configuration that HUAU actually executes into an official, human-readable explanation for organizers and players. The explanation is derived from structured rules; it is not a library of hand-written texts per tournament combination.

## Integrity rule

The official mathematical/competitive explanation is generated from saved configuration and is not manually editable. Organizer notes and logistics can be presented separately, but they must never replace or contradict the generated rules.

## V1 locales

- Spanish (`es`)
- English (`en`)

The core API keeps locale as an input so additional languages can be added without changing the competition model.

## Standard tournament coverage

The engine explains, when present in the persisted configuration:

- group count and unequal group sizes;
- one or two group rounds;
- internal standings/tiebreak order;
- fixed qualifiers per group;
- wildcard/extra qualifiers;
- Normalized cross-group comparison;
- Equalized cross-group comparison, including the explicit rule that group results are never deleted;
- snake/manual/random/live seeding;
- final draw by performance or pots;
- standard bracket, Top 2 final, Top 3 step ladder, Top 4 semifinals, or league-only;
- bracket byes;
- optional consolation;
- optional bronze match and sequential/simultaneous medal scheduling;
- BO1/BO3 and point targets;
- preferred rest blocks and scheduling intent.

## Team tournament coverage

The engine explains the Team format currently executable by the Team Engine:

- roster limits and composition;
- ordered rubbers, mode/gender, scoring and weight;
- always-played versus conditional rubbers;
- tiebreaker rubbers;
- majority or first-to-X series winner rules;
- whether remaining rubbers continue after the series is clinched;
- one/two group rounds;
- Team standings criteria.

Phase 8 deliberately does **not** announce a Team playoff/final phase that the current Team Engine cannot yet generate. The explanation must never promise a rule that runtime competition logic does not execute.

## Product surfaces

Phase 8 exposes the same generated explanation in:

1. organizer Format view for standard categories;
2. Team format builder as a live preview;
3. public tournament registration/category cards behind `Cómo se juega` / `How it works`;
4. `Mi HUAU > Mis inscripciones` for active registrations.

Phase 9 can reuse the exact same core explanation object in public HUAU Live / TV without creating a second rules system.

## Data flow

- Standard persisted source: `competition_format_versions.config_json` + `format_kind='standard'`.
- Team persisted source: `competition_format_versions.config_json` + `format_kind='team'`.
- `explanation_schema_version` travels with the persisted format metadata.
- The API parses config JSON to structured `formatConfig`; the browser never needs to interpret raw SQL JSON strings.
- No Phase 8 database migration is required. Existing `competition_format_versions.explanation_schema_version` is reused.

## Core API

`packages/core/src/tournament/explanation.ts` exports:

- `explainStandardFormat`
- `explainStandardFormatConfig`
- `standardExplanationInputFromConfig`
- `explainTeamFormat`

Each returns a `FormatExplanation` with:

- `schemaVersion`
- `kind`
- `locale`
- `official`
- `summary` (1–3 simple paragraphs)
- semantic `sections` for expandable detail.

## Acceptance checklist

### Standard

- [ ] Saved format shows an official explanation in organizer Format.
- [ ] 3/4/4 + Equalized states that only the cross-group comparison sample changes; group matches remain intact.
- [ ] Normalized uses win rate, point difference per match and points scored per match.
- [ ] Fixed qualifiers and wildcards match saved values.
- [ ] Top 2 / Top 3 / Top 4 / league-only language matches runtime behavior.
- [ ] Byes, consolation, bronze, BO3 and point targets only appear when configured.
- [ ] Seeding/final draw method matches saved configuration.
- [ ] Switching ES/EN regenerates the explanation in that locale.

### Public / player

- [ ] Public category exposes `Cómo se juega` without making the registration card permanently oversized.
- [ ] Active registration exposes the same official explanation.
- [ ] A category without a saved format shows no invented explanation.

### Team

- [ ] Team builder preview changes when roster/rubbers/winner rule change.
- [ ] Conditional tiebreaker (for example a deciding mixed doubles rubber) is described correctly.
- [ ] First-to-X and play-remaining behavior are described correctly.
- [ ] Team standings criteria appear in the configured order.
- [ ] No unsupported Team playoff is announced.

### Repository gates

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] preview acceptance

## Database

**No migration.** Do not rerun `0008_phase7_payments.sql`.
