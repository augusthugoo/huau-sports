# HUAU Sports - Implementation Plan v1.0

**Estado:** Plan ejecutable  
**Fecha:** 2026-08-29  
**Objetivo operativo inmediato:** torneo clasificatorio por equipos a fines de septiembre de 2026  
**Estrategia:** proteger Tournament primero, construir Club sin comprometer el evento real.

---

## 1. Regla de implementación

No se reconstruye HUAU “pantalla por pantalla” desde el legacy.

El orden correcto es:

1. fundación;
2. domain engines;
3. datos/auth;
4. workflows críticos;
5. UX;
6. integraciones;
7. offline/realtime;
8. QA de evento;
9. Club pilot.

El legacy queda intacto como fallback hasta que el cloud build supere un ensayo end-to-end.

---

## 2. Branch/release strategy

Recommended:

```text
main               production-ready only
staging            optional integration branch or env from main PRs
feature/*           scoped work
release/sept-2026   temporary event stabilization branch if needed
```

Use feature flags for unfinished Club areas rather than hiding broken routes manually.

---

## 3. Phase 0 - Governance & repository foundation

**Target:** Day 1-2

### Tasks

- Create new repository/monorepo.
- Copy this foundation package into `/docs/foundation`.
- Add ADR folder.
- Pin package manager and Node/runtime strategy.
- Scaffold React + Cloudflare Worker/Vite.
- Configure TypeScript strict.
- Configure lint/format.
- Configure Vitest.
- Configure Playwright smoke.
- Configure CI.
- Create dev/staging Cloudflare environments.
- Create D1 dev/staging DB.
- Create R2 dev/staging bucket.
- Create initial Drizzle migration.
- Add `.env.example` with no secrets.
- Define code owners/commit conventions if useful.

### Exit gate

- fresh clone installs/builds/tests;
- staging URL deploys;
- migrations run from empty DB;
- CI fails on type/test error;
- docs in repo.

---

## 4. Phase 1 - Identity, organizations & platform shell

**Target:** Days 2-5

### Backend

- Better Auth integration.
- user profile.
- organizations.
- organization people abstraction.
- organization membership request.
- org capabilities.
- platform admin allowlist/table.
- organization module entitlements.
- tenant authorization middleware.

### Frontend

- landing shell.
- sign up/sign in/recovery.
- My HUAU shell.
- context switcher.
- Organization Admin shell.
- Platform Admin shell hidden by permission.
- ES/EN i18n infrastructure.
- shared design tokens/Montserrat UI.

### Tests

- auth happy paths.
- Org A cannot access Org B.
- Platform admin normal vs support mode.
- missing translation key CI check.

### Exit gate

- user can register/login;
- organization can be created via platform admin/dev seed;
- user can request membership;
- org admin can approve;
- tenant isolation tests pass.

---

## 5. Phase 2 - Extract Tournament Engine from legacy

**Target:** Days 4-9; can overlap Phase 1 after repo foundation

### 5.1 Freeze source

Archive exact legacy build:

`HUAU_Tournament_V2_4_2_Local_y_Netlify_Autocarga.zip`

Do not use it as mutable target.

### 5.2 Create pure engine package

Port in small units:

1. types / entries;
2. round-robin generation;
3. standings internal group;
4. cross-group normalized;
5. cross-group equalized;
6. qualifiers/wildcards;
7. brackets/byes;
8. bronze/final progression;
9. consolation;
10. schedule planning;
11. category/day ordering;
12. result propagation.

### 5.3 Fixture parity

Build tests from known scenarios.

Required fixture names:

```text
single-group-4
unequal-3-4-4-normalized
unequal-3-4-4-equalized
wildcard-best-second
standard-bracket-6-to-8-with-byes
top2-final
top3-step
top4-semis
league-only
consolation
bronze-sequential
bronze-simultaneous
medal-bo3
two-day-schedule
player-multi-category-no-overlap
two-rounds-regression
cosmetic-edit-no-invalidation
```

### 5.4 Two-round fix

Implement as explicit `legNumber` grouping:

```text
schedule leg 1 fully
then schedule leg 2
```

Do not rely on match creation array order accidentally.

### Exit gate

- all fixture tests green;
- engine has zero DOM/storage dependencies;
- regression bug reproduces in legacy fixture and passes new expected behavior;
- cross-group calculations documented in test descriptions.

---

## 6. Phase 3 - Tournament persistence & migration layer

**Target:** Days 7-11

### Tasks

- tournament/category/entry tables.
- format version storage.
- competition materialization.
- groups/encounters/matches/results.
- schedule items.
- snapshot tables.
- critical audit.
- tournament revisions/mutations.
- import transformer from legacy `tournament-state.json`.
- export new HUAU backup JSON.

### Import test

Use a copy of a known tournament state and verify:

- people count;
- entries per category;
- group sizes;
- results;
- schedule;
- final phase.

Never mutate source JSON during import.

### Exit gate

- legacy JSON imports into staging;
- imported tournament renders same core structure;
- new export can round-trip into a clean dev DB/workspace.

---

## 7. Phase 4 - Tournament Admin UI v1

**Target:** Days 9-14

### Screens

- tournament list.
- create/edit general.
- participants.
- categories.
- format builder.
- draw/groups.
- schedule.
- results.
- final phase.
- live/publish.
- recovery.

### UX priorities

- setup checklist;
- simple/advanced format sections;
- impact-aware confirmation;
- structure lock;
- operator mode shell.

### Safety tasks

- classify cosmetic vs structural edits.
- snapshot before structural mutation.
- category-scoped invalidation only.
- restore workflow.

### Exit gate

A non-developer can create a standard tournament from blank to generated groups/schedule without opening legacy app.

---

## 8. Phase 5 - Team Competition Engine P0

**Target:** Days 11-17

This phase is blocking for the September event.

### Domain

- TeamFormat schema.
- roster validation.
- team entry.
- encounter builder.
- rubber definitions.
- conditional rubbers/tiebreaker.
- lineup validation.
- encounter scoring/winner.
- team standings comparator.
- group/playoff integration.

### UI

- team category selection.
- roster rules.
- ordered rubber builder.
- team entry/roster admin.
- lineup screen.
- team encounter result screen.
- live team score.

### Required tests

#### September preset

```text
1 MD
2 WD
3 MS
4 WS
5 XD
```

Test both:

- XD always plays.
- XD only plays at 2-2.

#### Alternative MLP-like

- even regular rubber count;
- tie possible;
- conditional tiebreaker activates;
- no special source-code branch named for event.

#### Roster

- 2M/2F minimum.
- 4-6 roster.
- invalid gender/roster assignments rejected.

### Exit gate

Organizer configures the September format only through UI/config, generates at least one team group/encounter, assigns lineups, records all rubbers and obtains correct winner/standings.

---

## 9. Phase 6 - Online registration

**Target:** Days 14-19

### Standard

- public tournament registration CTA.
- account required.
- capacity.
- waitlist.
- eligibility.
- registration state machine.

### Singles

- direct entry.

### Pairs

- create pair.
- invite HUAU partner.
- accept/decline.
- admin manual override.

### Teams

- captain creates team.
- roster invites.
- readiness validation.
- admin adds manual participants.

### Pricing

- free.
- per entry.
- per person.

### Exit gate

Three seeded staging users can complete singles, doubles invitation and team roster registrations.

---

## 10. Phase 7 - Mercado Pago + payments admin

**Target:** Days 17-22

### Setup

- create/configure HUAU Mercado Pago dev/test app.
- OAuth connect receiver account in test.
- encrypted token storage.
- tournament payment config.

### Payment flow

- internal payment attempt.
- Orders API create.
- idempotency.
- redirect.
- signed webhook endpoint.
- provider status verification.
- registration confirm.

### Manual methods

- bank instructions.
- WhatsApp proof link.
- manual mark-paid.
- cash.

### Payments admin

Columns:

- person/entry;
- category;
- amount;
- method;
- state;
- date;
- manual/automatic.

### Required abuse tests

- forged success return URL.
- duplicate webhook.
- webhook out of order.
- retry Create Order.
- user changes client amount.
- payment for full/invalid category race.

### Exit gate

Test payment cannot be marked approved without trusted server-side provider state or explicit admin manual action.

---

## 11. Phase 8 - Format Explanation Engine

**Target:** Days 18-22; can parallel payment work

### Tasks

- semantic explanation model.
- Spanish translations.
- English translations.
- group ranking explanation.
- normalized explanation.
- equalized explanation.
- wildcards.
- playoff modes.
- medals.
- team roster/encounter explanation.
- short vs detailed output.

### Tests

Snapshot tests for ES/EN semantics, not brittle full-page HTML.

Key fixture 3/4/4 must explain that normalized comparison uses percentages/averages and equalized comparison discards only cross-group extra-opponent results.

### Exit gate

Every P0 format configuration has nonempty ES/EN summary and exact criteria section.

---

## 12. Phase 9 - Public Live + realtime

**Target:** Days 20-24

### Public projection

- sanitized DTO.
- category public data.
- group tables.
- schedule.
- results.
- bracket.
- team encounter score.
- format explanation.

### Realtime

- TournamentLiveRoom Durable Object.
- WebSocket hibernation.
- revision invalidation events.
- reconnect.
- fallback refresh.

### TV

- route/view mode using same public projection.
- large typography/layout.

### Exit gate

One admin result update appears on:

- second browser;
- phone viewport;
- TV viewport;

without manual reload under normal online conditions.

---

## 13. Phase 10 - PWA + offline Tournament

**Target:** Days 21-26

This is a hard gate before event use.

### PWA

- manifest.
- icons.
- service worker.
- shell cache.
- installability.

### IndexedDB

- tournament snapshot.
- outbox.
- local snapshot.
- sync repository.

### Offline write

- result entry.
- standings recompute.
- bracket continuation.
- queue.

### Reconnect

- idempotent mutation submission.
- revision update.
- conflict UI.

### Offline readiness screen

Add event checklist.

### Exit gate test

1. Load tournament online.
2. Enable airplane/network offline.
3. Enter several group results.
4. Finish groups.
5. Generate final phase.
6. Enter playoff result.
7. Restore network.
8. Sync.
9. Verify second device/public receives correct final state.

If this fails, cloud build is not sole event tool.

---

## 14. Phase 11 - Event hardening / rehearsal

**Target:** final 5-7 days before September event

### Freeze

No broad feature additions.

### Rehearsal dataset

Create full mock of actual team event:

- real expected team count range;
- real roster rules;
- five rubbers;
- expected groups/playoff;
- courts;
- match durations;
- payment mode.

### Simulation

Run:

- registration;
- payment;
- team setup;
- draw;
- schedule;
- live;
- offline interruption;
- wrong score correction;
- roster substitution scenario;
- participant name correction;
- structure restore;
- final/bronze.

### Hardware

Test actual:

- Mac/primary admin device;
- TV via HDMI;
- phone delegate;
- tablet if Ref used;
- venue network/hotspot fallback.

### Backup package

Before event:

- cloud tournament export JSON;
- legacy fallback app zip;
- event-specific migrated data if needed;
- local offline-ready PWA on primary device.

### Go/no-go

Cloud HUAU is primary only if all hard gates pass.

Otherwise legacy Tournament remains primary while cloud handles public/registration pieces that are safe.

---

# 15. HUAU Club pilot implementation

Club work should begin after P0 engine foundation; production readiness can follow September event.

## Club Phase A - Organization setup & memberships

- org profile/branding.
- sports.
- member requests.
- membership entitlements.
- admin member list.

## Club Phase B - Venues/courts & availability

- venues.
- courts.
- opening schedule.
- booking policy.
- blocks.
- availability API.

## Club Phase C - Reservations

- member booking flow.
- manual approval.
- provisional holds.
- conflict-safe create.
- admin calendar/list.

## Club Phase D - Open matches

- reservation -> open.
- capacity.
- join/leave.
- waitlist.
- cutoff/auto-release.
- community browse.

## Club Phase E - Open Play

- official activity.
- court allocation.
- capacity/waitlist.
- no rotation/attendance.

## Club Phase F - polish/pilot

- Mi semana.
- in-app notifications.
- minimal analytics.
- onboarding.
- PWA install experience.

---

## 16. Deferred activities/coach

After Club reservation/community pilot is stable:

- activity recurrence;
- class types;
- coach dashboard;
- coach agenda;
- clinic registration/payment;
- approval policies.

Do not block initial club pitch with this.

---

## 17. Ref migration plan

### Step 1 - Preserve

Keep Beta 1.8 operational as separate PWA.

### Step 2 - Extract/modernize engine

Port `engine.js` behavior to `packages/ref-engine` TypeScript with parity tests.

### Step 3 - Rebuild UI on shared HUAU components

Preserve match-first visual hierarchy.

### Step 4 - Tournament integration (P2)

- assignment.
- match config load.
- offline cache.
- result submission.
- optional table confirmation.

No reason to delay September Tournament core for Step 4.

---

## 18. Test strategy by layer

### Unit

- domain comparators;
- standings;
- schedule;
- roster validation;
- payment state reducer;
- explanation semantics.

### Integration

- repositories + D1;
- tenant isolation;
- reservations overlap;
- payment webhook;
- snapshots/restore;
- mutation idempotency.

### E2E

Critical paths:

- sign up/join org;
- reserve court;
- join open match;
- create tournament;
- singles registration;
- doubles invite;
- team registration;
- admin draw/schedule/results;
- team encounter;
- public live;
- payment test.

### Offline E2E

Playwright/browser context offline where possible plus manual device QA.

---

## 19. Definition of Done for a feature

A P0/P1 feature is not done until:

- PRD behavior implemented;
- server authorization present;
- typed validation present;
- happy + important error states UI;
- mobile/target responsive checked;
- ES/EN keys present where user-facing;
- unit/integration tests appropriate;
- no critical console errors;
- audit/snapshot rule applied if destructive;
- offline behavior defined (supported / explicitly unavailable);
- staging QA passed;
- docs/ADR updated if implementation changed baseline.

---

## 20. Feature flag strategy

Recommended flags:

```text
club_module
team_competitions
mercadopago_payments
public_live
connected_ref
coach_module
push_notifications
```

Flags should be server-enforced entitlements, not only hidden buttons.

---

## 21. Data migration checkpoints

Before schema changes affecting Tournament:

1. staging migration from realistic data;
2. export backup;
3. migration test from previous schema;
4. rollback/recovery plan;
5. production migration during low activity.

Avoid schema experimentation on live September event week.

---

## 22. Project risks & response

### Scope creep before September

Response: P0 freeze. Club P1 behind feature flag.

### Mercado Pago OAuth takes longer than expected

Response: maintain manual transfer/cash and optional generic payment-link fallback for pilot; automatic paid state only launches once webhook verification is complete.

### Team rules change late

Response: config-driven builder + format versioning; do not hardcode.

### Venue Internet unstable

Response: offline readiness + local mutation queue + TV can run from primary device if needed.

### Club asks for different reservation rules

Response: booking policies configurable; gather exact rules before pilot enablement.

---

## 23. Suggested calendar from 2026-08-30

This is aggressive and assumes focused development. Dates can slide, but the order should not.

### Aug 30 - Sep 4

- Phase 0.
- Phase 1 core.
- Tournament Engine extraction begins.

### Sep 5 - Sep 10

- Tournament Engine parity.
- persistence/import.
- admin tournament shell.

### Sep 11 - Sep 16

- Team Engine.
- team UI.
- registration system.

### Sep 17 - Sep 21

- Mercado Pago.
- explanation engine.
- public/live.

### Sep 22 - Sep 25

- PWA/offline.
- hardening.
- actual-event mock.

### Final days before event

- feature freeze;
- rehearsal;
- venue/device test;
- backups;
- only blocker fixes.

### After event

- postmortem;
- Club reservation/community pilot completion;
- Ref integration planning.

---

## 24. First development ticket sequence

If beginning immediately, create tickets in this order:

1. `FOUND-001 Scaffold Cloudflare React Worker monorepo`.
2. `FOUND-002 CI + typecheck + Vitest + Playwright smoke`.
3. `DB-001 D1/Drizzle base migrations`.
4. `AUTH-001 Better Auth email/password`.
5. `ORG-001 Organizations + tenant middleware`.
6. `ORG-002 Organization People abstraction`.
7. `I18N-001 ES/EN infrastructure`.
8. `UI-001 HUAU tokens + Montserrat + app shells`.
9. `TENG-001 Tournament domain types`.
10. `TENG-002 Legacy standings parity`.
11. `TENG-003 Cross-group normalized/equalized`.
12. `TENG-004 Bracket/progression`.
13. `TENG-005 Scheduler + two-round fix`.
14. `TMIG-001 Legacy JSON importer`.
15. `TSAFE-001 Snapshots/structure lock`.
16. `TEAM-001 Team format schema`.
17. `TEAM-002 Encounter/rubber engine`.
18. `TEAM-003 Lineup validator`.
19. `TEAM-004 Team standings`.
20. `REG-001 Registration state machine`.
21. `REG-002 Pair/team invitations`.
22. `PAY-001 Payment account/OAuth foundation`.
23. `PAY-002 Mercado Pago order + webhook`.
24. `PUB-001 Public tournament projection`.
25. `LIVE-001 Durable Object room`.
26. `OFF-001 IndexedDB tournament repository`.
27. `OFF-002 Mutation queue/revision sync`.
28. `E2E-SEP-001 Full September tournament rehearsal fixture`.

---

## 25. Stop conditions

Do not move to production event use if any of these remain unresolved:

- known data-loss path;
- wrong team winner/standings;
- two-round schedule regression;
- payment false-positive possibility;
- tenant isolation failure;
- offline result not safely saved locally;
- restore path untested;
- public endpoint leaks private fields.

---

## 26. Final outcome of implementation cycle

The first cycle is successful when HUAU can demonstrate two things simultaneously:

1. **Tournament:** operate a real configurable team tournament with online registration/payment and reliable live/offline execution.
2. **Club:** show a credible, functioning path from membership -> court reservation -> open match/community, proving that HUAU can become the club’s recurring operating layer rather than only an event tool.
