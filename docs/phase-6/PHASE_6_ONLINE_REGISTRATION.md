# Phase 6 — Online Registration

Version: `0.7.0-phase6-online-registration`

## Objective

Make HUAU Tournament registrable from the public side while preserving the Tournament and Team engines already approved in Phases 4 and 5.

## Delivered

### Public tournament registration
- Public route `/tournaments/:slug`.
- HUAU account required to register.
- Public category cards expose entry type, eligibility rules, capacity, waitlist and pricing policy.
- Registration closing time and Tournament/category structure locks are enforced server-side.

### Player eligibility
- `birth_date` and `sport_gender` are maintained in the HUAU user profile.
- Tournament categories now support explicit `min_age` and `max_age`.
- Age is evaluated at Tournament start date; category names such as `+40` are not parsed as rules.
- Gendered categories validate the canonical sport gender profile.

### Singles
- Eligible player creates an individual Tournament entry directly.
- Existing Tournament player/profile projection remains synchronized for legacy-compatible Tournament operation.

### Pairs
- Creator starts the doubles entry and invites the partner by HUAU email.
- Invitee can accept or decline from `Mis inscripciones`.
- Pair remains `inviting` until the second member accepts.
- Mixed pairs validate the final male/female composition.
- Duplicate participation in the same category is rejected.

### Teams
- Captain creates a Team entry and may invite roster members immediately or complete the roster later.
- Invitation acceptance creates the canonical organization/person + Tournament profile projection.
- Team readiness reuses the Phase 5 `TeamFormat` parser and roster validator.
- Incomplete Team entries stay in `inviting`; they are not falsely confirmed.

### Capacity and waitlist
- Category `max_entries` and `registration_status` are respected.
- Overflow registrations are stored as `waitlisted` with a position.
- Cancelling a waitlisted registration compacts remaining positions.
- Admin can promote a waitlisted registration when capacity is available.
- Existing manual Tournament entries are included in occupied-entry counts.

### Pricing boundary for Phase 7
- Supports `free`, `per_entry` and `per_person` pricing.
- Paid registrations become `awaiting_payment` / `pending_payment` only when structurally ready.
- Phase 6 does not invent or simulate a payment approval.
- Admin can apply discount, courtesy or fixed-total adjustments.

### Player workspace
- `Mis inscripciones` shows registrations, waitlist position and pending invitations.
- Player can accept/decline invitations and cancel their own registration.

### Tournament admin
- New `Inscripciones` workspace inside HUAU Tournament.
- Registration desk exposes creator, category, entry, state, amount and waitlist position.
- Public Tournament URL can be copied from the admin workspace.
- Admin can promote waitlist entries and apply courtesy/discount adjustments.

### Snapshot / restore
Tournament snapshots now preserve:
- `tournament_registrations`
- `entry_invitations`
- `registration_adjustments`

This keeps Phase 6 data inside the same Tournament recovery contract used by previous phases.

## Database migration

`packages/db/drizzle/0005_phase6_online_registration.sql`

Adds:
- `tournament_categories.min_age`
- `tournament_categories.max_age`
- `tournament_registrations`
- `entry_invitations`
- `registration_adjustments`
- supporting indexes and active-registration duplicate protection
- `schema_version = phase6-online-registration`

No Phase 7 payment provider tables or payment-success semantics are introduced here.

## Validation performed before handoff

- App TypeScript config: clean.
- Worker TypeScript config: clean.
- Node/Vite TypeScript config: clean.
- Core and DB TypeScript configs: clean.
- `noUnusedLocals` / `noUnusedParameters` pass on the modified app/worker/core surface.
- SQLite migration smoke test passed sequentially for `0000` through `0005`.
- Smoke result: schema version `phase6-online-registration`; all three Phase 6 tables and `min_age` / `max_age` exist.

The user's repository should still run the normal project gates after applying the ZIP:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Preview acceptance pass

Use at least three HUAU accounts and verify:
1. eligible single registration;
2. pair creator → partner invitation → partner acceptance;
3. Team captain → roster invitations → readiness after valid roster;
4. capacity overflow → waitlist → admin promotion;
5. paid category remains `awaiting_payment` rather than appearing paid;
6. courtesy/discount changes final amount and derived registration state correctly;
7. cancellation removes active participation and compacts waitlist positions.

## Phase boundary

Phase 6 ends at registration/payment requirement derivation. Mercado Pago connection, payment intents, receiver onboarding, webhooks and server-side payment verification belong to Phase 7.
