-- Phase 6 QA hardening: tournament-wide player category limit.
ALTER TABLE tournament_settings ADD COLUMN max_categories_per_player INTEGER;

INSERT INTO app_meta(key,value,updated_at)
VALUES('schema_version','phase6-registration-continuity',CAST(strftime('%s','now') AS INTEGER))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
