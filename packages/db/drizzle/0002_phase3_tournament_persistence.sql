PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "tournaments" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organizer_organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "host_venue_id" TEXT,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "sport" TEXT NOT NULL CHECK ("sport" IN ('pickleball','padel','tennis')),
  "status" TEXT NOT NULL CHECK ("status" IN ('draft','registration_open','registration_closed','draw_ready','scheduled','live','completed','cancelled')),
  "visibility" TEXT NOT NULL CHECK ("visibility" IN ('public','members','invite')),
  "start_at" INTEGER NOT NULL,
  "end_at" INTEGER,
  "timezone" TEXT NOT NULL,
  "court_count" INTEGER NOT NULL,
  "public_participants" INTEGER NOT NULL DEFAULT 1,
  "public_live" INTEGER NOT NULL DEFAULT 1,
  "structure_locked" INTEGER NOT NULL DEFAULT 0,
  "published_revision" INTEGER NOT NULL DEFAULT 0,
  "working_revision" INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "tournaments_org_idx" ON "tournaments" ("organizer_organization_id");
CREATE INDEX IF NOT EXISTS "tournaments_status_idx" ON "tournaments" ("organizer_organization_id","status");

CREATE TABLE IF NOT EXISTS "tournament_categories" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "tournament_id" TEXT NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "entry_type" TEXT NOT NULL CHECK ("entry_type" IN ('individual','pair','team')),
  "competition_gender" TEXT CHECK ("competition_gender" IN ('male','female','mixed','open')),
  "max_entries" INTEGER,
  "registration_status" TEXT NOT NULL CHECK ("registration_status" IN ('closed','open','waitlist_only')),
  "price_scope" TEXT NOT NULL CHECK ("price_scope" IN ('free','per_entry','per_person')),
  "price_minor" INTEGER,
  "currency" TEXT,
  "format_version_id" TEXT,
  "scheduled_date" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "structure_locked" INTEGER NOT NULL DEFAULT 0,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  UNIQUE("tournament_id","name")
);
CREATE INDEX IF NOT EXISTS "tournament_categories_tournament_idx" ON "tournament_categories" ("tournament_id","sort_order");

CREATE TABLE IF NOT EXISTS "tournament_entries" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "category_id" TEXT NOT NULL REFERENCES "tournament_categories"("id") ON DELETE CASCADE,
  "entry_type" TEXT NOT NULL CHECK ("entry_type" IN ('individual','pair','team')),
  "display_name" TEXT NOT NULL,
  "captain_user_id" TEXT REFERENCES "user"("id"),
  "status" TEXT NOT NULL CHECK ("status" IN ('draft','inviting','ready','pending_payment','confirmed','waitlisted','withdrawn','rejected')),
  "waitlist_position" INTEGER,
  "seed_rating" REAL,
  "created_by_user_id" TEXT REFERENCES "user"("id"),
  "created_by_admin" INTEGER NOT NULL DEFAULT 0,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "tournament_entries_category_idx" ON "tournament_entries" ("category_id","status");

CREATE TABLE IF NOT EXISTS "entry_members" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "entry_id" TEXT NOT NULL REFERENCES "tournament_entries"("id") ON DELETE CASCADE,
  "organization_person_id" TEXT NOT NULL REFERENCES "organization_people"("id"),
  "member_role" TEXT NOT NULL CHECK ("member_role" IN ('player','captain','substitute')),
  "roster_slot" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('pending_invite','accepted','manual','declined','removed')),
  "invited_user_id" TEXT REFERENCES "user"("id"),
  "accepted_at" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE("entry_id","organization_person_id")
);
CREATE INDEX IF NOT EXISTS "entry_members_entry_idx" ON "entry_members" ("entry_id");

CREATE TABLE IF NOT EXISTS "competition_format_versions" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "category_id" TEXT NOT NULL REFERENCES "tournament_categories"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "format_kind" TEXT NOT NULL CHECK ("format_kind" IN ('standard','team')),
  "config_json" TEXT NOT NULL,
  "explanation_schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "created_at" INTEGER NOT NULL,
  "locked_at" INTEGER,
  UNIQUE("category_id","version_number")
);

CREATE TABLE IF NOT EXISTS "competitions" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "category_id" TEXT NOT NULL UNIQUE REFERENCES "tournament_categories"("id") ON DELETE CASCADE,
  "format_version_id" TEXT NOT NULL REFERENCES "competition_format_versions"("id"),
  "status" TEXT NOT NULL CHECK ("status" IN ('draft','groups_generated','group_stage','groups_complete','final_phase','completed')),
  "structure_revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "competition_groups" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "competition_id" TEXT NOT NULL REFERENCES "competitions"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  UNIQUE("competition_id","name")
);

CREATE TABLE IF NOT EXISTS "competition_group_entries" (
  "group_id" TEXT NOT NULL REFERENCES "competition_groups"("id") ON DELETE CASCADE,
  "entry_id" TEXT NOT NULL REFERENCES "tournament_entries"("id") ON DELETE CASCADE,
  "seed" INTEGER,
  "sort_order" INTEGER NOT NULL,
  PRIMARY KEY("group_id","entry_id")
);

CREATE TABLE IF NOT EXISTS "competition_encounters" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "competition_id" TEXT NOT NULL REFERENCES "competitions"("id") ON DELETE CASCADE,
  "stage" TEXT NOT NULL CHECK ("stage" IN ('group','playoff','consolation','bronze','final')),
  "group_id" TEXT REFERENCES "competition_groups"("id") ON DELETE SET NULL,
  "round_label" TEXT,
  "round_number" INTEGER,
  "leg_number" INTEGER NOT NULL DEFAULT 1,
  "entry_a_id" TEXT REFERENCES "tournament_entries"("id"),
  "entry_b_id" TEXT REFERENCES "tournament_entries"("id"),
  "source_encounter_a_id" TEXT,
  "source_encounter_b_id" TEXT,
  "source_loser_a_id" TEXT,
  "source_loser_b_id" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('pending','bye','ready','in_progress','finished','skipped')),
  "winner_entry_id" TEXT REFERENCES "tournament_entries"("id"),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "competition_encounters_competition_stage_idx" ON "competition_encounters" ("competition_id","stage");
CREATE INDEX IF NOT EXISTS "competition_encounters_group_leg_idx" ON "competition_encounters" ("group_id","leg_number");

CREATE TABLE IF NOT EXISTS "matches" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "encounter_id" TEXT NOT NULL REFERENCES "competition_encounters"("id") ON DELETE CASCADE,
  "rubber_key" TEXT,
  "rubber_order" INTEGER NOT NULL DEFAULT 1,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('singles','doubles')),
  "competition_gender" TEXT CHECK ("competition_gender" IN ('male','female','mixed','open')),
  "best_of" INTEGER NOT NULL DEFAULT 1,
  "point_target" INTEGER,
  "scoring_mode" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('pending','ready','in_progress','finished','skipped')),
  "side_a_label" TEXT,
  "side_b_label" TEXT,
  "winner_side" TEXT CHECK ("winner_side" IN ('A','B')),
  "manual_override" INTEGER NOT NULL DEFAULT 0,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "matches_encounter_idx" ON "matches" ("encounter_id","rubber_order");

CREATE TABLE IF NOT EXISTS "match_results" (
  "match_id" TEXT PRIMARY KEY NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "score_a" INTEGER,
  "score_b" INTEGER,
  "winner_side" TEXT CHECK ("winner_side" IN ('A','B')),
  "result_status" TEXT NOT NULL CHECK ("result_status" IN ('pending','final','corrected')),
  "entered_by_user_id" TEXT REFERENCES "user"("id"),
  "entered_at" INTEGER,
  "corrected_at" INTEGER,
  "updated_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "match_sets" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "match_id" TEXT NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "set_number" INTEGER NOT NULL,
  "score_a" INTEGER NOT NULL,
  "score_b" INTEGER NOT NULL,
  "winner_side" TEXT NOT NULL CHECK ("winner_side" IN ('A','B')),
  UNIQUE("match_id","set_number")
);

CREATE TABLE IF NOT EXISTS "schedule_items" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "tournament_id" TEXT NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "category_id" TEXT NOT NULL REFERENCES "tournament_categories"("id") ON DELETE CASCADE,
  "encounter_id" TEXT REFERENCES "competition_encounters"("id") ON DELETE SET NULL,
  "match_id" TEXT REFERENCES "matches"("id") ON DELETE SET NULL,
  "placeholder_key" TEXT,
  "stage" TEXT NOT NULL,
  "round_label" TEXT,
  "court_label" TEXT NOT NULL,
  "start_at" INTEGER NOT NULL,
  "end_at" INTEGER NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('reserved','bound','completed','cancelled')),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "schedule_items_tournament_start_idx" ON "schedule_items" ("tournament_id","start_at");
CREATE INDEX IF NOT EXISTS "schedule_items_category_idx" ON "schedule_items" ("category_id","start_at");

CREATE TABLE IF NOT EXISTS "schedule_revisions" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "tournament_id" TEXT NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "revision_number" INTEGER NOT NULL,
  "generated_from_structure_revision" INTEGER NOT NULL,
  "created_by_user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "created_at" INTEGER NOT NULL,
  "is_current" INTEGER NOT NULL DEFAULT 1,
  UNIQUE("tournament_id","revision_number")
);

CREATE TABLE IF NOT EXISTS "tournament_mutations" (
  "mutation_id" TEXT PRIMARY KEY NOT NULL,
  "tournament_id" TEXT NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "actor_user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "device_id" TEXT,
  "base_revision" INTEGER NOT NULL,
  "applied_revision" INTEGER,
  "mutation_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "payload_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('applied','conflict','rejected')),
  "created_at" INTEGER NOT NULL,
  "applied_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "tournament_mutations_tournament_revision_idx" ON "tournament_mutations" ("tournament_id","applied_revision");

CREATE TABLE IF NOT EXISTS "tournament_snapshots" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "tournament_id" TEXT NOT NULL REFERENCES "tournaments"("id") ON DELETE CASCADE,
  "scope_type" TEXT NOT NULL CHECK ("scope_type" IN ('tournament','category')),
  "scope_id" TEXT,
  "reason" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payload_json" TEXT NOT NULL,
  "created_by_user_id" TEXT REFERENCES "user"("id"),
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "tournament_snapshots_tournament_revision_idx" ON "tournament_snapshots" ("tournament_id","revision");

CREATE TABLE IF NOT EXISTS "critical_audit_events" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE SET NULL,
  "tournament_id" TEXT REFERENCES "tournaments"("id") ON DELETE SET NULL,
  "actor_user_id" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "actor_type" TEXT NOT NULL CHECK ("actor_type" IN ('user','platform_admin','system','webhook')),
  "action" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "summary" TEXT NOT NULL,
  "metadata_json" TEXT,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "critical_audit_tournament_idx" ON "critical_audit_events" ("tournament_id","created_at");
CREATE INDEX IF NOT EXISTS "critical_audit_organization_idx" ON "critical_audit_events" ("organization_id","created_at");

INSERT OR REPLACE INTO "app_meta" ("key","value","updated_at") VALUES ('schema_version','phase3',unixepoch());
