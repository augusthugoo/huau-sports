PRAGMA foreign_keys=ON;

ALTER TABLE tournament_categories ADD COLUMN min_age INTEGER;
ALTER TABLE tournament_categories ADD COLUMN max_age INTEGER;

CREATE TABLE IF NOT EXISTS tournament_registrations (
  id TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES tournament_entries(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  registration_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','inviting','awaiting_payment','confirmed','waitlisted','cancelled','rejected')),
  participant_count INTEGER NOT NULL DEFAULT 1,
  price_scope TEXT NOT NULL CHECK (price_scope IN ('free','per_entry','per_person')),
  base_amount_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  final_amount_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  waitlist_position INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tournament_id, registration_number)
);
CREATE INDEX IF NOT EXISTS tournament_registrations_tournament_idx ON tournament_registrations(tournament_id,status,created_at);
CREATE INDEX IF NOT EXISTS tournament_registrations_category_idx ON tournament_registrations(category_id,status,waitlist_position);
CREATE INDEX IF NOT EXISTS tournament_registrations_user_idx ON tournament_registrations(user_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS tournament_registrations_active_creator_category_uq
  ON tournament_registrations(user_id,category_id)
  WHERE status NOT IN ('cancelled','rejected');

CREATE TABLE IF NOT EXISTS entry_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  registration_id TEXT NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  inviter_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  invitee_email TEXT NOT NULL,
  invitee_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  member_role TEXT NOT NULL CHECK (member_role IN ('player','captain','substitute')),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  responded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entry_invitations_email_status_idx ON entry_invitations(invitee_email,status,created_at);
CREATE INDEX IF NOT EXISTS entry_invitations_user_status_idx ON entry_invitations(invitee_user_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS entry_invitations_pending_entry_email_uq
  ON entry_invitations(entry_id,lower(invitee_email)) WHERE status='pending';

CREATE TABLE IF NOT EXISTS registration_adjustments (
  id TEXT PRIMARY KEY NOT NULL,
  registration_id TEXT NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('discount','courtesy','fixed_total')),
  amount_minor INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS registration_adjustments_registration_idx ON registration_adjustments(registration_id,created_at);

INSERT INTO app_meta(key,value,updated_at)
VALUES('schema_version','phase6-online-registration',CAST(strftime('%s','now') AS INTEGER))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
