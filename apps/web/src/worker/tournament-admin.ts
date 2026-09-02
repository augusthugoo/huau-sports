import {
  advanceLiveDraw,
  balancedGroupSizes,
  buildCompetitionFromGroups,
  buildLegacyFormatOptions,
  calculateGroupStandings,
  createLiveDrawState,
  crossGroupStatsForEntry,
  distributeEntriesIntoGroups,
  distributeEntriesRandomly,
  distributeEntriesSnake,
  generateFinalPhase,
  groupsFromEntryIds,
  importLegacyTournamentState,
  generateTournamentSchedule,
  normalizeStandardFormat,
  tournamentSetupChecklist,
  withEncounterResult,
  type Competition,
  type CompetitionEncounter,
  type LegacySeedingMethod,
  type LiveDrawState,
  type ScheduleCategory,
  type StandardCompetitionFormat,
  type TournamentEntry,
  type TournamentGroup,
  type TournamentPersistenceBundle,
} from "@huau/core";

type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isOrgAdmin: (userId: string, organizationId: string, env: Env, request?: Request) => Promise<boolean>;
};

type CategoryRow = {
  id: string;
  tournamentId: string;
  name: string;
  entryType: "individual" | "pair" | "team";
  competitionGender: "male" | "female" | "mixed" | "open" | null;
  scheduledDate: string | null;
  sortOrder: number;
  structureLocked: number;
  formatVersionId: string | null;
};

type TournamentRow = {
  id: string;
  organizerOrganizationId: string;
  name: string;
  slug: string;
  sport: "pickleball" | "padel" | "tennis";
  status: string;
  visibility: string;
  startAt: number;
  endAt: number | null;
  timezone: string;
  courtCount: number;
  publicParticipants: number;
  publicLive: number;
  structureLocked: number;
  publishedRevision: number;
  workingRevision: number;
};

type SqlValue = string | number | null;
type SqlRow = Record<string, SqlValue>;

type CategorySnapshotPayload = {
  snapshotVersion?: number;
  category: SqlRow;
  entries?: SqlRow[];
  entryMembers?: SqlRow[];
  playerProfiles?: SqlRow[];
  playerCategories?: SqlRow[];
  drawSessions?: SqlRow[];
  formatVersions: SqlRow[];
  competitions: SqlRow[];
  groups: SqlRow[];
  groupEntries: SqlRow[];
  encounters: SqlRow[];
  matches: SqlRow[];
  matchResults: SqlRow[];
  matchSets: SqlRow[];
  scheduleItems: SqlRow[];
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

const readJson = async <T>(request: Request): Promise<T> => (await request.json()) as T;
const uuid = () => crypto.randomUUID();
const unixNow = () => Math.floor(Date.now() / 1000);
const asBool = (value: unknown) => (value ? 1 : 0);

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function dateFromUnix(value: number): string {
  const ms = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(ms).toISOString().slice(0, 10);
}

function unixFromLocal(date: string, time = "00:00", timezone = "America/Montevideo"): number {
  const suffix = timezone === "America/Montevideo" ? "-03:00" : "Z";
  return Math.floor(Date.parse(`${date}T${time}:00${suffix}`) / 1000);
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 70) {
    await db.batch(statements.slice(index, index + 70));
  }
}

async function tournamentForAccess(
  tournamentId: string,
  request: Request,
  env: Env,
  access: AccessHelpers,
): Promise<{ user: CurrentUser; tournament: TournamentRow } | Response> {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const tournament = await env.HUAU_DB.prepare(
    `SELECT id, organizer_organization_id as organizerOrganizationId, name, slug, sport, status, visibility,
            start_at as startAt, end_at as endAt, timezone, court_count as courtCount,
            public_participants as publicParticipants, public_live as publicLive,
            structure_locked as structureLocked, published_revision as publishedRevision,
            working_revision as workingRevision
       FROM tournaments WHERE id=?`,
  )
    .bind(tournamentId)
    .first<TournamentRow>();
  if (!tournament) return json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });
  if (!(await access.isOrgAdmin(user.id, tournament.organizerOrganizationId, env, request))) {
    return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  return { user, tournament };
}

async function categoryForAccess(
  categoryId: string,
  request: Request,
  env: Env,
  access: AccessHelpers,
): Promise<{ user: CurrentUser; tournament: TournamentRow; category: CategoryRow } | Response> {
  const category = await env.HUAU_DB.prepare(
    `SELECT id, tournament_id as tournamentId, name, entry_type as entryType,
            competition_gender as competitionGender, scheduled_date as scheduledDate,
            sort_order as sortOrder, structure_locked as structureLocked, format_version_id as formatVersionId
       FROM tournament_categories WHERE id=?`,
  )
    .bind(categoryId)
    .first<CategoryRow>();
  if (!category) return json({ ok: false, code: "CATEGORY_NOT_FOUND" }, { status: 404 });
  const result = await tournamentForAccess(category.tournamentId, request, env, access);
  if (result instanceof Response) return result;
  return { ...result, category };
}

type TournamentSettingsRow = {
  tournamentId: string;
  club: string;
  city: string;
  location: string;
  description: string;
  contact: string;
  dailyStart: string;
  dailyEnd: string;
  defaultMatchMinutes: number;
  paymentType: "per_category" | "base_plus_extra" | "free";
  entryFeeMinor: number | null;
  baseFeeMinor: number | null;
  extraCategoryFeeMinor: number | null;
  registrationCloseAt: number | null;
  minimumGroup: number;
  preferredGroup: number;
  maximumGroup: number;
  suggestedQualifiersPerGroup: number;
  seedingMethod: LegacySeedingMethod;
  minimumRestSlots: number;
};

type PlayerProfileRow = {
  id: string;
  tournamentId: string;
  organizationPersonId: string | null;
  displayName: string;
  club: string;
  contact: string;
  duprSingles: number;
  duprDoubles: number;
  paymentStatus: "pending" | "paid";
  playerStatus: "pending" | "confirmed";
  notes: string;
  sortOrder: number;
};

type PlayerAssignmentRow = {
  playerProfileId: string;
  categoryId: string;
  partnerProfileId: string | null;
};

async function ensureTournamentSettings(env: Env, tournamentId: string) {
  await env.HUAU_DB.prepare(
    `INSERT OR IGNORE INTO tournament_settings
     (tournament_id,club,city,location,description,contact,daily_start,daily_end,default_match_minutes,payment_type,
      entry_fee_minor,base_fee_minor,extra_category_fee_minor,registration_close_at,minimum_group,preferred_group,maximum_group,
      suggested_qualifiers_per_group,seeding_method,minimum_rest_slots,updated_at)
     VALUES (?,'','Piriápolis','','','','09:00','20:00',30,'per_category',NULL,NULL,NULL,NULL,3,4,4,2,'snake',1,?)`,
  ).bind(tournamentId, unixNow()).run();
}

async function settingsForTournament(env: Env, tournamentId: string): Promise<TournamentSettingsRow> {
  await ensureTournamentSettings(env, tournamentId);
  const row = await env.HUAU_DB.prepare(
    `SELECT tournament_id as tournamentId,club,city,location,description,contact,daily_start as dailyStart,daily_end as dailyEnd,
            default_match_minutes as defaultMatchMinutes,payment_type as paymentType,entry_fee_minor as entryFeeMinor,
            base_fee_minor as baseFeeMinor,extra_category_fee_minor as extraCategoryFeeMinor,registration_close_at as registrationCloseAt,
            minimum_group as minimumGroup,preferred_group as preferredGroup,maximum_group as maximumGroup,
            suggested_qualifiers_per_group as suggestedQualifiersPerGroup,seeding_method as seedingMethod,
            minimum_rest_slots as minimumRestSlots
       FROM tournament_settings WHERE tournament_id=?`,
  ).bind(tournamentId).first<TournamentSettingsRow>();
  if (!row) throw new Error("TOURNAMENT_SETTINGS_NOT_FOUND");
  return row;
}

function splitDisplayName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || value.trim() || "Jugador";
  return { firstName, lastName: parts.join(" ") };
}

async function loadPlayerAssignments(env: Env, tournamentId: string): Promise<PlayerAssignmentRow[]> {
  const rows = await env.HUAU_DB.prepare(
    `SELECT pc.player_profile_id as playerProfileId,pc.category_id as categoryId,pc.partner_profile_id as partnerProfileId
       FROM tournament_player_categories pc JOIN tournament_player_profiles p ON p.id=pc.player_profile_id
      WHERE p.tournament_id=? ORDER BY p.sort_order,pc.category_id`,
  ).bind(tournamentId).all<PlayerAssignmentRow>();
  return rows.results;
}

async function loadPlayerProfile(env: Env, profileId: string): Promise<PlayerProfileRow | null> {
  return env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,organization_person_id as organizationPersonId,display_name as displayName,club,contact,
            dupr_singles as duprSingles,dupr_doubles as duprDoubles,payment_status as paymentStatus,player_status as playerStatus,
            notes,sort_order as sortOrder FROM tournament_player_profiles WHERE id=?`,
  ).bind(profileId).first<PlayerProfileRow>();
}

async function invalidateCategoryCompetition(env: Env, categoryId: string) {
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE category_id=?`).bind(categoryId),
    env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id=?`).bind(categoryId),
    env.HUAU_DB.prepare(`DELETE FROM tournament_draw_sessions WHERE category_id=?`).bind(categoryId),
    env.HUAU_DB.prepare(`UPDATE tournament_categories SET structure_locked=0,updated_at=?,version=version+1 WHERE id=?`).bind(unixNow(), categoryId),
  ]);
}

async function syncDerivedEntriesForCategory(env: Env, categoryId: string, userId: string) {
  const category = await env.HUAU_DB.prepare(
    `SELECT id,entry_type as entryType FROM tournament_categories WHERE id=?`,
  ).bind(categoryId).first<{ id: string; entryType: "individual" | "pair" | "team" }>();
  if (!category || category.entryType === "team") return;
  const rows = await env.HUAU_DB.prepare(
    `SELECT pc.player_profile_id as playerId,pc.partner_profile_id as partnerId,
            p.display_name as name,p.dupr_singles as duprSingles,p.dupr_doubles as duprDoubles,p.player_status as playerStatus,
            p.organization_person_id as personId,p.sort_order as sortOrder
       FROM tournament_player_categories pc JOIN tournament_player_profiles p ON p.id=pc.player_profile_id
      WHERE pc.category_id=? ORDER BY p.sort_order,p.display_name`,
  ).bind(categoryId).all<{ playerId: string; partnerId: string | null; name: string; duprSingles: number; duprDoubles: number; playerStatus: string; personId: string | null; sortOrder: number }>();
  const byId = new Map(rows.results.map((row) => [row.playerId, row]));
  type Desired = { sourceKind: string; sourceKey: string; displayName: string; rating: number; members: string[] };
  const desired = new Map<string, Desired>();
  if (category.entryType === "individual") {
    for (const row of rows.results) {
      if (row.playerStatus !== "confirmed" || !row.personId) continue;
      desired.set(row.playerId, { sourceKind: "legacy_player", sourceKey: row.playerId, displayName: row.name, rating: Number(row.duprSingles || 0), members: [row.personId] });
    }
  } else {
    for (const row of rows.results) {
      if (row.playerStatus !== "confirmed" || !row.partnerId || !row.personId) continue;
      const partner = byId.get(row.partnerId);
      if (!partner || partner.playerStatus !== "confirmed" || !partner.personId || partner.partnerId !== row.playerId) continue;
      const ids = [row.playerId, partner.playerId].sort();
      const key = ids.join(":");
      if (desired.has(key)) continue;
      const ordered = row.sortOrder <= partner.sortOrder ? [row, partner] : [partner, row];
      desired.set(key, {
        sourceKind: "legacy_pair",
        sourceKey: key,
        displayName: `${ordered[0]!.name} / ${ordered[1]!.name}`,
        rating: Math.max(Number(row.duprDoubles || 0), Number(partner.duprDoubles || 0)),
        members: [ordered[0]!.personId!, ordered[1]!.personId!],
      });
    }
  }
  const existing = await env.HUAU_DB.prepare(
    `SELECT id,source_kind as sourceKind,source_key as sourceKey FROM tournament_entries
      WHERE category_id=? AND source_kind IN ('legacy_player','legacy_pair')`,
  ).bind(categoryId).all<{ id: string; sourceKind: string; sourceKey: string }>();
  const existingMap = new Map(existing.results.map((row) => [row.sourceKey, row]));
  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [];
  for (const row of existing.results) {
    if (!desired.has(row.sourceKey)) statements.push(env.HUAU_DB.prepare(`DELETE FROM tournament_entries WHERE id=?`).bind(row.id));
  }
  for (const item of desired.values()) {
    const current = existingMap.get(item.sourceKey);
    const entryId = current?.id ?? uuid();
    if (current) {
      statements.push(env.HUAU_DB.prepare(
        `UPDATE tournament_entries SET display_name=?,seed_rating=?,status='confirmed',updated_at=?,version=version+1 WHERE id=?`,
      ).bind(item.displayName, item.rating, stamp, entryId));
      statements.push(env.HUAU_DB.prepare(`DELETE FROM entry_members WHERE entry_id=?`).bind(entryId));
    } else {
      statements.push(env.HUAU_DB.prepare(
        `INSERT INTO tournament_entries
         (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version)
         VALUES (?,?,?,?,NULL,'confirmed',NULL,?,?,1,?,?,?, ?,1)`,
      ).bind(entryId, categoryId, category.entryType, item.displayName, item.rating, userId, item.sourceKind, item.sourceKey, stamp, stamp));
    }
    item.members.forEach((personId, index) => statements.push(env.HUAU_DB.prepare(
      `INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at)
       VALUES (?,?,?, ?,NULL,'manual',NULL,?,?,?)`,
    ).bind(uuid(), entryId, personId, index === 0 ? "captain" : "player", stamp, stamp, stamp)));
  }
  if (statements.length) await runBatches(env.HUAU_DB, statements);
}

async function refreshDerivedDisplaysForTournament(env: Env, tournamentId: string, userId: string) {
  const categories = await env.HUAU_DB.prepare(`SELECT id FROM tournament_categories WHERE tournament_id=?`).bind(tournamentId).all<{ id: string }>();
  for (const category of categories.results) await syncDerivedEntriesForCategory(env, category.id, userId);
  await env.HUAU_DB.prepare(
    `UPDATE matches SET side_a_label=(SELECT display_name FROM tournament_entries e JOIN competition_encounters ce ON ce.entry_a_id=e.id WHERE ce.id=matches.encounter_id),
                        side_b_label=(SELECT display_name FROM tournament_entries e JOIN competition_encounters ce ON ce.entry_b_id=e.id WHERE ce.id=matches.encounter_id),
                        updated_at=?
      WHERE encounter_id IN (SELECT ce.id FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id JOIN tournament_categories tc ON tc.id=c.category_id WHERE tc.tournament_id=?)`,
  ).bind(unixNow(), tournamentId).run();
}

function sameStringSet(a: string[], b: string[]) {
  return [...a].sort().join("|") === [...b].sort().join("|");
}

async function persistCompetitionStructure(
  env: Env,
  accessResult: { user: CurrentUser; tournament: TournamentRow; category: CategoryRow },
  format: StandardCompetitionFormat,
  groups: TournamentGroup[],
  config: Record<string, unknown>,
  scheduledDate: string,
) {
  const categoryId = accessResult.category.id;
  const competition = buildCompetitionFromGroups({ id: uuid(), categoryId, groups: groups.map((group) => ({ ...group, id: uuid() })), format });
  const normalizedGroups = competition.groups;
  const versionRow = await env.HUAU_DB.prepare(`SELECT COALESCE(MAX(version_number),0)+1 as nextVersion FROM competition_format_versions WHERE category_id=?`).bind(categoryId).first<{ nextVersion: number }>();
  const formatId = uuid(); const stamp = unixNow();
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE category_id=?`).bind(categoryId),
    env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id=?`).bind(categoryId),
    env.HUAU_DB.prepare(`INSERT INTO competition_format_versions (id,category_id,version_number,format_kind,config_json,explanation_schema_version,created_by_user_id,created_at,locked_at) VALUES (?,?,?,'standard',?,1,?,?,?)`).bind(formatId,categoryId,versionRow?.nextVersion??1,JSON.stringify(config),accessResult.user.id,stamp,stamp),
    env.HUAU_DB.prepare(`INSERT INTO competitions (id,category_id,format_version_id,status,structure_revision,created_at,updated_at) VALUES (?,?,?,'groups_generated',1,?,?)`).bind(competition.id,categoryId,formatId,stamp,stamp),
  ];
  normalizedGroups.forEach((group, groupIndex) => {
    statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_groups (id,competition_id,name,sort_order) VALUES (?,?,?,?)`).bind(group.id,competition.id,group.name,groupIndex));
    group.entries.forEach((entry, entryIndex) => statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_group_entries (group_id,entry_id,seed,sort_order) VALUES (?,?,?,?)`).bind(group.id,entry.id,entryIndex+1,entryIndex)));
  });
  competition.encounters.forEach((encounter) => {
    statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_encounters (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',NULL,?,?,1)`).bind(encounter.id,competition.id,encounter.stage,encounter.groupId,encounter.roundLabel,encounter.roundNumber,encounter.legNumber,encounter.entryA?.id??null,encounter.entryB?.id??null,encounter.sourceEncounterAId,encounter.sourceEncounterBId,encounter.sourceLoserAId,encounter.sourceLoserBId,stamp,stamp));
    statements.push(env.HUAU_DB.prepare(`INSERT INTO matches (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version) VALUES (?,?,NULL,1,?, ?,?,?,NULL,'pending',?,?,NULL,0,?,?,1)`).bind(uuid(),encounter.id,accessResult.category.entryType==="individual"?"singles":"doubles",accessResult.category.competitionGender,encounter.bestOf,encounter.pointTarget,encounter.entryA?.name??null,encounter.entryB?.name??null,stamp,stamp));
  });
  statements.push(env.HUAU_DB.prepare(`UPDATE tournament_categories SET format_version_id=?,scheduled_date=?,structure_locked=1,updated_at=?,version=version+1 WHERE id=?`).bind(formatId,scheduledDate,stamp,categoryId));
  await runBatches(env.HUAU_DB, statements);
}


type PlayerAssignmentInput = { categoryId: string; partnerProfileId?: string | null };

type LegacyStateShape = {
  version: string;
  tournament: Record<string, unknown>;
  players: Array<Record<string, unknown>>;
  formats: Record<string, Record<string, unknown>>;
  competitions: Record<string, Record<string, unknown>>;
  drawSessions: Record<string, unknown>;
  schedule: Array<Record<string, unknown>>;
};

function normalizedPlayerStatus(value: unknown): "pending" | "confirmed" {
  return value === "pending" ? "pending" : "confirmed";
}

function normalizedPaymentStatus(value: unknown): "pending" | "paid" {
  return value === "paid" ? "paid" : "pending";
}

function safeLegacySeeding(value: unknown): LegacySeedingMethod {
  return value === "manual" || value === "random" || value === "live" ? value : "snake";
}

function legacyPaymentType(value: unknown): "per_category" | "base_plus_extra" | "free" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "base_plus_extra" || normalized.includes("fijo") || normalized.includes("adicional") || normalized.includes("extra")) return "base_plus_extra";
  if (normalized === "free" || normalized.includes("grat")) return "free";
  return "per_category";
}

function legacyLocalDateTimeToUnix(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  const source = String(value ?? "").trim();
  if (!source) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(source);
  if (!match) return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}:00-03:00`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function safePlayoffMode(value: unknown): StandardCompetitionFormat["playoffMode"] {
  return value === "top2_final" || value === "top3_step" || value === "top4_semis" || value === "league_only"
    ? value
    : "standard";
}

async function lockedCategoriesAmong(env: Env, categoryIds: string[]) {
  if (!categoryIds.length) return [] as CategoryRow[];
  const placeholders = categoryIds.map(() => "?").join(",");
  const rows = await env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,name,entry_type as entryType,competition_gender as competitionGender,
            scheduled_date as scheduledDate,sort_order as sortOrder,structure_locked as structureLocked,format_version_id as formatVersionId
       FROM tournament_categories WHERE id IN (${placeholders}) AND structure_locked=1`,
  ).bind(...categoryIds).all<CategoryRow>();
  return rows.results;
}

async function snapshotAndInvalidateCategories(
  env: Env,
  tournament: TournamentRow,
  user: CurrentUser,
  categories: CategoryRow[],
  reason: string,
) {
  for (const category of categories) {
    await snapshotCategory(env, tournament, category, user.id, reason);
    await invalidateCategoryCompetition(env, category.id);
  }
}

async function assertPartnerAvailability(
  env: Env,
  profileId: string,
  assignments: PlayerAssignmentInput[],
) {
  for (const assignment of assignments) {
    if (!assignment.partnerProfileId) continue;
    if (assignment.partnerProfileId === profileId) throw new Error("PLAYER_CANNOT_PARTNER_SELF");
    const category = await env.HUAU_DB.prepare(`SELECT entry_type as entryType FROM tournament_categories WHERE id=?`).bind(assignment.categoryId).first<{entryType:string}>();
    if (!category || category.entryType !== "pair") throw new Error("PARTNER_ONLY_ALLOWED_FOR_PAIR_CATEGORY");
    const existing = await env.HUAU_DB.prepare(
      `SELECT partner_profile_id as partnerId FROM tournament_player_categories WHERE player_profile_id=? AND category_id=?`,
    ).bind(assignment.partnerProfileId, assignment.categoryId).first<{partnerId:string|null}>();
    if (existing?.partnerId && existing.partnerId !== profileId) throw new Error("PARTNER_ALREADY_ASSIGNED");
  }
}

async function replacePlayerAssignments(
  env: Env,
  profileId: string,
  assignments: PlayerAssignmentInput[],
) {
  await assertPartnerAvailability(env, profileId, assignments);
  const stamp = unixNow();
  const previous = await env.HUAU_DB.prepare(
    `SELECT category_id as categoryId,partner_profile_id as partnerId FROM tournament_player_categories WHERE player_profile_id=?`,
  ).bind(profileId).all<{categoryId:string;partnerId:string|null}>();
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`DELETE FROM tournament_player_categories WHERE player_profile_id=?`).bind(profileId),
  ];
  for (const old of previous.results) {
    if (!old.partnerId) continue;
    statements.push(
      env.HUAU_DB.prepare(
        `UPDATE tournament_player_categories SET partner_profile_id=NULL,updated_at=? WHERE player_profile_id=? AND category_id=? AND partner_profile_id=?`,
      ).bind(stamp, old.partnerId, old.categoryId, profileId),
    );
  }
  for (const assignment of assignments) {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_player_categories (player_profile_id,category_id,partner_profile_id,created_at,updated_at) VALUES (?,?,?,?,?)`,
      ).bind(profileId, assignment.categoryId, assignment.partnerProfileId ?? null, stamp, stamp),
    );
    if (assignment.partnerProfileId) {
      statements.push(
        env.HUAU_DB.prepare(
          `INSERT INTO tournament_player_categories (player_profile_id,category_id,partner_profile_id,created_at,updated_at)
           VALUES (?,?,?,?,?) ON CONFLICT(player_profile_id,category_id) DO UPDATE SET partner_profile_id=excluded.partner_profile_id,updated_at=excluded.updated_at`,
        ).bind(assignment.partnerProfileId, assignment.categoryId, profileId, stamp, stamp),
      );
    }
  }
  await runBatches(env.HUAU_DB, statements);
}

async function createOrUpdateOrganizationPerson(
  env: Env,
  tournament: TournamentRow,
  profileId: string | null,
  displayName: string,
  contact: string,
): Promise<string> {
  const parts = splitDisplayName(displayName);
  let personId: string | null = null;
  if (profileId) {
    const profile = await loadPlayerProfile(env, profileId);
    personId = profile?.organizationPersonId ?? null;
  }
  const stamp = unixNow();
  if (personId) {
    await env.HUAU_DB.prepare(
      `UPDATE organization_people SET first_name=?,last_name=?,phone=?,updated_at=? WHERE id=?`,
    ).bind(parts.firstName, parts.lastName, contact || null, stamp, personId).run();
    return personId;
  }
  personId = uuid();
  await env.HUAU_DB.prepare(
    `INSERT INTO organization_people (id,organization_id,user_id,first_name,last_name,email,phone,sport_gender,source,status,created_at,updated_at)
     VALUES (?,?,NULL,?,?,NULL,?,NULL,'manual','active',?,?)`,
  ).bind(personId, tournament.organizerOrganizationId, parts.firstName, parts.lastName, contact || null, stamp, stamp).run();
  return personId;
}

function parseSavedConfig(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
}

async function saveCategoryFormatVersion(
  env: Env,
  category: CategoryRow,
  userId: string,
  config: Record<string, unknown>,
  lock = false,
): Promise<string> {
  const version = await env.HUAU_DB.prepare(
    `SELECT COALESCE(MAX(version_number),0)+1 as nextVersion FROM competition_format_versions WHERE category_id=?`,
  ).bind(category.id).first<{nextVersion:number}>();
  const id = uuid();
  const stamp = unixNow();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `INSERT INTO competition_format_versions (id,category_id,version_number,format_kind,config_json,explanation_schema_version,created_by_user_id,created_at,locked_at)
       VALUES (?,?,?,'standard',?,1,?,?,?)`,
    ).bind(id, category.id, version?.nextVersion ?? 1, JSON.stringify(config), userId, stamp, lock ? stamp : null),
    env.HUAU_DB.prepare(`UPDATE tournament_categories SET format_version_id=?,updated_at=?,version=version+1 WHERE id=?`).bind(id, stamp, category.id),
  ]);
  return id;
}

async function savedCategoryConfig(env: Env, category: CategoryRow): Promise<Record<string, unknown>> {
  if (!category.formatVersionId) return {};
  const row = await env.HUAU_DB.prepare(`SELECT config_json as configJson FROM competition_format_versions WHERE id=?`).bind(category.formatVersionId).first<{configJson:string}>();
  return parseSavedConfig(row?.configJson);
}

function formatForConfig(config: Record<string, unknown>, fallbackRest = 1): StandardCompetitionFormat {
  return normalizeStandardFormat({
    groupRounds: Number(config.groupRounds) === 2 ? 2 : 1,
    qualifiersPerGroup: Math.max(1, Number(config.qualifiersPerGroup ?? 2)),
    wildcardQualifiers: Math.max(0, Number(config.wildcardQualifiers ?? 0)),
    crossGroupMethod: config.crossGroupMethod === "equalized" ? "equalized" : "normalized",
    playoffMode: safePlayoffMode(config.playoffMode),
    consolationMode: config.consolationMode === "knockout" ? "knockout" : "none",
    avoidGroupRematches: config.avoidGroupRematches !== false,
    bronzeMatch: config.bronzeMatch === true,
    medalSchedule: config.medalSchedule === "simultaneous" ? "simultaneous" : "sequential",
    finalDrawMethod: config.finalDrawMethod === "pots" ? "pots" : "performance",
    preliminary: { bestOf: 1, pointTarget: Math.max(1, Number(config.standardPointTarget ?? config.preliminaryPointTarget ?? 15)) },
    medal: { bestOf: Number(config.medalBestOf) === 3 ? 3 : 1, pointTarget: Math.max(1, Number(config.medalPointTarget ?? 11)) },
    preferredRestSlots: Math.max(0, Number(config.preferredRestSlots ?? fallbackRest)),
  });
}

async function buildAndPersistCategoryGroups(
  env: Env,
  accessResult: { user: CurrentUser; tournament: TournamentRow; category: CategoryRow },
  input: { seedingMethod?: LegacySeedingMethod; groupSizes?: number[]; orderedEntryIds?: string[]; config?: Record<string, unknown>; scheduledDate?: string },
) {
  await syncDerivedEntriesForCategory(env, accessResult.category.id, accessResult.user.id);
  const entries = await loadEntryModels(env, accessResult.category.id);
  if (entries.length < 2) throw new Error("NOT_ENOUGH_ENTRIES");
  const settings = await settingsForTournament(env, accessResult.tournament.id);
  const existingConfig = await savedCategoryConfig(env, accessResult.category);
  const config = { ...existingConfig, ...(input.config ?? {}) };
  const sizesRaw = (input.groupSizes?.length ? input.groupSizes : Array.isArray(config.groupSizes) ? config.groupSizes as number[] : null);
  const groupCount = Math.max(1, Math.trunc(Number(config.groupCount ?? 1)));
  const groupSizes = (sizesRaw ?? balancedGroupSizes(entries.length, groupCount)).map((value) => Math.max(1, Math.trunc(Number(value))));
  if (groupSizes.reduce((sum, value) => sum + value, 0) !== entries.length) throw new Error("GROUP_SIZE_MISMATCH");
  const method = safeLegacySeeding(input.seedingMethod ?? config.seedingMethod ?? settings.seedingMethod);
  let groups: TournamentGroup[];
  if (method === "manual") groups = groupsFromEntryIds(entries, groupSizes, input.orderedEntryIds ?? []);
  else if (method === "random") groups = distributeEntriesRandomly(entries, groupSizes);
  else groups = distributeEntriesSnake(entries, groupSizes);
  const finalConfig: Record<string, unknown> = {
    ...config,
    groupCount: groupSizes.length,
    groupSizes,
    seedingMethod: method,
    preferredRestSlots: Math.max(0, Number(config.preferredRestSlots ?? settings.minimumRestSlots)),
    matchMinutes: Math.max(5, Number(config.matchMinutes ?? settings.defaultMatchMinutes)),
    dailyStart: typeof config.dailyStart === "string" ? config.dailyStart : settings.dailyStart,
  };
  const format = formatForConfig(finalConfig, settings.minimumRestSlots);
  await persistCompetitionStructure(
    env,
    accessResult,
    format,
    groups,
    finalConfig,
    input.scheduledDate || accessResult.category.scheduledDate || dateFromUnix(accessResult.tournament.startAt),
  );
  await regenerateTournamentSchedule(env, accessResult.tournament, accessResult.user.id, settings.dailyStart);
  await audit(env, accessResult.tournament, accessResult.user.id, "category.groups_generated", `Generated ${method} groups`, "category", accessResult.category.id, { groupSizes, seedingMethod: method });
}

async function createFinalPhaseForCategory(
  env: Env,
  accessResult: { user: CurrentUser; tournament: TournamentRow; category: CategoryRow },
  auto = false,
) {
  const categoryId = accessResult.category.id;
  const competition = await loadCompetition(env, categoryId);
  if (!competition) throw new Error("COMPETITION_NOT_GENERATED");
  if (competition.finalGenerated) return;
  if (competition.encounters.some((encounter) => encounter.stage === "group" && encounter.status !== "finished")) throw new Error("GROUPS_INCOMPLETE");
  if (competition.format.playoffMode === "league_only") {
    await env.HUAU_DB.prepare(`UPDATE competitions SET status='completed',updated_at=? WHERE id=?`).bind(unixNow(), competition.id).run();
    return;
  }
  await snapshotCategory(env, accessResult.tournament, accessResult.category, accessResult.user.id, auto ? "Before automatic final phase generation" : "Before final phase generation");
  const generated = generateFinalPhase(competition);
  const newEncounters = generated.encounters.filter((encounter) => encounter.stage !== "group");
  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [];
  for (const encounter of newEncounters) {
    const matchId = uuid();
    statements.push(env.HUAU_DB.prepare(
      `INSERT INTO competition_encounters (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    ).bind(encounter.id, competition.id, encounter.stage, null, encounter.roundLabel, encounter.roundNumber, encounter.legNumber,
      encounter.entryA?.id ?? null, encounter.entryB?.id ?? null, encounter.sourceEncounterAId, encounter.sourceEncounterBId,
      encounter.sourceLoserAId, encounter.sourceLoserBId, encounter.status, encounter.winnerEntryId, stamp, stamp));
    statements.push(env.HUAU_DB.prepare(
      `INSERT INTO matches (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version)
       VALUES (?,?,NULL,1,?,?,?,?,NULL,?,?,?,NULL,0,?,?,1)`,
    ).bind(matchId, encounter.id, accessResult.category.entryType === "individual" ? "singles" : "doubles", accessResult.category.competitionGender,
      encounter.bestOf, encounter.pointTarget, encounter.status === "bye" ? "finished" : "pending", encounter.entryA?.name ?? null, encounter.entryB?.name ?? null, stamp, stamp));
  }
  statements.push(
    env.HUAU_DB.prepare(`UPDATE competitions SET status='final_phase',structure_revision=structure_revision+1,updated_at=? WHERE id=?`).bind(stamp, competition.id),
    env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(stamp, accessResult.tournament.id),
  );
  await runBatches(env.HUAU_DB, statements);
  const settings = await settingsForTournament(env, accessResult.tournament.id);
  await regenerateTournamentSchedule(env, accessResult.tournament, accessResult.user.id, settings.dailyStart);
  await audit(env, accessResult.tournament, accessResult.user.id, auto ? "category.final_phase.auto" : "category.final_phase", auto ? "Generated final phase automatically" : "Generated final phase", "category", categoryId, { matchCount: newEncounters.length });
}

async function persistImportedBundle(env: Env, bundle: TournamentPersistenceBundle) {
  const statements: D1PreparedStatement[] = [];
  for (const row of bundle.people) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO organization_people (id,organization_id,user_id,first_name,last_name,email,phone,sport_gender,source,status,created_at,updated_at) VALUES (?,?,NULL,?,?,?,?,?,'import','active',?,?)`,
  ).bind(row.id,row.organizationId,row.firstName,row.lastName,row.email,row.phone,row.sportGender,row.createdAt,row.updatedAt));
  const t = bundle.tournament;
  statements.push(env.HUAU_DB.prepare(
    `INSERT INTO tournaments (id,organizer_organization_id,host_venue_id,name,slug,sport,status,visibility,start_at,end_at,timezone,court_count,public_participants,public_live,structure_locked,published_revision,working_revision,created_by_user_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(t.id,t.organizerOrganizationId,t.hostVenueId,t.name,t.slug,t.sport,t.status,t.visibility,t.startAt,t.endAt,t.timezone,t.courtCount,asBool(t.publicParticipants),asBool(t.publicLive),asBool(t.structureLocked),t.publishedRevision,t.workingRevision,t.createdByUserId,t.createdAt,t.updatedAt));
  for (const row of bundle.categories) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO tournament_categories (id,tournament_id,name,entry_type,competition_gender,max_entries,registration_status,price_scope,price_minor,currency,format_version_id,scheduled_date,sort_order,structure_locked,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.tournamentId,row.name,row.entryType,row.competitionGender,row.maxEntries,row.registrationStatus,row.priceScope,row.priceMinor,row.currency,row.formatVersionId,row.scheduledDate,row.sortOrder,asBool(row.structureLocked),row.createdAt,row.updatedAt,row.version));
  for (const row of bundle.entries) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)`,
  ).bind(row.id,row.categoryId,row.entryType,row.displayName,row.captainUserId,row.status,row.waitlistPosition,row.seedRating,row.createdByUserId,asBool(row.createdByAdmin),row.createdAt,row.updatedAt,row.version));
  for (const row of bundle.entryMembers) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.entryId,row.organizationPersonId,row.memberRole,row.rosterSlot,row.status,row.invitedUserId,row.acceptedAt,row.createdAt,row.updatedAt));
  for (const row of bundle.formatVersions) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO competition_format_versions (id,category_id,version_number,format_kind,config_json,explanation_schema_version,created_by_user_id,created_at,locked_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.categoryId,row.versionNumber,row.formatKind,row.configJson,row.explanationSchemaVersion,row.createdByUserId,row.createdAt,row.lockedAt));
  for (const row of bundle.competitions) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO competitions (id,category_id,format_version_id,status,structure_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
  ).bind(row.id,row.categoryId,row.formatVersionId,row.status,row.structureRevision,row.createdAt,row.updatedAt));
  for (const row of bundle.groups) statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_groups (id,competition_id,name,sort_order) VALUES (?,?,?,?)`).bind(row.id,row.competitionId,row.name,row.sortOrder));
  for (const row of bundle.groupEntries) statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_group_entries (group_id,entry_id,seed,sort_order) VALUES (?,?,?,?)`).bind(row.groupId,row.entryId,row.seed,row.sortOrder));
  for (const row of bundle.encounters) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO competition_encounters (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.competitionId,row.stage,row.groupId,row.roundLabel,row.roundNumber,row.legNumber,row.entryAId,row.entryBId,row.sourceEncounterAId,row.sourceEncounterBId,row.sourceLoserAId,row.sourceLoserBId,row.status,row.winnerEntryId,row.createdAt,row.updatedAt,row.version));
  for (const row of bundle.matches) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO matches (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.encounterId,row.rubberKey,row.rubberOrder,row.mode,row.competitionGender,row.bestOf,row.pointTarget,row.scoringMode,row.status,row.sideALabel,row.sideBLabel,row.winnerSide,asBool(row.manualOverride),row.createdAt,row.updatedAt,row.version));
  for (const row of bundle.matchResults) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO match_results (match_id,score_a,score_b,winner_side,result_status,entered_by_user_id,entered_at,corrected_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(row.matchId,row.scoreA,row.scoreB,row.winnerSide,row.resultStatus,row.enteredByUserId,row.enteredAt,row.correctedAt,row.updatedAt));
  for (const row of bundle.matchSets) statements.push(env.HUAU_DB.prepare(`INSERT INTO match_sets (id,match_id,set_number,score_a,score_b,winner_side) VALUES (?,?,?,?,?,?)`).bind(row.id,row.matchId,row.setNumber,row.scoreA,row.scoreB,row.winnerSide));
  for (const row of bundle.scheduleItems) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO schedule_items (id,tournament_id,category_id,encounter_id,match_id,placeholder_key,stage,round_label,court_label,start_at,end_at,status,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.tournamentId,row.categoryId,row.encounterId,row.matchId,row.placeholderKey,row.stage,row.roundLabel,row.courtLabel,row.startAt,row.endAt,row.status,row.createdAt,row.updatedAt,row.version));
  for (const row of bundle.scheduleRevisions) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO schedule_revisions (id,tournament_id,revision_number,generated_from_structure_revision,created_by_user_id,created_at,is_current) VALUES (?,?,?,?,?,?,?)`,
  ).bind(row.id,row.tournamentId,row.revisionNumber,row.generatedFromStructureRevision,row.createdByUserId,row.createdAt,asBool(row.isCurrent)));
  for (const row of bundle.snapshots) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO tournament_snapshots (id,tournament_id,scope_type,scope_id,reason,revision,payload_json,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.tournamentId,row.scopeType,row.scopeId,row.reason,row.revision,row.payloadJson,row.createdByUserId,row.createdAt));
  for (const row of bundle.auditEvents) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO critical_audit_events (id,organization_id,tournament_id,actor_user_id,actor_type,action,entity_type,entity_id,summary,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.organizationId,row.tournamentId,row.actorUserId,row.actorType,row.action,row.entityType,row.entityId,row.summary,row.metadataJson,row.createdAt));
  await runBatches(env.HUAU_DB, statements);
}

async function addLegacyProfilesAfterImport(env: Env, bundle: TournamentPersistenceBundle, input: unknown) {
  const root = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const state = (root.state && typeof root.state === "object" ? root.state : root) as Record<string, unknown>;
  const sourcePlayers = Array.isArray(state.players) ? state.players as Array<Record<string, unknown>> : [];
  const tournamentSource = state.tournament && typeof state.tournament === "object" ? state.tournament as Record<string, unknown> : {};
  const categoryByName = new Map(bundle.categories.map((category) => [category.name, category.id]));
  const profileByLegacy = new Map<string, string>();
  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [];
  sourcePlayers.forEach((player, index) => {
    const legacyId = String(player.id ?? index + 1);
    const profileId = uuid();
    profileByLegacy.set(legacyId, profileId);
    const person = bundle.people[index];
    statements.push(env.HUAU_DB.prepare(
      `INSERT INTO tournament_player_profiles (id,tournament_id,organization_person_id,display_name,club,contact,dupr_singles,dupr_doubles,payment_status,player_status,notes,sort_order,created_at,updated_at,version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    ).bind(profileId,bundle.tournament.id,person?.id ?? null,String(player.name ?? `Jugador ${index+1}`),String(player.club ?? ""),String(player.contact ?? ""),Number(player.duprSingles ?? 0),Number(player.duprDoubles ?? 0),
      String(player.payment ?? "").toLowerCase().includes("pagado") ? "paid" : "pending",String(player.status ?? "").toLowerCase().includes("confirm") ? "confirmed" : "pending",String(player.notes ?? ""),index,stamp,stamp));
  });
  await runBatches(env.HUAU_DB, statements);
  const assignmentStatements: D1PreparedStatement[] = [];
  sourcePlayers.forEach((player, index) => {
    const profileId = profileByLegacy.get(String(player.id ?? index+1));
    if (!profileId) return;
    const categories = Array.isArray(player.categories) ? player.categories.map(String) : [];
    const partners = player.partners && typeof player.partners === "object" ? player.partners as Record<string, unknown> : {};
    for (const categoryName of categories) {
      const categoryId = categoryByName.get(categoryName);
      if (!categoryId) continue;
      const partnerLegacy = partners[categoryName];
      const partnerProfileId = partnerLegacy === undefined || partnerLegacy === null || partnerLegacy === "" ? null : profileByLegacy.get(String(partnerLegacy)) ?? null;
      assignmentStatements.push(env.HUAU_DB.prepare(
        `INSERT OR REPLACE INTO tournament_player_categories (player_profile_id,category_id,partner_profile_id,created_at,updated_at) VALUES (?,?,?,?,?)`,
      ).bind(profileId,categoryId,partnerProfileId,stamp,stamp));
    }
  });
  if (assignmentStatements.length) await runBatches(env.HUAU_DB, assignmentStatements);
  await env.HUAU_DB.prepare(
    `INSERT OR REPLACE INTO tournament_settings (tournament_id,club,city,location,description,contact,daily_start,daily_end,default_match_minutes,payment_type,entry_fee_minor,base_fee_minor,extra_category_fee_minor,registration_close_at,minimum_group,preferred_group,maximum_group,suggested_qualifiers_per_group,seeding_method,minimum_rest_slots,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(bundle.tournament.id,String(tournamentSource.club ?? ""),String(tournamentSource.city ?? "Piriápolis"),String(tournamentSource.location ?? ""),String(tournamentSource.description ?? ""),String(tournamentSource.contact ?? ""),
    String(tournamentSource.dailyStart ?? "09:00"),String(tournamentSource.dailyEnd ?? "20:00"),Math.max(5,Number(tournamentSource.matchMinutes ?? 30)),legacyPaymentType(tournamentSource.paymentType),
    tournamentSource.entryFee ? Math.round(Number(tournamentSource.entryFee)*100) : null,tournamentSource.baseFee ? Math.round(Number(tournamentSource.baseFee)*100) : null,
    tournamentSource.extraCategoryFee ? Math.round(Number(tournamentSource.extraCategoryFee)*100) : null,legacyLocalDateTimeToUnix(tournamentSource.registrationClose),Math.max(2,Number(tournamentSource.minimumGroup ?? 3)),Math.max(2,Number(tournamentSource.preferredGroup ?? 4)),Math.max(2,Number(tournamentSource.maximumGroup ?? 4)),
    Number(tournamentSource.qualifiersPerGroup ?? 2),String(tournamentSource.seedingMethod ?? "").toLowerCase().includes("manual") ? "manual" : String(tournamentSource.seedingMethod ?? "").toLowerCase().includes("aleat") ? "random" : "snake",Math.max(0,Number(tournamentSource.minimumRestSlots ?? 1)),stamp).run();
  for (const category of bundle.categories) await syncDerivedEntriesForCategory(env, category.id, bundle.tournament.createdByUserId);
}
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy V2.4.2 adapter intentionally accepts dynamic backup shapes */
async function legacyStateForTournament(env: Env, tournamentId: string): Promise<LegacyStateShape> {
  const detail = await tournamentDetail(env, tournamentId);
  if (!detail) throw new Error("TOURNAMENT_NOT_FOUND");
  const categoryNameById = new Map((detail.categories as Array<{id:string;name:string}>).map((category) => [category.id, category.name]));
  const assignments = detail.playerCategories as PlayerAssignmentRow[];
  const categoryDates: Record<string,string> = {};
  (detail.categories as Array<{id:string;name:string;scheduledDate:string|null}>).forEach((category) => {
    if (category.scheduledDate) categoryDates[category.name] = category.scheduledDate;
  });
  const players = (detail.players as Array<PlayerProfileRow>).map((player) => {
    const own = assignments.filter((assignment) => assignment.playerProfileId === player.id);
    const categories = own.map((assignment) => categoryNameById.get(assignment.categoryId)).filter((value): value is string => Boolean(value));
    const partners: Record<string,string> = {};
    own.forEach((assignment) => {
      const categoryName = categoryNameById.get(assignment.categoryId);
      if (categoryName && assignment.partnerProfileId) partners[categoryName] = assignment.partnerProfileId;
    });
    return {
      id: player.id, name: player.displayName, club: player.club, contact: player.contact, duprSingles: player.duprSingles,
      duprDoubles: player.duprDoubles, categories, partners, payment: player.paymentStatus === "paid" ? "Pagado" : "Pendiente",
      status: player.playerStatus === "confirmed" ? "Confirmado" : "Pendiente", notes: player.notes,
    };
  });
  const formats: Record<string,Record<string,unknown>> = {};
  for (const category of detail.categories as Array<{id:string;name:string;configJson:string|null}>) {
    const config = parseSavedConfig(category.configJson);
    const groupRows = (detail.groups as Array<{categoryId:string;name:string;entryId:string|null}>).filter((group) => group.categoryId === category.id);
    const sizeByGroup = new Map<string,number>();
    groupRows.forEach((row) => { if (row.entryId) sizeByGroup.set(row.name, (sizeByGroup.get(row.name) ?? 0) + 1); });
    const sizes = [...sizeByGroup.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,size]) => size);
    formats[category.name] = {
      ...config,
      groups: sizes.length || Number(config.groupCount ?? 1),
      sizes: sizes.length ? sizes : (Array.isArray(config.groupSizes) ? config.groupSizes : []),
      matchMinutes: Number(config.matchMinutes ?? detail.settings.defaultMatchMinutes),
      standardPointTarget: Number(config.standardPointTarget ?? 15), medalPointTarget: Number(config.medalPointTarget ?? 11),
    };
  }
  const legacyEncounterId = new Map<string,number>();
  (detail.matches as Array<{encounterId:string}>).forEach((match, index) => legacyEncounterId.set(match.encounterId, 1000 + index));
  const entriesByCategory = new Map<string,Array<Record<string,unknown>>>();
  for (const raw of detail.entries as Array<{id:string;categoryId:string;displayName:string;seedRating:number;sourceKind?:string|null;sourceKey?:string|null}>) {
    const playerIds = raw.sourceKind === "legacy_pair" ? String(raw.sourceKey ?? "").split(":").filter(Boolean) : raw.sourceKind === "legacy_player" && raw.sourceKey ? [raw.sourceKey] : [];
    const list = entriesByCategory.get(raw.categoryId) ?? [];
    list.push({ id: raw.id, name: raw.displayName, playerIds, rating: raw.seedRating });
    entriesByCategory.set(raw.categoryId, list);
  }
  const competitions: Record<string,Record<string,unknown>> = {};
  for (const category of detail.categories as Array<{id:string;name:string}>) {
    const entries = entriesByCategory.get(category.id) ?? [];
    const entryById = new Map(entries.map((entry) => [String(entry.id), entry]));
    const groupRows = detail.groups as Array<{id:string;name:string;categoryId:string;entryId:string|null;sortOrder:number|null}>;
    const groupNames = [...new Set(groupRows.filter((row) => row.categoryId === category.id).map((row) => row.name))];
    const groups = groupNames.map((name) => ({
      name,
      entries: groupRows.filter((row) => row.categoryId === category.id && row.name === name && row.entryId).sort((a,b)=>Number(a.sortOrder??0)-Number(b.sortOrder??0)).map((row) => entryById.get(String(row.entryId))).filter(Boolean),
    }));
    const matches = (detail.matches as Array<any>).filter((match) => match.categoryId === category.id).map((match) => ({
      id: legacyEncounterId.get(match.encounterId), category: category.name, stage: match.stage === "group" ? "Grupo" : "Final", group: match.groupName ?? "",
      round: match.roundLabel ?? (match.stage === "final" ? "Final" : match.stage), legNumber: match.legNumber ?? 1,
      teamA: match.sideA ?? "", teamB: match.sideB ?? "", entryAId: match.entryAId ?? "", entryBId: match.entryBId ?? "",
      teamAIds: entryById.get(String(match.entryAId ?? ""))?.playerIds ?? [], teamBIds: entryById.get(String(match.entryBId ?? ""))?.playerIds ?? [],
      scoreA: match.scoreA ?? "", scoreB: match.scoreB ?? "", status: match.status === "finished" ? "Finalizado" : match.status === "bye" ? "Bye" : "Pendiente",
      winnerEntry: match.winnerEntryId ? entryById.get(String(match.winnerEntryId)) ?? null : null,
      sourceA: match.sourceEncounterAId ? legacyEncounterId.get(match.sourceEncounterAId) ?? 0 : 0,
      sourceB: match.sourceEncounterBId ? legacyEncounterId.get(match.sourceEncounterBId) ?? 0 : 0,
      sourceLoserA: match.sourceLoserAId ? legacyEncounterId.get(match.sourceLoserAId) ?? 0 : 0,
      sourceLoserB: match.sourceLoserBId ? legacyEncounterId.get(match.sourceLoserBId) ?? 0 : 0,
      bestOf: match.bestOf, pointTarget: match.pointTarget,
      sets: (match.sets ?? []).map((set:any) => ({ a: set.scoreA, b: set.scoreB })),
    }));
    if (groups.length || matches.length) competitions[category.name] = { format: formats[category.name], groups, matches, finalGenerated: matches.some((match:any) => match.stage !== "Grupo") };
  }
  const schedule = (detail.schedule as Array<any>).map((item) => ({
    id: item.id, category: item.categoryName, matchId: item.encounterId ? legacyEncounterId.get(item.encounterId) ?? 0 : 0,
    date: dateFromUnix(Number(item.startAt)), time: new Date(toMsForServer(Number(item.startAt))).toLocaleTimeString("en-GB",{timeZone:detail.tournament.timezone,hour:"2-digit",minute:"2-digit",hour12:false}),
    court: Number(String(item.courtLabel).match(/\d+/)?.[0] ?? 1), durationMinutes: Math.max(1,Math.round((Number(item.endAt)-Number(item.startAt))/60)),
    stage: item.stage === "group" ? "Grupo" : "Final", round: item.roundLabel ?? "", placeholderIndex: item.encounterId ? 0 : 1,
  }));
  return {
    version: "2.4.2-huau-sports-parity",
    tournament: {
      name: detail.tournament.name, club: detail.settings.club, city: detail.settings.city, location: detail.settings.location,
      description: detail.settings.description, contact: detail.settings.contact, startDate: dateFromUnix(detail.tournament.startAt),
      endDate: detail.tournament.endAt ? dateFromUnix(detail.tournament.endAt) : "", dailyStart: detail.settings.dailyStart, dailyEnd: detail.settings.dailyEnd,
      categoryDates, courtCount: detail.tournament.courtCount, matchMinutes: detail.settings.defaultMatchMinutes,
      paymentType: detail.settings.paymentType, entryFee: detail.settings.entryFeeMinor ? detail.settings.entryFeeMinor/100 : "",
      baseFee: detail.settings.baseFeeMinor ? detail.settings.baseFeeMinor/100 : "", extraCategoryFee: detail.settings.extraCategoryFeeMinor ? detail.settings.extraCategoryFeeMinor/100 : "",
      registrationClose: detail.settings.registrationCloseAt ?? "", categories: (detail.categories as Array<{name:string}>).map((category)=>category.name),
      categoryOrder: (detail.categories as Array<{name:string}>).map((category)=>category.name), minimumGroup: detail.settings.minimumGroup,
      preferredGroup: detail.settings.preferredGroup, maximumGroup: detail.settings.maximumGroup, qualifiersPerGroup: detail.settings.suggestedQualifiersPerGroup,
      seedingMethod: detail.settings.seedingMethod, scheduleMode: "Categorías completas por jornada", minimumRestSlots: detail.settings.minimumRestSlots,
      status: detail.tournament.status,
    },
    players, formats, competitions,
    drawSessions: Object.fromEntries((detail.drawSessions as Array<any>).map((session) => [categoryNameById.get(session.categoryId) ?? session.categoryId, JSON.parse(session.stateJson)])),
    schedule,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

function toMsForServer(value: number) { return value < 10_000_000_000 ? value * 1000 : value; }

async function snapshotCategory(
  env: Env,
  tournament: TournamentRow,
  category: CategoryRow,
  userId: string,
  reason: string,
): Promise<string> {
  const [
    categoryFull,
    entries,
    entryMembers,
    playerProfiles,
    playerCategories,
    drawSessions,
    formatVersions,
    competitions,
    groups,
    groupEntries,
    encounters,
    matches,
    matchResults,
    matchSets,
    scheduleItems,
  ] = await Promise.all([
    env.HUAU_DB.prepare(`SELECT * FROM tournament_categories WHERE id=?`).bind(category.id).first(),
    env.HUAU_DB.prepare(`SELECT * FROM tournament_entries WHERE category_id=? ORDER BY created_at,id`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT em.* FROM entry_members em JOIN tournament_entries e ON e.id=em.entry_id WHERE e.category_id=? ORDER BY em.created_at,em.id`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT p.* FROM tournament_player_profiles p JOIN tournament_player_categories pc ON pc.player_profile_id=p.id WHERE pc.category_id=? ORDER BY p.sort_order,p.id`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT * FROM tournament_player_categories WHERE category_id=? ORDER BY player_profile_id`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT * FROM tournament_draw_sessions WHERE category_id=?`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT * FROM competition_format_versions WHERE category_id=? ORDER BY version_number`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT * FROM competitions WHERE category_id=?`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT g.* FROM competition_groups g JOIN competitions c ON c.id=g.competition_id WHERE c.category_id=?`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT ge.* FROM competition_group_entries ge JOIN competition_groups g ON g.id=ge.group_id JOIN competitions c ON c.id=g.competition_id WHERE c.category_id=?`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT e.* FROM competition_encounters e JOIN competitions c ON c.id=e.competition_id WHERE c.category_id=?`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT m.* FROM matches m JOIN competition_encounters e ON e.id=m.encounter_id JOIN competitions c ON c.id=e.competition_id WHERE c.category_id=?`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT r.* FROM match_results r JOIN matches m ON m.id=r.match_id JOIN competition_encounters e ON e.id=m.encounter_id JOIN competitions c ON c.id=e.competition_id WHERE c.category_id=?`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT s.* FROM match_sets s JOIN matches m ON m.id=s.match_id JOIN competition_encounters e ON e.id=m.encounter_id JOIN competitions c ON c.id=e.competition_id WHERE c.category_id=?`).bind(category.id).all(),
    env.HUAU_DB.prepare(`SELECT * FROM schedule_items WHERE category_id=? ORDER BY start_at,court_label`).bind(category.id).all(),
  ]);
  const payload: CategorySnapshotPayload = {
    snapshotVersion: 2,
    category: (categoryFull ?? {}) as SqlRow,
    entries: entries.results as SqlRow[],
    entryMembers: entryMembers.results as SqlRow[],
    playerProfiles: playerProfiles.results as SqlRow[],
    playerCategories: playerCategories.results as SqlRow[],
    drawSessions: drawSessions.results as SqlRow[],
    formatVersions: formatVersions.results as SqlRow[],
    competitions: competitions.results as SqlRow[],
    groups: groups.results as SqlRow[],
    groupEntries: groupEntries.results as SqlRow[],
    encounters: encounters.results as SqlRow[],
    matches: matches.results as SqlRow[],
    matchResults: matchResults.results as SqlRow[],
    matchSets: matchSets.results as SqlRow[],
    scheduleItems: scheduleItems.results as SqlRow[],
  };
  const snapshotId = uuid();
  await env.HUAU_DB.prepare(
    `INSERT INTO tournament_snapshots
     (id,tournament_id,scope_type,scope_id,reason,revision,payload_json,created_by_user_id,created_at)
     VALUES (?,?,'category',?,?,?,?,?,?)`,
  )
    .bind(snapshotId, tournament.id, category.id, reason, tournament.workingRevision, JSON.stringify(payload), userId, unixNow())
    .run();
  return snapshotId;
}

async function audit(
  env: Env,
  tournament: TournamentRow,
  userId: string,
  action: string,
  summary: string,
  entityType?: string,
  entityId?: string,
  metadata?: unknown,
) {
  await env.HUAU_DB.prepare(
    `INSERT INTO critical_audit_events
     (id,organization_id,tournament_id,actor_user_id,actor_type,action,entity_type,entity_id,summary,metadata_json,created_at)
     VALUES (?,?,?,?, 'user', ?,?,?,?,?,?)`,
  )
    .bind(uuid(), tournament.organizerOrganizationId, tournament.id, userId, action, entityType ?? null, entityId ?? null, summary, metadata ? JSON.stringify(metadata) : null, unixNow())
    .run();
}

async function loadEntryModels(env: Env, categoryId: string): Promise<TournamentEntry[]> {
  const rows = await env.HUAU_DB.prepare(
    `SELECT e.id, e.display_name as name, COALESCE(e.seed_rating,0) as rating,
            em.organization_person_id as participantId, em.roster_slot as rosterSlot
       FROM tournament_entries e
       LEFT JOIN entry_members em ON em.entry_id=e.id AND em.status IN ('accepted','manual')
      WHERE e.category_id=? AND e.status IN ('ready','confirmed')
      ORDER BY COALESCE(e.seed_rating,0) DESC, e.created_at ASC, em.created_at ASC`,
  )
    .bind(categoryId)
    .all<{ id: string; name: string; rating: number; participantId: string | null; rosterSlot: string | null }>();
  const byId = new Map<string, TournamentEntry>();
  for (const row of rows.results) {
    const entry = byId.get(row.id) ?? { id: row.id, name: row.name, rating: Number(row.rating || 0), participantIds: [] };
    if (row.participantId) entry.participantIds.push(row.participantId);
    byId.set(row.id, entry);
  }
  return [...byId.values()];
}

async function loadCompetition(env: Env, categoryId: string): Promise<Competition | null> {
  const competitionRow = await env.HUAU_DB.prepare(
    `SELECT c.id, c.category_id as categoryId, c.status, c.format_version_id as formatVersionId,
            f.config_json as configJson
       FROM competitions c JOIN competition_format_versions f ON f.id=c.format_version_id
      WHERE c.category_id=? LIMIT 1`,
  )
    .bind(categoryId)
    .first<{ id: string; categoryId: string; status: string; formatVersionId: string; configJson: string }>();
  if (!competitionRow) return null;
  const format = normalizeStandardFormat(JSON.parse(competitionRow.configJson) as Partial<StandardCompetitionFormat>);
  // Recovery pass: these reads are independent once the competition id is known.
  // Running them in parallel avoids five serial D1 round-trips on every workspace refresh.
  const [entries, groupRows, membershipRows, encounterRows, setRows] = await Promise.all([
    loadEntryModels(env, categoryId),
    env.HUAU_DB.prepare(
      `SELECT g.id,g.name,g.sort_order as sortOrder FROM competition_groups g WHERE g.competition_id=? ORDER BY g.sort_order`,
    ).bind(competitionRow.id).all<{ id: string; name: string; sortOrder: number }>(),
    env.HUAU_DB.prepare(
      `SELECT ge.group_id as groupId,ge.entry_id as entryId,ge.sort_order as sortOrder
         FROM competition_group_entries ge JOIN competition_groups g ON g.id=ge.group_id
        WHERE g.competition_id=? ORDER BY ge.sort_order`,
    ).bind(competitionRow.id).all<{ groupId: string; entryId: string; sortOrder: number }>(),
    env.HUAU_DB.prepare(
      `SELECT e.id,e.stage,e.group_id as groupId,g.name as groupName,e.round_label as roundLabel,
              e.round_number as roundNumber,e.leg_number as legNumber,e.entry_a_id as entryAId,e.entry_b_id as entryBId,
              e.source_encounter_a_id as sourceA,e.source_encounter_b_id as sourceB,
              e.source_loser_a_id as sourceLoserA,e.source_loser_b_id as sourceLoserB,
              e.status,e.winner_entry_id as winnerEntryId,m.id as matchId,m.best_of as bestOf,m.point_target as pointTarget,
              r.score_a as scoreA,r.score_b as scoreB
         FROM competition_encounters e
         LEFT JOIN competition_groups g ON g.id=e.group_id
         LEFT JOIN matches m ON m.encounter_id=e.id AND m.rubber_order=1
         LEFT JOIN match_results r ON r.match_id=m.id
        WHERE e.competition_id=? ORDER BY e.created_at,e.id`,
    ).bind(competitionRow.id).all<{
      id: string; stage: CompetitionEncounter["stage"]; groupId: string | null; groupName: string | null;
      roundLabel: string | null; roundNumber: number | null; legNumber: number; entryAId: string | null; entryBId: string | null;
      sourceA: string | null; sourceB: string | null; sourceLoserA: string | null; sourceLoserB: string | null;
      status: CompetitionEncounter["status"]; winnerEntryId: string | null; matchId: string | null; bestOf: 1 | 3 | null;
      pointTarget: number | null; scoreA: number | null; scoreB: number | null;
    }>(),
    env.HUAU_DB.prepare(
      `SELECT s.match_id as matchId,s.set_number as setNumber,s.score_a as scoreA,s.score_b as scoreB
         FROM match_sets s JOIN matches m ON m.id=s.match_id JOIN competition_encounters e ON e.id=m.encounter_id
        WHERE e.competition_id=? ORDER BY s.match_id,s.set_number`,
    ).bind(competitionRow.id).all<{ matchId: string; setNumber: number; scoreA: number; scoreB: number }>(),
  ]);
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const byGroup = new Map<string, TournamentEntry[]>();
  for (const membership of membershipRows.results) {
    const entry = entryMap.get(membership.entryId);
    if (!entry) continue;
    const list = byGroup.get(membership.groupId) ?? [];
    list.push(entry);
    byGroup.set(membership.groupId, list);
  }
  const groups: TournamentGroup[] = groupRows.results.map((group) => ({
    id: group.id,
    name: group.name,
    entries: byGroup.get(group.id) ?? [],
  }));
  const setsByMatch = new Map<string, Array<{ scoreA: number; scoreB: number }>>();
  for (const set of setRows.results) {
    const list = setsByMatch.get(set.matchId) ?? [];
    list.push({ scoreA: set.scoreA, scoreB: set.scoreB });
    setsByMatch.set(set.matchId, list);
  }
  const encounters: CompetitionEncounter[] = encounterRows.results.map((row) => ({
    id: row.id,
    stage: row.stage,
    groupId: row.groupId,
    groupName: row.groupName,
    roundLabel: row.roundLabel,
    roundNumber: row.roundNumber,
    legNumber: row.legNumber,
    entryA: row.entryAId ? entryMap.get(row.entryAId) ?? null : null,
    entryB: row.entryBId ? entryMap.get(row.entryBId) ?? null : null,
    sourceEncounterAId: row.sourceA,
    sourceEncounterBId: row.sourceB,
    sourceLoserAId: row.sourceLoserA,
    sourceLoserBId: row.sourceLoserB,
    status: row.status,
    winnerEntryId: row.winnerEntryId,
    scoreA: row.scoreA,
    scoreB: row.scoreB,
    sets: row.matchId ? setsByMatch.get(row.matchId) ?? [] : [],
    bestOf: row.bestOf === 3 ? 3 : 1,
    pointTarget: row.pointTarget ?? (row.stage === "bronze" || row.stage === "final" ? format.medal.pointTarget : format.preliminary.pointTarget),
  }));
  return {
    id: competitionRow.id,
    categoryId,
    format,
    groups,
    encounters,
    finalGenerated: encounters.some((encounter) => encounter.stage !== "group"),
  };
}

async function regenerateTournamentSchedule(env: Env, tournament: TournamentRow, userId: string, dailyStart = "09:00") {
  const categoryRows = await env.HUAU_DB.prepare(
    `SELECT tc.id,tc.scheduled_date as scheduledDate,tc.sort_order as sortOrder,
            f.config_json as configJson
       FROM tournament_categories tc
       JOIN competitions c ON c.category_id=tc.id
       JOIN competition_format_versions f ON f.id=c.format_version_id
      WHERE tc.tournament_id=? AND tc.scheduled_date IS NOT NULL
      ORDER BY tc.sort_order`,
  )
    .bind(tournament.id)
    .all<{ id: string; scheduledDate: string; sortOrder: number; configJson: string }>();
  const categories: ScheduleCategory[] = [];
  const competitionByCategory = new Map<string, Competition>();
  const tournamentSettings = await settingsForTournament(env, tournament.id);
  for (const row of categoryRows.results) {
    const competition = await loadCompetition(env, row.id);
    if (!competition) continue;
    competitionByCategory.set(row.id, competition);
    const config = JSON.parse(row.configJson) as { matchMinutes?: number };
    categories.push({
      categoryId: row.id,
      scheduledDate: row.scheduledDate,
      order: row.sortOrder,
      matchMinutes: Math.max(5, Number(config.matchMinutes ?? tournamentSettings.defaultMatchMinutes ?? 15)),
      competition,
    });
  }
  const schedule = generateTournamentSchedule({
    settings: {
      startDate: dateFromUnix(tournament.startAt),
      dailyStart: /^\d{2}:\d{2}$/.test(dailyStart) ? dailyStart : tournamentSettings.dailyStart,
      courtCount: tournament.courtCount,
      preferredRestSlots: Math.max(0, Math.trunc(tournamentSettings.minimumRestSlots)),
    },
    categories,
  });
  // The legacy scheduler reserves final-phase slots before qualifiers are known. Once
  // the bracket exists, bind those exact slots to the real encounters rather than
  // scheduling a second final phase or moving medal times.
  const finalQueues = new Map<string, Competition["encounters"]>();
  for (const [categoryId, competition] of competitionByCategory) {
    const actual = competition.encounters
      .filter((encounter) => encounter.stage !== "group" && encounter.status !== "bye" && encounter.status !== "skipped")
      .sort((a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0) || a.id.localeCompare(b.id));
    for (const encounter of actual) {
      const key = `${categoryId}|${encounter.stage}|${encounter.roundLabel ?? ""}`;
      const queue = finalQueues.get(key) ?? [];
      queue.push(encounter);
      finalQueues.set(key, queue);
    }
  }
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE tournament_id=?`).bind(tournament.id),
  ];
  for (const item of schedule.items) {
    const start = unixFromLocal(item.date, item.time, tournament.timezone);
    const end = start + item.durationMinutes * 60;
    let encounterId = item.encounterId;
    if (item.reserved && !encounterId) {
      const key = `${item.categoryId}|${item.stage}|${item.roundLabel ?? ""}`;
      encounterId = finalQueues.get(key)?.shift()?.id ?? null;
    }
    const matchId = encounterId
      ? await env.HUAU_DB.prepare(`SELECT id FROM matches WHERE encounter_id=? AND rubber_order=1 LIMIT 1`).bind(encounterId).first<{ id: string }>()
      : null;
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO schedule_items
         (id,tournament_id,category_id,encounter_id,match_id,placeholder_key,stage,round_label,court_label,start_at,end_at,status,created_at,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      ).bind(
        uuid(), tournament.id, item.categoryId, encounterId, matchId?.id ?? null,
        item.reserved && !encounterId ? `${item.categoryId}:${item.stage}:${item.blockIndex}:${item.court}` : null,
        item.stage, item.roundLabel, `Court ${item.court}`, start, end,
        encounterId ? "bound" : item.reserved ? "reserved" : "bound", unixNow(), unixNow(),
      ),
    );
  }
  const revision = tournament.workingRevision + 1;
  statements.push(
    env.HUAU_DB.prepare(`UPDATE schedule_revisions SET is_current=0 WHERE tournament_id=?`).bind(tournament.id),
    env.HUAU_DB.prepare(
      `INSERT INTO schedule_revisions
       (id,tournament_id,revision_number,generated_from_structure_revision,created_by_user_id,created_at,is_current)
       VALUES (?,?,?,?,?,?,1)`,
    ).bind(uuid(), tournament.id, revision, revision, userId, unixNow()),
    env.HUAU_DB.prepare(
      `UPDATE tournaments SET status=CASE WHEN status='draft' THEN 'scheduled' ELSE status END,
              structure_locked=1,working_revision=?,updated_at=? WHERE id=?`,
    ).bind(revision, unixNow(), tournament.id),
  );
  await runBatches(env.HUAU_DB, statements);
}

async function tournamentDailyStart(env: Env, tournamentId: string): Promise<string> {
  const rows = await env.HUAU_DB.prepare(
    `SELECT f.config_json as configJson
       FROM tournament_categories tc
       JOIN competitions c ON c.category_id=tc.id
       JOIN competition_format_versions f ON f.id=c.format_version_id
      WHERE tc.tournament_id=? ORDER BY tc.sort_order LIMIT 1`,
  ).bind(tournamentId).all<{ configJson: string }>();
  const first = rows.results[0];
  if (!first) return "09:00";
  try {
    const config = JSON.parse(first.configJson) as { dailyStart?: string };
    return /^\d{2}:\d{2}$/.test(config.dailyStart ?? "") ? config.dailyStart! : "09:00";
  } catch {
    return "09:00";
  }
}

async function tournamentDetail(env: Env, tournamentId: string) {
  const tournament = await env.HUAU_DB.prepare(
    `SELECT id,organizer_organization_id as organizerOrganizationId,name,slug,sport,status,visibility,start_at as startAt,end_at as endAt,
            timezone,court_count as courtCount,public_participants as publicParticipants,public_live as publicLive,
            structure_locked as structureLocked,published_revision as publishedRevision,working_revision as workingRevision
       FROM tournaments WHERE id=?`,
  ).bind(tournamentId).first<TournamentRow>();
  if (!tournament) return null;

  const settings = await settingsForTournament(env, tournamentId);
  const [categories, entries, groups, matchRows, schedule, snapshots, players, drawSessions, assignments, sets] = await Promise.all([
    env.HUAU_DB.prepare(
      `SELECT tc.id,tc.name,tc.entry_type as entryType,tc.competition_gender as competitionGender,tc.scheduled_date as scheduledDate,
              tc.sort_order as sortOrder,tc.structure_locked as structureLocked,tc.format_version_id as formatVersionId,
              f.config_json as configJson,
              (SELECT COUNT(*) FROM tournament_entries e WHERE e.category_id=tc.id AND e.status NOT IN ('withdrawn','rejected')) as entryCount,
              c.status as competitionStatus,
              (SELECT COUNT(*) FROM competition_encounters ce WHERE ce.competition_id=c.id AND ce.stage='group') as groupMatchCount,
              (SELECT COUNT(*) FROM competition_encounters ce WHERE ce.competition_id=c.id AND ce.stage='group' AND ce.status='finished') as finishedGroupMatchCount,
              (SELECT COUNT(*) FROM competition_encounters ce WHERE ce.competition_id=c.id AND ce.stage!='group') as finalMatchCount
         FROM tournament_categories tc
         LEFT JOIN competitions c ON c.category_id=tc.id
         LEFT JOIN competition_format_versions f ON f.id=COALESCE(c.format_version_id,tc.format_version_id)
        WHERE tc.tournament_id=? ORDER BY tc.sort_order,tc.name`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT e.id,e.category_id as categoryId,e.display_name as displayName,e.entry_type as entryType,e.status,
              COALESCE(e.seed_rating,0) as seedRating,e.source_kind as sourceKind,e.source_key as sourceKey,
              GROUP_CONCAT(TRIM(p.first_name || ' ' || p.last_name),' · ') as members
         FROM tournament_entries e
         LEFT JOIN entry_members em ON em.entry_id=e.id AND em.status IN ('accepted','manual')
         LEFT JOIN organization_people p ON p.id=em.organization_person_id
         JOIN tournament_categories tc ON tc.id=e.category_id
        WHERE tc.tournament_id=? GROUP BY e.id ORDER BY e.created_at`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT g.id,g.name,c.category_id as categoryId,ge.entry_id as entryId,e.display_name as entryName,ge.sort_order as sortOrder,ge.seed
         FROM competition_groups g JOIN competitions c ON c.id=g.competition_id
         LEFT JOIN competition_group_entries ge ON ge.group_id=g.id
         LEFT JOIN tournament_entries e ON e.id=ge.entry_id
        WHERE c.category_id IN (SELECT id FROM tournament_categories WHERE tournament_id=?)
        ORDER BY c.category_id,g.sort_order,ge.sort_order`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT ce.id as encounterId,ce.competition_id as competitionId,c.category_id as categoryId,tc.name as categoryName,
              ce.stage,ce.group_id as groupId,g.name as groupName,ce.round_label as roundLabel,ce.round_number as roundNumber,ce.leg_number as legNumber,
              ce.entry_a_id as entryAId,ea.display_name as sideA,ce.entry_b_id as entryBId,eb.display_name as sideB,
              ce.status,ce.winner_entry_id as winnerEntryId,m.id as matchId,m.best_of as bestOf,m.point_target as pointTarget,
              mr.score_a as scoreA,mr.score_b as scoreB,mr.result_status as resultStatus,
              si.start_at as scheduleStart,si.end_at as scheduleEnd,si.court_label as courtLabel
         FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id JOIN tournament_categories tc ON tc.id=c.category_id
         LEFT JOIN competition_groups g ON g.id=ce.group_id LEFT JOIN tournament_entries ea ON ea.id=ce.entry_a_id
         LEFT JOIN tournament_entries eb ON eb.id=ce.entry_b_id LEFT JOIN matches m ON m.encounter_id=ce.id AND m.rubber_order=1
         LEFT JOIN match_results mr ON mr.match_id=m.id LEFT JOIN schedule_items si ON si.encounter_id=ce.id
        WHERE tc.tournament_id=?
        ORDER BY COALESCE(si.start_at,9223372036854775807),tc.sort_order,CASE ce.stage WHEN 'group' THEN 0 WHEN 'playoff' THEN 1 WHEN 'consolation' THEN 2 WHEN 'bronze' THEN 3 ELSE 4 END,ce.round_number,ce.created_at`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT si.id,si.category_id as categoryId,tc.name as categoryName,si.encounter_id as encounterId,si.match_id as matchId,
              si.stage,si.round_label as roundLabel,si.court_label as courtLabel,si.start_at as startAt,si.end_at as endAt,si.status,
              ce.group_id as groupId,g.name as groupName,ce.leg_number as legNumber,
              ce.entry_a_id as entryAId,ea.display_name as sideA,ce.entry_b_id as entryBId,eb.display_name as sideB
         FROM schedule_items si JOIN tournament_categories tc ON tc.id=si.category_id
         LEFT JOIN competition_encounters ce ON ce.id=si.encounter_id LEFT JOIN competition_groups g ON g.id=ce.group_id
         LEFT JOIN tournament_entries ea ON ea.id=ce.entry_a_id LEFT JOIN tournament_entries eb ON eb.id=ce.entry_b_id
        WHERE si.tournament_id=? ORDER BY si.start_at,si.court_label`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT s.id,s.scope_type as scopeType,s.scope_id as scopeId,s.reason,s.revision,s.created_at as createdAt,tc.name as categoryName
         FROM tournament_snapshots s LEFT JOIN tournament_categories tc ON tc.id=s.scope_id
        WHERE s.tournament_id=? ORDER BY s.created_at DESC LIMIT 50`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT id,tournament_id as tournamentId,organization_person_id as organizationPersonId,display_name as displayName,club,contact,
              dupr_singles as duprSingles,dupr_doubles as duprDoubles,payment_status as paymentStatus,player_status as playerStatus,
              notes,sort_order as sortOrder,created_at as createdAt,updated_at as updatedAt
         FROM tournament_player_profiles WHERE tournament_id=? ORDER BY sort_order,display_name`,
    ).bind(tournamentId).all<PlayerProfileRow>(),
    env.HUAU_DB.prepare(
      `SELECT ds.category_id as categoryId,ds.status,ds.state_json as stateJson,ds.updated_at as updatedAt
         FROM tournament_draw_sessions ds JOIN tournament_categories tc ON tc.id=ds.category_id WHERE tc.tournament_id=?`,
    ).bind(tournamentId).all(),
    loadPlayerAssignments(env, tournamentId),
    env.HUAU_DB.prepare(
      `SELECT s.match_id as matchId,s.set_number as setNumber,s.score_a as scoreA,s.score_b as scoreB,s.winner_side as winnerSide
         FROM match_sets s JOIN matches m ON m.id=s.match_id JOIN competition_encounters ce ON ce.id=m.encounter_id
         JOIN competitions c ON c.id=ce.competition_id JOIN tournament_categories tc ON tc.id=c.category_id
        WHERE tc.tournament_id=? ORDER BY s.match_id,s.set_number`,
    ).bind(tournamentId).all(),
  ]);

  const matches = matchRows.results as Array<Record<string, unknown>>;
  const setsByMatch = new Map<string, unknown[]>();
  for (const raw of sets.results as Array<{matchId:string;setNumber:number;scoreA:number;scoreB:number;winnerSide:string}>) {
    const list = setsByMatch.get(raw.matchId) ?? [];
    list.push({ setNumber: raw.setNumber, scoreA: raw.scoreA, scoreB: raw.scoreB, winnerSide: raw.winnerSide });
    setsByMatch.set(raw.matchId, list);
  }
  for (const match of matches) {
    match.sets = match.matchId ? (setsByMatch.get(String(match.matchId)) ?? []) : [];
  }

  const standings: Array<Record<string, unknown>> = [];
  const crossGroup: Array<Record<string, unknown>> = [];
  const categoryRows = categories.results as Array<{ id: string; entryCount: number; competitionStatus: string | null; scheduledDate: string | null }>;
  // Recovery pass: hydrate all categories concurrently instead of serially.
  const competitions = await Promise.all(categoryRows.map((category) => loadCompetition(env, category.id)));
  for (let categoryIndex = 0; categoryIndex < categoryRows.length; categoryIndex += 1) {
    const category = categoryRows[categoryIndex]!;
    const competition = competitions[categoryIndex];
    if (!competition) continue;
    for (const group of competition.groups) {
      const rows = calculateGroupStandings(competition, group.id);
      standings.push({
        categoryId: category.id,
        groupId: group.id,
        groupName: group.name,
        rows: rows.map((row, index) => ({
          position: index + 1, entryId: row.entry.id, name: row.entry.name, played: row.played, wins: row.wins, losses: row.losses,
          scored: row.scored, conceded: row.conceded, diff: row.diff, rating: row.entry.rating,
        })),
      });
      rows.forEach((row, index) => {
        const stats = crossGroupStatsForEntry(competition, group.id, row.entry.id);
        if (!stats) return;
        crossGroup.push({
          categoryId: category.id, groupId: group.id, groupName: group.name, position: index + 1, entryId: row.entry.id,
          name: row.entry.name, played: stats.played, wins: stats.wins, winRate: stats.winRate, diff: stats.diff,
          diffPerMatch: stats.diffPerMatch, scored: stats.scored, scoredPerMatch: stats.scoredPerMatch, method: stats.method,
          ignoredEncounterIds: stats.ignoredEncounterIds,
        });
      });
    }
  }

  const checklist = tournamentSetupChecklist({
    hasGeneral: Boolean(tournament.name && tournament.startAt && tournament.courtCount),
    categoryCount: categoryRows.length,
    entryCount: categoryRows.reduce((sum, row) => sum + Number(row.entryCount || 0), 0),
    generatedCategoryCount: categoryRows.filter((row) => row.competitionStatus).length,
    scheduledCategoryCount: categoryRows.filter((row) => row.competitionStatus && row.scheduledDate).length,
  });
  return {
    tournament, settings, categories: categories.results, entries: entries.results, groups: groups.results, matches,
    schedule: schedule.results, snapshots: snapshots.results, players: players.results, playerCategories: assignments,
    drawSessions: drawSessions.results, standings, crossGroup, checklist,
  };
}
async function restoreSnapshot(
  env: Env,
  snapshotId: string,
  request: Request,
  access: AccessHelpers,
): Promise<Response> {
  const snapshot = await env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,scope_id as scopeId,payload_json as payloadJson FROM tournament_snapshots WHERE id=? AND scope_type='category'`,
  ).bind(snapshotId).first<{ id: string; tournamentId: string; scopeId: string; payloadJson: string }>();
  if (!snapshot) return json({ ok: false, code: "SNAPSHOT_NOT_FOUND" }, { status: 404 });
  const accessResult = await tournamentForAccess(snapshot.tournamentId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const payload = JSON.parse(snapshot.payloadJson) as CategorySnapshotPayload;
  if (!payload.category || String(payload.category.id ?? "") !== snapshot.scopeId) {
    return json({ ok: false, code: "SNAPSHOT_PAYLOAD_INVALID" }, { status: 400 });
  }

  const currentCategory = await env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,name,entry_type as entryType,competition_gender as competitionGender,
            scheduled_date as scheduledDate,sort_order as sortOrder,structure_locked as structureLocked,format_version_id as formatVersionId
       FROM tournament_categories WHERE id=?`,
  ).bind(snapshot.scopeId).first<CategoryRow>();
  if (currentCategory) {
    await snapshotCategory(env, accessResult.tournament, currentCategory, accessResult.user.id, "Before restore");
  }

  // Snapshots created before parity v2 did not include entries/assignments. Keep
  // their legacy restore behavior for backwards compatibility. New snapshots
  // are self-contained and can even recreate a category that was deleted.
  const fullSnapshot = Number(payload.snapshotVersion ?? 1) >= 2;
  if (!fullSnapshot && !currentCategory) {
    return json({ ok: false, code: "LEGACY_SNAPSHOT_CATEGORY_MISSING" }, { status: 409 });
  }

  const category = payload.category;
  const statements: D1PreparedStatement[] = [];
  if (fullSnapshot) {
    statements.push(env.HUAU_DB.prepare(`DELETE FROM tournament_categories WHERE id=?`).bind(snapshot.scopeId));
    statements.push(env.HUAU_DB.prepare(
      `INSERT INTO tournament_categories
       (id,tournament_id,name,entry_type,competition_gender,max_entries,registration_status,price_scope,price_minor,currency,format_version_id,scheduled_date,sort_order,structure_locked,created_at,updated_at,version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      category.id, category.tournament_id, category.name, category.entry_type, category.competition_gender, category.max_entries,
      category.registration_status, category.price_scope, category.price_minor, category.currency, category.format_version_id,
      category.scheduled_date, category.sort_order, category.structure_locked, category.created_at, unixNow(), category.version,
    ));
    for (const row of payload.entries ?? []) statements.push(env.HUAU_DB.prepare(
      `INSERT INTO tournament_entries
       (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(row.id,row.category_id,row.entry_type,row.display_name,row.captain_user_id,row.status,row.waitlist_position,row.seed_rating,row.created_by_user_id,row.created_by_admin,row.source_kind ?? null,row.source_key ?? null,row.created_at,row.updated_at,row.version));
    for (const row of payload.entryMembers ?? []) statements.push(env.HUAU_DB.prepare(
      `INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(row.id,row.entry_id,row.organization_person_id,row.member_role,row.roster_slot,row.status,row.invited_user_id,row.accepted_at,row.created_at,row.updated_at));
    for (const row of payload.playerProfiles ?? []) statements.push(env.HUAU_DB.prepare(
      `INSERT OR IGNORE INTO tournament_player_profiles
       (id,tournament_id,organization_person_id,display_name,club,contact,dupr_singles,dupr_doubles,payment_status,player_status,notes,sort_order,created_at,updated_at,version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(row.id,row.tournament_id,row.organization_person_id,row.display_name,row.club,row.contact,row.dupr_singles,row.dupr_doubles,row.payment_status,row.player_status,row.notes,row.sort_order,row.created_at,row.updated_at,row.version));
    for (const row of payload.playerCategories ?? []) statements.push(env.HUAU_DB.prepare(
      `INSERT INTO tournament_player_categories (player_profile_id,category_id,partner_profile_id,created_at,updated_at) VALUES (?,?,?,?,?)`,
    ).bind(row.player_profile_id,row.category_id,row.partner_profile_id,row.created_at,row.updated_at));
  } else {
    statements.push(
      env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE category_id=?`).bind(snapshot.scopeId),
      env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id=?`).bind(snapshot.scopeId),
      env.HUAU_DB.prepare(
        `UPDATE tournament_categories SET name=?,entry_type=?,competition_gender=?,max_entries=?,registration_status=?,price_scope=?,price_minor=?,currency=?,format_version_id=?,scheduled_date=?,sort_order=?,structure_locked=?,updated_at=?,version=? WHERE id=?`,
      ).bind(
        category.name, category.entry_type, category.competition_gender, category.max_entries, category.registration_status,
        category.price_scope, category.price_minor, category.currency, category.format_version_id, category.scheduled_date,
        category.sort_order, category.structure_locked, unixNow(), category.version, snapshot.scopeId,
      ),
    );
  }

  for (const row of payload.formatVersions) statements.push(env.HUAU_DB.prepare(
    `INSERT OR REPLACE INTO competition_format_versions (id,category_id,version_number,format_kind,config_json,explanation_schema_version,created_by_user_id,created_at,locked_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.category_id,row.version_number,row.format_kind,row.config_json,row.explanation_schema_version,row.created_by_user_id,row.created_at,row.locked_at));
  for (const row of payload.competitions) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO competitions (id,category_id,format_version_id,status,structure_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
  ).bind(row.id,row.category_id,row.format_version_id,row.status,row.structure_revision,row.created_at,row.updated_at));
  for (const row of payload.groups) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO competition_groups (id,competition_id,name,sort_order) VALUES (?,?,?,?)`,
  ).bind(row.id,row.competition_id,row.name,row.sort_order));
  for (const row of payload.groupEntries) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO competition_group_entries (group_id,entry_id,seed,sort_order) VALUES (?,?,?,?)`,
  ).bind(row.group_id,row.entry_id,row.seed,row.sort_order));
  for (const row of payload.encounters) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO competition_encounters (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.competition_id,row.stage,row.group_id,row.round_label,row.round_number,row.leg_number,row.entry_a_id,row.entry_b_id,row.source_encounter_a_id,row.source_encounter_b_id,row.source_loser_a_id,row.source_loser_b_id,row.status,row.winner_entry_id,row.created_at,row.updated_at,row.version));
  for (const row of payload.matches) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO matches (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.encounter_id,row.rubber_key,row.rubber_order,row.mode,row.competition_gender,row.best_of,row.point_target,row.scoring_mode,row.status,row.side_a_label,row.side_b_label,row.winner_side,row.manual_override,row.created_at,row.updated_at,row.version));
  for (const row of payload.matchResults) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO match_results (match_id,score_a,score_b,winner_side,result_status,entered_by_user_id,entered_at,corrected_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(row.match_id,row.score_a,row.score_b,row.winner_side,row.result_status,row.entered_by_user_id,row.entered_at,row.corrected_at,row.updated_at));
  for (const row of payload.matchSets) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO match_sets (id,match_id,set_number,score_a,score_b,winner_side) VALUES (?,?,?,?,?,?)`,
  ).bind(row.id,row.match_id,row.set_number,row.score_a,row.score_b,row.winner_side));
  for (const row of payload.scheduleItems) statements.push(env.HUAU_DB.prepare(
    `INSERT INTO schedule_items (id,tournament_id,category_id,encounter_id,match_id,placeholder_key,stage,round_label,court_label,start_at,end_at,status,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(row.id,row.tournament_id,row.category_id,row.encounter_id,row.match_id,row.placeholder_key,row.stage,row.round_label,row.court_label,row.start_at,row.end_at,row.status,row.created_at,row.updated_at,row.version));
  if (fullSnapshot) {
    for (const row of payload.drawSessions ?? []) statements.push(env.HUAU_DB.prepare(
      `INSERT INTO tournament_draw_sessions (category_id,status,state_json,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
    ).bind(row.category_id,row.status,row.state_json,row.created_by_user_id,row.created_at,row.updated_at));
  }
  statements.push(env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(unixNow(), snapshot.tournamentId));
  await runBatches(env.HUAU_DB, statements);
  await audit(env, accessResult.tournament, accessResult.user.id, "snapshot.restore", "Restored category snapshot", "category", snapshot.scopeId, { snapshotId, snapshotVersion: payload.snapshotVersion ?? 1 });
  return json({ ok: true });
}

export async function handleTournamentAdminApi(
  request: Request,
  env: Env,
  url: URL,
  access: AccessHelpers,
): Promise<Response | null> {
  const orgTournaments = url.pathname.match(/^\/api\/admin\/organizations\/([^/]+)\/tournaments$/);
  if (orgTournaments) {
    const organizationId = decodeURIComponent(orgTournaments[1]!);
    const user = await access.requireUser(request, env);
    if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
    if (!(await access.isOrgAdmin(user.id, organizationId, env, request))) return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
    if (request.method === "GET") {
      const rows = await env.HUAU_DB.prepare(
        `SELECT id,name,slug,sport,status,visibility,start_at as startAt,end_at as endAt,court_count as courtCount,
                structure_locked as structureLocked,working_revision as workingRevision,
                (SELECT COUNT(*) FROM tournament_categories tc WHERE tc.tournament_id=tournaments.id) as categoryCount,
                (SELECT COUNT(*) FROM tournament_entries te JOIN tournament_categories tc ON tc.id=te.category_id WHERE tc.tournament_id=tournaments.id AND te.status NOT IN ('withdrawn','rejected')) as entryCount
           FROM tournaments WHERE organizer_organization_id=? ORDER BY start_at DESC,created_at DESC`,
      ).bind(organizationId).all();
      return json({ ok: true, tournaments: rows.results });
    }
    if (request.method === "POST") {
      const body = await readJson<{ name?: string; sport?: string; startDate?: string; endDate?: string | null; courtCount?: number; visibility?: string }>(request);
      const name = body.name?.trim();
      const sport = body.sport;
      const startDate = body.startDate;
      const courtCount = Math.max(1, Math.trunc(Number(body.courtCount || 1)));
      if (!name || !startDate || !["pickleball","padel","tennis"].includes(sport ?? "")) return json({ ok: false, code: "INVALID_TOURNAMENT" }, { status: 400 });
      const tournamentId = uuid();
      const slug = `${slugify(name)}-${tournamentId.slice(0,6)}`;
      const stamp = unixNow();
      await env.HUAU_DB.prepare(
        `INSERT INTO tournaments (id,organizer_organization_id,host_venue_id,name,slug,sport,status,visibility,start_at,end_at,timezone,court_count,public_participants,public_live,structure_locked,published_revision,working_revision,created_by_user_id,created_at,updated_at)
         VALUES (?,?,NULL,?,?,?,'draft',?,?,?,?,?,1,1,0,0,0,?,?,?)`,
      ).bind(tournamentId,organizationId,name,slug,sport,body.visibility ?? "public",unixFromLocal(startDate),body.endDate ? unixFromLocal(body.endDate,"23:59") : null,"America/Montevideo",courtCount,user.id,stamp,stamp).run();
      await ensureTournamentSettings(env, tournamentId);
      return json({ ok: true, tournament: { id: tournamentId, name, slug } }, { status: 201 });
    }
  }

  const tournamentRoute = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)$/);
  if (tournamentRoute) {
    const tournamentId = decodeURIComponent(tournamentRoute[1]!);
    const accessResult = await tournamentForAccess(tournamentId, request, env, access);
    if (accessResult instanceof Response) return accessResult;
    if (request.method === "GET") {
      const detail = await tournamentDetail(env, tournamentId);
      return json({ ok: true, ...detail });
    }
    if (request.method === "PUT") {
      const body = await readJson<{ status?: string; publicLive?: boolean; publicParticipants?: boolean; name?: string; courtCount?: number; visibility?: string }>(request);
      const allowedStatuses = ["draft","registration_open","registration_closed","draw_ready","scheduled","live","completed","cancelled"];
      if (body.status && !allowedStatuses.includes(body.status)) return json({ ok: false, code: "INVALID_STATUS" }, { status: 400 });
      await env.HUAU_DB.prepare(
        `UPDATE tournaments SET name=COALESCE(?,name),court_count=COALESCE(?,court_count),visibility=COALESCE(?,visibility),
                status=COALESCE(?,status),public_live=COALESCE(?,public_live),public_participants=COALESCE(?,public_participants),updated_at=? WHERE id=?`,
      ).bind(body.name?.trim() || null,body.courtCount ? Math.max(1,Math.trunc(body.courtCount)) : null,body.visibility ?? null,body.status ?? null,
        body.publicLive === undefined ? null : asBool(body.publicLive),body.publicParticipants === undefined ? null : asBool(body.publicParticipants),unixNow(),tournamentId).run();
      return json({ ok: true });
    }
  }

  const importTournamentRoute = url.pathname.match(/^\/api\/admin\/organizations\/([^/]+)\/tournaments\/import$/);
  if (importTournamentRoute && request.method === "POST") {
    const organizationId = decodeURIComponent(importTournamentRoute[1]!);
    const user = await access.requireUser(request, env);
    if (!user) return json({ ok:false, code:"UNAUTHENTICATED" }, { status:401 });
    if (!(await access.isOrgAdmin(user.id, organizationId, env, request))) return json({ ok:false, code:"FORBIDDEN" }, { status:403 });
    const input = await readJson<unknown>(request);
    const idCache = new Map<string,string>();
    const idFactory = (kind:string, sourceKey:string) => {
      const key = `${kind}:${sourceKey}`;
      const existing = idCache.get(key);
      if (existing) return existing;
      const value = uuid(); idCache.set(key,value); return value;
    };
    try {
      const sourceName = (() => {
        if (!input || typeof input !== "object") return "legacy";
        const root = input as Record<string,unknown>;
        const state = root.state && typeof root.state === "object" ? root.state as Record<string,unknown> : root;
        const tournament = state.tournament && typeof state.tournament === "object" ? state.tournament as Record<string,unknown> : {};
        return String(tournament.name ?? "legacy");
      })();
      const bundle = importLegacyTournamentState(input, {
        organizationId, createdByUserId:user.id, tournamentId:uuid(), slug:`${slugify(sourceName)}-${uuid().slice(0,6)}`, idFactory,
      });
      await persistImportedBundle(env,bundle);
      await addLegacyProfilesAfterImport(env,bundle,input);
      return json({ok:true,tournament:{id:bundle.tournament.id,name:bundle.tournament.name,slug:bundle.tournament.slug}},{status:201});
    } catch (error) {
      return json({ok:false,code:error instanceof Error ? error.message : "LEGACY_IMPORT_FAILED"},{status:400});
    }
  }

  const tournamentBackup = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/backup$/);
  if (tournamentBackup && request.method === "GET") {
    const tournamentId = decodeURIComponent(tournamentBackup[1]!);
    const accessResult = await tournamentForAccess(tournamentId,request,env,access);
    if (accessResult instanceof Response) return accessResult;
    try {
      const state = await legacyStateForTournament(env,tournamentId);
      return json({format:"huau-tournament-state",revision:accessResult.tournament.workingRevision,state,exportedAt:unixNow()});
    } catch (error) {
      return json({ok:false,code:error instanceof Error?error.message:"BACKUP_FAILED"},{status:500});
    }
  }

  const settingsRoute = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/settings$/);
  if (settingsRoute && request.method === "PUT") {
    const tournamentId = decodeURIComponent(settingsRoute[1]!);
    const accessResult = await tournamentForAccess(tournamentId,request,env,access);
    if (accessResult instanceof Response) return accessResult;
    const body = await readJson<Partial<TournamentSettingsRow> & {startDate?:string;endDate?:string|null;courtCount?:number}>(request);
    const current = await settingsForTournament(env,tournamentId);
    const dailyStart = /^\d{2}:\d{2}$/.test(body.dailyStart ?? "") ? body.dailyStart! : current.dailyStart;
    const dailyEnd = /^\d{2}:\d{2}$/.test(body.dailyEnd ?? "") ? body.dailyEnd! : current.dailyEnd;
    const minimumGroup = Math.max(2,Math.trunc(Number(body.minimumGroup ?? current.minimumGroup)));
    const preferredGroup = Math.max(minimumGroup,Math.trunc(Number(body.preferredGroup ?? current.preferredGroup)));
    const maximumGroup = Math.max(preferredGroup,Math.trunc(Number(body.maximumGroup ?? current.maximumGroup)));
    const stamp = unixNow();
    await env.HUAU_DB.batch([
      env.HUAU_DB.prepare(
        `UPDATE tournament_settings SET club=?,city=?,location=?,description=?,contact=?,daily_start=?,daily_end=?,default_match_minutes=?,payment_type=?,entry_fee_minor=?,base_fee_minor=?,extra_category_fee_minor=?,registration_close_at=?,minimum_group=?,preferred_group=?,maximum_group=?,suggested_qualifiers_per_group=?,seeding_method=?,minimum_rest_slots=?,updated_at=? WHERE tournament_id=?`,
      ).bind(body.club ?? current.club,body.city ?? current.city,body.location ?? current.location,body.description ?? current.description,body.contact ?? current.contact,dailyStart,dailyEnd,
        Math.max(5,Math.trunc(Number(body.defaultMatchMinutes ?? current.defaultMatchMinutes))),body.paymentType ?? current.paymentType,
        Object.prototype.hasOwnProperty.call(body,"entryFeeMinor") ? body.entryFeeMinor ?? null : current.entryFeeMinor,
        Object.prototype.hasOwnProperty.call(body,"baseFeeMinor") ? body.baseFeeMinor ?? null : current.baseFeeMinor,
        Object.prototype.hasOwnProperty.call(body,"extraCategoryFeeMinor") ? body.extraCategoryFeeMinor ?? null : current.extraCategoryFeeMinor,
        Object.prototype.hasOwnProperty.call(body,"registrationCloseAt") ? body.registrationCloseAt ?? null : current.registrationCloseAt,minimumGroup,preferredGroup,maximumGroup,
        Math.max(0,Math.min(2,Math.trunc(Number(body.suggestedQualifiersPerGroup ?? current.suggestedQualifiersPerGroup)))),safeLegacySeeding(body.seedingMethod ?? current.seedingMethod),
        Math.max(0,Math.min(4,Math.trunc(Number(body.minimumRestSlots ?? current.minimumRestSlots)))),stamp,tournamentId),
      env.HUAU_DB.prepare(
        `UPDATE tournaments SET start_at=COALESCE(?,start_at),end_at=?,court_count=COALESCE(?,court_count),working_revision=working_revision+1,updated_at=? WHERE id=?`,
      ).bind(body.startDate ? unixFromLocal(body.startDate,dailyStart,accessResult.tournament.timezone) : null,body.endDate === undefined ? accessResult.tournament.endAt : body.endDate ? unixFromLocal(body.endDate,dailyEnd,accessResult.tournament.timezone) : null,
        body.courtCount ? Math.max(1,Math.trunc(Number(body.courtCount))) : null,stamp,tournamentId),
    ]);
    const generated = await env.HUAU_DB.prepare(`SELECT COUNT(*) as count FROM competitions c JOIN tournament_categories tc ON tc.id=c.category_id WHERE tc.tournament_id=?`).bind(tournamentId).first<{count:number}>();
    if (Number(generated?.count ?? 0) > 0) await regenerateTournamentSchedule(env,{...accessResult.tournament,courtCount:body.courtCount ? Math.max(1,Math.trunc(Number(body.courtCount))) : accessResult.tournament.courtCount},accessResult.user.id,dailyStart);
    return json({ok:true});
  }

  const tournamentPlayers = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/players$/);
  if (tournamentPlayers && request.method === "POST") {
    const tournamentId = decodeURIComponent(tournamentPlayers[1]!);
    const accessResult = await tournamentForAccess(tournamentId,request,env,access);
    if (accessResult instanceof Response) return accessResult;
    const body = await readJson<{displayName?:string;club?:string;contact?:string;duprSingles?:number;duprDoubles?:number;paymentStatus?:string;playerStatus?:string;notes?:string;assignments?:PlayerAssignmentInput[];confirmImpact?:boolean}>(request);
    const displayName = body.displayName?.trim();
    if (!displayName) return json({ok:false,code:"PLAYER_NAME_REQUIRED"},{status:400});
    const duplicate = await env.HUAU_DB.prepare(`SELECT id FROM tournament_player_profiles WHERE tournament_id=? AND lower(display_name)=lower(?)`).bind(tournamentId,displayName).first();
    if (duplicate) return json({ok:false,code:"DUPLICATE_PLAYER"},{status:409});
    const assignments = (body.assignments ?? []).filter((value) => value.categoryId);
    const affectedIds = [...new Set(assignments.map((value)=>value.categoryId))];
    const locked = await lockedCategoriesAmong(env,affectedIds);
    if (locked.length && !body.confirmImpact) return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Agregar este jugador modifica categorías ya sorteadas. HUAU guardará snapshots e invalidará sólo esas categorías."},{status:409});
    if (locked.length) await snapshotAndInvalidateCategories(env,accessResult.tournament,accessResult.user,locked,"Before adding tournament player");
    const profileId = uuid(); const personId = await createOrUpdateOrganizationPerson(env,accessResult.tournament,null,displayName,body.contact?.trim() ?? "");
    const sort = await env.HUAU_DB.prepare(`SELECT COALESCE(MAX(sort_order),-1)+1 as nextSort FROM tournament_player_profiles WHERE tournament_id=?`).bind(tournamentId).first<{nextSort:number}>();
    const stamp=unixNow();
    await env.HUAU_DB.prepare(
      `INSERT INTO tournament_player_profiles (id,tournament_id,organization_person_id,display_name,club,contact,dupr_singles,dupr_doubles,payment_status,player_status,notes,sort_order,created_at,updated_at,version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    ).bind(profileId,tournamentId,personId,displayName,body.club?.trim()??"",body.contact?.trim()??"",Number(body.duprSingles??0),Number(body.duprDoubles??0),normalizedPaymentStatus(body.paymentStatus),normalizedPlayerStatus(body.playerStatus),body.notes?.trim()??"",sort?.nextSort??0,stamp,stamp).run();
    try { await replacePlayerAssignments(env,profileId,assignments); } catch(error) { await env.HUAU_DB.prepare(`DELETE FROM tournament_player_profiles WHERE id=?`).bind(profileId).run(); return json({ok:false,code:error instanceof Error?error.message:"PLAYER_ASSIGNMENT_FAILED"},{status:409}); }
    for (const categoryId of affectedIds) await syncDerivedEntriesForCategory(env,categoryId,accessResult.user.id);
    await env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(stamp,tournamentId).run();
    return json({ok:true,player:{id:profileId,displayName}},{status:201});
  }

  const playerRoute = url.pathname.match(/^\/api\/admin\/tournament-players\/([^/]+)$/);
  if (playerRoute && (request.method === "PUT" || request.method === "DELETE")) {
    const profileId = decodeURIComponent(playerRoute[1]!);
    const current = await loadPlayerProfile(env,profileId);
    if (!current) return json({ok:false,code:"PLAYER_NOT_FOUND"},{status:404});
    const accessResult = await tournamentForAccess(current.tournamentId,request,env,access);
    if (accessResult instanceof Response) return accessResult;
    const previousAssignments = (await loadPlayerAssignments(env,current.tournamentId)).filter((row)=>row.playerProfileId===profileId);
    if (request.method === "DELETE") {
      const body: {confirmImpact?:boolean} = await readJson<{confirmImpact?:boolean}>(request).catch(()=>({}));
      const affectedIds = [...new Set(previousAssignments.map((row)=>row.categoryId))];
      const locked = await lockedCategoriesAmong(env,affectedIds);
      if (locked.length && !body.confirmImpact) return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Eliminar este jugador invalida categorías ya sorteadas. HUAU guardará snapshots primero."},{status:409});
      if (locked.length) await snapshotAndInvalidateCategories(env,accessResult.tournament,accessResult.user,locked,"Before deleting tournament player");
      await env.HUAU_DB.prepare(`DELETE FROM tournament_player_profiles WHERE id=?`).bind(profileId).run();
      for (const categoryId of affectedIds) await syncDerivedEntriesForCategory(env,categoryId,accessResult.user.id);
      await env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(unixNow(),current.tournamentId).run();
      return json({ok:true});
    }
    const body = await readJson<{displayName?:string;club?:string;contact?:string;duprSingles?:number;duprDoubles?:number;paymentStatus?:string;playerStatus?:string;notes?:string;assignments?:PlayerAssignmentInput[];confirmImpact?:boolean}>(request);
    const nextAssignments = body.assignments ?? previousAssignments.map((row)=>({categoryId:row.categoryId,partnerProfileId:row.partnerProfileId}));
    const structural = normalizedPlayerStatus(body.playerStatus ?? current.playerStatus) !== current.playerStatus ||
      !sameStringSet(previousAssignments.map((row)=>`${row.categoryId}:${row.partnerProfileId??""}`),nextAssignments.map((row)=>`${row.categoryId}:${row.partnerProfileId??""}`));
    const affectedIds = [...new Set([...previousAssignments.map((row)=>row.categoryId),...nextAssignments.map((row)=>row.categoryId)])];
    const locked = structural ? await lockedCategoriesAmong(env,affectedIds) : [];
    if (locked.length && !body.confirmImpact) return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Cambiar categorías, pareja o estado competitivo modifica estructuras ya sorteadas. HUAU guardará snapshots primero."},{status:409});
    if (locked.length) await snapshotAndInvalidateCategories(env,accessResult.tournament,accessResult.user,locked,"Before tournament player structural edit");
    const displayName = body.displayName?.trim() || current.displayName;
    const duplicate = await env.HUAU_DB.prepare(`SELECT id FROM tournament_player_profiles WHERE tournament_id=? AND lower(display_name)=lower(?) AND id<>?`).bind(current.tournamentId,displayName,profileId).first();
    if (duplicate) return json({ok:false,code:"DUPLICATE_PLAYER"},{status:409});
    const contact = body.contact?.trim() ?? current.contact;
    const personId = await createOrUpdateOrganizationPerson(env,accessResult.tournament,profileId,displayName,contact);
    const stamp=unixNow();
    await env.HUAU_DB.prepare(
      `UPDATE tournament_player_profiles SET organization_person_id=?,display_name=?,club=?,contact=?,dupr_singles=?,dupr_doubles=?,payment_status=?,player_status=?,notes=?,updated_at=?,version=version+1 WHERE id=?`,
    ).bind(personId,displayName,body.club?.trim()??current.club,contact,Number(body.duprSingles??current.duprSingles),Number(body.duprDoubles??current.duprDoubles),normalizedPaymentStatus(body.paymentStatus??current.paymentStatus),normalizedPlayerStatus(body.playerStatus??current.playerStatus),body.notes?.trim()??current.notes,stamp,profileId).run();
    try { await replacePlayerAssignments(env,profileId,nextAssignments); } catch(error) { return json({ok:false,code:error instanceof Error?error.message:"PLAYER_ASSIGNMENT_FAILED"},{status:409}); }
    for (const categoryId of affectedIds) await syncDerivedEntriesForCategory(env,categoryId,accessResult.user.id);
    await refreshDerivedDisplaysForTournament(env,current.tournamentId,accessResult.user.id);
    await env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(stamp,current.tournamentId).run();
    return json({ok:true});
  }

  const categoryRoute = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)$/);
  if (categoryRoute && (request.method === "PUT" || request.method === "DELETE")) {
    const categoryId=decodeURIComponent(categoryRoute[1]!);
    const accessResult=await categoryForAccess(categoryId,request,env,access);
    if(accessResult instanceof Response)return accessResult;
    const body: {name?:string;entryType?:"individual"|"pair"|"team";competitionGender?:string|null;scheduledDate?:string|null;confirmImpact?:boolean} = await readJson<{name?:string;entryType?:"individual"|"pair"|"team";competitionGender?:string|null;scheduledDate?:string|null;confirmImpact?:boolean}>(request).catch(()=>({}));
    if(request.method==="DELETE"){
      if(accessResult.category.structureLocked&&!body.confirmImpact)return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Eliminar esta categoría borra su estructura competitiva. HUAU guardará un snapshot primero."},{status:409});
      // Category deletion is always destructive, even before a draw exists.
      // Keep a self-contained snapshot so Recovery can recreate it.
      await snapshotCategory(env,accessResult.tournament,accessResult.category,accessResult.user.id,"Before deleting category");
      await env.HUAU_DB.prepare(`DELETE FROM tournament_categories WHERE id=?`).bind(categoryId).run();
      const settings=await settingsForTournament(env,accessResult.tournament.id); await regenerateTournamentSchedule(env,accessResult.tournament,accessResult.user.id,settings.dailyStart);
      return json({ok:true});
    }
    const nextEntryType=body.entryType??accessResult.category.entryType;
    const structural=nextEntryType!==accessResult.category.entryType || (body.competitionGender!==undefined&&body.competitionGender!==accessResult.category.competitionGender);
    if(structural&&accessResult.category.structureLocked&&!body.confirmImpact)return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Cambiar modalidad o género invalida el sorteo y cronograma. HUAU guardará un snapshot primero."},{status:409});
    if(structural&&accessResult.category.structureLocked){await snapshotCategory(env,accessResult.tournament,accessResult.category,accessResult.user.id,"Before category structural edit");await invalidateCategoryCompetition(env,categoryId);}
    const scheduledDate=body.scheduledDate===undefined?accessResult.category.scheduledDate:body.scheduledDate;
    await env.HUAU_DB.prepare(`UPDATE tournament_categories SET name=COALESCE(?,name),entry_type=?,competition_gender=?,scheduled_date=?,updated_at=?,version=version+1 WHERE id=?`).bind(body.name?.trim()||null,nextEntryType,body.competitionGender===undefined?accessResult.category.competitionGender:body.competitionGender,scheduledDate,unixNow(),categoryId).run();
    await syncDerivedEntriesForCategory(env,categoryId,accessResult.user.id);
    const settings=await settingsForTournament(env,accessResult.tournament.id); await regenerateTournamentSchedule(env,accessResult.tournament,accessResult.user.id,settings.dailyStart);
    return json({ok:true});
  }

  const categoryFormat = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)\/format$/);
  if (categoryFormat && request.method === "PUT") {
    const categoryId=decodeURIComponent(categoryFormat[1]!); const accessResult=await categoryForAccess(categoryId,request,env,access); if(accessResult instanceof Response)return accessResult;
    const body=await readJson<{config?:Record<string,unknown>;confirmImpact?:boolean}>(request); const config=body.config??{};
    if(accessResult.category.structureLocked&&!body.confirmImpact)return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Cambiar el formato de una categoría sorteada invalida grupos y cronograma. HUAU guardará un snapshot primero."},{status:409});
    if(accessResult.category.structureLocked){await snapshotCategory(env,accessResult.tournament,accessResult.category,accessResult.user.id,"Before format change");await invalidateCategoryCompetition(env,categoryId);}
    const id=await saveCategoryFormatVersion(env,{...accessResult.category,structureLocked:0},accessResult.user.id,config,false);
    return json({ok:true,formatVersionId:id});
  }

  const formatSimulate = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)\/format\/simulate$/);
  if (formatSimulate && request.method === "POST") {
    const categoryId=decodeURIComponent(formatSimulate[1]!);const accessResult=await categoryForAccess(categoryId,request,env,access);if(accessResult instanceof Response)return accessResult;
    await syncDerivedEntriesForCategory(env,categoryId,accessResult.user.id);const entries=await loadEntryModels(env,categoryId);const settings=await settingsForTournament(env,accessResult.tournament.id);
    const body=await readJson<Record<string,unknown>>(request);const availableMinutes=Math.max(0,Number(body.availableMinutes??0));
    const options=buildLegacyFormatOptions({entries:entries.length,courts:Math.max(1,Number(body.courts??accessResult.tournament.courtCount)),availableMinutes,matchMinutes:Math.max(5,Number(body.matchMinutes??settings.defaultMatchMinutes)),minimumGroup:Math.max(2,Number(body.minimumGroup??settings.minimumGroup)),preferredGroup:Math.max(2,Number(body.preferredGroup??settings.preferredGroup)),maximumGroup:Math.max(2,Number(body.maximumGroup??settings.maximumGroup)),finalDrawMethod:body.finalDrawMethod==="pots"?"pots":"performance",avoidGroupRematches:body.avoidGroupRematches!==false,bronzeMatch:body.bronzeMatch===true,medalBestOf:Number(body.medalBestOf)===3?3:1,medalSchedule:body.medalSchedule==="simultaneous"?"simultaneous":"sequential",standardPointTarget:Math.max(1,Number(body.standardPointTarget??15)),medalPointTarget:Math.max(1,Number(body.medalPointTarget??11)),groupRounds:Number(body.groupRounds)===2?2:1,crossGroupMethod:body.crossGroupMethod==="equalized"?"equalized":"normalized",playoffMode:["standard","top2_final","top3_step","top4_semis","league_only"].includes(String(body.playoffMode))?(String(body.playoffMode) as "standard"|"top2_final"|"top3_step"|"top4_semis"|"league_only"):"standard",consolationMode:body.consolationMode==="knockout"?"knockout":"none",minimumGuaranteedMatches:Math.max(0,Number(body.minimumGuaranteedMatches??0)),wildcardQualifiers:Math.max(0,Number(body.wildcardQualifiers??0)),requestedQualifiersPerGroup:Number(body.requestedQualifiersPerGroup)===1?1:Number(body.requestedQualifiersPerGroup)===2?2:0});
    return json({ok:true,options});
  }

  const groupsGenerate = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)\/groups$/);
  if(groupsGenerate&&request.method==="POST"){
    const categoryId=decodeURIComponent(groupsGenerate[1]!);const accessResult=await categoryForAccess(categoryId,request,env,access);if(accessResult instanceof Response)return accessResult;
    const body=await readJson<{seedingMethod?:LegacySeedingMethod;groupSizes?:number[];orderedEntryIds?:string[];config?:Record<string,unknown>;scheduledDate?:string;confirmImpact?:boolean}>(request);
    if(body.seedingMethod==="live")return json({ok:false,code:"USE_LIVE_DRAW"},{status:400});
    if(accessResult.category.structureLocked&&!body.confirmImpact)return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Regenerar grupos reemplaza estructura y cronograma. HUAU guardará un snapshot primero."},{status:409});
    if(accessResult.category.structureLocked)await snapshotCategory(env,accessResult.tournament,accessResult.category,accessResult.user.id,"Before group regeneration");
    try{await buildAndPersistCategoryGroups(env,accessResult,body);return json({ok:true});}catch(error){return json({ok:false,code:error instanceof Error?error.message:"GROUP_GENERATION_FAILED"},{status:400});}
  }

  const drawRoute=url.pathname.match(/^\/api\/admin\/categories\/([^/]+)\/draw\/(start|next|reset|confirm)$/);
  if(drawRoute&&request.method==="POST"){
    const categoryId=decodeURIComponent(drawRoute[1]!);const action=drawRoute[2]!;const accessResult=await categoryForAccess(categoryId,request,env,access);if(accessResult instanceof Response)return accessResult;
    const body: {groupSizes?:number[];confirmImpact?:boolean} = await readJson<{groupSizes?:number[];confirmImpact?:boolean}>(request).catch(()=>({}));
    // Legacy V2.1 parity: starting/resetting a live draw is only a rehearsal.
    // It MUST NOT alter the currently confirmed competition. The structural
    // replacement happens exclusively when the operator confirms the completed draw.
    await syncDerivedEntriesForCategory(env,categoryId,accessResult.user.id);const entries=await loadEntryModels(env,categoryId);const config=await savedCategoryConfig(env,accessResult.category);
    if(action==="start"||action==="reset"){
      const sizes=(body.groupSizes?.length?body.groupSizes:Array.isArray(config.groupSizes)?config.groupSizes as number[]:balancedGroupSizes(entries.length,Math.max(1,Number(config.groupCount??1)))).map(Number);
      if(sizes.reduce((sum,value)=>sum+value,0)!==entries.length)return json({ok:false,code:"GROUP_SIZE_MISMATCH"},{status:400});
      const state=createLiveDrawState(entries.map((entry)=>entry.id),sizes);const stamp=unixNow();
      await env.HUAU_DB.prepare(`INSERT INTO tournament_draw_sessions (category_id,status,state_json,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(category_id) DO UPDATE SET status=excluded.status,state_json=excluded.state_json,created_by_user_id=excluded.created_by_user_id,updated_at=excluded.updated_at`).bind(categoryId,state.status,JSON.stringify(state),accessResult.user.id,stamp,stamp).run();
      return json({ok:true,state});
    }
    const row=await env.HUAU_DB.prepare(`SELECT state_json as stateJson FROM tournament_draw_sessions WHERE category_id=?`).bind(categoryId).first<{stateJson:string}>();if(!row)return json({ok:false,code:"DRAW_NOT_STARTED"},{status:409});
    let state=JSON.parse(row.stateJson) as LiveDrawState;
    if(action==="next"){
      state=advanceLiveDraw(state);await env.HUAU_DB.prepare(`UPDATE tournament_draw_sessions SET status=?,state_json=?,updated_at=? WHERE category_id=?`).bind(state.status,JSON.stringify(state),unixNow(),categoryId).run();return json({ok:true,state});
    }
    if(state.status!=="complete")return json({ok:false,code:"DRAW_NOT_COMPLETE"},{status:409});
    const labels=Object.keys(state.assignments).sort();const groupSizes=labels.map((label)=>state.assignments[label]?.length??0);const order=labels.flatMap((label)=>state.assignments[label]??[]);
    const finalConfig={...config,groupSizes,groupCount:groupSizes.length,seedingMethod:"live"};
    if(accessResult.category.structureLocked&&!body.confirmImpact)return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Confirmar este sorteo reemplazará los grupos y el cronograma actuales. HUAU guardará un snapshot primero."},{status:409});
    if(accessResult.category.structureLocked)await snapshotCategory(env,accessResult.tournament,accessResult.category,accessResult.user.id,"Before confirming live draw");
    try{await buildAndPersistCategoryGroups(env,accessResult,{seedingMethod:"manual",groupSizes,orderedEntryIds:order,config:finalConfig,scheduledDate:accessResult.category.scheduledDate??dateFromUnix(accessResult.tournament.startAt)});await env.HUAU_DB.prepare(`UPDATE tournament_draw_sessions SET status='confirmed',updated_at=? WHERE category_id=?`).bind(unixNow(),categoryId).run();return json({ok:true,state});}catch(error){return json({ok:false,code:error instanceof Error?error.message:"DRAW_CONFIRM_FAILED"},{status:400});}
  }

  const scheduleRegenerate=url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/schedule\/regenerate$/);
  if(scheduleRegenerate&&request.method==="POST"){
    const tournamentId=decodeURIComponent(scheduleRegenerate[1]!);const accessResult=await tournamentForAccess(tournamentId,request,env,access);if(accessResult instanceof Response)return accessResult;const settings=await settingsForTournament(env,tournamentId);await regenerateTournamentSchedule(env,accessResult.tournament,accessResult.user.id,settings.dailyStart);return json({ok:true});
  }
  const resetCompetition=url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/reset-competition$/);
  if(resetCompetition&&request.method==="POST"){
    const tournamentId=decodeURIComponent(resetCompetition[1]!);
    const accessResult=await tournamentForAccess(tournamentId,request,env,access);if(accessResult instanceof Response)return accessResult;
    const body: {confirm?:boolean}=await readJson<{confirm?:boolean}>(request).catch(()=>({}));
    if(!body.confirm)return json({ok:false,code:"RESET_CONFIRM_REQUIRED",impact:"Elimina formatos activos, grupos, resultados y cronograma. Conserva jugadores, categorías y datos del torneo."},{status:409});
    const categoryRows=await env.HUAU_DB.prepare(`SELECT id,tournament_id as tournamentId,name,entry_type as entryType,competition_gender as competitionGender,scheduled_date as scheduledDate,sort_order as sortOrder,structure_locked as structureLocked,format_version_id as formatVersionId FROM tournament_categories WHERE tournament_id=? ORDER BY sort_order`).bind(tournamentId).all<CategoryRow>();
    for(const category of categoryRows.results){
      if(category.formatVersionId||category.structureLocked)await snapshotCategory(env,accessResult.tournament,category,accessResult.user.id,"Before competition reset");
    }
    const stamp=unixNow();
    await runBatches(env.HUAU_DB,[
      env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE tournament_id=?`).bind(tournamentId),
      env.HUAU_DB.prepare(`DELETE FROM tournament_draw_sessions WHERE category_id IN (SELECT id FROM tournament_categories WHERE tournament_id=?)`).bind(tournamentId),
      env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id IN (SELECT id FROM tournament_categories WHERE tournament_id=?)`).bind(tournamentId),
      env.HUAU_DB.prepare(`UPDATE tournament_categories SET format_version_id=NULL,structure_locked=0,updated_at=?,version=version+1 WHERE tournament_id=?`).bind(stamp,tournamentId),
      env.HUAU_DB.prepare(`UPDATE tournaments SET status='draft',structure_locked=0,working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(stamp,tournamentId),
    ]);
    await audit(env,accessResult.tournament,accessResult.user.id,"tournament.competition.reset","Reset competition while preserving tournament data and players","tournament",tournamentId);
    return json({ok:true});
  }
  const categoryCreate = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/categories$/);
  if (categoryCreate && request.method === "POST") {
    const tournamentId = decodeURIComponent(categoryCreate[1]!);
    const accessResult = await tournamentForAccess(tournamentId, request, env, access);
    if (accessResult instanceof Response) return accessResult;
    const body = await readJson<{ name?: string; entryType?: string; competitionGender?: string | null }>(request);
    const name = body.name?.trim();
    if (!name || !["individual","pair","team"].includes(body.entryType ?? "")) return json({ ok: false, code: "INVALID_CATEGORY" }, { status: 400 });
    const sortRow = await env.HUAU_DB.prepare(`SELECT COALESCE(MAX(sort_order),-1)+1 as nextSort FROM tournament_categories WHERE tournament_id=?`).bind(tournamentId).first<{ nextSort: number }>();
    const categoryId = uuid(); const stamp=unixNow();
    await env.HUAU_DB.prepare(
      `INSERT INTO tournament_categories (id,tournament_id,name,entry_type,competition_gender,max_entries,registration_status,price_scope,price_minor,currency,format_version_id,scheduled_date,sort_order,structure_locked,created_at,updated_at,version)
       VALUES (?,?,?,?,?,NULL,'closed','free',NULL,'UYU',NULL,NULL,?,0,?,?,1)`,
    ).bind(categoryId,tournamentId,name,body.entryType,body.competitionGender ?? null,sortRow?.nextSort ?? 0,stamp,stamp).run();
    await env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(stamp,tournamentId).run();
    return json({ ok:true, category:{ id:categoryId,name } },{status:201});
  }

  const addEntry = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)\/entries$/);
  if (addEntry && request.method === "POST") {
    const categoryId = decodeURIComponent(addEntry[1]!);
    const accessResult = await categoryForAccess(categoryId, request, env, access);
    if (accessResult instanceof Response) return accessResult;
    const body = await readJson<{ displayName?: string; members?: string[]; seedRating?: number; confirmImpact?: boolean }>(request);
    const members=(body.members ?? []).map((value)=>value.trim()).filter(Boolean);
    const expected = accessResult.category.entryType === "individual" ? 1 : accessResult.category.entryType === "pair" ? 2 : Math.max(1,members.length);
    if (members.length !== expected && accessResult.category.entryType !== "team") return json({ok:false,code:"INVALID_MEMBER_COUNT"},{status:400});
    if (!members.length) return json({ok:false,code:"MEMBERS_REQUIRED"},{status:400});
    if (accessResult.category.structureLocked && !body.confirmImpact) return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"The category draw and schedule will be invalidated. A snapshot will be created first."},{status:409});
    if (accessResult.category.structureLocked) {
      await snapshotCategory(env, accessResult.tournament, accessResult.category, accessResult.user.id, "Before participant structural change");
      await env.HUAU_DB.batch([
        env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE category_id=?`).bind(categoryId),
        env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id=?`).bind(categoryId),
        env.HUAU_DB.prepare(`UPDATE tournament_categories SET format_version_id=NULL,structure_locked=0,updated_at=? WHERE id=?`).bind(unixNow(),categoryId),
      ]);
    }
    const entryId=uuid(); const stamp=unixNow(); const displayName=body.displayName?.trim() || members.join(" / ");
    const statements:D1PreparedStatement[]=[env.HUAU_DB.prepare(
      `INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,created_at,updated_at,version)
       VALUES (?,?,?,?,NULL,'confirmed',NULL,?,?,1,?,?,1)`,
    ).bind(entryId,categoryId,accessResult.category.entryType,displayName,Number(body.seedRating||0),accessResult.user.id,stamp,stamp)];
    members.forEach((member,index)=>{
      const personId=uuid(); const parts=member.split(/\s+/); const first=parts.shift() || member; const last=parts.join(" ");
      statements.push(env.HUAU_DB.prepare(
        `INSERT INTO organization_people (id,organization_id,user_id,first_name,last_name,email,phone,sport_gender,source,status,created_at,updated_at)
         VALUES (?,?,NULL,?,?,NULL,NULL,NULL,'manual','active',?,?)`,
      ).bind(personId,accessResult.tournament.organizerOrganizationId,first,last,stamp,stamp));
      statements.push(env.HUAU_DB.prepare(
        `INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at)
         VALUES (?,?,?, ?,NULL,'manual',NULL,?,?,?)`,
      ).bind(uuid(),entryId,personId,index===0?"captain":"player",stamp,stamp,stamp));
    });
    statements.push(env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,structure_locked=0,updated_at=? WHERE id=?`).bind(stamp,accessResult.tournament.id));
    await runBatches(env.HUAU_DB,statements);
    return json({ok:true,entry:{id:entryId,displayName}},{status:201});
  }

  const reorderCategory = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)\/order$/);
  if (reorderCategory && request.method === "POST") {
    const categoryId = decodeURIComponent(reorderCategory[1]!);
    const accessResult = await categoryForAccess(categoryId, request, env, access);
    if (accessResult instanceof Response) return accessResult;
    const body = await readJson<{ direction?: "up" | "down" }>(request);
    if (body.direction !== "up" && body.direction !== "down") return json({ ok:false, code:"INVALID_DIRECTION" }, { status:400 });
    const rows = await env.HUAU_DB.prepare(
      `SELECT id,sort_order as sortOrder FROM tournament_categories WHERE tournament_id=? ORDER BY sort_order,name`,
    ).bind(accessResult.tournament.id).all<{ id:string; sortOrder:number }>();
    const index = rows.results.findIndex((row) => row.id === categoryId);
    const targetIndex = body.direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= rows.results.length) return json({ ok:true });
    const current = rows.results[index]!;
    const target = rows.results[targetIndex]!;
    const targetCategory = await env.HUAU_DB.prepare(
      `SELECT id,tournament_id as tournamentId,name,entry_type as entryType,competition_gender as competitionGender,scheduled_date as scheduledDate,sort_order as sortOrder,structure_locked as structureLocked,format_version_id as formatVersionId FROM tournament_categories WHERE id=?`,
    ).bind(target.id).first<CategoryRow>();
    if (accessResult.category.formatVersionId) await snapshotCategory(env, accessResult.tournament, accessResult.category, accessResult.user.id, "Before category order change");
    if (targetCategory?.formatVersionId) await snapshotCategory(env, accessResult.tournament, targetCategory, accessResult.user.id, "Before category order change");
    await env.HUAU_DB.batch([
      env.HUAU_DB.prepare(`UPDATE tournament_categories SET sort_order=?,updated_at=? WHERE id=?`).bind(target.sortOrder, unixNow(), current.id),
      env.HUAU_DB.prepare(`UPDATE tournament_categories SET sort_order=?,updated_at=? WHERE id=?`).bind(current.sortOrder, unixNow(), target.id),
    ]);
    const dailyStart = await tournamentDailyStart(env, accessResult.tournament.id);
    await regenerateTournamentSchedule(env, accessResult.tournament, accessResult.user.id, dailyStart);
    await audit(env, accessResult.tournament, accessResult.user.id, "category.order", "Changed category schedule order", "category", categoryId, { direction: body.direction });
    return json({ ok:true });
  }

  const generate = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)\/generate$/);
  if (generate && request.method === "POST") {
    const categoryId=decodeURIComponent(generate[1]!); const accessResult=await categoryForAccess(categoryId,request,env,access); if(accessResult instanceof Response)return accessResult;
    const body=await readJson<{ groupCount?:number; scheduledDate?:string; dailyStart?:string; matchMinutes?:number; format?:Partial<StandardCompetitionFormat>; confirmImpact?:boolean }>(request);
    const entries=await loadEntryModels(env,categoryId); if(entries.length<2)return json({ok:false,code:"NOT_ENOUGH_ENTRIES"},{status:400});
    const groupCount=Math.max(1,Math.min(entries.length,Math.trunc(body.groupCount||1))); const scheduledDate=body.scheduledDate || dateFromUnix(accessResult.tournament.startAt);
    if(accessResult.category.structureLocked && !body.confirmImpact)return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Existing draw and schedule will be replaced. A category snapshot will be created first."},{status:409});
    await snapshotCategory(env,accessResult.tournament,accessResult.category,accessResult.user.id,accessResult.category.structureLocked?"Before category regeneration":"Before first category generation");
    const format=normalizeStandardFormat(body.format); const groups=distributeEntriesIntoGroups(entries,groupCount).map((group)=>({...group,id:uuid()}));
    const competition=buildCompetitionFromGroups({id:uuid(),categoryId,groups,format});
    const versionRow=await env.HUAU_DB.prepare(`SELECT COALESCE(MAX(version_number),0)+1 as nextVersion FROM competition_format_versions WHERE category_id=?`).bind(categoryId).first<{nextVersion:number}>();
    const formatId=uuid(); const stamp=unixNow(); const config={...format,matchMinutes:Math.max(5,Math.trunc(body.matchMinutes||15)),dailyStart:body.dailyStart||"09:00",groupCount};
    const statements:D1PreparedStatement[]=[
      env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE category_id=?`).bind(categoryId),
      env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id=?`).bind(categoryId),
      env.HUAU_DB.prepare(`INSERT INTO competition_format_versions (id,category_id,version_number,format_kind,config_json,explanation_schema_version,created_by_user_id,created_at,locked_at) VALUES (?,?,?,'standard',?,1,?,?,?)`).bind(formatId,categoryId,versionRow?.nextVersion??1,JSON.stringify(config),accessResult.user.id,stamp,stamp),
      env.HUAU_DB.prepare(`INSERT INTO competitions (id,category_id,format_version_id,status,structure_revision,created_at,updated_at) VALUES (?,?,?,'groups_generated',1,?,?)`).bind(competition.id,categoryId,formatId,stamp,stamp),
    ];
    groups.forEach((group,groupIndex)=>{statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_groups (id,competition_id,name,sort_order) VALUES (?,?,?,?)`).bind(group.id,competition.id,group.name,groupIndex));group.entries.forEach((entry,entryIndex)=>statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_group_entries (group_id,entry_id,seed,sort_order) VALUES (?,?,?,?)`).bind(group.id,entry.id,entryIndex+1,entryIndex)));});
    competition.encounters.forEach((encounter)=>{statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_encounters (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',NULL,?,?,1)`).bind(encounter.id,competition.id,encounter.stage,encounter.groupId,encounter.roundLabel,encounter.roundNumber,encounter.legNumber,encounter.entryA?.id??null,encounter.entryB?.id??null,encounter.sourceEncounterAId,encounter.sourceEncounterBId,encounter.sourceLoserAId,encounter.sourceLoserBId,stamp,stamp));statements.push(env.HUAU_DB.prepare(`INSERT INTO matches (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version) VALUES (?,?,NULL,1,?, ?,?,?,NULL,'pending',?,?,NULL,0,?,?,1)`).bind(uuid(),encounter.id,accessResult.category.entryType==="individual"?"singles":"doubles",accessResult.category.competitionGender,encounter.bestOf,encounter.pointTarget,encounter.entryA?.name??null,encounter.entryB?.name??null,stamp,stamp));});
    statements.push(env.HUAU_DB.prepare(`UPDATE tournament_categories SET format_version_id=?,scheduled_date=?,structure_locked=1,updated_at=?,version=version+1 WHERE id=?`).bind(formatId,scheduledDate,stamp,categoryId));
    await runBatches(env.HUAU_DB,statements);
    await regenerateTournamentSchedule(env, accessResult.tournament, accessResult.user.id, body.dailyStart || "09:00");
    await audit(env,accessResult.tournament,accessResult.user.id,"category.generate","Generated groups and tournament schedule","category",categoryId,{groupCount,entryCount:entries.length});
    return json({ok:true});
  }

  const finals = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)\/finals$/);
  if(finals && request.method==="POST"){
    const categoryId=decodeURIComponent(finals[1]!);
    const accessResult=await categoryForAccess(categoryId,request,env,access);
    if(accessResult instanceof Response)return accessResult;
    try{
      await createFinalPhaseForCategory(env,accessResult,false);
      return json({ok:true});
    }catch(error){
      const code=error instanceof Error?error.message:"FINAL_PHASE_FAILED";
      return json({ok:false,code},{status:code==="GROUPS_INCOMPLETE"||code==="COMPETITION_NOT_GENERATED"?409:400});
    }
  }

  const matchResult=url.pathname.match(/^\/api\/admin\/matches\/([^/]+)\/result$/);
  if(matchResult && request.method==="POST"){
    const matchId=decodeURIComponent(matchResult[1]!);
    const lookup=await env.HUAU_DB.prepare(
      `SELECT tc.id as categoryId,tc.tournament_id as tournamentId,ce.id as encounterId,ce.stage,m.best_of as bestOf,
              CASE WHEN mr.match_id IS NULL THEN 0 ELSE 1 END as hadResult,c.id as competitionId
         FROM matches m JOIN competition_encounters ce ON ce.id=m.encounter_id JOIN competitions c ON c.id=ce.competition_id
         JOIN tournament_categories tc ON tc.id=c.category_id LEFT JOIN match_results mr ON mr.match_id=m.id WHERE m.id=?`,
    ).bind(matchId).first<{categoryId:string;tournamentId:string;encounterId:string;stage:string;bestOf:number;hadResult:number;competitionId:string}>();
    if(!lookup)return json({ok:false,code:"MATCH_NOT_FOUND"},{status:404});
    const accessResult=await tournamentForAccess(lookup.tournamentId,request,env,access);if(accessResult instanceof Response)return accessResult;
    const categoryAccess=await categoryForAccess(lookup.categoryId,request,env,access);if(categoryAccess instanceof Response)return categoryAccess;
    const body=await readJson<{scoreA?:number;scoreB?:number;sets?:Array<{scoreA:number;scoreB:number}>;confirmImpact?:boolean}>(request);

    let competition=await loadCompetition(env,lookup.categoryId);if(!competition)return json({ok:false,code:"COMPETITION_NOT_FOUND"},{status:404});
    if(lookup.stage==="group"&&lookup.hadResult&&competition.finalGenerated){
      const finishedFinal=competition.encounters.some((encounter)=>encounter.stage!=="group"&&encounter.status==="finished");
      if(finishedFinal&&!body.confirmImpact)return json({ok:false,code:"STRUCTURE_CHANGE_CONFIRM_REQUIRED",impact:"Corregir este resultado cambia los clasificados y la llave ya iniciada. HUAU guardará un snapshot y regenerará la fase final."},{status:409});
      await snapshotCategory(env,accessResult.tournament,categoryAccess.category,accessResult.user.id,"Before group result correction with final phase");
      await env.HUAU_DB.batch([
        env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE category_id=? AND stage!='group'`).bind(lookup.categoryId),
        env.HUAU_DB.prepare(`DELETE FROM competition_encounters WHERE competition_id=? AND stage!='group'`).bind(lookup.competitionId),
        env.HUAU_DB.prepare(`UPDATE competitions SET status='group_stage',updated_at=?,structure_revision=structure_revision+1 WHERE id=?`).bind(unixNow(),lookup.competitionId),
      ]);
      competition=(await loadCompetition(env,lookup.categoryId))!;
    }

    let updated:Competition;
    try{
      updated=lookup.bestOf===3
        ?withEncounterResult(competition,lookup.encounterId,{sets:body.sets??[]})
        :withEncounterResult(competition,lookup.encounterId,{scoreA:Number(body.scoreA),scoreB:Number(body.scoreB)});
    }catch(error){return json({ok:false,code:error instanceof Error?error.message:"INVALID_RESULT"},{status:400});}
    const target=updated.encounters.find((encounter)=>encounter.id===lookup.encounterId)!;
    const stamp=unixNow();
    const statements:D1PreparedStatement[]=[];
    for(const encounter of updated.encounters){
      const before=competition.encounters.find((candidate)=>candidate.id===encounter.id);if(!before)continue;
      const changed=before.entryA?.id!==encounter.entryA?.id||before.entryB?.id!==encounter.entryB?.id||before.status!==encounter.status||before.winnerEntryId!==encounter.winnerEntryId;
      if(!changed)continue;
      statements.push(env.HUAU_DB.prepare(
        `UPDATE competition_encounters SET entry_a_id=?,entry_b_id=?,status=?,winner_entry_id=?,updated_at=?,version=version+1 WHERE id=?`,
      ).bind(encounter.entryA?.id??null,encounter.entryB?.id??null,encounter.status,encounter.winnerEntryId,stamp,encounter.id));
      statements.push(env.HUAU_DB.prepare(
        `UPDATE matches SET side_a_label=?,side_b_label=?,status=CASE WHEN ? IN ('finished','bye','skipped') THEN 'finished' WHEN ?='ready' THEN 'ready' ELSE status END,updated_at=?,version=version+1 WHERE encounter_id=?`,
      ).bind(encounter.entryA?.name??null,encounter.entryB?.name??null,encounter.status,encounter.status,stamp,encounter.id));
    }
    const winnerSide=target.winnerEntryId===target.entryA?.id?"A":"B";
    statements.push(
      env.HUAU_DB.prepare(`UPDATE matches SET status='finished',winner_side=?,side_a_label=?,side_b_label=?,updated_at=?,version=version+1 WHERE id=?`).bind(winnerSide,target.entryA?.name??null,target.entryB?.name??null,stamp,matchId),
      env.HUAU_DB.prepare(
        `INSERT INTO match_results (match_id,score_a,score_b,winner_side,result_status,entered_by_user_id,entered_at,corrected_at,updated_at)
         VALUES (?,?,?,?, 'final',?,?,NULL,?)
         ON CONFLICT(match_id) DO UPDATE SET score_a=excluded.score_a,score_b=excluded.score_b,winner_side=excluded.winner_side,result_status='corrected',entered_by_user_id=excluded.entered_by_user_id,corrected_at=excluded.entered_at,updated_at=excluded.updated_at`,
      ).bind(matchId,target.scoreA,target.scoreB,winnerSide,accessResult.user.id,stamp,stamp),
      env.HUAU_DB.prepare(`DELETE FROM match_sets WHERE match_id=?`).bind(matchId),
    );
    target.sets.forEach((set,index)=>statements.push(env.HUAU_DB.prepare(`INSERT INTO match_sets (id,match_id,set_number,score_a,score_b,winner_side) VALUES (?,?,?,?,?,?)`).bind(uuid(),matchId,index+1,set.scoreA,set.scoreB,set.scoreA>set.scoreB?"A":"B")));
    statements.push(env.HUAU_DB.prepare(`UPDATE schedule_items SET status='completed',updated_at=?,version=version+1 WHERE match_id=?`).bind(stamp,matchId));
    await runBatches(env.HUAU_DB,statements);

    const after=await loadCompetition(env,lookup.categoryId);
    if(after&&lookup.stage==="group"&&!after.finalGenerated&&after.encounters.filter((encounter)=>encounter.stage==="group").every((encounter)=>encounter.status==="finished")){
      await createFinalPhaseForCategory(env,categoryAccess,true);
    }else if(after&&after.finalGenerated&&after.encounters.every((encounter)=>encounter.status==="finished"||encounter.status==="bye"||encounter.status==="skipped")){
      await env.HUAU_DB.batch([
        env.HUAU_DB.prepare(`UPDATE competitions SET status='completed',updated_at=? WHERE id=?`).bind(stamp,after.id),
        env.HUAU_DB.prepare(`UPDATE tournaments SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM competitions c JOIN tournament_categories tc ON tc.id=c.category_id WHERE tc.tournament_id=? AND c.status!='completed') THEN 'completed' ELSE status END,updated_at=? WHERE id=?`).bind(lookup.tournamentId,stamp,lookup.tournamentId),
      ]);
    }
    await audit(env,accessResult.tournament,accessResult.user.id,lookup.hadResult?"match.result.corrected":"match.result","Saved match result","match",matchId,{encounterId:lookup.encounterId});
    return json({ok:true});
  }
  const restore=url.pathname.match(/^\/api\/admin\/tournament-snapshots\/([^/]+)\/restore$/); if(restore && request.method==="POST")return restoreSnapshot(env,decodeURIComponent(restore[1]!),request,access);
  return null;
}
