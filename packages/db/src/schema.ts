import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Better Auth core schema. Passwords/tokens remain owned by Better Auth.
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_issuer_account_id_uq").on(table.issuer, table.accountId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  duprSingles: real("dupr_singles"),
  duprDoubles: real("dupr_doubles"),
  duprId: text("dupr_id"),
  birthDate: text("birth_date"),
  sportGender: text("sport_gender"),
  countryCode: text("country_code"),
  city: text("city"),
  avatarR2Key: text("avatar_r2_key"),
  preferredLocale: text("preferred_locale").notNull().default("es-UY"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const platformAdmins = sqliteTable("platform_admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type", {
    enum: ["club", "sports_complex", "community", "academy", "organizer", "league", "federation"],
  }).notNull(),
  status: text("status", { enum: ["active", "trial", "suspended", "archived"] })
    .notNull()
    .default("trial"),
  defaultLocale: text("default_locale").notNull().default("es-UY"),
  timezone: text("timezone").notNull().default("America/Montevideo"),
  defaultCurrency: text("default_currency").notNull().default("UYU"),
  publicDescription: text("public_description"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const organizationBranding = sqliteTable("organization_branding", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  logoR2Key: text("logo_r2_key"),
  heroR2Key: text("hero_r2_key"),
  accentPrimary: text("accent_primary"),
  accentSecondary: text("accent_secondary"),
  publicName: text("public_name"),
  showPoweredByHuau: integer("show_powered_by_huau", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const organizationModules = sqliteTable(
  "organization_modules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    module: text("module", { enum: ["club", "tournament", "ref"] }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    planKey: text("plan_key"),
    startsAt: integer("starts_at", { mode: "timestamp" }),
    endsAt: integer("ends_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("organization_modules_org_module_uq").on(table.organizationId, table.module)],
);

export const organizationPeople = sqliteTable(
  "organization_people",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    birthDate: text("birth_date"),
    sportGender: text("sport_gender"),
    source: text("source", { enum: ["user", "manual", "import"] }).notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("organization_people_org_user_uq").on(table.organizationId, table.userId)],
);

export const organizationMembershipRequests = sqliteTable(
  "organization_membership_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "approved", "rejected", "cancelled"] })
      .notNull()
      .default("pending"),
    note: text("note"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("membership_requests_org_status_idx").on(table.organizationId, table.status),
    index("membership_requests_user_idx").on(table.userId),
  ],
);

export const organizationMemberships = sqliteTable(
  "organization_memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationPersonId: text("organization_person_id")
      .notNull()
      .references(() => organizationPeople.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "active", "suspended", "expired", "inactive"],
    })
      .notNull()
      .default("active"),
    startsAt: integer("starts_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    adminNotes: text("admin_notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("organization_memberships_org_user_uq").on(table.organizationId, table.userId)],
);

export const organizationUserCapabilities = sqliteTable(
  "organization_user_capabilities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    capability: text("capability", {
      enum: ["org_admin", "coach", "tournament_operator", "future_referee"],
    }).notNull(),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("org_user_capability_uq").on(table.organizationId, table.userId, table.capability),
    index("org_user_capability_lookup_idx").on(table.organizationId, table.userId, table.status),
  ],
);

export const organizationCapabilityPolicies = sqliteTable(
  "organization_capability_policies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    permissionKey: text("permission_key").notNull(),
    allowed: integer("allowed", { mode: "boolean" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("org_capability_policy_uq").on(
      table.organizationId,
      table.capability,
      table.permissionKey,
    ),
  ],
);

// Phase 3: Tournament persistence and migration layer.
export const tournaments = sqliteTable(
  "tournaments",
  {
    id: text("id").primaryKey(),
    organizerOrganizationId: text("organizer_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hostVenueId: text("host_venue_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    sport: text("sport", { enum: ["pickleball", "padel", "tennis"] }).notNull(),
    status: text("status", {
      enum: ["draft", "registration_open", "registration_closed", "draw_ready", "scheduled", "live", "completed", "cancelled"],
    }).notNull(),
    visibility: text("visibility", { enum: ["public", "members", "invite"] }).notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at"),
    timezone: text("timezone").notNull(),
    courtCount: integer("court_count").notNull(),
    publicParticipants: integer("public_participants", { mode: "boolean" }).notNull().default(true),
    publicLive: integer("public_live", { mode: "boolean" }).notNull().default(true),
    publicHeroR2Key: text("public_hero_r2_key"),
    structureLocked: integer("structure_locked", { mode: "boolean" }).notNull().default(false),
    publishedRevision: integer("published_revision").notNull().default(0),
    workingRevision: integer("working_revision").notNull().default(0),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("tournaments_org_idx").on(table.organizerOrganizationId),
    index("tournaments_status_idx").on(table.organizerOrganizationId, table.status),
  ],
);

export const tournamentCategories = sqliteTable(
  "tournament_categories",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    entryType: text("entry_type", { enum: ["individual", "pair", "team"] }).notNull(),
    competitionGender: text("competition_gender", { enum: ["male", "female", "mixed", "open"] }),
    maxEntries: integer("max_entries"),
    minAge: integer("min_age"),
    maxAge: integer("max_age"),
    registrationStatus: text("registration_status", { enum: ["closed", "open", "waitlist_only"] }).notNull(),
    priceScope: text("price_scope", { enum: ["free", "per_entry", "per_person"] }).notNull(),
    priceMinor: integer("price_minor"),
    currency: text("currency"),
    formatVersionId: text("format_version_id"),
    scheduledDate: text("scheduled_date"),
    sortOrder: integer("sort_order").notNull().default(0),
    structureLocked: integer("structure_locked", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("tournament_categories_tournament_name_uq").on(table.tournamentId, table.name),
    index("tournament_categories_tournament_idx").on(table.tournamentId, table.sortOrder),
  ],
);

export const tournamentEntries = sqliteTable(
  "tournament_entries",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => tournamentCategories.id, { onDelete: "cascade" }),
    entryType: text("entry_type", { enum: ["individual", "pair", "team"] }).notNull(),
    displayName: text("display_name").notNull(),
    captainUserId: text("captain_user_id").references(() => user.id),
    status: text("status", {
      enum: ["draft", "inviting", "ready", "pending_payment", "confirmed", "waitlisted", "withdrawn", "rejected"],
    }).notNull(),
    waitlistPosition: integer("waitlist_position"),
    seedRating: real("seed_rating"),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdByAdmin: integer("created_by_admin", { mode: "boolean" }).notNull().default(false),
    sourceKind: text("source_kind"),
    sourceKey: text("source_key"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
    teamPaymentMode: text("team_payment_mode", { enum: ["individual", "team_full"] }),
  },
  (table) => [index("tournament_entries_category_idx").on(table.categoryId, table.status)],
);

export const entryMembers = sqliteTable(
  "entry_members",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id")
      .notNull()
      .references(() => tournamentEntries.id, { onDelete: "cascade" }),
    organizationPersonId: text("organization_person_id")
      .notNull()
      .references(() => organizationPeople.id),
    memberRole: text("member_role", { enum: ["player", "captain", "substitute"] }).notNull(),
    rosterSlot: text("roster_slot"),
    status: text("status", { enum: ["pending_invite", "accepted", "manual", "declined", "removed"] }).notNull(),
    invitedUserId: text("invited_user_id").references(() => user.id),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("entry_members_entry_person_uq").on(table.entryId, table.organizationPersonId),
    index("entry_members_entry_idx").on(table.entryId),
  ],
);

export const competitionFormatVersions = sqliteTable(
  "competition_format_versions",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => tournamentCategories.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    formatKind: text("format_kind", { enum: ["standard", "team"] }).notNull(),
    configJson: text("config_json").notNull(),
    explanationSchemaVersion: integer("explanation_schema_version").notNull().default(1),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at").notNull(),
    lockedAt: integer("locked_at"),
  },
  (table) => [uniqueIndex("competition_format_versions_category_version_uq").on(table.categoryId, table.versionNumber)],
);

export const competitions = sqliteTable("competitions", {
  id: text("id").primaryKey(),
  categoryId: text("category_id")
    .notNull()
    .unique()
    .references(() => tournamentCategories.id, { onDelete: "cascade" }),
  formatVersionId: text("format_version_id")
    .notNull()
    .references(() => competitionFormatVersions.id),
  status: text("status", { enum: ["draft", "groups_generated", "group_stage", "groups_complete", "final_phase", "completed"] }).notNull(),
  structureRevision: integer("structure_revision").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const competitionGroups = sqliteTable(
  "competition_groups",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [uniqueIndex("competition_groups_competition_name_uq").on(table.competitionId, table.name)],
);

export const competitionGroupEntries = sqliteTable(
  "competition_group_entries",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => competitionGroups.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => tournamentEntries.id, { onDelete: "cascade" }),
    seed: integer("seed"),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.entryId] })],
);

export const competitionEncounters = sqliteTable(
  "competition_encounters",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: ["group", "playoff", "consolation", "bronze", "final"] }).notNull(),
    groupId: text("group_id").references(() => competitionGroups.id, { onDelete: "set null" }),
    roundLabel: text("round_label"),
    roundNumber: integer("round_number"),
    legNumber: integer("leg_number").notNull().default(1),
    entryAId: text("entry_a_id").references(() => tournamentEntries.id),
    entryBId: text("entry_b_id").references(() => tournamentEntries.id),
    sourceEncounterAId: text("source_encounter_a_id"),
    sourceEncounterBId: text("source_encounter_b_id"),
    sourceLoserAId: text("source_loser_a_id"),
    sourceLoserBId: text("source_loser_b_id"),
    status: text("status", { enum: ["pending", "bye", "ready", "in_progress", "finished", "skipped"] }).notNull(),
    winnerEntryId: text("winner_entry_id").references(() => tournamentEntries.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("competition_encounters_competition_stage_idx").on(table.competitionId, table.stage),
    index("competition_encounters_group_leg_idx").on(table.groupId, table.legNumber),
  ],
);

export const matches = sqliteTable(
  "matches",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => competitionEncounters.id, { onDelete: "cascade" }),
    rubberKey: text("rubber_key"),
    rubberOrder: integer("rubber_order").notNull().default(1),
    mode: text("mode", { enum: ["singles", "doubles"] }).notNull(),
    competitionGender: text("competition_gender", { enum: ["male", "female", "mixed", "open"] }),
    bestOf: integer("best_of").notNull().default(1),
    pointTarget: integer("point_target"),
    scoringMode: text("scoring_mode"),
    status: text("status", { enum: ["pending", "ready", "in_progress", "finished", "skipped"] }).notNull(),
    sideALabel: text("side_a_label"),
    sideBLabel: text("side_b_label"),
    winnerSide: text("winner_side", { enum: ["A", "B"] }),
    manualOverride: integer("manual_override", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [index("matches_encounter_idx").on(table.encounterId, table.rubberOrder)],
);

export const matchResults = sqliteTable("match_results", {
  matchId: text("match_id")
    .primaryKey()
    .references(() => matches.id, { onDelete: "cascade" }),
  scoreA: integer("score_a"),
  scoreB: integer("score_b"),
  winnerSide: text("winner_side", { enum: ["A", "B"] }),
  resultStatus: text("result_status", { enum: ["pending", "final", "corrected"] }).notNull(),
  enteredByUserId: text("entered_by_user_id").references(() => user.id),
  enteredAt: integer("entered_at"),
  correctedAt: integer("corrected_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const matchSets = sqliteTable(
  "match_sets",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    scoreA: integer("score_a").notNull(),
    scoreB: integer("score_b").notNull(),
    winnerSide: text("winner_side", { enum: ["A", "B"] }).notNull(),
  },
  (table) => [uniqueIndex("match_sets_match_set_uq").on(table.matchId, table.setNumber)],
);

export const matchSideMembers = sqliteTable(
  "match_side_members",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    side: text("side", { enum: ["A", "B"] }).notNull(),
    organizationPersonId: text("organization_person_id")
      .notNull()
      .references(() => organizationPeople.id),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.side, table.organizationPersonId] }),
    uniqueIndex("match_side_members_match_side_position_uq").on(table.matchId, table.side, table.position),
    index("match_side_members_match_side_idx").on(table.matchId, table.side, table.position),
  ],
);

export const teamEncounterLineups = sqliteTable(
  "team_encounter_lineups",
  {
    id: text("id").primaryKey(),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => competitionEncounters.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => tournamentEntries.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["draft", "locked"] }).notNull().default("draft"),
    lockedAt: integer("locked_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("team_encounter_lineups_encounter_entry_uq").on(table.encounterId, table.entryId),
    index("team_encounter_lineups_encounter_idx").on(table.encounterId),
  ],
);

export const teamLineupAssignments = sqliteTable(
  "team_lineup_assignments",
  {
    id: text("id").primaryKey(),
    lineupId: text("lineup_id")
      .notNull()
      .references(() => teamEncounterLineups.id, { onDelete: "cascade" }),
    rubberKey: text("rubber_key").notNull(),
    organizationPersonId: text("organization_person_id")
      .notNull()
      .references(() => organizationPeople.id),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("team_lineup_assignments_lineup_rubber_person_uq").on(
      table.lineupId,
      table.rubberKey,
      table.organizationPersonId,
    ),
    uniqueIndex("team_lineup_assignments_lineup_rubber_position_uq").on(table.lineupId, table.rubberKey, table.position),
    index("team_lineup_assignments_lineup_idx").on(table.lineupId, table.rubberKey, table.position),
  ],
);

export const scheduleItems = sqliteTable(
  "schedule_items",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => tournamentCategories.id, { onDelete: "cascade" }),
    encounterId: text("encounter_id").references(() => competitionEncounters.id, { onDelete: "set null" }),
    matchId: text("match_id").references(() => matches.id, { onDelete: "set null" }),
    placeholderKey: text("placeholder_key"),
    stage: text("stage").notNull(),
    roundLabel: text("round_label"),
    courtLabel: text("court_label").notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
    status: text("status", { enum: ["reserved", "bound", "completed", "cancelled"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("schedule_items_tournament_start_idx").on(table.tournamentId, table.startAt),
    index("schedule_items_category_idx").on(table.categoryId, table.startAt),
  ],
);

export const scheduleRevisions = sqliteTable(
  "schedule_revisions",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    generatedFromStructureRevision: integer("generated_from_structure_revision").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at").notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [uniqueIndex("schedule_revisions_tournament_revision_uq").on(table.tournamentId, table.revisionNumber)],
);

export const tournamentMutations = sqliteTable(
  "tournament_mutations",
  {
    mutationId: text("mutation_id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id),
    deviceId: text("device_id"),
    baseRevision: integer("base_revision").notNull(),
    appliedRevision: integer("applied_revision"),
    mutationType: text("mutation_type").notNull(),
    entityId: text("entity_id"),
    payloadHash: text("payload_hash").notNull(),
    status: text("status", { enum: ["applied", "conflict", "rejected"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    appliedAt: integer("applied_at"),
  },
  (table) => [index("tournament_mutations_tournament_revision_idx").on(table.tournamentId, table.appliedRevision)],
);

export const tournamentSnapshots = sqliteTable(
  "tournament_snapshots",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    scopeType: text("scope_type", { enum: ["tournament", "category"] }).notNull(),
    scopeId: text("scope_id"),
    reason: text("reason").notNull(),
    revision: integer("revision").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("tournament_snapshots_tournament_revision_idx").on(table.tournamentId, table.revision)],
);

export const criticalAuditEvents = sqliteTable(
  "critical_audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    tournamentId: text("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorType: text("actor_type", { enum: ["user", "platform_admin", "system", "webhook"] }).notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("critical_audit_tournament_idx").on(table.tournamentId, table.createdAt),
    index("critical_audit_organization_idx").on(table.organizationId, table.createdAt),
  ],
);

// Phase 4.1: HUAU Tournament legacy-parity administrative model.
export const tournamentSettings = sqliteTable("tournament_settings", {
  tournamentId: text("tournament_id").primaryKey().references(() => tournaments.id, { onDelete: "cascade" }),
  club: text("club").notNull().default(""),
  city: text("city").notNull().default("Piriápolis"),
  location: text("location").notNull().default(""),
  description: text("description").notNull().default(""),
  contact: text("contact").notNull().default(""),
  regulationsText: text("regulations_text").notNull().default(""),
  regulationsVersion: integer("regulations_version").notNull().default(0),
  duprRequired: integer("dupr_required", { mode: "boolean" }).notNull().default(false),
  duprMax: real("dupr_max"),
  duprAsOfDate: text("dupr_as_of_date"),
  dailyStart: text("daily_start").notNull().default("09:00"),
  dailyEnd: text("daily_end").notNull().default("20:00"),
  defaultMatchMinutes: integer("default_match_minutes").notNull().default(30),
  paymentType: text("payment_type", { enum: ["per_category", "base_plus_extra", "free"] }).notNull().default("per_category"),
  entryFeeMinor: integer("entry_fee_minor"),
  baseFeeMinor: integer("base_fee_minor"),
  extraCategoryFeeMinor: integer("extra_category_fee_minor"),
  registrationCloseAt: integer("registration_close_at"),
  maxCategoriesPerPlayer: integer("max_categories_per_player"),
  teamIndividualFeeMinor: integer("team_individual_fee_minor"),
  teamFullFeeMinor: integer("team_full_fee_minor"),
  teamAdditionalParticipationMode: text("team_additional_participation_mode", { enum: ["full", "extra", "free"] }).notNull().default("full"),
  teamAdditionalFeeMinor: integer("team_additional_fee_minor"),
  allowTeamAgeDivisionOverlap: integer("allow_team_age_division_overlap", { mode: "boolean" }).notNull().default(true),
  minimumGroup: integer("minimum_group").notNull().default(3),
  preferredGroup: integer("preferred_group").notNull().default(4),
  maximumGroup: integer("maximum_group").notNull().default(4),
  suggestedQualifiersPerGroup: integer("suggested_qualifiers_per_group").notNull().default(2),
  seedingMethod: text("seeding_method", { enum: ["snake", "manual", "random", "live"] }).notNull().default("snake"),
  minimumRestSlots: integer("minimum_rest_slots").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

export const tournamentPlayerProfiles = sqliteTable(
  "tournament_player_profiles",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    organizationPersonId: text("organization_person_id").references(() => organizationPeople.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    club: text("club").notNull().default(""),
    contact: text("contact").notNull().default(""),
    duprSingles: real("dupr_singles").notNull().default(0),
    duprDoubles: real("dupr_doubles").notNull().default(0),
    paymentStatus: text("payment_status", { enum: ["pending", "paid"] }).notNull().default("pending"),
    playerStatus: text("player_status", { enum: ["pending", "confirmed"] }).notNull().default("confirmed"),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("tournament_player_profiles_tournament_idx").on(table.tournamentId, table.sortOrder),
    uniqueIndex("tournament_player_profiles_person_uq").on(table.tournamentId, table.organizationPersonId),
  ],
);

export const tournamentPlayerCategories = sqliteTable(
  "tournament_player_categories",
  {
    playerProfileId: text("player_profile_id").notNull().references(() => tournamentPlayerProfiles.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull().references(() => tournamentCategories.id, { onDelete: "cascade" }),
    partnerProfileId: text("partner_profile_id").references(() => tournamentPlayerProfiles.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.playerProfileId, table.categoryId] }),
    index("tournament_player_categories_category_idx").on(table.categoryId),
    index("tournament_player_categories_partner_idx").on(table.partnerProfileId),
  ],
);

export const tournamentDrawSessions = sqliteTable("tournament_draw_sessions", {
  categoryId: text("category_id").primaryKey().references(() => tournamentCategories.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["ready", "running", "complete", "confirmed"] }).notNull().default("ready"),
  stateJson: text("state_json").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Phase 6: Online Tournament Registration.
export const tournamentRegistrations = sqliteTable(
  "tournament_registrations",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull().references(() => tournamentCategories.id, { onDelete: "cascade" }),
    entryId: text("entry_id").references(() => tournamentEntries.id, { onDelete: "set null" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    registrationNumber: integer("registration_number").notNull(),
    status: text("status", { enum: ["draft","inviting","awaiting_payment","confirmed","waitlisted","cancelled","rejected"] }).notNull(),
    participantCount: integer("participant_count").notNull().default(1),
    priceScope: text("price_scope", { enum: ["free","per_entry","per_person"] }).notNull(),
    baseAmountMinor: integer("base_amount_minor").notNull().default(0),
    discountMinor: integer("discount_minor").notNull().default(0),
    finalAmountMinor: integer("final_amount_minor").notNull().default(0),
    currency: text("currency"),
    waitlistPosition: integer("waitlist_position"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
    coveredByRegistrationId: text("covered_by_registration_id"),
    paidAmountMinor: integer("paid_amount_minor").notNull().default(0),
    refundedAmountMinor: integer("refunded_amount_minor").notNull().default(0),
    regulationsVersionAccepted: integer("regulations_version_accepted"),
    regulationsAcceptedAt: integer("regulations_accepted_at"),
  },
  (table) => [
    uniqueIndex("tournament_registrations_tournament_number_uq").on(table.tournamentId, table.registrationNumber),
    index("tournament_registrations_tournament_idx").on(table.tournamentId, table.status, table.createdAt),
    index("tournament_registrations_category_idx").on(table.categoryId, table.status, table.waitlistPosition),
    index("tournament_registrations_user_idx").on(table.userId, table.status, table.createdAt),
    index("tournament_registrations_user_tournament_idx").on(table.userId, table.tournamentId, table.status),
  ],
);


export const tournamentWildCards = sqliteTable(
  "tournament_wild_cards",
  {
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    note: text("note"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tournamentId, table.userId] }),
    index("tournament_wild_cards_tournament_idx").on(table.tournamentId, table.createdAt),
  ],
);

export const registrationMatchInvitations = sqliteTable(
  "registration_match_invitations",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull().references(() => tournamentCategories.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["pair", "team"] }).notNull(),
    inviterRegistrationId: text("inviter_registration_id").notNull().references(() => tournamentRegistrations.id, { onDelete: "cascade" }),
    inviteeRegistrationId: text("invitee_registration_id").notNull().references(() => tournamentRegistrations.id, { onDelete: "cascade" }),
    inviterUserId: text("inviter_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    inviteeUserId: text("invitee_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    teamEntryId: text("team_entry_id").references(() => tournamentEntries.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted", "declined", "cancelled", "expired"] }).notNull(),
    expiresAt: integer("expires_at").notNull(),
    respondedAt: integer("responded_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("registration_match_invitee_idx").on(table.inviteeUserId, table.status, table.createdAt),
    index("registration_match_inviter_idx").on(table.inviterRegistrationId, table.status, table.createdAt),
  ],
);

export const entryInvitations = sqliteTable(
  "entry_invitations",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => tournamentRegistrations.id, { onDelete: "cascade" }),
    entryId: text("entry_id").notNull().references(() => tournamentEntries.id, { onDelete: "cascade" }),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull().references(() => tournamentCategories.id, { onDelete: "cascade" }),
    inviterUserId: text("inviter_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    inviteeEmail: text("invitee_email").notNull(),
    inviteeUserId: text("invitee_user_id").references(() => user.id, { onDelete: "set null" }),
    memberRole: text("member_role", { enum: ["player","captain","substitute"] }).notNull(),
    status: text("status", { enum: ["pending","accepted","declined","cancelled","expired"] }).notNull(),
    token: text("token").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    respondedAt: integer("responded_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("entry_invitations_email_status_idx").on(table.inviteeEmail, table.status, table.createdAt)],
);

export const registrationAdjustments = sqliteTable(
  "registration_adjustments",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => tournamentRegistrations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["discount","courtesy","fixed_total"] }).notNull(),
    amountMinor: integer("amount_minor").notNull().default(0),
    note: text("note"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("registration_adjustments_registration_idx").on(table.registrationId, table.createdAt)],
);

// Phase 7: Tournament payments and financial audit.
export const paymentAccounts = sqliteTable(
  "payment_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["mercado_pago"] }).notNull(),
    label: text("label").notNull(),
    status: text("status", { enum: ["active", "expired", "revoked", "error"] }).notNull(),
    externalAccountId: text("external_account_id"),
    publicKey: text("public_key"),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: integer("token_expires_at"),
    liveMode: integer("live_mode", { mode: "boolean" }).notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("payment_accounts_org_idx").on(table.organizationId, table.provider, table.status),
    uniqueIndex("payment_accounts_provider_external_uq").on(table.provider, table.externalAccountId),
  ],
);

export const tournamentPaymentSettings = sqliteTable("tournament_payment_settings", {
  tournamentId: text("tournament_id").primaryKey().references(() => tournaments.id, { onDelete: "cascade" }),
  bankTransferEnabled: integer("bank_transfer_enabled", { mode: "boolean" }).notNull().default(true),
  cashEnabled: integer("cash_enabled", { mode: "boolean" }).notNull().default(false),
  mercadoPagoEnabled: integer("mercado_pago_enabled", { mode: "boolean" }).notNull().default(false),
  mercadoPagoAccountId: text("mercado_pago_account_id").references(() => paymentAccounts.id, { onDelete: "set null" }),
  bankName: text("bank_name"),
  bankAccountHolder: text("bank_account_holder"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountAlias: text("bank_account_alias"),
  bankCurrency: text("bank_currency").notNull().default("UYU"),
  bankInstructions: text("bank_instructions"),
  transferProofRequired: integer("transfer_proof_required", { mode: "boolean" }).notNull().default(true),
  cashInstructions: text("cash_instructions"),
  paymentDueAt: integer("payment_due_at"),
  refundPolicy: text("refund_policy", { enum: ["manual", "none", "full_before_deadline"] }).notNull().default("manual"),
  refundDeadlineAt: integer("refund_deadline_at"),
  cancellationPolicyText: text("cancellation_policy_text"),
  updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const paymentOrders = sqliteTable(
  "payment_orders",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    payerKind: text("payer_kind", { enum: ["user", "manual_profile"] }).notNull(),
    payerUserId: text("payer_user_id").references(() => user.id, { onDelete: "restrict" }),
    payerProfileId: text("payer_profile_id").references(() => tournamentPlayerProfiles.id, { onDelete: "restrict" }),
    payerName: text("payer_name").notNull(),
    payerEmail: text("payer_email"),
    currency: text("currency").notNull().default("UYU"),
    subtotalMinor: integer("subtotal_minor").notNull().default(0),
    discountMinor: integer("discount_minor").notNull().default(0),
    totalAmountMinor: integer("total_amount_minor").notNull().default(0),
    amountPaidMinor: integer("amount_paid_minor").notNull().default(0),
    amountRefundedMinor: integer("amount_refunded_minor").notNull().default(0),
    status: text("status", { enum: ["draft", "awaiting_payment", "pending_review", "paid", "cancelled", "partially_refunded", "refunded"] }).notNull(),
    selectedMethod: text("selected_method", { enum: ["mercado_pago", "bank_transfer", "cash"] }),
    dueAt: integer("due_at"),
    paidAt: integer("paid_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    index("payment_orders_tournament_idx").on(table.tournamentId, table.status, table.updatedAt),
    index("payment_orders_user_idx").on(table.payerUserId, table.tournamentId, table.status),
    index("payment_orders_profile_idx").on(table.payerProfileId, table.tournamentId, table.status),
  ],
);

export const paymentOrderItems = sqliteTable(
  "payment_order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => paymentOrders.id, { onDelete: "cascade" }),
    registrationId: text("registration_id").references(() => tournamentRegistrations.id, { onDelete: "set null" }),
    playerProfileId: text("player_profile_id").references(() => tournamentPlayerProfiles.id, { onDelete: "set null" }),
    categoryId: text("category_id").references(() => tournamentCategories.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    amountMinor: integer("amount_minor").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("payment_order_items_order_idx").on(table.orderId),
    index("payment_order_items_registration_idx").on(table.registrationId),
    index("payment_order_items_profile_idx").on(table.playerProfileId, table.categoryId),
  ],
);

export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => paymentOrders.id, { onDelete: "cascade" }),
    method: text("method", { enum: ["mercado_pago", "bank_transfer", "cash"] }).notNull(),
    status: text("status", { enum: ["created", "pending", "submitted", "approved", "rejected", "cancelled", "refunded"] }).notNull(),
    amountMinor: integer("amount_minor").notNull(),
    externalId: text("external_id"),
    externalStatus: text("external_status"),
    externalReference: text("external_reference"),
    idempotencyKey: text("idempotency_key"),
    note: text("note"),
    submittedByUserId: text("submitted_by_user_id").references(() => user.id, { onDelete: "set null" }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    submittedAt: integer("submitted_at"),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("payment_attempts_order_idx").on(table.orderId, table.createdAt),
    index("payment_attempts_external_idx").on(table.method, table.externalId),
    uniqueIndex("payment_attempts_idempotency_uq").on(table.idempotencyKey),
  ],
);

export const paymentProofs = sqliteTable(
  "payment_proofs",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id").notNull().references(() => paymentAttempts.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByUserId: text("uploaded_by_user_id").references(() => user.id, { onDelete: "set null" }),
    uploadedAt: integer("uploaded_at").notNull(),
  },
  (table) => [index("payment_proofs_attempt_idx").on(table.attemptId, table.uploadedAt)],
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    orderId: text("order_id").references(() => paymentOrders.id, { onDelete: "set null" }),
    attemptId: text("attempt_id").references(() => paymentAttempts.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    providerEventId: text("provider_event_id"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("payment_events_tournament_idx").on(table.tournamentId, table.createdAt),
    index("payment_events_order_idx").on(table.orderId, table.createdAt),
  ],
);

export const paymentOauthStates = sqliteTable(
  "payment_oauth_states",
  {
    id: text("id").primaryKey(),
    state: text("state").notNull().unique(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    initiatedByUserId: text("initiated_by_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    codeVerifier: text("code_verifier").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("payment_oauth_states_expiry_idx").on(table.expiresAt, table.consumedAt)],
);

export const registrationCancellationRequests = sqliteTable(
  "registration_cancellation_requests",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id").notNull().references(() => tournamentRegistrations.id, { onDelete: "cascade" }),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["pending", "approved", "rejected", "cancelled"] }).notNull(),
    reason: text("reason"),
    netPaidMinor: integer("net_paid_minor").notNull().default(0),
    refundAmountMinor: integer("refund_amount_minor").notNull().default(0),
    adminNote: text("admin_note"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("registration_cancellation_requests_tournament_idx").on(table.tournamentId, table.status, table.createdAt)],
);

export const paymentRefunds = sqliteTable(
  "payment_refunds",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull().references(() => paymentOrders.id, { onDelete: "cascade" }),
    registrationId: text("registration_id").references(() => tournamentRegistrations.id, { onDelete: "set null" }),
    amountMinor: integer("amount_minor").notNull(),
    method: text("method", { enum: ["mercado_pago", "bank_transfer", "cash", "other"] }).notNull(),
    status: text("status", { enum: ["pending", "completed", "rejected"] }).notNull(),
    externalId: text("external_id"),
    note: text("note"),
    createdByUserId: text("created_by_user_id").notNull().references(() => user.id),
    completedByUserId: text("completed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("payment_refunds_order_idx").on(table.orderId, table.status, table.createdAt),
    index("payment_refunds_registration_idx").on(table.registrationId, table.status, table.createdAt),
  ],
);

export const tournamentDayState = sqliteTable("tournament_day_state", {
  tournamentId: text("tournament_id")
    .primaryKey()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").unique(),
  snapshotR2Key: text("snapshot_r2_key"),
  publishedRevision: integer("published_revision").notNull().default(0),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  finalizedAt: integer("finalized_at", { mode: "timestamp" }),
  createdByUserId: text("created_by_user_id").references(() => user.id),
  syncStatus: text("sync_status").notNull().default("idle"),
  syncedRevision: integer("synced_revision").notNull().default(0),
  syncedAt: integer("synced_at", { mode: "timestamp" }),
  syncError: text("sync_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
