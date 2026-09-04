-- Phase 9A — Public Tournament Landing: tournament-specific public cover image.
PRAGMA foreign_keys=ON;

ALTER TABLE tournaments ADD COLUMN public_hero_r2_key TEXT;
