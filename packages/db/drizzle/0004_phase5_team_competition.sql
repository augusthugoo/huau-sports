-- HUAU Sports Phase 5A — Team Competition Engine persistence foundation
-- Adds historical match-side snapshots and persisted team encounter lineups.

CREATE TABLE IF NOT EXISTS "match_side_members" (
  "match_id" TEXT NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "side" TEXT NOT NULL CHECK ("side" IN ('A','B')),
  "organization_person_id" TEXT NOT NULL REFERENCES "organization_people"("id"),
  "position" INTEGER NOT NULL,
  PRIMARY KEY("match_id","side","organization_person_id"),
  UNIQUE("match_id","side","position")
);
CREATE INDEX IF NOT EXISTS "match_side_members_match_side_idx"
  ON "match_side_members" ("match_id","side","position");

CREATE TABLE IF NOT EXISTS "team_encounter_lineups" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "encounter_id" TEXT NOT NULL REFERENCES "competition_encounters"("id") ON DELETE CASCADE,
  "entry_id" TEXT NOT NULL REFERENCES "tournament_entries"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','locked')),
  "locked_at" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE("encounter_id","entry_id")
);
CREATE INDEX IF NOT EXISTS "team_encounter_lineups_encounter_idx"
  ON "team_encounter_lineups" ("encounter_id");

CREATE TABLE IF NOT EXISTS "team_lineup_assignments" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "lineup_id" TEXT NOT NULL REFERENCES "team_encounter_lineups"("id") ON DELETE CASCADE,
  "rubber_key" TEXT NOT NULL,
  "organization_person_id" TEXT NOT NULL REFERENCES "organization_people"("id"),
  "position" INTEGER NOT NULL,
  "created_at" INTEGER NOT NULL,
  UNIQUE("lineup_id","rubber_key","organization_person_id"),
  UNIQUE("lineup_id","rubber_key","position")
);
CREATE INDEX IF NOT EXISTS "team_lineup_assignments_lineup_idx"
  ON "team_lineup_assignments" ("lineup_id","rubber_key","position");

INSERT OR REPLACE INTO "app_meta" ("key","value","updated_at")
VALUES ('schema_version','phase5-team-engine',unixepoch());
