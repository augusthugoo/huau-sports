-- HUAU D.1: manual registrations confined to one tournament; no synthetic auth users.
-- The existing tournament_player_categories and manual_profile payment ledger remain authoritative.
ALTER TABLE tournament_player_profiles ADD COLUMN manual_age INTEGER;

CREATE TABLE IF NOT EXISTS assisted_join_requests (
  id TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  inviter_registration_id TEXT NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  manual_profile_id TEXT NOT NULL REFERENCES tournament_player_profiles(id) ON DELETE CASCADE,
  requested_by_user_id TEXT NOT NULL REFERENCES user(id),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')),
  resolved_by_user_id TEXT REFERENCES user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS assisted_join_requests_tournament_idx
  ON assisted_join_requests(tournament_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS assisted_join_requests_pending_uq
  ON assisted_join_requests(inviter_registration_id,manual_profile_id)
  WHERE status='pending';
