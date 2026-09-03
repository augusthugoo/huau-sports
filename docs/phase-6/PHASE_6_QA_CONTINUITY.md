# Phase 6 QA Continuity Patch

This patch closes the second preview-QA batch before Phase 6 can merge to `main`.

## QA-05 — Mi HUAU organization-card overflow

- Organization cards now respect the panel width.
- Action buttons wrap instead of pushing the card border outside its container.

## QA-06 — Pair/team acceptance is not final confirmation

- Joining an invitation only completes pair/roster membership.
- If the registration has a non-zero amount it remains `awaiting_payment`.
- The accepted invitee continues to see the shared registration in `Mis inscripciones` instead of having it disappear.
- No fake payment confirmation is introduced; real payment execution remains Phase 7.

## QA-07 — Persistent pair/team registration management

`Mi HUAU -> Mis inscripciones` now exposes the existing entry after creation:

- accepted members;
- pending invitations;
- pair invitation replacement/resend;
- team member invitations after initial creation;
- pending invitation cancellation;
- team roster minimum/maximum context when a Team format exists;
- persistent `awaiting_payment` explanation.

The Tournament admin `Inscripciones` panel can also:

- see accepted members and pending invitees;
- invite/replace the missing pair member;
- add Team roster invitations;
- cancel a pending invitation.

The public registration form remains a creation surface. Once an entry exists, its continuation happens from `Mis inscripciones` / admin instead of attempting to register again.

## QA-08 — Maximum categories per player

Tournament settings now support `max_categories_per_player`:

- blank = no limit;
- positive integer = maximum active categories for one HUAU user in the tournament;
- accepted singles/pair/team membership counts;
- pending invitations do **not** count until accepted;
- cancelled/withdrawn/rejected entries do not count;
- the limit is enforced when creating a registration and when accepting an invitation;
- the public tournament page shows current usage when a maximum is configured.

Manual/admin participant management remains the administrative override path.

## Database

New migration:

`packages/db/drizzle/0006_phase6_registration_continuity.sql`

It adds:

`max_categories_per_player INTEGER NULL`

to `tournament_settings` and advances `app_meta.schema_version` to:

`phase6-registration-continuity`

Because the current D1 migration ledger was historically not populated, do **not** run a blanket `wrangler d1 migrations apply` against the existing dev/staging databases. Apply only `0006` directly after code gates pass.

## Focused preview QA

1. Mi HUAU organization card stays inside its panel.
2. Pair: A creates -> B joins -> invitation disappears but shared registration remains for both.
3. Paid pair remains `awaiting_payment`, not `confirmed`.
4. Pair creator can replace/resend a pending partner invitation from `Mis inscripciones`.
5. Admin can send/replace the partner invitation from Tournament -> Inscripciones.
6. Team captain can add roster invitations after initial creation and cancel pending ones.
7. Accepted Team member sees the shared registration.
8. Configure max categories = 2; third registration is rejected.
9. Pending invitation does not consume category-limit quota; accepting it does.
10. Existing base + extra pricing remains unchanged.
