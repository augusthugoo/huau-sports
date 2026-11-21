-- HUAU Tournament Organizer Lote A.
-- Apply to the intended D1 environment BEFORE deploying Worker endpoints.
-- This creates only new tables; existing tournaments, registrations, payments,
-- Tournament Day checkpoints and sporting results are untouched.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tournament_organizers (
  tournament_id TEXT PRIMARY KEY NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  organizer_email TEXT NOT NULL,
  organizer_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  day_enabled INTEGER NOT NULL DEFAULT 0 CHECK (day_enabled IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  assigned_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tournament_organizers_email_status_idx
  ON tournament_organizers(organizer_email,status);
CREATE INDEX IF NOT EXISTS tournament_organizers_user_status_idx
  ON tournament_organizers(organizer_user_id,status);

CREATE TABLE IF NOT EXISTS tournament_organizer_audit (
  id TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN (
    'assigned','reassigned','refreshed','reactivated','revoked','day_enabled','day_disabled'
  )),
  old_email TEXT,
  new_email TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tournament_organizer_audit_tournament_idx
  ON tournament_organizer_audit(tournament_id,created_at);
