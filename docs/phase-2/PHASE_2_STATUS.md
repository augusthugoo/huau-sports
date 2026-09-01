# HUAU Sports — Phase 2 Tournament Engine

**Status:** IMPLEMENTED — pending branch CI / preview validation  
**Core version:** `0.3.0-phase2`  
**Scope:** pure tournament-domain extraction; no D1 migration; no Tournament admin UI yet.

## Source frozen

Legacy reference:

`HUAU_Tournament_V2_4_2_Local_y_Netlify_Autocarga.zip`

SHA-256:

`c90e0b513d5568f3b38a9abb8d0dcc621e5c3e5e167f4a71dc6e461d8e854672`

The legacy archive remains reference/fallback only. Phase 2 does not copy its browser/storage architecture.

## Pure engine delivered in `@huau/core`

New module: `packages/core/src/tournament/`

- domain types and normalized standard-format defaults;
- group round-robin generation;
- explicit `legNumber` for one/two-leg group stages;
- internal group standings with legacy-compatible tie-break structure;
- cross-group Normalized comparison;
- cross-group Equalized comparison with explanation payload (`consideredEncounterIds` / `ignoredEncounterIds`);
- fixed qualifiers + wildcard qualifiers;
- standard bracket seeding, byes and avoid-group-rematch assignment;
- top-2 final, top-3 step, top-4 semifinals and league-only modes;
- consolation knockout;
- bronze/final progression;
- medal BO3 result handling;
- deterministic result propagation from winner/loser sources;
- multi-day/category scheduling;
- player/pair overlap prevention within a time block;
- preferred rest-slot scheduling;
- sequential/simultaneous medal reservation;
- cosmetic entry edits that refresh references without regenerating structure.

## Two-round regression fix

The new engine does **not** depend on match creation order.

Scheduling partitions group encounters by `legNumber` and drains Leg 1 completely before Leg 2 becomes eligible:

```text
Leg 1 queue -> empty
then
Leg 2 queue -> empty
```

This is covered by the `two-rounds-regression` fixture.

## Fixture parity suite

`packages/core/src/tournament/tournament-engine.test.ts`

Required Phase 2 fixtures implemented:

1. `single-group-4`
2. `unequal-3-4-4-normalized`
3. `unequal-3-4-4-equalized`
4. `wildcard-best-second`
5. `standard-bracket-6-to-8-with-byes`
6. `top2-final`
7. `top3-step`
8. `top4-semis`
9. `league-only`
10. `consolation`
11. `bronze-sequential`
12. `bronze-simultaneous`
13. `medal-bo3`
14. `two-day-schedule`
15. `player-multi-category-no-overlap`
16. `two-rounds-regression`
17. `cosmetic-edit-no-invalidation`

Local source-level typecheck and an isolated runtime execution of all 17 fixtures were green while preparing the overlay. Canonical validation remains repository CI with pinned TypeScript/Vitest versions.

## Intentional architecture boundaries

Phase 2 contains no:

- DOM access;
- React code;
- `localStorage` / IndexedDB access;
- Worker/D1 access;
- network calls;
- global mutable tournament state.

Persistence, legacy JSON import and snapshots begin in Phase 3.

## Exit gate

Phase 2 is complete when on the `phase-2` branch:

- `pnpm typecheck` passes;
- `pnpm test` passes;
- `pnpm lint` passes;
- CI is green;
- Cloudflare branch preview still boots and Phase 1 auth/organization shell remains healthy;
- no regression appears in Phase 1 auth/organization flows.
