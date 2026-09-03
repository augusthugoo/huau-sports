# HUAU Sports — Current State

Updated: 2026-09-03

## Current phase

Phase 6 — Online Registration

Version: `0.7.0-phase6-online-registration`

Validation branch: `phase-6`

## Completed before Phase 6

- Phase 0–3 platform, identity/org and Tournament persistence foundations.
- Phase 4 Tournament legacy parity and performance recovery.
- Phase 5 Team Competition Engine + Team Tournament integration.
- Standard and Team Tournament competition flows are operationally approved; large-dataset hardening remains later work.

## Phase 6 accepted foundation

Already integrated and QA-hardened before this redesign:

- public Tournament registration route;
- global HUAU profile eligibility using birth date + sport gender;
- explicit category min/max age;
- capacity + waitlist + admin promotion;
- free/per-entry/per-person pricing and tournament pricing inheritance;
- tournament `base + extra category` pricing;
- `awaiting_payment` boundary without fake payment confirmation;
- admin courtesy/discount/fixed-total adjustments;
- `Mis inscripciones` and Tournament admin `Inscripciones` workspace;
- tournament-wide `max_categories_per_player`;
- Phase 6 snapshot/restore persistence;
- migrations `0005_phase6_online_registration.sql` and `0006_phase6_registration_continuity.sql`.

## Phase 6 registration redesign

The final registration model is **personal registration first, grouping second**.

### Multi-category registration

- Categories are selected instantly in the public page without creating a registration on every click.
- A side tray shows the selected categories, pricing breakdown and estimated total.
- One confirmation sends the selection to the server in a single batch request.
- Server-side validation remains authoritative for eligibility, duplicates, category limit, age-division overlap, capacity and pricing.

### Doubles

- Each player owns a personal registration in the doubles category.
- A free player can search only other active registrations in the same category that are not already assigned to a pair.
- A pair invitation links two existing personal registrations; it never creates the invited player's registration.
- Decline/cancel leaves both registrations free.
- Unlinking or cancelling one player's registration makes the other player free again.
- A pair becomes a competitive `tournament_entry` only when the invitation is accepted.

### Team tournaments

- A player registers personally and may remain `free` or create a team.
- The creator becomes captain.
- Captains invite only players who already hold a free personal registration in that same category.
- Accepting links the existing personal registration to the team roster.
- Leaving a team preserves the player's personal registration and returns them to `free`.
- Dissolving a team returns all active members to `free` unless their own registration is separately cancelled.

### Team pricing

Tournament settings now support:

- individual team participation fee;
- full-team fee paid by the captain;
- additional team participation policy: full price / extra fee / free;
- additional participation amount when `extra` is selected;
- allow/disallow multiple eligible team age divisions.

A captain can choose:

- `individual`: every roster member is responsible for their own personal participation fee;
- `team_full`: the captain carries the full-team charge and accepted members are marked as covered by that captain registration.

A player eligible for multiple age divisions (for example +50 also playing +40) may do so only when the tournament allows age-division overlap and the tournament-wide maximum-category limit is not exceeded.

### Payments boundary

Phase 6 models price responsibility and keeps paid registrations in `awaiting_payment` until a payment is actually approved. Phase 7 will connect Mercado Pago/manual payment confirmation to these states. Pair/team matching is available in Phase 6 so the grouping model can be QA-tested before payment execution exists; Phase 7 can tighten payment gates without changing the registration/grouping data model.

## Phase 6 closeout

Dev preview QA passed for:

- multi-category registration tray and one-shot confirmation;
- tournament base/extra pricing and category limits;
- doubles free-player matching, invitations, linking and unlinking;
- Team free/captain flows, invitations and roster linking;
- Tournament admin visibility of correct pair/team assignments;
- organization card/button layout.

Final closeout hardening separates current participation from cancellation history and hides withdrawn/rejected Team entries from operational rosters without deleting audit history.

## Database state

- `huau-dev`: migrations `0005`, `0006`, and `0007_phase6_registration_redesign.sql` have been applied and preview-tested.
- This closeout patch requires **no new migration**.
- `huau-staging`: remains untouched until the controlled Phase 6 promotion step.
- Wrangler's historical migration ledger is incomplete/empty, so do **not** run a blanket `wrangler d1 migrations apply`; execute only the required migration file after taking a backup.

`0007_phase6_registration_redesign.sql` adds:

- Team pricing-policy columns on `tournament_settings`;
- `team_payment_mode` on `tournament_entries`;
- `covered_by_registration_id` on `tournament_registrations`;
- `registration_match_invitations` for registration-to-registration pair/team matching;
- schema marker `phase6-registration-redesign`.

## Immediate next actions

1. Apply the Phase 6 closeout overlay on branch `phase-6`.
2. Run `pnpm typecheck && pnpm lint && pnpm test`.
3. No D1 migration is required.
4. Commit/push and do one final preview check: current vs history registration sections and absence of withdrawn teams in operational rosters.
5. If green, Phase 6 is accepted for merge to `main` and controlled staging promotion.

## Next planned phase

Phase 7 — Payments / Mercado Pago + payments admin.

Phase 7 starts after this Phase 6 closeout is merged and promoted through the controlled staging flow.
