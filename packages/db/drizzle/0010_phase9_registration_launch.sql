PRAGMA foreign_keys=ON;

ALTER TABLE tournament_settings ADD COLUMN regulations_text TEXT NOT NULL DEFAULT '';
ALTER TABLE tournament_settings ADD COLUMN regulations_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournament_settings ADD COLUMN dupr_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournament_settings ADD COLUMN dupr_max REAL;
ALTER TABLE tournament_settings ADD COLUMN dupr_as_of_date TEXT;

ALTER TABLE user_profiles ADD COLUMN dupr_singles REAL;
ALTER TABLE user_profiles ADD COLUMN dupr_doubles REAL;

ALTER TABLE tournament_registrations ADD COLUMN regulations_version_accepted INTEGER;
ALTER TABLE tournament_registrations ADD COLUMN regulations_accepted_at INTEGER;

CREATE TABLE tournament_wild_cards (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  note TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);

CREATE INDEX IF NOT EXISTS tournament_wild_cards_tournament_idx
  ON tournament_wild_cards(tournament_id, created_at);

CREATE INDEX IF NOT EXISTS tournament_registrations_user_tournament_idx
  ON tournament_registrations(user_id, tournament_id, status);
