-- Phase 6 registration redesign: personal registrations first, grouping second.
-- Adds team pricing policy, team payment responsibility, and registration-to-registration matching.

ALTER TABLE tournament_settings ADD COLUMN team_individual_fee_minor INTEGER;
ALTER TABLE tournament_settings ADD COLUMN team_full_fee_minor INTEGER;
ALTER TABLE tournament_settings ADD COLUMN team_additional_participation_mode TEXT NOT NULL DEFAULT 'full'
  CHECK (team_additional_participation_mode IN ('full','extra','free'));
ALTER TABLE tournament_settings ADD COLUMN team_additional_fee_minor INTEGER;
ALTER TABLE tournament_settings ADD COLUMN allow_team_age_division_overlap INTEGER NOT NULL DEFAULT 1;

ALTER TABLE tournament_entries ADD COLUMN team_payment_mode TEXT
  CHECK (team_payment_mode IN ('individual','team_full'));

ALTER TABLE tournament_registrations ADD COLUMN covered_by_registration_id TEXT
  REFERENCES tournament_registrations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS registration_match_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pair','team')),
  inviter_registration_id TEXT NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  invitee_registration_id TEXT NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  inviter_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  invitee_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  team_entry_id TEXT REFERENCES tournament_entries(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  expires_at INTEGER NOT NULL,
  responded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (inviter_registration_id <> invitee_registration_id)
);
CREATE INDEX IF NOT EXISTS registration_match_invitee_idx
  ON registration_match_invitations(invitee_user_id,status,created_at);
CREATE INDEX IF NOT EXISTS registration_match_inviter_idx
  ON registration_match_invitations(inviter_registration_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS registration_match_pending_pair_uq
  ON registration_match_invitations(inviter_registration_id,invitee_registration_id)
  WHERE status='pending';

-- Old email invitations belong to the previous shared-entry flow. Keep the audit trail,
-- but prevent stale pending invitations from competing with registration matching.
UPDATE entry_invitations SET status='cancelled', updated_at=CAST(strftime('%s','now') AS INTEGER)
WHERE status='pending';

INSERT INTO app_meta(key,value,updated_at)
VALUES('schema_version','phase6-registration-redesign',CAST(strftime('%s','now') AS INTEGER))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
