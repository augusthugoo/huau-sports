PRAGMA foreign_keys=ON;

-- Tournament Day is local-first.
-- D1 stores only access/publication/sync metadata; the large checkpoint lives in R2.
CREATE TABLE tournament_day_state (
  tournament_id TEXT PRIMARY KEY NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE,
  snapshot_r2_key TEXT,
  published_revision INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,
  finalized_at INTEGER,
  created_by_user_id TEXT REFERENCES user(id),
  sync_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle','syncing','synced','failed')),
  synced_revision INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  sync_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
