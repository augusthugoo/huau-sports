# Phase 6 — Registration Redesign

## Product decision

Phase 6 now treats a player's registration as the durable object. Doubles partners and Team rosters are relationships between already-registered players, rather than invitations that implicitly create or hide another player's registration.

## Public registration UX

The public tournament page uses a multi-category selection tray:

1. Add/remove categories locally with no registration write per click.
2. See the current estimated price of each selected category.
3. Configure Team choice (`free` or create team) and captain payment mode when relevant.
4. Confirm once.
5. Server revalidates the complete request and creates the personal registrations.

## Doubles state model

- Personal registration with no competitive entry: `free / looking for partner`.
- Invitation targets another free personal registration in the same category.
- Accept creates one pair `tournament_entry` and attaches both personal registrations.
- Unlink removes the pair entry and both personal registrations become free again.
- Cancelling one personal registration unlinks the pair first; the other registration survives and becomes free.

## Team state model

- Personal registration with no Team entry: `free`.
- A free player may create a Team and becomes captain.
- Captain invites free personal registrations from the same Team category.
- Accept attaches the invitee's personal registration to the Team entry and adds the organization person to the roster.
- Member leave detaches only that personal registration.
- Captain dissolve withdraws the Team entry and detaches all active registrations without cancelling their personal registrations.

## Pricing model

Team pricing settings are independent from the standard tournament base/extra model but category-level explicit price overrides remain possible.

- `team_individual_fee_minor`: standard personal Team participation.
- `team_full_fee_minor`: captain covers the full Team.
- `team_additional_participation_mode`: `full`, `extra`, `free`.
- `team_additional_fee_minor`: value when mode is `extra`.
- `allow_team_age_division_overlap`: whether an otherwise eligible player may participate in more than one age-based Team division.

`covered_by_registration_id` marks an accepted Team member whose personal fee is covered by a captain's `team_full` registration.

## Capacity / waitlist

Pair and Team category capacity is consumed by competitive entries, not by ungrouped personal registrations. A free doubles player or free Team player can register before a pair/Team slot exists; capacity is rechecked when a pair is formed or Team is created. Waitlisted competitive entries can still complete their composition, and admin promotion recalculates every linked personal registration together.

## Compatibility

Migration `0007` cancels only stale **pending** invitations from the previous email/shared-entry flow. Historical accepted data is kept for compatibility. `Mis inscripciones` retains a compatibility fallback for users who only exist inside an older shared entry.

## Payment boundary

No fake payment success is introduced in Phase 6. Positive amounts remain `awaiting_payment`; competitive entries use `pending_payment` when composition is ready but payment is unresolved. Phase 7 is responsible for turning approved payment events into confirmed payment/registration state.

## QA acceptance focus

- selecting multiple categories is instant;
- basket total follows existing registrations + selected order;
- max categories enforced client-side and server-side;
- +50 player can also select +40 only when eligible and overlap is enabled;
- free doubles players can invite each other and both keep their own registration;
- unlink/cancel returns surviving registration to free state;
- free Team player can create Team later;
- Team captain can invite only same-category free registrations;
- individual-vs-full-Team payment responsibility recalculates correctly;
- leaving/dissolving clears captain coverage and recalculates personal amount/status;
- waitlist promotion updates all personal registrations attached to the same competitive entry;
- snapshot/restore includes Team payment mode, captain coverage and registration-match invitations.
