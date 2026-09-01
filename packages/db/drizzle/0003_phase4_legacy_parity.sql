-- Phase 4.1 full HUAU Tournament legacy parity.
CREATE TABLE IF NOT EXISTS tournament_settings (
  tournament_id TEXT PRIMARY KEY NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  club TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT 'Piriápolis',
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  daily_start TEXT NOT NULL DEFAULT '09:00',
  daily_end TEXT NOT NULL DEFAULT '20:00',
  default_match_minutes INTEGER NOT NULL DEFAULT 30,
  payment_type TEXT NOT NULL DEFAULT 'per_category',
  entry_fee_minor INTEGER,
  base_fee_minor INTEGER,
  extra_category_fee_minor INTEGER,
  registration_close_at INTEGER,
  minimum_group INTEGER NOT NULL DEFAULT 3,
  preferred_group INTEGER NOT NULL DEFAULT 4,
  maximum_group INTEGER NOT NULL DEFAULT 4,
  suggested_qualifiers_per_group INTEGER NOT NULL DEFAULT 2,
  seeding_method TEXT NOT NULL DEFAULT 'snake',
  minimum_rest_slots INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_player_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  organization_person_id TEXT REFERENCES organization_people(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  club TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  dupr_singles REAL NOT NULL DEFAULT 0,
  dupr_doubles REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  player_status TEXT NOT NULL DEFAULT 'confirmed',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS tournament_player_profiles_tournament_idx ON tournament_player_profiles(tournament_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS tournament_player_profiles_person_uq ON tournament_player_profiles(tournament_id, organization_person_id);

CREATE TABLE IF NOT EXISTS tournament_player_categories (
  player_profile_id TEXT NOT NULL REFERENCES tournament_player_profiles(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  partner_profile_id TEXT REFERENCES tournament_player_profiles(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_profile_id, category_id)
);
CREATE INDEX IF NOT EXISTS tournament_player_categories_category_idx ON tournament_player_categories(category_id);
CREATE INDEX IF NOT EXISTS tournament_player_categories_partner_idx ON tournament_player_categories(partner_profile_id);

CREATE TABLE IF NOT EXISTS tournament_draw_sessions (
  category_id TEXT PRIMARY KEY NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ready',
  state_json TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE tournament_entries ADD COLUMN source_kind TEXT;
ALTER TABLE tournament_entries ADD COLUMN source_key TEXT;
CREATE INDEX IF NOT EXISTS tournament_entries_source_idx ON tournament_entries(category_id, source_kind, source_key);

-- Backfill Phase 4 manual-entry tournaments into the legacy-parity player model.
-- This keeps existing preview/test tournaments usable after the migration instead
-- of forcing organizers to recreate players that already exist in entry_members.
WITH people_in_tournaments AS (
  SELECT DISTINCT
    tc.tournament_id AS tournament_id,
    em.organization_person_id AS organization_person_id
  FROM tournament_entries te
  JOIN tournament_categories tc ON tc.id = te.category_id
  JOIN entry_members em ON em.entry_id = te.id
  WHERE em.status <> 'removed'
)
INSERT OR IGNORE INTO tournament_player_profiles (
  id,
  tournament_id,
  organization_person_id,
  display_name,
  club,
  contact,
  dupr_singles,
  dupr_doubles,
  payment_status,
  player_status,
  notes,
  sort_order,
  created_at,
  updated_at,
  version
)
SELECT
  'backfill-' || lower(hex(randomblob(16))),
  pit.tournament_id,
  pit.organization_person_id,
  CASE
    WHEN trim(coalesce(op.first_name,'') || ' ' || coalesce(op.last_name,'')) <> ''
      THEN trim(coalesce(op.first_name,'') || ' ' || coalesce(op.last_name,''))
    ELSE 'Jugador'
  END,
  '',
  coalesce(op.phone, op.email, ''),
  coalesce((
    SELECT max(coalesce(te2.seed_rating,0))
    FROM tournament_entries te2
    JOIN tournament_categories tc2 ON tc2.id = te2.category_id
    JOIN entry_members em2 ON em2.entry_id = te2.id
    WHERE tc2.tournament_id = pit.tournament_id
      AND tc2.entry_type = 'individual'
      AND em2.organization_person_id = pit.organization_person_id
      AND em2.status <> 'removed'
  ),0),
  coalesce((
    SELECT max(coalesce(te3.seed_rating,0))
    FROM tournament_entries te3
    JOIN tournament_categories tc3 ON tc3.id = te3.category_id
    JOIN entry_members em3 ON em3.entry_id = te3.id
    WHERE tc3.tournament_id = pit.tournament_id
      AND tc3.entry_type = 'pair'
      AND em3.organization_person_id = pit.organization_person_id
      AND em3.status <> 'removed'
  ),0),
  'pending',
  'confirmed',
  '',
  row_number() OVER (
    PARTITION BY pit.tournament_id
    ORDER BY op.first_name, op.last_name, pit.organization_person_id
  ) - 1,
  CAST(strftime('%s','now') AS INTEGER),
  CAST(strftime('%s','now') AS INTEGER),
  1
FROM people_in_tournaments pit
JOIN organization_people op ON op.id = pit.organization_person_id;

INSERT OR IGNORE INTO tournament_player_categories (
  player_profile_id,
  category_id,
  partner_profile_id,
  created_at,
  updated_at
)
SELECT
  pp.id,
  te.category_id,
  CASE
    WHEN tc.entry_type = 'pair' THEN (
      SELECT pp2.id
      FROM entry_members em2
      JOIN tournament_player_profiles pp2
        ON pp2.tournament_id = tc.tournament_id
       AND pp2.organization_person_id = em2.organization_person_id
      WHERE em2.entry_id = te.id
        AND em2.status <> 'removed'
        AND em2.organization_person_id <> em.organization_person_id
      ORDER BY em2.created_at, em2.id
      LIMIT 1
    )
    ELSE NULL
  END,
  CAST(strftime('%s','now') AS INTEGER),
  CAST(strftime('%s','now') AS INTEGER)
FROM tournament_entries te
JOIN tournament_categories tc ON tc.id = te.category_id
JOIN entry_members em ON em.entry_id = te.id AND em.status <> 'removed'
JOIN tournament_player_profiles pp
  ON pp.tournament_id = tc.tournament_id
 AND pp.organization_person_id = em.organization_person_id
WHERE tc.entry_type IN ('individual','pair');

UPDATE tournament_entries
SET
  source_kind = 'legacy_player',
  source_key = (
    SELECT pp.id
    FROM entry_members em
    JOIN tournament_categories tc ON tc.id = tournament_entries.category_id
    JOIN tournament_player_profiles pp
      ON pp.tournament_id = tc.tournament_id
     AND pp.organization_person_id = em.organization_person_id
    WHERE em.entry_id = tournament_entries.id
      AND em.status <> 'removed'
    ORDER BY em.created_at, em.id
    LIMIT 1
  )
WHERE source_kind IS NULL
  AND entry_type = 'individual';

UPDATE tournament_entries
SET
  source_kind = 'legacy_pair',
  source_key = (
    SELECT group_concat(profile_id, ':')
    FROM (
      SELECT pp.id AS profile_id
      FROM entry_members em
      JOIN tournament_categories tc ON tc.id = tournament_entries.category_id
      JOIN tournament_player_profiles pp
        ON pp.tournament_id = tc.tournament_id
       AND pp.organization_person_id = em.organization_person_id
      WHERE em.entry_id = tournament_entries.id
        AND em.status <> 'removed'
      ORDER BY pp.id
    )
  )
WHERE source_kind IS NULL
  AND entry_type = 'pair';

INSERT OR IGNORE INTO app_meta (key, value, updated_at)
VALUES ('schema_version', 'phase4-legacy-parity', CAST(strftime('%s','now') AS INTEGER));
UPDATE app_meta SET value='phase4-legacy-parity', updated_at=CAST(strftime('%s','now') AS INTEGER) WHERE key='schema_version';
