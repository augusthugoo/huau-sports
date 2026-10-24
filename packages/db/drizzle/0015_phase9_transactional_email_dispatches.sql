PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS email_dispatches (
  event_key TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  provider_message_id TEXT,
  error_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS email_dispatches_status_updated_idx
  ON email_dispatches(status, updated_at);
