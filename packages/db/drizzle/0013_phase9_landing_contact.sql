PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS platform_contact_leads (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  organization_type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS platform_contact_leads_status_created_idx
  ON platform_contact_leads(status, created_at DESC);
