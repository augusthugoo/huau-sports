-- HUAU Legal V2. Apply to the exact D1 environment BEFORE deploying the Worker.
-- No changes to existing users, payments, tournaments or results.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS legal_signup_acceptances (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  user_id TEXT,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  account_role TEXT NOT NULL CHECK (account_role IN ('adult','guardian')),
  guardian_attested INTEGER NOT NULL DEFAULT 0,
  accepted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  started_at INTEGER,
  recorded_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','started','recorded')),
  FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS legal_signup_acceptances_email_created_idx
  ON legal_signup_acceptances (email,created_at);
CREATE INDEX IF NOT EXISTS legal_signup_acceptances_user_idx
  ON legal_signup_acceptances (user_id,recorded_at);
