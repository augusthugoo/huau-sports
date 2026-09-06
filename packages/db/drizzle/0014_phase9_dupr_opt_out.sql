-- Phase 9 registration UX: optionally allow players without DUPR.
ALTER TABLE tournament_settings
  ADD COLUMN allow_no_dupr INTEGER NOT NULL DEFAULT 0
  CHECK (allow_no_dupr IN (0,1));
