PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "email_verified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "session_user_id_idx" ON "session" ("user_id");
CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "issuer" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "id_token" TEXT,
  "access_token_expires_at" INTEGER,
  "refresh_token_expires_at" INTEGER,
  "scope" TEXT,
  "password" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "account_user_id_idx" ON "account" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_account_id_uq" ON "account" ("issuer","account_id");
CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "created_at" INTEGER,
  "updated_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE IF NOT EXISTS "user_profiles" (
  "user_id" TEXT PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "phone" TEXT,
  "birth_date" TEXT,
  "sport_gender" TEXT,
  "country_code" TEXT,
  "city" TEXT,
  "avatar_r2_key" TEXT,
  "preferred_locale" TEXT NOT NULL DEFAULT 'es-UY',
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "platform_admins" (
  "user_id" TEXT PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','disabled')),
  "created_at" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "type" TEXT NOT NULL CHECK ("type" IN ('club','sports_complex','community','academy','organizer','league','federation')),
  "status" TEXT NOT NULL DEFAULT 'trial' CHECK ("status" IN ('active','trial','suspended','archived')),
  "default_locale" TEXT NOT NULL DEFAULT 'es-UY',
  "timezone" TEXT NOT NULL DEFAULT 'America/Montevideo',
  "default_currency" TEXT NOT NULL DEFAULT 'UYU',
  "public_description" TEXT,
  "contact_email" TEXT,
  "contact_phone" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "organization_branding" (
  "organization_id" TEXT PRIMARY KEY NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "logo_r2_key" TEXT,
  "hero_r2_key" TEXT,
  "accent_primary" TEXT,
  "accent_secondary" TEXT,
  "public_name" TEXT,
  "show_powered_by_huau" INTEGER NOT NULL DEFAULT 1,
  "updated_at" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "organization_modules" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "module" TEXT NOT NULL CHECK ("module" IN ('club','tournament','ref')),
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "plan_key" TEXT,
  "starts_at" INTEGER,
  "ends_at" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE("organization_id","module")
);
CREATE TABLE IF NOT EXISTS "organization_people" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "birth_date" TEXT,
  "sport_gender" TEXT,
  "source" TEXT NOT NULL CHECK ("source" IN ('user','manual','import')),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','inactive')),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "organization_people_org_user_uq" ON "organization_people" ("organization_id","user_id") WHERE "user_id" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "organization_membership_requests" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','approved','rejected','cancelled')),
  "note" TEXT,
  "reviewed_by_user_id" TEXT REFERENCES "user"("id"),
  "reviewed_at" INTEGER,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "membership_requests_pending_uq" ON "organization_membership_requests" ("organization_id","user_id") WHERE "status"='pending';
CREATE INDEX IF NOT EXISTS "membership_requests_org_status_idx" ON "organization_membership_requests" ("organization_id","status");
CREATE INDEX IF NOT EXISTS "membership_requests_user_idx" ON "organization_membership_requests" ("user_id");
CREATE TABLE IF NOT EXISTS "organization_memberships" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "organization_person_id" TEXT NOT NULL REFERENCES "organization_people"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('pending','active','suspended','expired','inactive')),
  "starts_at" INTEGER,
  "expires_at" INTEGER,
  "admin_notes" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE("organization_id","user_id")
);
CREATE TABLE IF NOT EXISTS "organization_user_capabilities" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "capability" TEXT NOT NULL CHECK ("capability" IN ('org_admin','coach','tournament_operator','future_referee')),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','inactive')),
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE("organization_id","user_id","capability")
);
CREATE INDEX IF NOT EXISTS "org_user_capability_lookup_idx" ON "organization_user_capabilities" ("organization_id","user_id","status");
CREATE TABLE IF NOT EXISTS "organization_capability_policies" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "capability" TEXT NOT NULL,
  "permission_key" TEXT NOT NULL,
  "allowed" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  UNIQUE("organization_id","capability","permission_key")
);

INSERT OR REPLACE INTO "app_meta" ("key","value","updated_at") VALUES ('schema_version','phase1',unixepoch());
