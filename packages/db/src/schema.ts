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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    version: integer("version").notNull().default(1),
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
