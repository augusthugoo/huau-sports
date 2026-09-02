# Phase 6 QA Hardening

This patch closes the functional gaps found during preview QA before Phase 6 is merged to `main`.

## Fixed

1. **Closed / locked registration state is public before login**
   - Anonymous visitors no longer see a misleading sign-in CTA for a category that cannot accept registrations.
   - Tournament deadline, tournament registration state and competition structure lock are surfaced on the public category card.

2. **Structure lock protects registration reopening**
   - A locked tournament/category cannot be changed from closed to open/waitlist-only registration.
   - Admin UI explains the lock and disables reopening options.
   - Existing locked competitions remain readable and can still be closed.

3. **Tournament pricing is the default source of truth**
   - Category `price_minor = NULL` means **inherit tournament pricing**.
   - Tournament `per_category`, `base_plus_extra`, and `free` settings now drive online registration amounts.
   - Categories can still explicitly override with free, per-entry or per-person pricing.
   - Explicit category free is stored as `price_scope='free', price_minor=0`; inherited pricing remains `price_minor=NULL`.
   - Base + extra pricing is stable by registration number so accepting an invitation does not accidentally turn the first registration into an extra-category price.

4. **Global HUAU profile / progressive eligibility**
   - `Mi HUAU` now exposes the minimum global profile required by Tournament: first name, last name, birth date and sport gender.
   - Public registration asks only when a category actually needs missing eligibility data.
   - `Mis inscripciones` can complete the same global profile inline before accepting an invitation.
   - Missing sport gender now returns `SPORT_GENDER_REQUIRED` before a mismatch rejection.

5. **New-account path is discoverable from login**
   - Login now links to account creation and signup links back to login.

## Database

No new migration is required. Phase 6 migration `0005_phase6_online_registration.sql` remains the latest schema change.

## QA rerun

After applying this patch, recheck:

- closed category while logged out;
- structure-locked category;
- `Mi HUAU -> Mi perfil` save;
- doubles invitation -> profile completion -> accept;
- tournament `Pago por categoría` inherited by a category;
- tournament `Base + categoría extra` first vs second registration;
- explicit category override (including explicit free);
- capacity / waitlist and admin promotion.
