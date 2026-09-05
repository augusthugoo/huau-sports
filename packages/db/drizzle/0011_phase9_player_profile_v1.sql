-- Phase 9 Player Profile V1.
-- DUPR ID is intentionally not indexed: it is profile metadata, not a hot lookup key.
ALTER TABLE user_profiles ADD COLUMN dupr_id TEXT;
