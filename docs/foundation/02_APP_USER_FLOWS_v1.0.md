# HUAU Sports - App & User Flows v1.0

**Estado:** Baseline funcional  
**Fecha:** 2026-08-29  
**Depende de:** PRD v1.0

---

## 1. Principios de navegación

- Una sola identidad HUAU.
- Un solo login.
- El usuario ve espacios según contexto y permisos.
- Lo público no requiere login.
- Tournament Live es el mismo producto responsive en móvil, desktop y TV.
- El jugador usa principalmente móvil.
- Organización/admin usa principalmente desktop/tablet.
- Ref usa principalmente tablet landscape.

---

## 2. Mapa de superficies

```text
HUAU PUBLIC
├─ Landing
├─ Organizations
│  └─ Organization public page
└─ Tournaments
   └─ Tournament Live / public page

AUTH
├─ Sign up
├─ Sign in
├─ Verify email
└─ Recover password

MY HUAU
├─ Home / Mi semana
├─ Organizations
├─ Reservations
├─ Open matches
├─ Activities / Open Play
├─ Tournaments
├─ Invitations
└─ Profile

ORGANIZATION ADMIN
├─ Overview
├─ Members
├─ Memberships
├─ Venues & Courts
├─ Reservations
├─ Community / Open matches
├─ Activities
├─ Tournaments
├─ Payments
├─ Branding / Settings
└─ Analytics

TOURNAMENT WORKSPACE
├─ Setup
├─ Registrations
├─ Participants
├─ Categories & formats
├─ Draw / groups
├─ Schedule
├─ Results
├─ Standings
├─ Final phase
├─ Teams (when applicable)
├─ Publish / Live
├─ Backups / Restore
└─ Event operation mode

HUAU REF
├─ Match setup / assigned match
├─ Scoring
├─ Timeout / Warning / Correction
└─ Summary

PLATFORM ADMIN
├─ Organizations
├─ Modules / Feature flags
├─ Support mode
├─ Integrations health
├─ Critical audit
└─ Platform analytics
```

---

# 3. Public flows

## PF-01 - Landing -> Organization

**Actor:** Visitor

1. Visitor opens HUAU landing.
2. Sees value proposition and modules.
3. Can:
   - open a public organization;
   - open a public tournament;
   - sign in;
   - create account;
   - contact HUAU.
4. Organization public page shows configured public content.
5. If user wants member-only action -> authentication gate.

**Acceptance:** browsing public content never forces account creation.

---

## PF-02 - Public Tournament Live

**Actor:** Visitor/player/spectator

1. Opens `/tournaments/:slug`.
2. Header shows tournament name, organizer, venue, dates and live status.
3. User can select category.
4. Category view exposes:
   - format summary;
   - criteria details;
   - participants if public;
   - groups;
   - schedule;
   - live standings;
   - results;
   - bracket/final phase.
5. Live updates arrive automatically while online.
6. If realtime is unavailable, app falls back to refresh strategy.
7. Shows last updated timestamp when data is stale.
8. TV mode changes presentation, not source of truth.

**No login required.**

---

# 4. Authentication & account flows

## AF-01 - Create HUAU account

1. User taps `Crear cuenta`.
2. Enters:
   - first name;
   - last name;
   - email;
   - password.
3. Accepts required legal terms.
4. Account is created in unverified state.
5. Verification email sent.
6. User verifies.
7. HUAU creates global profile.
8. Optional progressive profile asks only what is useful now:
   - phone;
   - country/city;
   - sport preferences;
   - rating/level.
9. User enters `Mi HUAU`.

**Failure states:** duplicate email, weak password, expired token, email delivery retry.

---

## AF-02 - Sign in

1. Email/password.
2. Auth session created.
3. Route resolver checks capabilities and last context.
4. Default destination: `Mi HUAU`.
5. Admin contexts are accessible from context switcher, not separate login.

---

## AF-03 - Password recovery

1. User requests reset.
2. Email with time-limited token.
3. New password.
4. Existing sessions can be revoked according to auth policy.

---

# 5. Organization membership flows

## MF-01 - Request to join a club/organization

1. Logged-in user opens organization public page.
2. Taps `Solicitar unirme`.
3. HUAU displays current known identity.
4. Optional club-specific question/note.
5. Request enters `pending`.
6. Organization Admin sees request.
7. Admin verifies membership externally.
8. Admin approves or rejects.
9. If approved:
   - organization membership created;
   - sport entitlements/membership plan assigned manually;
   - user sees organization in Mi HUAU.
10. User receives in-app notice; email only if notification matrix marks it important.

---

## MF-02 - Admin approves membership

1. Admin opens `Members > Requests`.
2. Opens request.
3. Sees profile, requested organization and any relevant info.
4. Selects membership/entitlements:
   - Pickleball;
   - Padel;
   - Tennis;
   - General;
   - custom future option.
5. Sets expiration if needed.
6. Approves.
7. System records actor/time.

---

## MF-03 - Manual member status update

1. Admin opens member.
2. Changes status or sports entitlement.
3. If change affects future reservations, HUAU shows impact before save.
4. Existing confirmed reservations are not silently deleted.
5. Save.

---

# 6. Court reservation flows

## RF-01 - Private reservation

**Actor:** Member

1. `Reservar cancha`.
2. Select sport.
3. Select date.
4. HUAU shows available intervals/courts according to rules.
5. Select start time + duration.
6. Choose `Privada`.
7. HUAU validates:
   - entitlement;
   - booking limits;
   - availability;
   - duration rules.
8. If auto-approval:
   - reservation -> `confirmed`.
9. If manual approval:
   - reservation -> `pending_approval`;
   - interval receives provisional hold.
10. Admin approves/rejects.
11. User sees state in `Mi semana`.

**Race condition:** if availability changed before submit, return conflict and refresh options.

---

## RF-02 - Open reservation / open match

1. Same steps as private reservation through slot selection.
2. User selects `Partido abierto`.
3. Configures:
   - total player slots;
   - already occupied/guest slots;
   - level recommendation;
   - gender/mode when relevant;
   - description;
   - visibility.
4. Reservation requested/confirmed.
5. Open match becomes visible only when reservation has valid hold/status.
6. Other users may join.
7. If completed -> state `full`.
8. If player leaves -> slot reopens.
9. At configured cutoff:
   - if minimum players reached -> remains;
   - otherwise auto-cancel/release if club enabled this rule.

---

## RF-03 - Admin reservation approval

1. Admin opens `Reservations > Pending`.
2. Sees:
   - member;
   - membership status;
   - sport;
   - court;
   - date/time;
   - duration;
   - private/open.
3. Approve or reject.
4. Approval converts provisional hold to confirmed booking.
5. Rejection releases interval immediately.

---

## RF-04 - Admin blocks court

1. `Venues & Courts` or calendar.
2. Select court(s), interval, reason.
3. HUAU finds conflicting reservations.
4. If none -> block.
5. If conflicts -> show explicit list and require resolution; never silently cancel.
6. Save block.

---

# 7. Open match/community flows

## CF-01 - Browse open matches

1. User opens organization `Comunidad / Partidos`.
2. Filter by sport/date/level optional.
3. Cards show:
   - date/time;
   - venue/court;
   - modality;
   - level;
   - slots filled;
   - creator.
4. User opens detail.
5. Taps `Sumarme` if eligible.
6. Server validates capacity atomically.
7. User becomes participant or waitlisted.

---

## CF-02 - Leave match

1. Participant opens match.
2. Taps `Bajarme`.
3. Confirmation.
4. Slot reopens.
5. If waitlist exists, first eligible waitlisted user is promoted according to policy.
6. Match remains visible until cutoff.

---

## CF-03 - Creator cancels

1. Creator opens match/reservation.
2. Taps cancel.
3. HUAU shows cancellation policy and participants affected.
4. Confirm.
5. Reservation cancelled/released.
6. Match closes.
7. Participants see in-app status; critical email policy configurable.

---

# 8. Open Play flows

## OP-01 - Admin creates Open Play

1. Organization Admin -> `Activities > New`.
2. Type = Open Play.
3. Configure:
   - sport;
   - date/time or recurrence;
   - linked courts;
   - capacity;
   - level optional;
   - membership eligibility optional;
   - price optional;
   - description.
4. HUAU reserves/blocks linked court capacity.
5. Publish.
6. Activity appears in member community/home.

---

## OP-02 - User joins Open Play

1. User opens activity.
2. HUAU checks eligibility.
3. If capacity -> registered.
4. If full -> waitlist.
5. If paid Open Play is not enabled in current release, UI must not offer automatic payment; admin can use manual process or feature remains disabled.

No attendance/rotation workflow in V1.

---

# 9. Tournament creation flow

## TF-01 - Create tournament shell

1. Organization Admin -> `Tournaments > Create`.
2. Configure:
   - name;
   - organizer organization;
   - venue;
   - dates/timezone;
   - sports;
   - court count/courts;
   - visibility;
   - branding;
   - public slug;
   - payment receiver/account if applicable.
3. Save as draft.
4. Tournament dashboard opens with setup checklist.

Checklist examples:

- Basic info.
- Categories.
- Registration.
- Payment.
- Format.
- Publish registration.
- Close registration.
- Draw/groups.
- Schedule.
- Lock structure.
- Run event.

---

# 10. Tournament category flows

## TF-02 - Create standard category

1. Admin creates category.
2. Entry type:
   - individual;
   - pair.
3. Configure eligibility/name.
4. Configure price/capacity.
5. Choose format preset or advanced builder.
6. Format engine validates configuration.
7. Explanation preview updates live.
8. Save version.

---

## TF-03 - Standard format builder

Configuration sections use progressive disclosure:

**Entries & groups**

- group sizes/number;
- 1 or 2 rounds;
- qualifiers per group;
- wildcard spots.

**Cross-group**

- normalized;
- equalized.

**Post-group**

- standard bracket;
- Top 2 final;
- Top 4 semis;
- Top 3 step;
- league only;
- consolation.

**Medals**

- bronze;
- sequential/simultaneous;
- BO1/BO3;
- point targets.

**Seeding**

- serpentine rating;
- manual;
- random;
- avoid immediate group rematch.

At every step HUAU shows estimated matches/time and a human explanation.

---

# 11. Registration flows

## REG-01 - Singles registration

1. Logged user opens public tournament.
2. `Inscribirme`.
3. Select eligible category.
4. HUAU checks capacity and duplicate entry.
5. Entry becomes `pending_payment` or `confirmed` if free.
6. Payment flow.
7. Approved payment -> confirmed.
8. Confirmation page + optional email.

---

## REG-02 - Pair registration

1. User selects doubles category.
2. HUAU creates draft pair entry.
3. User searches/invites partner by email/account.
4. Invitation -> pending.
5. Partner accepts.
6. Pair eligibility validated.
7. Entry moves to payment-ready.
8. Price scope determines payer flow:
   - per entry: one payer covers entry;
   - per person: both member payment obligations tracked.
9. Entry confirmed only when policy satisfied.

**Admin override:** create pair manually or resolve missing account.

---

## REG-03 - Team registration

1. Captain selects team category.
2. Creates team name.
3. HUAU shows roster rules.
4. Captain invites members.
5. Each invitation can be accepted/declined.
6. Team readiness meter shows composition requirements.
7. Admin may add manual participants.
8. Once roster valid, payment becomes available.
9. Payment policy:
   - per team;
   - per member.
10. Entry confirmed when roster + payment requirements are met.

---

## REG-04 - Waitlist

1. Category full.
2. User can join waitlist.
3. Entry position recorded.
4. When slot released, promotion policy runs.
5. Promoted entry receives payment window if needed.
6. If payment window expires, next waitlist entry may be promoted.

Exact timing is organization/tournament configuration.

---

# 12. Mercado Pago payment flow

## PAY-01 - Automatic tournament payment

1. Registration has amount and receiver payment account.
2. Client requests `Create checkout`.
3. Server validates entry, amount, capacity and status.
4. Server creates internal payment attempt with unique idempotency key.
5. Server creates Mercado Pago order with external reference.
6. Client redirects to Mercado Pago checkout URL.
7. User pays.
8. Browser may return to HUAU, but state remains `processing` until verified.
9. Mercado Pago webhook arrives.
10. Server verifies signature and retrieves/validates provider state.
11. Payment becomes approved/rejected/etc.
12. Registration state recalculated.
13. Realtime/public/admin update triggered.

**Never:** mark paid solely from success return URL.

---

## PAY-02 - Manual transfer/cash

1. User chooses manual payment method if tournament allows it.
2. HUAU shows instructions.
3. Optional `Enviar comprobante por WhatsApp` deep link.
4. Registration remains `payment_pending_manual`.
5. Admin checks transfer/cash externally.
6. Admin opens Payments and marks as paid.
7. Critical audit event recorded.
8. Registration becomes confirmed if all other conditions satisfied.

---

# 13. Draw and group generation flows

## DRAW-01 - Generate groups

1. Registration closes or admin chooses eligible confirmed entries.
2. Admin opens category `Draw`.
3. Chooses configured seeding method.
4. Preview generated.
5. HUAU shows group sizes and explanation.
6. Admin confirms.
7. Snapshot created.
8. Groups become current competition structure.
9. Public publish remains explicit.

---

## DRAW-02 - Live draw

1. Admin launches live draw.
2. HUAU displays participant pool.
3. Draw next/autoplay/pause/reshuffle as current legacy capability.
4. Nothing destructive is committed until final confirmation.
5. On confirm -> snapshot + groups.

---

## DRAW-03 - Manual groups

1. Admin selects manual distribution.
2. Places each entry in group.
3. Counters validate exact target sizes.
4. Cannot confirm invalid distribution.
5. Confirm -> snapshot.

---

# 14. Schedule flow

## SCH-01 - Generate schedule

1. Categories/groups exist.
2. Admin configures:
   - category day/order;
   - match duration by category;
   - court availability;
   - preferred rest.
3. Scheduler groups by competition round.
4. For two-round groups:
   - schedules all Round/Vuelta 1 first;
   - then Vuelta 2.
5. Scheduler enforces no simultaneous player.
6. Reserves placeholders for later final rounds.
7. Preview includes start/end estimates.
8. Admin confirms.
9. Snapshot created.
10. Schedule can be published and exported as image.

---

# 15. Event operation flows

## EVT-01 - Operator mode

Purpose: simplify the live event for a less technical operator.

1. Admin selects `Operar torneo`.
2. UI focuses on:
   - Now;
   - Next;
   - Courts;
   - Result entry;
   - category status.
3. Advanced configuration is hidden behind `Tournament settings`.
4. Result entry immediately recalculates dependent views locally.
5. If online -> sync + broadcast.
6. If offline -> mutation queued + offline indicator.

---

## EVT-02 - Enter result

1. Open scheduled match.
2. Enter score or sets.
3. Client validates basic structure but does not impose win-by-two when event rules permit manual override.
4. Save.
5. Match finalizes.
6. Engine updates:
   - standings;
   - qualification readiness;
   - bracket propagation if already generated;
   - live state.
7. Offline -> save locally first, queue sync.

---

## EVT-03 - Complete groups -> generate final phase

1. Last required group result is entered.
2. Category shows `Groups complete`.
3. HUAU calculates final standings and cross-group ranking.
4. Explanation panel shows why entries qualify/seeding.
5. Admin taps `Generate final phase`.
6. Preview bracket.
7. Confirm -> snapshot.
8. Reserved schedule placeholders bind to real matches.
9. Publish live.

---

# 16. Team competition flows

## TEAM-01 - Configure team category

1. Category entry type = `team`.
2. Define roster min/max and composition rules.
3. Open `Encounter Builder`.
4. Add ordered rubbers.
5. For each rubber:
   - singles/doubles;
   - gender/mode;
   - scoring rules;
   - always/conditional;
   - tiebreaker flag.
6. Define encounter winner rule.
7. Define competition phase like any other entry competition.
8. Explanation preview generated.
9. Save format version.

---

## TEAM-02 - Build lineup for encounter

1. Encounter Team A vs Team B exists.
2. Admin opens lineup.
3. For each rubber, selects eligible roster members for both teams.
4. HUAU validates:
   - roster membership;
   - required player count;
   - gender/mode constraints;
   - duplicate restrictions if configured.
5. Save draft.
6. `Lock lineup` before first rubber.
7. Post-lock edit requires explicit unlock/impact confirmation if no conflicting result exists.

---

## TEAM-03 - Run encounter

1. Encounter starts.
2. Rubbers appear in configured order.
3. Result entered per rubber.
4. Encounter score updates (e.g. 2-1).
5. Conditional tiebreaker activates only if trigger condition met.
6. When winner condition is met:
   - encounter winner determined;
   - optional remaining rubbers played or skipped according to format.
7. Team standings update.

---

## TEAM-04 - September preset example

This is a preset, not hardcoded behavior:

1. Men’s Doubles.
2. Women’s Doubles.
3. Men’s Singles.
4. Women’s Singles.
5. Mixed Doubles.

The builder determines whether #5 is always played or only if tied 2-2.

---

# 17. Format Explanation flows

## EXP-01 - Organizer preview

1. Format changes.
2. Engine returns structured explanation tokens/sections.
3. Localizer renders Spanish/English.
4. Organizer sees:
   - short summary;
   - exact criteria expandable.
5. Organizer may add separate logistical note.

---

## EXP-02 - Player/public explanation

1. Player opens category.
2. Short explanation visible by default.
3. `Ver criterios` expands:
   - group ranking;
   - cross-group logic;
   - qualifiers;
   - bracket/tiebreak rules.
4. Mathematical text is read-only and tied to format version.

---

# 18. Data safety flows

## SAFE-01 - Cosmetic participant edit

1. Admin edits name/contact/notes.
2. System classifies change as non-structural.
3. Existing entry/group/match references update display data.
4. No competition or schedule regenerated.

---

## SAFE-02 - Structural participant edit

1. Admin changes category/partner/roster participation.
2. HUAU computes affected scope.
3. Modal states explicitly:
   - category affected;
   - groups impacted;
   - schedule impact;
   - results risk.
4. If allowed, automatic snapshot created.
5. Admin confirms.
6. Only affected competition scope invalidated/regenerated.
7. Other categories remain untouched.

---

## SAFE-03 - Structure lock

1. Admin locks category before/event start.
2. Structural controls become disabled.
3. To modify:
   - tap unlock;
   - read impact warning;
   - confirm;
   - snapshot.
4. Results remain editable under result correction flow.

---

## SAFE-04 - Restore

1. Admin/support opens `Recovery`.
2. Sees named snapshots/hits.
3. Selects snapshot.
4. HUAU shows what will revert.
5. Creates a pre-restore snapshot of current state.
6. Restores selected scope.
7. Broadcast/sync revision increments.

---

# 19. Offline flows

## OFF-01 - Prepare tournament device

1. Operator opens tournament while online.
2. Taps/receives `Available offline` status.
3. App caches shell/assets and tournament working data.
4. PWA confirms local readiness.
5. Optional JSON backup exported before event.

---

## OFF-02 - Connection lost during event

1. Network detector changes to offline.
2. Non-blocking persistent banner: `Sin conexión - trabajando localmente`.
3. Result entry continues.
4. Mutations receive local IDs and queue order.
5. UI uses local Tournament Engine immediately.
6. Public cloud live remains at last synced state.

---

## OFF-03 - Reconnect

1. Connectivity restored.
2. Sync worker sends queued mutations in order with idempotency keys.
3. If server revision compatible -> mutations accepted.
4. Server returns new revision.
5. Local snapshot revalidated.
6. Realtime update broadcast.
7. If conflict:
   - do not silently overwrite;
   - pause affected mutation;
   - show conflict resolver/support path.

---

# 20. HUAU Ref flows

## REF-01 - Standalone event use

1. Ref opens as dedicated PWA/surface.
2. Configure:
   - singles/doubles;
   - teams/players;
   - scoring traditional/rally;
   - BO1/3/5;
   - points 11/15/21;
   - first server.
3. Confirm summary.
4. Score match.
5. Use timeout/warning/correction/undo/redo as needed.
6. Finish.
7. Show final summary.
8. Result communicated to delegate manually.

Works without network.

---

## REF-02 - Future connected referee

1. Referee signs in.
2. Sees assigned matches.
3. Opens assigned match; roster/config auto-loaded.
4. Match is cached locally.
5. Referee scores offline/online.
6. Finalization creates signed/result submission.
7. Tournament receives result.
8. Depending on event policy:
   - auto-finalize; or
   - table confirms.

---

# 21. Platform Admin flows

## PA-01 - Organization support mode

1. Platform Admin opens organization.
2. Selects `Entrar en modo soporte`.
3. UI displays persistent support banner.
4. Support session gets explicit scoped authorization.
5. Admin can inspect operational data and perform allowed fixes.
6. Sensitive payment credentials remain masked/non-readable.
7. Every write produces critical audit event.
8. Exit support mode.

---

## PA-02 - Enable module/feature

1. Platform Admin opens organization.
2. Modules:
   - Club;
   - Tournament;
   - Ref capability;
   - beta flags.
3. Toggle/plan change.
4. Entitlements updated.
5. Organization UI updates on next auth/context refresh.

---

# 22. Coach flows - deferred P2

## COACH-01 - Coach activity

1. Coach capability exists.
2. Coach drafts class/session.
3. Depending on organization policy:
   - auto publish; or
   - admin approval.
4. Activity reserves required court/time.
5. Members register.
6. Coach sees agenda.

This flow is documented now but not a P0/P1 launch blocker.

---

# 23. Navigation guard rules

- Public routes: anonymous allowed.
- `/app/*`: authenticated user.
- Organization admin routes: authenticated + organization admin permission.
- Platform routes: platform-admin explicit allowlist/role.
- Tournament write routes: organization/tournament capability.
- Ref connected routes: assigned capability/event permission.
- Every server write re-checks authorization; frontend guards are never treated as security.

---

# 24. Empty/error state requirements

Every primary flow must define:

- loading;
- empty;
- offline;
- permission denied;
- conflict;
- validation error;
- server error;
- stale state.

Critical tournament screens must not collapse to generic “Something went wrong”; they must preserve the last safe local state where possible.
