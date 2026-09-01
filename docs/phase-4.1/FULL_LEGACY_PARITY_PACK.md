# Phase 4.1 — Full HUAU Tournament Legacy Parity Pack

Version: **0.5.2-phase4.1-parity**

This pack replaces the incremental 4.1A/4.1B/etc. patch strategy. It ports the functional Tournament V2.4.2 baseline as one coherent admin/persistence/engine upgrade while preserving HUAU Sports' newer cloud safeguards.

## Included

- migration `0003_phase4_legacy_parity.sql`;
- unique tournament player profiles and migration backfill for pre-existing Phase 4 entries;
- per-category partner assignment and derived entries;
- legacy format simulator;
- explicit snake/random/manual/live seeding;
- manual groups and live progressive draw;
- full format controls already supported by the Tournament Engine;
- schedule parity, real match rows/windows and schedule image export;
- chronological results, inline BO1/BO3 correction, standings and cross-group tables;
- automatic/safe final-phase generation;
- internal TV mode;
- group/promo image generation;
- backup/import, competition reset and snapshot recovery;
- updated parity matrix.

## Important live-draw invariant

Starting, resetting or running a live draw changes only `tournament_draw_sessions`. A locked competition is snapshotted/replaced **only when Confirm groups is pressed**. This preserves the V2.1 behavior where a public draw can be rehearsed/reset without corrupting the confirmed tournament.

## Migration continuity

Migration 0003 backfills tournaments created with the first Phase 4 workspace:
- organization people become tournament player profiles;
- existing category memberships become player/category assignments;
- pair entries infer reciprocal partner assignments;
- old entries receive parity source keys.

This is additive. It does not drop the Phase 3 tournament tables.

## Validation performed while packaging

- 0000 → 0001 → 0002 → 0003 executed successfully against SQLite with foreign keys enabled.
- Synthetic Phase 4 pair entries were backfilled into four player profiles with reciprocal partners and source-linked entries.
- Core parity assertions validated legacy 3/4/4 balancing, exact snake placement, random placement capacity, manual-group validation, two rounds, wildcard rejection and live-draw rotation.
- Static TypeScript checks were run against the cumulative working tree in the packaging environment. The authoritative project checks remain the pinned pnpm commands on the development machine/CI.

## Authoritative checks after applying

```bash
nvm use 22.16.0
pnpm typecheck
pnpm test
pnpm lint
```

Do not apply the obsolete `HUAU_Sports_Phase_4_1A_1_Schedule_Results_Parity_Overlay.zip`; its changes are superseded by this pack.
