import {
  capacityDecision,
  categoryLimitReached,
  evaluateRegistrationEligibility,
  parseTeamFormat,
  registrationPriceMinor,
  resolveRegistrationPricing,
  resolveTeamIndividualPrice,
  teamAgeDivisionOverlapBlocked,
  validateTeamRoster,
  type RegistrationCategoryRule,
  type TeamAdditionalParticipationMode,
  type TeamRosterMember,
} from "@huau/core";

type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isOrgAdmin: (userId: string, organizationId: string, env: Env, request?: Request) => Promise<boolean>;
};

type TournamentRow = {
  id: string;
  organizerOrganizationId: string;
  name: string;
  slug: string;
  sport: string;
  status: string;
  visibility: string;
  startAt: number;
  endAt: number | null;
  timezone: string;
  courtCount: number;
  structureLocked: number;
};

type CategoryRow = RegistrationCategoryRule & {
  id: string;
  tournamentId: string;
  name: string;
  structureLocked: number;
  formatVersionId: string | null;
};

type ProfileRow = {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  sportGender: "male" | "female" | "unspecified";
  phone: string | null;
};

type PricingSettingsRow = {
  paymentType: "per_category" | "base_plus_extra" | "free";
  entryFeeMinor: number | null;
  baseFeeMinor: number | null;
  extraCategoryFeeMinor: number | null;
  maxCategoriesPerPlayer: number | null;
  teamIndividualFeeMinor: number | null;
  teamFullFeeMinor: number | null;
  teamAdditionalParticipationMode: TeamAdditionalParticipationMode;
  teamAdditionalFeeMinor: number | null;
  allowTeamAgeDivisionOverlap: number;
};

type RegistrationRow = {
  id: string;
  tournamentId: string;
  categoryId: string;
  entryId: string | null;
  userId: string;
  status: string;
  participantCount: number;
  priceScope: "free" | "per_entry" | "per_person";
  baseAmountMinor: number;
  discountMinor: number;
  finalAmountMinor: number;
  currency: string | null;
  waitlistPosition: number | null;
  registrationNumber: number;
  coveredByRegistrationId: string | null;
  paidAmountMinor: number;
  refundedAmountMinor: number;
};

type TeamPaymentMode = "individual" | "team_full";

type MatchInvitationRow = {
  id: string;
  tournamentId: string;
  categoryId: string;
  kind: "pair" | "team";
  inviterRegistrationId: string;
  inviteeRegistrationId: string;
  inviterUserId: string;
  inviteeUserId: string;
  teamEntryId: string | null;
  status: string;
  expiresAt: number;
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
const now = () => Math.floor(Date.now() / 1000);
const dateFromUnix = (value: number) => new Date((value < 10_000_000_000 ? value * 1000 : value)).toISOString().slice(0, 10);
const activeRegistrationSql = `status NOT IN ('cancelled','rejected')`;

function parseJsonOrNull(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function tournamentBySlug(env: Env, slug: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,organizer_organization_id as organizerOrganizationId,name,slug,sport,status,visibility,start_at as startAt,end_at as endAt,timezone,court_count as courtCount,structure_locked as structureLocked FROM tournaments WHERE slug=?`,
  ).bind(slug).first<TournamentRow>();
}

async function tournamentById(env: Env, id: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,organizer_organization_id as organizerOrganizationId,name,slug,sport,status,visibility,start_at as startAt,end_at as endAt,timezone,court_count as courtCount,structure_locked as structureLocked FROM tournaments WHERE id=?`,
  ).bind(id).first<TournamentRow>();
}

async function categoryById(env: Env, id: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,name,entry_type as entryType,competition_gender as competitionGender,min_age as minAge,max_age as maxAge,max_entries as maxEntries,registration_status as registrationStatus,price_scope as priceScope,price_minor as priceMinor,currency,structure_locked as structureLocked,format_version_id as formatVersionId FROM tournament_categories WHERE id=?`,
  ).bind(id).first<CategoryRow>();
}

async function profileForUser(env: Env, userId: string) {
  return env.HUAU_DB.prepare(
    `SELECT first_name as firstName,last_name as lastName,birth_date as birthDate,COALESCE(sport_gender,'unspecified') as sportGender,phone FROM user_profiles WHERE user_id=?`,
  ).bind(userId).first<ProfileRow>();
}

async function userById(env: Env, userId: string) {
  return env.HUAU_DB.prepare(`SELECT id,name,email FROM user WHERE id=?`).bind(userId).first<CurrentUser>();
}

async function registrationCloseAt(env: Env, tournamentId: string) {
  const row = await env.HUAU_DB.prepare(
    `SELECT registration_close_at as registrationCloseAt FROM tournament_settings WHERE tournament_id=?`,
  ).bind(tournamentId).first<{ registrationCloseAt: number | null }>();
  return row?.registrationCloseAt ?? null;
}

async function pricingSettingsForTournament(env: Env, tournamentId: string): Promise<PricingSettingsRow> {
  const row = await env.HUAU_DB.prepare(
    `SELECT payment_type as paymentType,entry_fee_minor as entryFeeMinor,base_fee_minor as baseFeeMinor,extra_category_fee_minor as extraCategoryFeeMinor,
            max_categories_per_player as maxCategoriesPerPlayer,team_individual_fee_minor as teamIndividualFeeMinor,
            team_full_fee_minor as teamFullFeeMinor,COALESCE(team_additional_participation_mode,'full') as teamAdditionalParticipationMode,
            team_additional_fee_minor as teamAdditionalFeeMinor,COALESCE(allow_team_age_division_overlap,1) as allowTeamAgeDivisionOverlap
       FROM tournament_settings WHERE tournament_id=?`,
  ).bind(tournamentId).first<PricingSettingsRow>();
  return row ?? {
    paymentType: "free",
    entryFeeMinor: null,
    baseFeeMinor: null,
    extraCategoryFeeMinor: null,
    maxCategoriesPerPlayer: null,
    teamIndividualFeeMinor: null,
    teamFullFeeMinor: null,
    teamAdditionalParticipationMode: "full",
    teamAdditionalFeeMinor: null,
    allowTeamAgeDivisionOverlap: 1,
  };
}

async function priorActiveRegistrationCount(env: Env, tournamentId: string, userId: string, beforeRegistrationNumber?: number) {
  const beforeClause = beforeRegistrationNumber === undefined ? "" : "AND registration_number < ?";
  const values: Array<string | number> = [tournamentId, userId];
  if (beforeRegistrationNumber !== undefined) values.push(beforeRegistrationNumber);
  const row = await env.HUAU_DB.prepare(
    `SELECT COUNT(*) as count FROM tournament_registrations WHERE tournament_id=? AND user_id=? AND ${activeRegistrationSql} ${beforeClause}`,
  ).bind(...values).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function priorActiveTeamRegistrationCount(env: Env, tournamentId: string, userId: string, beforeRegistrationNumber?: number) {
  const beforeClause = beforeRegistrationNumber === undefined ? "" : "AND tr.registration_number < ?";
  const values: Array<string | number> = [tournamentId, userId];
  if (beforeRegistrationNumber !== undefined) values.push(beforeRegistrationNumber);
  const row = await env.HUAU_DB.prepare(
    `SELECT COUNT(*) as count
       FROM tournament_registrations tr JOIN tournament_categories tc ON tc.id=tr.category_id
      WHERE tr.tournament_id=? AND tr.user_id=? AND tr.status NOT IN ('cancelled','rejected') AND tc.entry_type='team' ${beforeClause}`,
  ).bind(...values).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function priorAgeTeamDivisionCount(env: Env, tournamentId: string, userId: string, excludeCategoryId?: string) {
  const values: string[] = [tournamentId, userId];
  const exclusion = excludeCategoryId ? "AND tc.id<>?" : "";
  if (excludeCategoryId) values.push(excludeCategoryId);
  const row = await env.HUAU_DB.prepare(
    `SELECT COUNT(DISTINCT tc.id) as count
       FROM tournament_registrations tr JOIN tournament_categories tc ON tc.id=tr.category_id
      WHERE tr.tournament_id=? AND tr.user_id=? AND tr.status NOT IN ('cancelled','rejected') AND tc.entry_type='team'
        AND (tc.min_age IS NOT NULL OR tc.max_age IS NOT NULL) ${exclusion}`,
  ).bind(...values).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function activeCategoryCountForUser(env: Env, tournamentId: string, userId: string) {
  const row = await env.HUAU_DB.prepare(
    `SELECT COUNT(DISTINCT categoryId) as count FROM (
       SELECT category_id as categoryId FROM tournament_registrations
        WHERE tournament_id=? AND user_id=? AND status NOT IN ('cancelled','rejected')
       UNION
       SELECT e.category_id as categoryId
         FROM tournament_entries e
         JOIN tournament_categories tc ON tc.id=e.category_id
         JOIN entry_members em ON em.entry_id=e.id AND em.status IN ('accepted','manual')
         JOIN organization_people op ON op.id=em.organization_person_id
        WHERE tc.tournament_id=? AND op.user_id=? AND e.status NOT IN ('withdrawn','rejected')
     )`,
  ).bind(tournamentId, userId, tournamentId, userId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function userAlreadyInCategory(env: Env, userId: string, categoryId: string) {
  const own = await env.HUAU_DB.prepare(
    `SELECT id FROM tournament_registrations WHERE user_id=? AND category_id=? AND status NOT IN ('cancelled','rejected') LIMIT 1`,
  ).bind(userId, categoryId).first<{ id: string }>();
  if (own) return true;
  const legacy = await env.HUAU_DB.prepare(
    `SELECT e.id FROM tournament_entries e
       JOIN entry_members em ON em.entry_id=e.id AND em.status IN ('accepted','manual')
       JOIN organization_people op ON op.id=em.organization_person_id
      WHERE e.category_id=? AND op.user_id=? AND e.status NOT IN ('withdrawn','rejected') LIMIT 1`,
  ).bind(categoryId, userId).first<{ id: string }>();
  return Boolean(legacy);
}

async function effectivePersonalPricing(
  env: Env,
  tournamentId: string,
  userId: string,
  category: CategoryRow,
  options: { beforeRegistrationNumber?: number; teamPaymentMode?: TeamPaymentMode | null } = {},
) {
  const settings = await pricingSettingsForTournament(env, tournamentId);
  if (category.entryType === "team" && options.teamPaymentMode === "team_full") {
    if (settings.teamFullFeeMinor === null) throw new Error("TEAM_FULL_FEE_NOT_CONFIGURED");
    return { settings, priceScope: "per_entry" as const, priceMinor: Math.max(0, settings.teamFullFeeMinor), source: "team_full" as const };
  }

  if (category.priceMinor !== null) {
    return {
      settings,
      priceScope: category.priceScope,
      priceMinor: registrationPriceMinor({ priceScope: category.priceScope, priceMinor: category.priceMinor }, 1),
      source: "category" as const,
    };
  }

  if (category.entryType === "team" && settings.teamIndividualFeeMinor !== null) {
    const priorTeam = await priorActiveTeamRegistrationCount(env, tournamentId, userId, options.beforeRegistrationNumber);
    return {
      settings,
      priceScope: "per_person" as const,
      priceMinor: resolveTeamIndividualPrice({
        individualFeeMinor: settings.teamIndividualFeeMinor,
        additionalMode: settings.teamAdditionalParticipationMode,
        additionalFeeMinor: settings.teamAdditionalFeeMinor,
        priorTeamRegistrationCount: priorTeam,
      }),
      source: priorTeam > 0 ? "team_additional" as const : "team_individual" as const,
    };
  }

  const prior = await priorActiveRegistrationCount(env, tournamentId, userId, options.beforeRegistrationNumber);
  const resolution = resolveRegistrationPricing({
    categoryPriceScope: category.priceScope,
    categoryPriceMinor: category.priceMinor,
    tournamentPaymentType: settings.paymentType,
    tournamentEntryFeeMinor: settings.entryFeeMinor,
    tournamentBaseFeeMinor: settings.baseFeeMinor,
    tournamentExtraCategoryFeeMinor: settings.extraCategoryFeeMinor,
    priorActiveRegistrationCount: prior,
  });
  return {
    settings,
    priceScope: resolution.priceScope,
    priceMinor: registrationPriceMinor({ priceScope: resolution.priceScope, priceMinor: resolution.priceMinor }, 1),
    source: resolution.source === "category" ? "category" as const : "tournament" as const,
  };
}

async function ensureOrganizationPerson(env: Env, tournament: TournamentRow, user: CurrentUser, profile: ProfileRow): Promise<string> {
  const existing = await env.HUAU_DB.prepare(
    `SELECT id FROM organization_people WHERE organization_id=? AND user_id=?`,
  ).bind(tournament.organizerOrganizationId, user.id).first<{ id: string }>();
  const stamp = now();
  if (existing) {
    await env.HUAU_DB.prepare(
      `UPDATE organization_people SET first_name=?,last_name=?,email=?,phone=?,birth_date=?,sport_gender=?,status='active',updated_at=? WHERE id=?`,
    ).bind(profile.firstName, profile.lastName, user.email, profile.phone, profile.birthDate, profile.sportGender === "unspecified" ? null : profile.sportGender, stamp, existing.id).run();
    return existing.id;
  }
  const id = uuid();
  await env.HUAU_DB.prepare(
    `INSERT INTO organization_people (id,organization_id,user_id,first_name,last_name,email,phone,birth_date,sport_gender,source,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'user','active',?,?)`,
  ).bind(id, tournament.organizerOrganizationId, user.id, profile.firstName, profile.lastName, user.email, profile.phone, profile.birthDate, profile.sportGender === "unspecified" ? null : profile.sportGender, stamp, stamp).run();
  return id;
}

async function ensureTournamentPlayerProfile(env: Env, tournament: TournamentRow, personId: string, profile: ProfileRow, user: CurrentUser): Promise<string> {
  const existing = await env.HUAU_DB.prepare(
    `SELECT id FROM tournament_player_profiles WHERE tournament_id=? AND organization_person_id=?`,
  ).bind(tournament.id, personId).first<{ id: string }>();
  if (existing) return existing.id;
  const id = uuid();
  const stamp = now();
  const sort = await env.HUAU_DB.prepare(
    `SELECT COALESCE(MAX(sort_order),-1)+1 as nextSort FROM tournament_player_profiles WHERE tournament_id=?`,
  ).bind(tournament.id).first<{ nextSort: number }>();
  await env.HUAU_DB.prepare(
    `INSERT INTO tournament_player_profiles (id,tournament_id,organization_person_id,display_name,club,contact,dupr_singles,dupr_doubles,payment_status,player_status,notes,sort_order,created_at,updated_at,version)
     VALUES (?,?,?,?, '', ?,0,0,'pending','confirmed','',?,?,?,1)`,
  ).bind(id, tournament.id, personId, `${profile.firstName} ${profile.lastName}`.trim() || user.name, user.email, sort?.nextSort ?? 0, stamp, stamp).run();
  return id;
}

async function ensureIdentity(env: Env, tournament: TournamentRow, user: CurrentUser) {
  const profile = await profileForUser(env, user.id);
  if (!profile) throw new Error("PROFILE_REQUIRED");
  const personId = await ensureOrganizationPerson(env, tournament, user, profile);
  const playerProfileId = await ensureTournamentPlayerProfile(env, tournament, personId, profile, user);
  return { profile, personId, playerProfileId };
}

async function syncLegacyAssignment(env: Env, profileId: string, categoryId: string, partnerProfileId: string | null) {
  const stamp = now();
  await env.HUAU_DB.prepare(
    `INSERT INTO tournament_player_categories (player_profile_id,category_id,partner_profile_id,created_at,updated_at)
     VALUES (?,?,?,?,?) ON CONFLICT(player_profile_id,category_id) DO UPDATE SET partner_profile_id=excluded.partner_profile_id,updated_at=excluded.updated_at`,
  ).bind(profileId, categoryId, partnerProfileId, stamp, stamp).run();
}

async function categoryOccupied(env: Env, categoryId: string) {
  const row = await env.HUAU_DB.prepare(
    `SELECT COUNT(*) as count FROM tournament_entries WHERE category_id=? AND status NOT IN ('waitlisted','withdrawn','rejected')`,
  ).bind(categoryId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function nextWaitlist(env: Env, categoryId: string) {
  const row = await env.HUAU_DB.prepare(
    `SELECT COALESCE(MAX(waitlist_position),0)+1 as nextPosition FROM tournament_entries WHERE category_id=? AND status='waitlisted'`,
  ).bind(categoryId).first<{ nextPosition: number }>();
  return Number(row?.nextPosition ?? 1);
}

async function nextRegistrationNumber(env: Env, tournamentId: string) {
  const row = await env.HUAU_DB.prepare(
    `SELECT COALESCE(MAX(registration_number),0)+1 as nextNumber FROM tournament_registrations WHERE tournament_id=?`,
  ).bind(tournamentId).first<{ nextNumber: number }>();
  return Number(row?.nextNumber ?? 1);
}

async function acquireCategoryDecision(env: Env, category: CategoryRow): Promise<{ decision: "closed" | "confirmed_slot" | "waitlist"; waitlistPosition: number | null }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const versionRow = await env.HUAU_DB.prepare(`SELECT version FROM tournament_categories WHERE id=?`).bind(category.id).first<{ version: number }>();
    if (!versionRow) throw new Error("CATEGORY_NOT_FOUND");
    const lock = await env.HUAU_DB.prepare(
      `UPDATE tournament_categories SET version=version+1,updated_at=? WHERE id=? AND version=?`,
    ).bind(now(), category.id, versionRow.version).run();
    const count = Number((lock as { meta?: { changes?: number } }).meta?.changes ?? 0);
    if (count !== 1) continue;
    const occupied = await categoryOccupied(env, category.id);
    const decision = capacityDecision({ maxEntries: category.maxEntries, occupiedEntries: occupied, registrationStatus: category.registrationStatus });
    return { decision, waitlistPosition: decision === "waitlist" ? await nextWaitlist(env, category.id) : null };
  }
  throw new Error("REGISTRATION_CAPACITY_BUSY");
}

async function registrationById(env: Env, registrationId: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,category_id as categoryId,entry_id as entryId,user_id as userId,status,participant_count as participantCount,
            price_scope as priceScope,base_amount_minor as baseAmountMinor,discount_minor as discountMinor,final_amount_minor as finalAmountMinor,
            currency,waitlist_position as waitlistPosition,registration_number as registrationNumber,covered_by_registration_id as coveredByRegistrationId,
            paid_amount_minor as paidAmountMinor,refunded_amount_minor as refundedAmountMinor
       FROM tournament_registrations WHERE id=?`,
  ).bind(registrationId).first<RegistrationRow>();
}

async function teamPaymentModeForEntry(env: Env, entryId: string | null) {
  if (!entryId) return null;
  const row = await env.HUAU_DB.prepare(`SELECT team_payment_mode as teamPaymentMode FROM tournament_entries WHERE id=?`).bind(entryId).first<{ teamPaymentMode: TeamPaymentMode | null }>();
  return row?.teamPaymentMode ?? null;
}

async function recalcPersonalRegistration(env: Env, registrationId: string) {
  const reg = await registrationById(env, registrationId);
  if (!reg || ["cancelled", "rejected"].includes(reg.status)) return;
  const category = await categoryById(env, reg.categoryId);
  if (!category) return;
  const entryMode = category.entryType === "team" ? await teamPaymentModeForEntry(env, reg.entryId) : null;
  const entryCaptain = reg.entryId
    ? await env.HUAU_DB.prepare(`SELECT captain_user_id as captainUserId,status FROM tournament_entries WHERE id=?`).bind(reg.entryId).first<{ captainUserId: string | null; status: string }>()
    : null;
  const covered = Boolean(reg.coveredByRegistrationId);
  let amount = 0;
  let scope: "free" | "per_entry" | "per_person" = "free";
  if (!covered) {
    const pricing = await effectivePersonalPricing(env, reg.tournamentId, reg.userId, category, {
      beforeRegistrationNumber: reg.registrationNumber,
      teamPaymentMode: category.entryType === "team" && entryMode === "team_full" && entryCaptain?.captainUserId === reg.userId ? "team_full" : "individual",
    });
    amount = pricing.priceMinor;
    scope = pricing.priceScope;
  }
  const final = Math.max(0, amount - reg.discountMinor);
  const netPaid = Math.max(0, reg.paidAmountMinor - reg.refundedAmountMinor);
  const status = entryCaptain?.status === "waitlisted"
    ? "waitlisted"
    : final > 0 && netPaid < final
      ? "awaiting_payment"
      : "confirmed";
  await env.HUAU_DB.prepare(
    `UPDATE tournament_registrations SET status=?,participant_count=1,price_scope=?,base_amount_minor=?,final_amount_minor=?,updated_at=?,version=version+1 WHERE id=?`,
  ).bind(status, scope, amount, final, now(), reg.id).run();
}

async function registrationRosterMeta(env: Env, category: CategoryRow) {
  if (category.entryType !== "team") return { min: null as number | null, max: null as number | null };
  const formatRow = await env.HUAU_DB.prepare(
    `SELECT config_json as configJson FROM competition_format_versions WHERE category_id=? AND format_kind='team' ORDER BY version_number DESC LIMIT 1`,
  ).bind(category.id).first<{ configJson: string }>();
  if (!formatRow) return { min: null, max: null };
  try {
    const format = parseTeamFormat(JSON.parse(formatRow.configJson) as unknown);
    return { min: format.roster.min, max: format.roster.max };
  } catch {
    return { min: null, max: null };
  }
}

async function teamCandidateHardViolation(env: Env, category: CategoryRow, entryId: string, candidateUserId: string): Promise<string | null> {
  const formatRow = await env.HUAU_DB.prepare(
    `SELECT config_json as configJson FROM competition_format_versions WHERE category_id=? AND format_kind='team' ORDER BY version_number DESC LIMIT 1`,
  ).bind(category.id).first<{ configJson: string }>();
  if (!formatRow) return null;
  const candidate = await profileForUser(env, candidateUserId);
  if (!candidate) return "PROFILE_REQUIRED";
  try {
    const format = parseTeamFormat(JSON.parse(formatRow.configJson) as unknown);
    const current = await env.HUAU_DB.prepare(
      `SELECT em.organization_person_id as personId,TRIM(op.first_name||' '||op.last_name) as name,COALESCE(op.sport_gender,'unspecified') as sportGender,em.member_role as role
         FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id
        WHERE em.entry_id=? AND em.status IN ('accepted','manual') ORDER BY em.created_at`,
    ).bind(entryId).all<{ personId: string; name: string; sportGender: "male" | "female" | "unspecified"; role: "player" | "captain" | "substitute" }>();
    const roster: TeamRosterMember[] = [
      ...current.results,
      { personId: `candidate:${candidateUserId}`, name: candidate.firstName || candidateUserId, sportGender: candidate.sportGender, role: "player" },
    ];
    const hardCodes = new Set(["ROSTER_TOO_LARGE", "ROSTER_MALE_MAX", "ROSTER_FEMALE_MAX", "ROSTER_COMPOSITION_MALE", "ROSTER_COMPOSITION_FEMALE"]);
    return validateTeamRoster(format, roster).issues.find((issue) => hardCodes.has(issue.code))?.code ?? null;
  } catch {
    return null;
  }
}

async function recalcCompetitiveEntry(env: Env, entryId: string) {
  const entry = await env.HUAU_DB.prepare(
    `SELECT id,category_id as categoryId,entry_type as entryType,status,waitlist_position as waitlistPosition FROM tournament_entries WHERE id=?`,
  ).bind(entryId).first<{ id: string; categoryId: string; entryType: "individual" | "pair" | "team"; status: string; waitlistPosition: number | null }>();
  if (!entry || ["withdrawn", "rejected"].includes(entry.status)) return;
  const category = await categoryById(env, entry.categoryId);
  if (!category) return;
  const members = await env.HUAU_DB.prepare(
    `SELECT em.organization_person_id as personId,em.member_role as role,COALESCE(op.sport_gender,'unspecified') as sportGender,TRIM(op.first_name||' '||op.last_name) as name
       FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id
      WHERE em.entry_id=? AND em.status IN ('accepted','manual') ORDER BY em.created_at`,
  ).bind(entryId).all<{ personId: string; role: "player" | "captain" | "substitute"; sportGender: string; name: string }>();

  let ready = entry.entryType === "individual" ? members.results.length >= 1 : entry.entryType === "pair" ? members.results.length === 2 : false;
  if (entry.entryType === "pair" && category.competitionGender === "mixed" && ready) {
    ready = members.results.map((member) => member.sportGender).sort().join(",") === "female,male";
  }
  if (entry.entryType === "team") {
    const formatRow = await env.HUAU_DB.prepare(
      `SELECT config_json as configJson FROM competition_format_versions WHERE category_id=? AND format_kind='team' ORDER BY version_number DESC LIMIT 1`,
    ).bind(category.id).first<{ configJson: string }>();
    if (formatRow) {
      try {
        const format = parseTeamFormat(JSON.parse(formatRow.configJson) as unknown);
        const roster: TeamRosterMember[] = members.results.map((member) => ({
          personId: member.personId,
          name: member.name,
          sportGender: member.sportGender === "male" || member.sportGender === "female" ? member.sportGender : "unspecified",
          role: member.role,
        }));
        ready = validateTeamRoster(format, roster).valid;
      } catch {
        ready = false;
      }
    }
  }

  const registrations = await env.HUAU_DB.prepare(
    `SELECT status,final_amount_minor as finalAmountMinor FROM tournament_registrations WHERE entry_id=? AND status NOT IN ('cancelled','rejected')`,
  ).bind(entryId).all<{ status: string; finalAmountMinor: number }>();
  const paymentsReady = registrations.results.every((registration) => registration.finalAmountMinor === 0 || registration.status === "confirmed");
  const status = entry.status === "waitlisted"
    ? "waitlisted"
    : !ready
      ? "inviting"
      : paymentsReady
        ? "confirmed"
        : "pending_payment";
  const displayName = entry.entryType === "pair" && members.results.length
    ? members.results.map((member) => member.name).join(" / ")
    : null;
  await env.HUAU_DB.prepare(
    `UPDATE tournament_entries SET status=?,display_name=COALESCE(?,display_name),updated_at=?,version=version+1 WHERE id=?`,
  ).bind(status, displayName, now(), entryId).run();
}

async function validateRegistrationCommon(env: Env, tournament: TournamentRow, category: CategoryRow, user: CurrentUser) {
  if (category.tournamentId !== tournament.id) throw new Error("CATEGORY_NOT_FOUND");
  if (tournament.status !== "registration_open") throw new Error("TOURNAMENT_REGISTRATION_CLOSED");
  if (category.registrationStatus === "closed") throw new Error("CATEGORY_REGISTRATION_CLOSED");
  if (tournament.structureLocked || category.structureLocked) throw new Error("COMPETITION_STRUCTURE_LOCKED");
  const closeAt = await registrationCloseAt(env, tournament.id);
  if (closeAt && now() > closeAt) throw new Error("REGISTRATION_DEADLINE_PASSED");
  const profile = await profileForUser(env, user.id);
  if (!profile) throw new Error("PROFILE_REQUIRED");
  const eligibility = evaluateRegistrationEligibility(category, profile, dateFromUnix(tournament.startAt));
  if (!eligibility.eligible) throw new Error(eligibility.code);
  if (await userAlreadyInCategory(env, user.id, category.id)) throw new Error("ALREADY_REGISTERED_IN_CATEGORY");
  return profile;
}

async function createPersonalRegistration(
  env: Env,
  tournament: TournamentRow,
  category: CategoryRow,
  user: CurrentUser,
  selection: { teamChoice?: "free" | "create"; teamName?: string; teamPaymentMode?: TeamPaymentMode },
) {
  const identity = await ensureIdentity(env, tournament, user);
  const registrationId = uuid();
  const number = await nextRegistrationNumber(env, tournament.id);
  const teamChoice = category.entryType === "team" ? selection.teamChoice ?? "free" : undefined;
  const teamPaymentMode: TeamPaymentMode | null = category.entryType === "team" && teamChoice === "create" ? selection.teamPaymentMode ?? "individual" : null;
  const pricing = await effectivePersonalPricing(env, tournament.id, user.id, category, { teamPaymentMode });
  const amount = pricing.priceMinor;
  const stamp = now();
  let status = amount > 0 ? "awaiting_payment" : "confirmed";
  let entryId: string | null = null;
  let waitlistPosition: number | null = null;

  if (category.entryType === "individual") {
    const capacity = await acquireCategoryDecision(env, category);
    if (capacity.decision === "closed") throw new Error("CATEGORY_REGISTRATION_CLOSED");
    entryId = uuid();
    waitlistPosition = capacity.waitlistPosition;
    status = capacity.decision === "waitlist" ? "waitlisted" : status;
    const entryStatus = capacity.decision === "waitlist" ? "waitlisted" : amount > 0 ? "pending_payment" : "confirmed";
    await env.HUAU_DB.batch([
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version,team_payment_mode)
         VALUES (?,?,?,?,?,?,?,?,?,0,'online_registration',?,?,?,1,NULL)`,
      ).bind(entryId, category.id, category.entryType, `${identity.profile.firstName} ${identity.profile.lastName}`.trim() || user.name, null, entryStatus, waitlistPosition, null, user.id, registrationId, stamp, stamp),
      env.HUAU_DB.prepare(
        `INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'accepted',?,?,?,?)`,
      ).bind(uuid(), entryId, identity.personId, "player", "1", user.id, stamp, stamp, stamp),
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_registrations (id,tournament_id,category_id,entry_id,user_id,registration_number,status,participant_count,price_scope,base_amount_minor,discount_minor,final_amount_minor,currency,waitlist_position,created_at,updated_at,version,covered_by_registration_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,1,NULL)`,
      ).bind(registrationId, tournament.id, category.id, entryId, user.id, number, status, 1, pricing.priceScope, amount, amount, category.currency ?? "UYU", waitlistPosition, stamp, stamp),
    ]);
    await syncLegacyAssignment(env, identity.playerProfileId, category.id, null);
    return { registrationId, entryId, status, waitlistPosition };
  }

  if (category.entryType === "team" && teamChoice === "create") {
    const capacity = await acquireCategoryDecision(env, category);
    if (capacity.decision === "closed") throw new Error("CATEGORY_REGISTRATION_CLOSED");
    entryId = uuid();
    waitlistPosition = capacity.waitlistPosition;
    status = capacity.decision === "waitlist" ? "waitlisted" : status;
    const teamName = selection.teamName?.trim() || `${identity.profile.firstName} Team`;
    const entryStatus = capacity.decision === "waitlist" ? "waitlisted" : "inviting";
    await env.HUAU_DB.batch([
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version,team_payment_mode)
         VALUES (?,?,?,?,?,?,?,?,?,0,'online_registration',?,?,?,1,?)`,
      ).bind(entryId, category.id, category.entryType, teamName, user.id, entryStatus, waitlistPosition, null, user.id, registrationId, stamp, stamp, teamPaymentMode),
      env.HUAU_DB.prepare(
        `INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'accepted',?,?,?,?)`,
      ).bind(uuid(), entryId, identity.personId, "captain", "1", user.id, stamp, stamp, stamp),
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_registrations (id,tournament_id,category_id,entry_id,user_id,registration_number,status,participant_count,price_scope,base_amount_minor,discount_minor,final_amount_minor,currency,waitlist_position,created_at,updated_at,version,covered_by_registration_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,1,NULL)`,
      ).bind(registrationId, tournament.id, category.id, entryId, user.id, number, status, 1, pricing.priceScope, amount, amount, category.currency ?? "UYU", waitlistPosition, stamp, stamp),
    ]);
    await recalcCompetitiveEntry(env, entryId);
    return { registrationId, entryId, status, waitlistPosition };
  }

  await env.HUAU_DB.prepare(
    `INSERT INTO tournament_registrations (id,tournament_id,category_id,entry_id,user_id,registration_number,status,participant_count,price_scope,base_amount_minor,discount_minor,final_amount_minor,currency,waitlist_position,created_at,updated_at,version,covered_by_registration_id)
     VALUES (?,?,?,NULL,?,?,?,?,?,?,0,?,?,NULL,?,?,1,NULL)`,
  ).bind(registrationId, tournament.id, category.id, user.id, number, status, 1, pricing.priceScope, amount, amount, category.currency ?? "UYU", stamp, stamp).run();
  if (category.entryType === "pair") await syncLegacyAssignment(env, identity.playerProfileId, category.id, null);
  return { registrationId, entryId: null, status, waitlistPosition: null };
}

async function compactWaitlist(env: Env, categoryId: string) {
  const rows = await env.HUAU_DB.prepare(
    `SELECT id,entry_id as entryId FROM tournament_registrations WHERE category_id=? AND status='waitlisted' ORDER BY waitlist_position,created_at,id`,
  ).bind(categoryId).all<{ id: string; entryId: string | null }>();
  const statements: D1PreparedStatement[] = [];
  rows.results.forEach((row, index) => {
    statements.push(env.HUAU_DB.prepare(`UPDATE tournament_registrations SET waitlist_position=?,updated_at=? WHERE id=?`).bind(index + 1, now(), row.id));
    if (row.entryId) statements.push(env.HUAU_DB.prepare(`UPDATE tournament_entries SET waitlist_position=?,updated_at=? WHERE id=?`).bind(index + 1, now(), row.entryId));
  });
  if (statements.length) await env.HUAU_DB.batch(statements);
}

async function publicTournament(slug: string, request: Request, env: Env, access: AccessHelpers) {
  const tournament = await tournamentBySlug(env, slug);
  if (!tournament || tournament.visibility !== "public") return json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });
  const closeAt = await registrationCloseAt(env, tournament.id);
  const settings = await pricingSettingsForTournament(env, tournament.id);
  const categories = await env.HUAU_DB.prepare(
    `SELECT tc.id,tc.tournament_id as tournamentId,tc.name,tc.entry_type as entryType,tc.competition_gender as competitionGender,tc.min_age as minAge,tc.max_age as maxAge,
            tc.max_entries as maxEntries,tc.registration_status as registrationStatus,tc.price_scope as priceScope,tc.price_minor as priceMinor,tc.currency,
            tc.structure_locked as structureLocked,tc.format_version_id as formatVersionId,tc.scheduled_date as scheduledDate,
            fv.format_kind as formatKind,fv.config_json as formatConfigJson,fv.explanation_schema_version as explanationSchemaVersion,
            (SELECT COUNT(*) FROM tournament_entries e WHERE e.category_id=tc.id AND e.status NOT IN ('waitlisted','withdrawn','rejected')) as occupiedEntries,
            (SELECT COUNT(*) FROM tournament_entries e WHERE e.category_id=tc.id AND e.status='waitlisted') as waitlistCount
       FROM tournament_categories tc LEFT JOIN competition_format_versions fv ON fv.id=tc.format_version_id
      WHERE tc.tournament_id=? ORDER BY tc.sort_order,tc.name`,
  ).bind(tournament.id).all<CategoryRow & { scheduledDate: string | null; occupiedEntries: number; waitlistCount: number; formatKind: string | null; formatConfigJson: string | null; explanationSchemaVersion: number | null }>();
  const currentUser = await access.requireUser(request, env);
  const profile = currentUser ? await profileForUser(env, currentUser.id) : null;
  const activeCategoryCount = currentUser ? await activeCategoryCountForUser(env, tournament.id, currentUser.id) : 0;
  const activeTeamCategoryCount = currentUser ? await priorActiveTeamRegistrationCount(env, tournament.id, currentUser.id) : 0;
  const activeAgeTeamDivisionCount = currentUser ? await priorAgeTeamDivisionCount(env, tournament.id, currentUser.id) : 0;

  const publicCategories = await Promise.all(categories.results.map(async (category) => {
    const preview = currentUser
      ? await effectivePersonalPricing(env, tournament.id, currentUser.id, category)
      : category.entryType === "team" && category.priceMinor === null && settings.teamIndividualFeeMinor !== null
        ? { priceScope: "per_person" as const, priceMinor: settings.teamIndividualFeeMinor, source: "team_individual" as const }
        : (() => {
            const resolution = resolveRegistrationPricing({
              categoryPriceScope: category.priceScope,
              categoryPriceMinor: category.priceMinor,
              tournamentPaymentType: settings.paymentType,
              tournamentEntryFeeMinor: settings.entryFeeMinor,
              tournamentBaseFeeMinor: settings.baseFeeMinor,
              tournamentExtraCategoryFeeMinor: settings.extraCategoryFeeMinor,
              priorActiveRegistrationCount: 0,
            });
            return { priceScope: resolution.priceScope, priceMinor: registrationPriceMinor({ priceScope: resolution.priceScope, priceMinor: resolution.priceMinor }, 1), source: resolution.source };
          })();
    const alreadyRegistered = currentUser ? await userAlreadyInCategory(env, currentUser.id, category.id) : false;
    const overlapBlocked = currentUser && !alreadyRegistered && category.entryType === "team"
      ? teamAgeDivisionOverlapBlocked({
          allowOverlap: Boolean(settings.allowTeamAgeDivisionOverlap),
          priorAgeDivisionCount: activeAgeTeamDivisionCount,
          categoryHasAgeRule: category.minAge !== null || category.maxAge !== null,
        })
      : false;
    const blockedCode = category.registrationStatus === "closed"
      ? "CATEGORY_REGISTRATION_CLOSED"
      : tournament.status !== "registration_open"
        ? "TOURNAMENT_REGISTRATION_CLOSED"
        : tournament.structureLocked || category.structureLocked
          ? "COMPETITION_STRUCTURE_LOCKED"
          : closeAt && now() > closeAt
            ? "REGISTRATION_DEADLINE_PASSED"
            : alreadyRegistered
              ? "ALREADY_REGISTERED_IN_CATEGORY"
              : categoryLimitReached(settings.maxCategoriesPerPlayer, activeCategoryCount)
                ? "MAX_CATEGORIES_REACHED"
                : overlapBlocked
                  ? "TEAM_AGE_DIVISION_OVERLAP_DISABLED"
                  : null;
    const { formatConfigJson, ...categoryPublic } = category;
    return {
      ...categoryPublic,
      formatConfig: parseJsonOrNull(formatConfigJson),
      rawPriceScope: category.priceScope,
      rawPriceMinor: category.priceMinor,
      priceScope: preview.priceScope,
      priceMinor: preview.priceMinor,
      priceSource: preview.source,
      registrationBlockedCode: blockedCode,
      viewerAlreadyRegistered: alreadyRegistered,
    };
  }));

  return json({
    ok: true,
    tournament,
    registrationCloseAt: closeAt,
    pricingPolicy: settings,
    teamPricing: {
      individualFeeMinor: settings.teamIndividualFeeMinor,
      fullTeamFeeMinor: settings.teamFullFeeMinor,
      additionalParticipationMode: settings.teamAdditionalParticipationMode,
      additionalFeeMinor: settings.teamAdditionalFeeMinor,
      allowAgeDivisionOverlap: Boolean(settings.allowTeamAgeDivisionOverlap),
    },
    maxCategoriesPerPlayer: settings.maxCategoriesPerPlayer,
    activeCategoryCount,
    activeTeamCategoryCount,
    activeAgeTeamDivisionCount,
    categories: publicCategories,
    viewer: currentUser ? { authenticated: true, profile } : { authenticated: false, profile: null },
  });
}

type BatchSelection = {
  categoryId: string;
  teamChoice?: "free" | "create";
  teamName?: string;
  teamPaymentMode?: TeamPaymentMode;
};

async function batchRegistration(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const tournament = await tournamentById(env, tournamentId);
  if (!tournament) return json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });
  const body = await readJson<{ selections?: BatchSelection[] }>(request).catch(() => ({ selections: [] }));
  const selections = Array.isArray(body.selections) ? body.selections.slice(0, 20) : [];
  if (!selections.length) return json({ ok: false, code: "NO_CATEGORIES_SELECTED" }, { status: 400 });
  const uniqueIds = new Set(selections.map((selection) => selection.categoryId));
  if (uniqueIds.size !== selections.length) return json({ ok: false, code: "DUPLICATE_CATEGORY_SELECTION" }, { status: 400 });

  const settings = await pricingSettingsForTournament(env, tournamentId);
  const activeCount = await activeCategoryCountForUser(env, tournamentId, user.id);
  if (settings.maxCategoriesPerPlayer !== null && activeCount + selections.length > settings.maxCategoriesPerPlayer) {
    return json({ ok: false, code: "MAX_CATEGORIES_REACHED", maxCategoriesPerPlayer: settings.maxCategoriesPerPlayer, activeCategoryCount: activeCount }, { status: 409 });
  }

  let selectedAgeTeam = 0;
  const priorAgeTeam = await priorAgeTeamDivisionCount(env, tournamentId, user.id);
  const categories: CategoryRow[] = [];
  try {
    for (const selection of selections) {
      const category = await categoryById(env, selection.categoryId);
      if (!category) throw new Error("CATEGORY_NOT_FOUND");
      await validateRegistrationCommon(env, tournament, category, user);
      if (category.entryType === "team" && (category.minAge !== null || category.maxAge !== null)) {
        if (teamAgeDivisionOverlapBlocked({
          allowOverlap: Boolean(settings.allowTeamAgeDivisionOverlap),
          priorAgeDivisionCount: priorAgeTeam + selectedAgeTeam,
          categoryHasAgeRule: true,
        })) throw new Error("TEAM_AGE_DIVISION_OVERLAP_DISABLED");
        selectedAgeTeam += 1;
      }
      if (category.entryType === "team" && selection.teamChoice === "create" && selection.teamPaymentMode === "team_full" && settings.teamFullFeeMinor === null) {
        throw new Error("TEAM_FULL_FEE_NOT_CONFIGURED");
      }
      categories.push(category);
    }
  } catch (error) {
    return json({ ok: false, code: error instanceof Error ? error.message : "REGISTRATION_FAILED" }, { status: 409 });
  }

  const created: Array<{ registrationId: string; entryId: string | null; categoryId: string; status: string; waitlistPosition: number | null }> = [];
  try {
    for (let index = 0; index < selections.length; index += 1) {
      const result = await createPersonalRegistration(env, tournament, categories[index]!, user, selections[index]!);
      created.push({ ...result, categoryId: categories[index]!.id });
    }
  } catch (error) {
    for (const item of created.reverse()) await cancelRegistrationInternal(env, item.registrationId, user.id, true);
    return json({ ok: false, code: error instanceof Error ? error.message : "REGISTRATION_FAILED" }, { status: 409 });
  }
  return json({ ok: true, registrations: created }, { status: 201 });
}

async function createRegistration(tournamentId: string, categoryId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const tournament = await tournamentById(env, tournamentId);
  const category = await categoryById(env, categoryId);
  if (!tournament || !category) return json({ ok: false, code: "CATEGORY_NOT_FOUND" }, { status: 404 });
  let body: { teamName?: string } = {};
  try { body = await readJson<{ teamName?: string }>(request); } catch { body = {}; }
  try {
    await validateRegistrationCommon(env, tournament, category, user);
    const settings = await pricingSettingsForTournament(env, tournamentId);
    const activeCount = await activeCategoryCountForUser(env, tournamentId, user.id);
    if (categoryLimitReached(settings.maxCategoriesPerPlayer, activeCount)) throw new Error("MAX_CATEGORIES_REACHED");
    const result = await createPersonalRegistration(env, tournament, category, user, {
      teamChoice: category.entryType === "team" && body.teamName ? "create" : "free",
      ...(body.teamName ? { teamName: body.teamName } : {}),
      teamPaymentMode: "individual",
    });
    return json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return json({ ok: false, code: error instanceof Error ? error.message : "REGISTRATION_FAILED" }, { status: 409 });
  }
}

async function createTeamForRegistration(registrationId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const reg = await registrationById(env, registrationId);
  if (!reg || reg.userId !== user.id) return json({ ok: false, code: "REGISTRATION_NOT_FOUND" }, { status: 404 });
  const tournament = await tournamentById(env, reg.tournamentId);
  const category = await categoryById(env, reg.categoryId);
  if (!tournament || !category || category.entryType !== "team") return json({ ok: false, code: "TEAM_REGISTRATION_REQUIRED" }, { status: 409 });
  if (reg.entryId) return json({ ok: false, code: "ALREADY_ASSIGNED_TO_TEAM" }, { status: 409 });
  if (tournament.structureLocked || category.structureLocked) return json({ ok: false, code: "COMPETITION_STRUCTURE_LOCKED" }, { status: 409 });
  const body: { teamName?: string; paymentMode?: TeamPaymentMode } = await readJson<{ teamName?: string; paymentMode?: TeamPaymentMode }>(request).catch(() => ({}));
  const paymentMode: TeamPaymentMode = body.paymentMode === "team_full" ? "team_full" : "individual";
  const settings = await pricingSettingsForTournament(env, reg.tournamentId);
  if (paymentMode === "team_full" && settings.teamFullFeeMinor === null) return json({ ok: false, code: "TEAM_FULL_FEE_NOT_CONFIGURED" }, { status: 409 });
  const identity = await ensureIdentity(env, tournament, user);
  let capacity: { decision: "closed" | "confirmed_slot" | "waitlist"; waitlistPosition: number | null };
  try { capacity = await acquireCategoryDecision(env, category); } catch (error) { return json({ ok: false, code: error instanceof Error ? error.message : "REGISTRATION_CAPACITY_BUSY" }, { status: 409 }); }
  if (capacity.decision === "closed") return json({ ok: false, code: "CATEGORY_REGISTRATION_CLOSED" }, { status: 409 });
  const entryId = uuid();
  const stamp = now();
  const teamName = body.teamName?.trim() || `${identity.profile.firstName} Team`;
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version,team_payment_mode)
       VALUES (?,?,'team',?,?,?,?,?, ?,0,'online_registration',?,?,?,1,?)`,
    ).bind(entryId, category.id, teamName, user.id, capacity.decision === "waitlist" ? "waitlisted" : "inviting", capacity.waitlistPosition, null, user.id, reg.id, stamp, stamp, paymentMode),
    env.HUAU_DB.prepare(
      `INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at)
       VALUES (?,?,?,?,?,'accepted',?,?,?,?)`,
    ).bind(uuid(), entryId, identity.personId, "captain", "1", user.id, stamp, stamp, stamp),
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET entry_id=?,waitlist_position=?,status=?,covered_by_registration_id=NULL,updated_at=?,version=version+1 WHERE id=?`)
      .bind(entryId, capacity.waitlistPosition, capacity.decision === "waitlist" ? "waitlisted" : reg.status, stamp, reg.id),
  ]);
  await recalcPersonalRegistration(env, reg.id);
  await recalcCompetitiveEntry(env, entryId);
  return json({ ok: true, entryId });
}

async function pairCompatibility(env: Env, category: CategoryRow, sourceUserId: string, targetUserId: string) {
  if (category.competitionGender !== "mixed") return true;
  const [source, target] = await Promise.all([profileForUser(env, sourceUserId), profileForUser(env, targetUserId)]);
  if (!source || !target) return false;
  return [source.sportGender, target.sportGender].sort().join(",") === "female,male";
}

async function registrationCandidates(registrationId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const source = await registrationById(env, registrationId);
  if (!source || source.userId !== user.id) return json({ ok: false, code: "REGISTRATION_NOT_FOUND" }, { status: 404 });
  const category = await categoryById(env, source.categoryId);
  if (!category || category.entryType === "individual") return json({ ok: false, code: "MATCHING_NOT_SUPPORTED" }, { status: 409 });
  if (category.entryType === "pair" && source.entryId) return json({ ok: false, code: "PAIR_ALREADY_COMPLETE" }, { status: 409 });
  if (category.entryType === "team") {
    if (!source.entryId) return json({ ok: false, code: "CREATE_TEAM_FIRST" }, { status: 409 });
    const entry = await env.HUAU_DB.prepare(`SELECT captain_user_id as captainUserId FROM tournament_entries WHERE id=?`).bind(source.entryId).first<{ captainUserId: string | null }>();
    if (entry?.captainUserId !== user.id) return json({ ok: false, code: "CAPTAIN_REQUIRED" }, { status: 403 });
  }
  const candidates = await env.HUAU_DB.prepare(
    `SELECT tr.id as registrationId,tr.user_id as userId,tr.status,tr.final_amount_minor as finalAmountMinor,u.name,u.email,
            up.birth_date as birthDate,COALESCE(up.sport_gender,'unspecified') as sportGender,
            (SELECT rmi.status FROM registration_match_invitations rmi WHERE rmi.inviter_registration_id=? AND rmi.invitee_registration_id=tr.id AND rmi.status='pending' LIMIT 1) as invitationStatus
       FROM tournament_registrations tr JOIN user u ON u.id=tr.user_id LEFT JOIN user_profiles up ON up.user_id=tr.user_id
      WHERE tr.category_id=? AND tr.id<>? AND tr.user_id<>? AND tr.status NOT IN ('cancelled','rejected','waitlisted') AND tr.entry_id IS NULL
      ORDER BY u.name,tr.created_at`,
  ).bind(source.id, source.categoryId, source.id, source.userId).all<{ registrationId: string; userId: string; status: string; finalAmountMinor: number; name: string; email: string; birthDate: string | null; sportGender: string; invitationStatus: string | null }>();
  const filtered = [];
  for (const candidate of candidates.results) {
    if (category.entryType === "pair" && !(await pairCompatibility(env, category, source.userId, candidate.userId))) continue;
    if (category.entryType === "team" && source.entryId && await teamCandidateHardViolation(env, category, source.entryId, candidate.userId)) continue;
    filtered.push({ ...candidate, paymentReady: candidate.finalAmountMinor === 0 || candidate.status === "confirmed" });
  }
  return json({ ok: true, candidates: filtered });
}

async function createMatchInvitation(registrationId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const source = await registrationById(env, registrationId);
  if (!source || source.userId !== user.id) return json({ ok: false, code: "REGISTRATION_NOT_FOUND" }, { status: 404 });
  const category = await categoryById(env, source.categoryId);
  const tournament = await tournamentById(env, source.tournamentId);
  if (!category || !tournament || category.entryType === "individual") return json({ ok: false, code: "MATCHING_NOT_SUPPORTED" }, { status: 409 });
  if (tournament.structureLocked || category.structureLocked) return json({ ok: false, code: "COMPETITION_STRUCTURE_LOCKED" }, { status: 409 });
  const body: { targetRegistrationId?: string } = await readJson<{ targetRegistrationId?: string }>(request).catch(() => ({}));
  const targetId = String(body.targetRegistrationId ?? "");
  const target = targetId ? await registrationById(env, targetId) : null;
  if (!target || target.categoryId !== source.categoryId || target.tournamentId !== source.tournamentId || target.userId === source.userId || target.entryId || ["cancelled", "rejected", "waitlisted"].includes(target.status)) {
    return json({ ok: false, code: "CANDIDATE_NOT_AVAILABLE" }, { status: 409 });
  }
  let kind: "pair" | "team";
  let teamEntryId: string | null = null;
  if (category.entryType === "pair") {
    kind = "pair";
    if (source.entryId) return json({ ok: false, code: "PAIR_ALREADY_COMPLETE" }, { status: 409 });
    if (!(await pairCompatibility(env, category, source.userId, target.userId))) return json({ ok: false, code: "PAIR_NOT_COMPATIBLE" }, { status: 409 });
  } else {
    kind = "team";
    if (!source.entryId) return json({ ok: false, code: "CREATE_TEAM_FIRST" }, { status: 409 });
    const entry = await env.HUAU_DB.prepare(`SELECT captain_user_id as captainUserId FROM tournament_entries WHERE id=?`).bind(source.entryId).first<{ captainUserId: string | null }>();
    if (entry?.captainUserId !== source.userId) return json({ ok: false, code: "CAPTAIN_REQUIRED" }, { status: 403 });
    const roster = await registrationRosterMeta(env, category);
    const current = await env.HUAU_DB.prepare(`SELECT COUNT(*) as count FROM entry_members WHERE entry_id=? AND status IN ('accepted','manual')`).bind(source.entryId).first<{ count: number }>();
    const pending = await env.HUAU_DB.prepare(`SELECT COUNT(*) as count FROM registration_match_invitations WHERE team_entry_id=? AND status='pending'`).bind(source.entryId).first<{ count: number }>();
    if (roster.max !== null && Number(current?.count ?? 0) + Number(pending?.count ?? 0) >= roster.max) return json({ ok: false, code: "TEAM_ROSTER_FULL" }, { status: 409 });
    const hardViolation = await teamCandidateHardViolation(env, category, source.entryId, target.userId);
    if (hardViolation) return json({ ok: false, code: hardViolation }, { status: 409 });
    teamEntryId = source.entryId;
  }
  const stamp = now();
  await env.HUAU_DB.prepare(
    `UPDATE registration_match_invitations SET status='cancelled',updated_at=? WHERE inviter_registration_id=? AND invitee_registration_id=? AND status='pending'`,
  ).bind(stamp, source.id, target.id).run();
  await env.HUAU_DB.prepare(
    `INSERT INTO registration_match_invitations (id,tournament_id,category_id,kind,inviter_registration_id,invitee_registration_id,inviter_user_id,invitee_user_id,team_entry_id,status,expires_at,responded_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'pending',?,NULL,?,?)`,
  ).bind(uuid(), source.tournamentId, source.categoryId, kind, source.id, target.id, source.userId, target.userId, teamEntryId, stamp + 7 * 86400, stamp, stamp).run();
  return json({ ok: true });
}

async function matchInvitationById(env: Env, invitationId: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,category_id as categoryId,kind,inviter_registration_id as inviterRegistrationId,
            invitee_registration_id as inviteeRegistrationId,inviter_user_id as inviterUserId,invitee_user_id as inviteeUserId,
            team_entry_id as teamEntryId,status,expires_at as expiresAt
       FROM registration_match_invitations WHERE id=?`,
  ).bind(invitationId).first<MatchInvitationRow>();
}

async function cancelOtherPairInvitations(env: Env, sourceRegistrationId: string, targetRegistrationId: string, keepId: string) {
  await env.HUAU_DB.prepare(
    `UPDATE registration_match_invitations SET status='cancelled',updated_at=?
      WHERE id<>? AND status='pending' AND (
        inviter_registration_id IN (?,?) OR invitee_registration_id IN (?,?)
      )`,
  ).bind(now(), keepId, sourceRegistrationId, targetRegistrationId, sourceRegistrationId, targetRegistrationId).run();
}

async function respondMatchInvitation(invitationId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const body: { response?: "accept" | "decline" } = await readJson<{ response?: "accept" | "decline" }>(request).catch(() => ({}));
  if (body.response !== "accept" && body.response !== "decline") return json({ ok: false, code: "INVALID_RESPONSE" }, { status: 400 });
  const invitation = await matchInvitationById(env, invitationId);
  if (!invitation) return json({ ok: false, code: "INVITATION_NOT_FOUND" }, { status: 404 });
  if (invitation.inviteeUserId !== user.id) return json({ ok: false, code: "INVITATION_NOT_FOR_USER" }, { status: 403 });
  if (invitation.status !== "pending") return json({ ok: false, code: "INVITATION_ALREADY_RESOLVED" }, { status: 409 });
  if (invitation.expiresAt < now()) return json({ ok: false, code: "INVITATION_EXPIRED" }, { status: 409 });
  if (body.response === "decline") {
    await env.HUAU_DB.prepare(`UPDATE registration_match_invitations SET status='declined',responded_at=?,updated_at=? WHERE id=?`).bind(now(), now(), invitation.id).run();
    return json({ ok: true, status: "declined" });
  }
  const source = await registrationById(env, invitation.inviterRegistrationId);
  const target = await registrationById(env, invitation.inviteeRegistrationId);
  const tournament = await tournamentById(env, invitation.tournamentId);
  const category = await categoryById(env, invitation.categoryId);
  if (!source || !target || !tournament || !category) return json({ ok: false, code: "INVITATION_STALE" }, { status: 409 });
  if (target.userId !== user.id || target.entryId || ["cancelled", "rejected", "waitlisted"].includes(target.status)) return json({ ok: false, code: "CANDIDATE_NOT_AVAILABLE" }, { status: 409 });
  if (tournament.structureLocked || category.structureLocked) return json({ ok: false, code: "COMPETITION_STRUCTURE_LOCKED" }, { status: 409 });

  if (invitation.kind === "pair") {
    if (category.entryType !== "pair" || source.entryId) return json({ ok: false, code: "PAIR_ALREADY_COMPLETE" }, { status: 409 });
    if (!(await pairCompatibility(env, category, source.userId, target.userId))) return json({ ok: false, code: "PAIR_NOT_COMPATIBLE" }, { status: 409 });
    const capacity = await acquireCategoryDecision(env, category);
    if (capacity.decision === "closed") return json({ ok: false, code: "CATEGORY_REGISTRATION_CLOSED" }, { status: 409 });
    const sourceUser = await userById(env, source.userId);
    const targetUser = await userById(env, target.userId);
    if (!sourceUser || !targetUser) return json({ ok: false, code: "USER_NOT_FOUND" }, { status: 409 });
    const [sourceIdentity, targetIdentity] = await Promise.all([ensureIdentity(env, tournament, sourceUser), ensureIdentity(env, tournament, targetUser)]);
    const entryId = uuid();
    const stamp = now();
    await env.HUAU_DB.batch([
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_entries (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version,team_payment_mode)
         VALUES (?,?,'pair',?,NULL,?,?,?,?,0,'registration_match',?,?,?,1,NULL)`,
      ).bind(entryId, category.id, `${sourceUser.name} / ${targetUser.name}`, capacity.decision === "waitlist" ? "waitlisted" : "inviting", capacity.waitlistPosition, null, source.userId, source.id, stamp, stamp),
      env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,'player','1','accepted',?,?,?,?)`)
        .bind(uuid(), entryId, sourceIdentity.personId, source.userId, stamp, stamp, stamp),
      env.HUAU_DB.prepare(`INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at) VALUES (?,?,?,'player','2','accepted',?,?,?,?)`)
        .bind(uuid(), entryId, targetIdentity.personId, target.userId, stamp, stamp, stamp),
      env.HUAU_DB.prepare(`UPDATE tournament_registrations SET entry_id=?,waitlist_position=?,status=CASE WHEN ?='waitlist' THEN 'waitlisted' ELSE status END,updated_at=?,version=version+1 WHERE id IN (?,?)`)
        .bind(entryId, capacity.waitlistPosition, capacity.decision, stamp, source.id, target.id),
      env.HUAU_DB.prepare(`UPDATE registration_match_invitations SET status='accepted',responded_at=?,updated_at=? WHERE id=?`).bind(stamp, stamp, invitation.id),
    ]);
    await cancelOtherPairInvitations(env, source.id, target.id, invitation.id);
    await syncLegacyAssignment(env, sourceIdentity.playerProfileId, category.id, targetIdentity.playerProfileId);
    await syncLegacyAssignment(env, targetIdentity.playerProfileId, category.id, sourceIdentity.playerProfileId);
    await recalcCompetitiveEntry(env, entryId);
    return json({ ok: true, status: "accepted", entryId });
  }

  if (category.entryType !== "team" || !source.entryId || source.entryId !== invitation.teamEntryId) return json({ ok: false, code: "TEAM_INVITATION_STALE" }, { status: 409 });
  const team = await env.HUAU_DB.prepare(
    `SELECT captain_user_id as captainUserId,team_payment_mode as teamPaymentMode,status FROM tournament_entries WHERE id=?`,
  ).bind(source.entryId).first<{ captainUserId: string | null; teamPaymentMode: TeamPaymentMode | null; status: string }>();
  if (!team || team.captainUserId !== source.userId) return json({ ok: false, code: "CAPTAIN_REQUIRED" }, { status: 409 });
  const roster = await registrationRosterMeta(env, category);
  const current = await env.HUAU_DB.prepare(`SELECT COUNT(*) as count FROM entry_members WHERE entry_id=? AND status IN ('accepted','manual')`).bind(source.entryId).first<{ count: number }>();
  if (roster.max !== null && Number(current?.count ?? 0) >= roster.max) return json({ ok: false, code: "TEAM_ROSTER_FULL" }, { status: 409 });
  const hardViolation = await teamCandidateHardViolation(env, category, source.entryId, target.userId);
  if (hardViolation) return json({ ok: false, code: hardViolation }, { status: 409 });
  const targetUser = await userById(env, target.userId);
  if (!targetUser) return json({ ok: false, code: "USER_NOT_FOUND" }, { status: 409 });
  const targetIdentity = await ensureIdentity(env, tournament, targetUser);
  const stamp = now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `INSERT INTO entry_members (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at)
       VALUES (?,?,?,'player',NULL,'accepted',?,?,?,?)`,
    ).bind(uuid(), source.entryId, targetIdentity.personId, target.userId, stamp, stamp, stamp),
    env.HUAU_DB.prepare(
      `UPDATE tournament_registrations SET entry_id=?,covered_by_registration_id=?,updated_at=?,version=version+1 WHERE id=?`,
    ).bind(source.entryId, team.teamPaymentMode === "team_full" ? source.id : null, stamp, target.id),
    env.HUAU_DB.prepare(`UPDATE registration_match_invitations SET status='accepted',responded_at=?,updated_at=? WHERE id=?`).bind(stamp, stamp, invitation.id),
    env.HUAU_DB.prepare(`UPDATE registration_match_invitations SET status='cancelled',updated_at=? WHERE id<>? AND invitee_registration_id=? AND status='pending'`).bind(stamp, invitation.id, target.id),
  ]);
  await recalcPersonalRegistration(env, target.id);
  await recalcCompetitiveEntry(env, source.entryId);
  return json({ ok: true, status: "accepted", entryId: source.entryId });
}

async function cancelMatchInvitation(invitationId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const invitation = await matchInvitationById(env, invitationId);
  if (!invitation) return json({ ok: false, code: "INVITATION_NOT_FOUND" }, { status: 404 });
  if (invitation.inviterUserId !== user.id) return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  if (invitation.status !== "pending") return json({ ok: false, code: "INVITATION_ALREADY_RESOLVED" }, { status: 409 });
  await env.HUAU_DB.prepare(`UPDATE registration_match_invitations SET status='cancelled',updated_at=? WHERE id=?`).bind(now(), invitation.id).run();
  return json({ ok: true });
}

async function clearLegacyPairLinks(env: Env, categoryId: string, userIds: string[]) {
  if (!userIds.length) return;
  const placeholders = userIds.map(() => "?").join(",");
  const profiles = await env.HUAU_DB.prepare(
    `SELECT pp.id FROM tournament_player_profiles pp JOIN organization_people op ON op.id=pp.organization_person_id WHERE pp.tournament_id=(SELECT tournament_id FROM tournament_categories WHERE id=?) AND op.user_id IN (${placeholders})`,
  ).bind(categoryId, ...userIds).all<{ id: string }>();
  if (!profiles.results.length) return;
  const profilePlaceholders = profiles.results.map(() => "?").join(",");
  await env.HUAU_DB.prepare(
    `UPDATE tournament_player_categories SET partner_profile_id=NULL,updated_at=? WHERE category_id=? AND (player_profile_id IN (${profilePlaceholders}) OR partner_profile_id IN (${profilePlaceholders}))`,
  ).bind(now(), categoryId, ...profiles.results.map((row) => row.id), ...profiles.results.map((row) => row.id)).run();
}

async function detachPairEntry(env: Env, entryId: string, categoryId: string) {
  const registrations = await env.HUAU_DB.prepare(
    `SELECT id,user_id as userId FROM tournament_registrations WHERE entry_id=? AND status NOT IN ('cancelled','rejected')`,
  ).bind(entryId).all<{ id: string; userId: string }>();
  const entry = await env.HUAU_DB.prepare(`SELECT status,waitlist_position as waitlistPosition FROM tournament_entries WHERE id=?`).bind(entryId).first<{ status: string; waitlistPosition: number | null }>();
  const stamp = now();
  const registrationIds = registrations.results.map((row) => row.id);
  const invitationCancel = registrationIds.length
    ? env.HUAU_DB.prepare(
        `UPDATE registration_match_invitations SET status='cancelled',updated_at=? WHERE status='pending' AND (inviter_registration_id IN (${registrationIds.map(() => "?").join(",")}) OR invitee_registration_id IN (${registrationIds.map(() => "?").join(",")}))`,
      ).bind(stamp, ...registrationIds, ...registrationIds)
    : null;
  await env.HUAU_DB.batch([
    ...(invitationCancel ? [invitationCancel] : []),
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET entry_id=NULL,covered_by_registration_id=NULL,waitlist_position=NULL,updated_at=?,version=version+1 WHERE entry_id=? AND status NOT IN ('cancelled','rejected')`).bind(stamp, entryId),
    env.HUAU_DB.prepare(`UPDATE entry_members SET status='removed',updated_at=? WHERE entry_id=? AND status IN ('accepted','manual')`).bind(stamp, entryId),
    env.HUAU_DB.prepare(`UPDATE tournament_entries SET status='withdrawn',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp, entryId),
  ]);
  await clearLegacyPairLinks(env, categoryId, registrations.results.map((row) => row.userId));
  for (const registration of registrations.results) await recalcPersonalRegistration(env, registration.id);
  if (entry?.status === "waitlisted" || entry?.waitlistPosition) await compactWaitlist(env, categoryId);
}

async function leaveTeamMember(env: Env, registration: RegistrationRow, userId: string) {
  if (!registration.entryId) return;
  const stamp = now();
  const person = await env.HUAU_DB.prepare(
    `SELECT id FROM organization_people WHERE user_id=? AND organization_id=(SELECT organizer_organization_id FROM tournaments WHERE id=?)`,
  ).bind(userId, registration.tournamentId).first<{ id: string }>();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET entry_id=NULL,covered_by_registration_id=NULL,waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp, registration.id),
    ...(person ? [env.HUAU_DB.prepare(`UPDATE entry_members SET status='removed',updated_at=? WHERE entry_id=? AND organization_person_id=?`).bind(stamp, registration.entryId, person.id)] : []),
    env.HUAU_DB.prepare(`UPDATE registration_match_invitations SET status='cancelled',updated_at=? WHERE invitee_registration_id=? AND status='pending'`).bind(stamp, registration.id),
  ]);
  await recalcPersonalRegistration(env, registration.id);
  await recalcCompetitiveEntry(env, registration.entryId);
}

async function dissolveTeamEntry(env: Env, entryId: string) {
  const entry = await env.HUAU_DB.prepare(
    `SELECT category_id as categoryId,status,waitlist_position as waitlistPosition FROM tournament_entries WHERE id=?`,
  ).bind(entryId).first<{ categoryId: string; status: string; waitlistPosition: number | null }>();
  const registrations = await env.HUAU_DB.prepare(
    `SELECT id FROM tournament_registrations WHERE entry_id=? AND status NOT IN ('cancelled','rejected')`,
  ).bind(entryId).all<{ id: string }>();
  const stamp = now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE registration_match_invitations SET status='cancelled',updated_at=? WHERE team_entry_id=? AND status='pending'`).bind(stamp, entryId),
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET entry_id=NULL,covered_by_registration_id=NULL,waitlist_position=NULL,updated_at=?,version=version+1 WHERE entry_id=? AND status NOT IN ('cancelled','rejected')`).bind(stamp, entryId),
    env.HUAU_DB.prepare(`UPDATE entry_members SET status='removed',updated_at=? WHERE entry_id=? AND status IN ('accepted','manual')`).bind(stamp, entryId),
    env.HUAU_DB.prepare(`UPDATE tournament_entries SET status='withdrawn',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp, entryId),
  ]);
  for (const registration of registrations.results) await recalcPersonalRegistration(env, registration.id);
  if (entry && (entry.status === "waitlisted" || entry.waitlistPosition)) await compactWaitlist(env, entry.categoryId);
}

async function leaveGroup(registrationId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const reg = await registrationById(env, registrationId);
  if (!reg) return json({ ok: false, code: "REGISTRATION_NOT_FOUND" }, { status: 404 });
  const category = await categoryById(env, reg.categoryId);
  if (!category || category.entryType === "individual" || !reg.entryId) return json({ ok: false, code: "NOT_ASSIGNED_TO_GROUP" }, { status: 409 });
  const tournament = await tournamentById(env, reg.tournamentId);
  if (tournament?.structureLocked || category.structureLocked) return json({ ok: false, code: "COMPETITION_STRUCTURE_LOCKED" }, { status: 409 });

  if (reg.userId === user.id) {
    if (category.entryType === "pair") await detachPairEntry(env, reg.entryId, category.id);
    else {
      const entry = await env.HUAU_DB.prepare(`SELECT captain_user_id as captainUserId FROM tournament_entries WHERE id=?`).bind(reg.entryId).first<{ captainUserId: string | null }>();
      if (entry?.captainUserId === user.id) await dissolveTeamEntry(env, reg.entryId);
      else await leaveTeamMember(env, reg, user.id);
    }
    return json({ ok: true });
  }

  // Compatibility for accepted members created by the older shared-registration flow.
  const legacyMember = await env.HUAU_DB.prepare(
    `SELECT em.id,op.user_id as userId FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=? AND op.user_id=? AND em.status IN ('accepted','manual')`,
  ).bind(reg.entryId, user.id).first<{ id: string; userId: string }>();
  if (!legacyMember) return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  await env.HUAU_DB.prepare(`UPDATE entry_members SET status='removed',updated_at=? WHERE id=?`).bind(now(), legacyMember.id).run();
  if (category.entryType === "pair") await clearLegacyPairLinks(env, category.id, [user.id, reg.userId]);
  await recalcCompetitiveEntry(env, reg.entryId);
  return json({ ok: true });
}

async function removeCancelledRegistrationFromCompetitiveProfile(env: Env, reg: RegistrationRow, category: CategoryRow) {
  if (category.entryType === "team") return;
  const linked = await env.HUAU_DB.prepare(
    `SELECT p.id as profileId,p.organization_person_id as personId
       FROM tournament_player_profiles p JOIN organization_people op ON op.id=p.organization_person_id
      WHERE p.tournament_id=? AND op.user_id=? LIMIT 1`,
  ).bind(reg.tournamentId,reg.userId).first<{ profileId: string; personId: string }>();
  if (!linked) return;
  const stamp = now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE tournament_player_categories SET partner_profile_id=NULL,updated_at=? WHERE category_id=? AND partner_profile_id=?`).bind(stamp,category.id,linked.profileId),
    env.HUAU_DB.prepare(`DELETE FROM tournament_player_categories WHERE player_profile_id=? AND category_id=?`).bind(linked.profileId,category.id),
  ]);
  if (!category.structureLocked) {
    await env.HUAU_DB.prepare(
      `DELETE FROM tournament_entries
        WHERE category_id=? AND source_kind IN ('legacy_player','legacy_pair') AND id IN (
          SELECT em.entry_id FROM entry_members em WHERE em.organization_person_id=?
        )`,
    ).bind(category.id,linked.personId).run();
  }
}

async function cancelRegistrationInternal(env: Env, registrationId: string, userId: string, force = false) {
  const reg = await registrationById(env, registrationId);
  if (!reg || (!force && reg.userId !== userId)) return;
  const category = await categoryById(env, reg.categoryId);
  if (reg.entryId && category) {
    if (category.entryType === "pair") await detachPairEntry(env, reg.entryId, category.id);
    else if (category.entryType === "team") {
      const entry = await env.HUAU_DB.prepare(`SELECT captain_user_id as captainUserId FROM tournament_entries WHERE id=?`).bind(reg.entryId).first<{ captainUserId: string | null }>();
      if (entry?.captainUserId === reg.userId) await dissolveTeamEntry(env, reg.entryId);
      else await leaveTeamMember(env, reg, reg.userId);
    } else {
      await env.HUAU_DB.batch([
        env.HUAU_DB.prepare(`UPDATE tournament_entries SET status='withdrawn',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(now(), reg.entryId),
        env.HUAU_DB.prepare(`UPDATE entry_members SET status='removed',updated_at=? WHERE entry_id=?`).bind(now(), reg.entryId),
      ]);
    }
  }
  if (category) await removeCancelledRegistrationFromCompetitiveProfile(env, reg, category);
  const stamp = now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET status='cancelled',entry_id=NULL,covered_by_registration_id=NULL,waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp, registrationId),
    env.HUAU_DB.prepare(`UPDATE registration_match_invitations SET status='cancelled',updated_at=? WHERE status='pending' AND (inviter_registration_id=? OR invitee_registration_id=?)`).bind(stamp, registrationId, registrationId),
  ]);
  if (reg.waitlistPosition) await compactWaitlist(env, reg.categoryId);
}

async function cancelOrRequestRegistration(env: Env, reg: RegistrationRow, requestedByUserId: string, reason: string | null) {
  if (["cancelled", "rejected"].includes(reg.status)) return { outcome: "already_cancelled" as const };
  const netPaid = Math.max(0, reg.paidAmountMinor - reg.refundedAmountMinor);
  if (netPaid > 0) {
    const existing = await env.HUAU_DB.prepare(
      `SELECT id FROM registration_cancellation_requests WHERE registration_id=? AND status='pending' LIMIT 1`,
    ).bind(reg.id).first<{ id: string }>();
    if (existing) return { outcome: "already_pending" as const, requestId: existing.id };
    const requestId = uuid();
    const stamp = now();
    await env.HUAU_DB.prepare(
      `INSERT INTO registration_cancellation_requests (id,registration_id,tournament_id,requested_by_user_id,status,reason,net_paid_minor,refund_amount_minor,admin_note,reviewed_by_user_id,reviewed_at,created_at,updated_at)
       VALUES (?,?,?,?,'pending',?,?,0,NULL,NULL,NULL,?,?)`,
    ).bind(requestId, reg.id, reg.tournamentId, requestedByUserId, reason, netPaid, stamp, stamp).run();
    return { outcome: "requested" as const, requestId };
  }
  await cancelRegistrationInternal(env, reg.id, reg.userId);
  return { outcome: "cancelled" as const };
}

async function cancelRegistration(registrationId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const reg = await registrationById(env, registrationId);
  if (!reg) return json({ ok: false, code: "REGISTRATION_NOT_FOUND" }, { status: 404 });
  if (reg.userId !== user.id) return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  let body: { reason?: string } = {};
  try { body = await readJson<{ reason?: string }>(request); } catch { body = {}; }
  const result = await cancelOrRequestRegistration(env, reg, user.id, body.reason?.trim() || null);
  return json({
    ok: true,
    cancellationRequested: result.outcome === "requested" || result.outcome === "already_pending",
    requestId: "requestId" in result ? result.requestId : undefined,
  });
}

async function cancelAllTournamentRegistrations(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const tournament = await env.HUAU_DB.prepare(`SELECT id FROM tournaments WHERE id=?`).bind(tournamentId).first<{ id: string }>();
  if (!tournament) return json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });
  let body: { reason?: string } = {};
  try { body = await readJson<{ reason?: string }>(request); } catch { body = {}; }
  const rows = await env.HUAU_DB.prepare(
    `SELECT id FROM tournament_registrations WHERE tournament_id=? AND user_id=? AND status NOT IN ('cancelled','rejected') ORDER BY registration_number`,
  ).bind(tournamentId, user.id).all<{ id: string }>();
  let cancelledNow = 0;
  let requestsCreated = 0;
  let requestsAlreadyPending = 0;
  for (const row of rows.results) {
    const reg = await registrationById(env, row.id);
    if (!reg) continue;
    const result = await cancelOrRequestRegistration(env, reg, user.id, body.reason?.trim() || null);
    if (result.outcome === "cancelled") cancelledNow += 1;
    else if (result.outcome === "requested") requestsCreated += 1;
    else if (result.outcome === "already_pending") requestsAlreadyPending += 1;
  }
  return json({ ok: true, total: rows.results.length, cancelledNow, requestsCreated, requestsAlreadyPending });
}

export async function cancelRegistrationForPaymentAdmin(env: Env, registrationId: string) {
  const reg = await registrationById(env, registrationId);
  if (!reg) throw new Error("REGISTRATION_NOT_FOUND");
  await cancelRegistrationInternal(env, registrationId, reg.userId, true);
}

type RegistrationViewerRow = {
  id: string;
  userId?: string | null;
  registrationNumber: number;
  status: string;
  participantCount: number;
  finalAmountMinor: number;
  currency: string | null;
  waitlistPosition: number | null;
  tournamentId: string;
  tournamentName: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  entryType: "individual" | "pair" | "team";
  entryName: string | null;
  entryId: string | null;
  isOwner: number;
  viewerRole: string | null;
  coveredByRegistrationId: string | null;
  teamPaymentMode: TeamPaymentMode | null;
  formatKind: string | null;
  formatConfigJson: string | null;
  explanationSchemaVersion: number | null;
  createdAt: number;
};

type RegistrationMemberView = { personId: string; name: string; email: string | null; memberRole: string; status: string; userId: string | null };
type OutgoingInvitationView = { id: string; targetRegistrationId: string; targetName: string; status: string; expiresAt: number };

async function registrationDetails(env: Env, row: RegistrationViewerRow) {
  const members = row.entryId
    ? await env.HUAU_DB.prepare(
        `SELECT op.id as personId,TRIM(op.first_name||' '||op.last_name) as name,op.email,em.member_role as memberRole,em.status,op.user_id as userId
           FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id
          WHERE em.entry_id=? AND em.status IN ('accepted','manual') ORDER BY em.created_at`,
      ).bind(row.entryId).all<RegistrationMemberView>()
    : { results: [] as RegistrationMemberView[] };
  const outgoing = await env.HUAU_DB.prepare(
    `SELECT rmi.id,rmi.invitee_registration_id as targetRegistrationId,u.name as targetName,rmi.status,rmi.expires_at as expiresAt
       FROM registration_match_invitations rmi JOIN tournament_registrations tr ON tr.id=rmi.invitee_registration_id JOIN user u ON u.id=tr.user_id
      WHERE rmi.inviter_registration_id=? AND rmi.status='pending' ORDER BY rmi.created_at`,
  ).bind(row.id).all<OutgoingInvitationView>();
  const category = await categoryById(env, row.categoryId);
  const roster = category ? await registrationRosterMeta(env, category) : { min: null, max: null };
  const teamCaptain = row.entryType === "team" && row.entryId
    ? await env.HUAU_DB.prepare(`SELECT captain_user_id as captainUserId FROM tournament_entries WHERE id=?`).bind(row.entryId).first<{ captainUserId: string | null }>()
    : null;
  const teamPricing = row.entryType === "team" ? await pricingSettingsForTournament(env, row.tournamentId) : null;
  const pendingCancellation = row.isOwner === 1
    ? await env.HUAU_DB.prepare(`SELECT id,reason,net_paid_minor as netPaidMinor,created_at as createdAt FROM registration_cancellation_requests WHERE registration_id=? AND status='pending' LIMIT 1`).bind(row.id).first<{ id: string; reason: string | null; netPaidMinor: number; createdAt: number }>()
    : null;
  const groupingState = row.entryType === "individual"
    ? "ready"
    : row.entryType === "pair"
      ? row.entryId && members.results.length >= 2 ? "paired" : "free"
      : !row.entryId
        ? "free"
        : row.viewerRole === "captain" && teamCaptain?.captainUserId
          ? "captain"
          : "member";
  const { formatConfigJson, ...baseRow } = row;
  return {
    ...baseRow,
    formatConfig: parseJsonOrNull(formatConfigJson),
    groupingState,
    members: members.results,
    outgoingInvitations: outgoing.results,
    rosterMin: roster.min,
    rosterMax: roster.max,
    teamFullFeeMinor: teamPricing?.teamFullFeeMinor ?? null,
    canSearch: row.isOwner === 1 && row.entryType === "pair" ? !row.entryId : row.isOwner === 1 && row.entryType === "team" ? Boolean(row.entryId && teamCaptain?.captainUserId) : false,
    covered: Boolean(row.coveredByRegistrationId),
    pendingCancellationRequest: pendingCancellation ?? null,
  };
}

async function myRegistrations(request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const own = await env.HUAU_DB.prepare(
    `SELECT tr.id,tr.registration_number as registrationNumber,tr.status,tr.participant_count as participantCount,tr.final_amount_minor as finalAmountMinor,tr.currency,
            tr.waitlist_position as waitlistPosition,tr.created_at as createdAt,tr.covered_by_registration_id as coveredByRegistrationId,
            t.id as tournamentId,t.name as tournamentName,t.slug,tc.id as categoryId,tc.name as categoryName,tc.entry_type as entryType,
            e.display_name as entryName,tr.entry_id as entryId,1 as isOwner,
            (SELECT em.member_role FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=tr.entry_id AND op.user_id=? AND em.status IN ('accepted','manual') LIMIT 1) as viewerRole,
            e.team_payment_mode as teamPaymentMode,fv.format_kind as formatKind,fv.config_json as formatConfigJson,fv.explanation_schema_version as explanationSchemaVersion
       FROM tournament_registrations tr JOIN tournaments t ON t.id=tr.tournament_id JOIN tournament_categories tc ON tc.id=tr.category_id
       LEFT JOIN tournament_entries e ON e.id=tr.entry_id LEFT JOIN competition_format_versions fv ON fv.id=tc.format_version_id
      WHERE tr.user_id=? ORDER BY tr.created_at DESC`,
  ).bind(user.id, user.id).all<RegistrationViewerRow>();

  const legacy = await env.HUAU_DB.prepare(
    `SELECT tr.id,tr.registration_number as registrationNumber,tr.status,tr.participant_count as participantCount,tr.final_amount_minor as finalAmountMinor,tr.currency,
            tr.waitlist_position as waitlistPosition,tr.created_at as createdAt,tr.covered_by_registration_id as coveredByRegistrationId,
            t.id as tournamentId,t.name as tournamentName,t.slug,tc.id as categoryId,tc.name as categoryName,tc.entry_type as entryType,
            e.display_name as entryName,tr.entry_id as entryId,0 as isOwner,
            em.member_role as viewerRole,e.team_payment_mode as teamPaymentMode,
            fv.format_kind as formatKind,fv.config_json as formatConfigJson,fv.explanation_schema_version as explanationSchemaVersion
       FROM tournament_registrations tr JOIN tournaments t ON t.id=tr.tournament_id JOIN tournament_categories tc ON tc.id=tr.category_id
       JOIN tournament_entries e ON e.id=tr.entry_id JOIN entry_members em ON em.entry_id=e.id AND em.status IN ('accepted','manual')
       JOIN organization_people op ON op.id=em.organization_person_id LEFT JOIN competition_format_versions fv ON fv.id=tc.format_version_id
      WHERE op.user_id=? AND tr.user_id<>? AND NOT EXISTS (
        SELECT 1 FROM tournament_registrations mine WHERE mine.user_id=? AND mine.category_id=tr.category_id AND mine.status NOT IN ('cancelled','rejected')
      ) ORDER BY tr.created_at DESC`,
  ).bind(user.id, user.id, user.id).all<RegistrationViewerRow>();

  const rows = [...own.results, ...legacy.results].sort((a, b) => b.createdAt - a.createdAt);
  const detailed = await Promise.all(rows.map((row) => registrationDetails(env, row)));
  const invitations = await env.HUAU_DB.prepare(
    `SELECT rmi.id,rmi.kind,rmi.expires_at as expiresAt,rmi.inviter_registration_id as inviterRegistrationId,
            t.name as tournamentName,t.slug,tc.name as categoryName,tc.entry_type as entryType,tc.competition_gender as competitionGender,
            tc.min_age as minAge,tc.max_age as maxAge,u.name as inviterName,e.display_name as teamName
       FROM registration_match_invitations rmi
       JOIN tournaments t ON t.id=rmi.tournament_id JOIN tournament_categories tc ON tc.id=rmi.category_id
       JOIN user u ON u.id=rmi.inviter_user_id LEFT JOIN tournament_entries e ON e.id=rmi.team_entry_id
      WHERE rmi.invitee_user_id=? AND rmi.status='pending' ORDER BY rmi.created_at DESC`,
  ).bind(user.id).all();
  const profile = await profileForUser(env, user.id);
  return json({ ok: true, profile: profile ?? null, registrations: detailed, invitations: invitations.results });
}

async function adminAccess(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return { response: json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 }) };
  const tournament = await tournamentById(env, tournamentId);
  if (!tournament) return { response: json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 }) };
  if (!(await access.isOrgAdmin(user.id, tournament.organizerOrganizationId, env, request))) return { response: json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) };
  return { user, tournament };
}

async function adminRegistrations(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const allowed = await adminAccess(tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  const rows = await env.HUAU_DB.prepare(
    `SELECT tr.id,tr.user_id as userId,tr.registration_number as registrationNumber,tr.status,tr.participant_count as participantCount,tr.price_scope as priceScope,
            tr.base_amount_minor as baseAmountMinor,tr.discount_minor as discountMinor,tr.final_amount_minor as finalAmountMinor,tr.currency,
            tr.waitlist_position as waitlistPosition,tr.created_at as createdAt,tr.covered_by_registration_id as coveredByRegistrationId,
            t.id as tournamentId,t.name as tournamentName,t.slug,tc.id as categoryId,tc.name as categoryName,tc.entry_type as entryType,
            e.display_name as entryName,tr.entry_id as entryId,1 as isOwner,
            (SELECT em.member_role FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id WHERE em.entry_id=tr.entry_id AND op.user_id=tr.user_id AND em.status IN ('accepted','manual') LIMIT 1) as viewerRole,
            e.team_payment_mode as teamPaymentMode,u.name as userName,u.email as userEmail,
            fv.format_kind as formatKind,fv.config_json as formatConfigJson,fv.explanation_schema_version as explanationSchemaVersion
       FROM tournament_registrations tr JOIN tournaments t ON t.id=tr.tournament_id JOIN tournament_categories tc ON tc.id=tr.category_id
       JOIN user u ON u.id=tr.user_id LEFT JOIN tournament_entries e ON e.id=tr.entry_id LEFT JOIN competition_format_versions fv ON fv.id=tc.format_version_id
      WHERE tr.tournament_id=? ORDER BY tc.sort_order,tr.created_at`,
  ).bind(tournamentId).all<RegistrationViewerRow & { priceScope: string; baseAmountMinor: number; discountMinor: number; userName: string; userEmail: string }>();
  const detailed = await Promise.all(rows.results.map((row) => registrationDetails(env, row)));
  return json({ ok: true, registrations: detailed, publicUrl: `/tournaments/${allowed.tournament.slug}` });
}

async function adminPromote(registrationId: string, request: Request, env: Env, access: AccessHelpers) {
  const reg = await registrationById(env, registrationId);
  if (!reg) return json({ ok: false, code: "REGISTRATION_NOT_FOUND" }, { status: 404 });
  const allowed = await adminAccess(reg.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  if (reg.status !== "waitlisted") return json({ ok: false, code: "REGISTRATION_NOT_WAITLISTED" }, { status: 409 });
  if (!reg.entryId) {
    await env.HUAU_DB.prepare(`UPDATE tournament_registrations SET status='confirmed',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(now(), reg.id).run();
    await recalcPersonalRegistration(env, reg.id);
    return json({ ok: true });
  }
  const category = await categoryById(env, reg.categoryId);
  if (!category) return json({ ok: false, code: "CATEGORY_NOT_FOUND" }, { status: 404 });
  const occupied = await categoryOccupied(env, reg.categoryId);
  if (category.maxEntries !== null && occupied >= category.maxEntries) return json({ ok: false, code: "CATEGORY_STILL_FULL" }, { status: 409 });
  const linked = await env.HUAU_DB.prepare(
    `SELECT id FROM tournament_registrations WHERE entry_id=? AND status NOT IN ('cancelled','rejected')`,
  ).bind(reg.entryId).all<{ id: string }>();
  const stamp = now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET waitlist_position=NULL,updated_at=?,version=version+1 WHERE entry_id=? AND status NOT IN ('cancelled','rejected')`).bind(stamp, reg.entryId),
    env.HUAU_DB.prepare(`UPDATE tournament_entries SET status='inviting',waitlist_position=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(stamp, reg.entryId),
  ]);
  for (const item of linked.results) await recalcPersonalRegistration(env, item.id);
  await recalcCompetitiveEntry(env, reg.entryId);
  await compactWaitlist(env, reg.categoryId);
  return json({ ok: true });
}

async function adminAdjustment(registrationId: string, request: Request, env: Env, access: AccessHelpers) {
  const reg = await registrationById(env, registrationId);
  if (!reg) return json({ ok: false, code: "REGISTRATION_NOT_FOUND" }, { status: 404 });
  const allowed = await adminAccess(reg.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  const body = await readJson<{ kind?: "discount" | "courtesy" | "fixed_total"; amountMinor?: number; note?: string }>(request);
  if (!body.kind || !["discount", "courtesy", "fixed_total"].includes(body.kind)) return json({ ok: false, code: "INVALID_ADJUSTMENT" }, { status: 400 });
  const amount = Math.max(0, Math.trunc(Number(body.amountMinor ?? 0)));
  let discount = 0;
  if (body.kind === "courtesy") discount = reg.baseAmountMinor;
  else if (body.kind === "discount") discount = Math.min(reg.baseAmountMinor, amount);
  else discount = Math.max(0, reg.baseAmountMinor - amount);
  const stamp = now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `INSERT INTO registration_adjustments (id,registration_id,kind,amount_minor,note,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?)`,
    ).bind(uuid(), registrationId, body.kind, amount, body.note?.trim() || null, allowed.user.id, stamp),
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET discount_minor=?,updated_at=?,version=version+1 WHERE id=?`).bind(discount, stamp, registrationId),
  ]);
  await recalcPersonalRegistration(env, registrationId);
  if (reg.entryId) await recalcCompetitiveEntry(env, reg.entryId);
  return json({ ok: true });
}

export async function handleRegistrationApi(request: Request, env: Env, access: AccessHelpers): Promise<Response | null> {
  const url = new URL(request.url);
  const pub = url.pathname.match(/^\/api\/public\/tournaments\/([^/]+)$/);
  if (pub && request.method === "GET") return publicTournament(decodeURIComponent(pub[1]!), request, env, access);

  const batch = url.pathname.match(/^\/api\/tournaments\/([^/]+)\/registrations\/batch$/);
  if (batch && request.method === "POST") return batchRegistration(decodeURIComponent(batch[1]!), request, env, access);

  const create = url.pathname.match(/^\/api\/tournaments\/([^/]+)\/categories\/([^/]+)\/register$/);
  if (create && request.method === "POST") return createRegistration(decodeURIComponent(create[1]!), decodeURIComponent(create[2]!), request, env, access);

  if (url.pathname === "/api/me/tournament-registrations" && request.method === "GET") return myRegistrations(request, env, access);

  const team = url.pathname.match(/^\/api\/tournament-registrations\/([^/]+)\/team$/);
  if (team && request.method === "POST") return createTeamForRegistration(decodeURIComponent(team[1]!), request, env, access);

  const candidates = url.pathname.match(/^\/api\/tournament-registrations\/([^/]+)\/candidates$/);
  if (candidates && request.method === "GET") return registrationCandidates(decodeURIComponent(candidates[1]!), request, env, access);

  const matchInvite = url.pathname.match(/^\/api\/tournament-registrations\/([^/]+)\/match-invitations$/);
  if (matchInvite && request.method === "POST") return createMatchInvitation(decodeURIComponent(matchInvite[1]!), request, env, access);

  const respond = url.pathname.match(/^\/api\/registration-match-invitations\/([^/]+)\/respond$/);
  if (respond && request.method === "POST") return respondMatchInvitation(decodeURIComponent(respond[1]!), request, env, access);

  const cancelInvite = url.pathname.match(/^\/api\/registration-match-invitations\/([^/]+)$/);
  if (cancelInvite && request.method === "DELETE") return cancelMatchInvitation(decodeURIComponent(cancelInvite[1]!), request, env, access);

  const leave = url.pathname.match(/^\/api\/tournament-registrations\/([^/]+)\/leave-group$/);
  if (leave && request.method === "POST") return leaveGroup(decodeURIComponent(leave[1]!), request, env, access);

  const cancelAll = url.pathname.match(/^\/api\/tournaments\/([^/]+)\/registrations\/cancel-all$/);
  if (cancelAll && request.method === "POST") return cancelAllTournamentRegistrations(decodeURIComponent(cancelAll[1]!), request, env, access);

  const cancel = url.pathname.match(/^\/api\/tournament-registrations\/([^/]+)\/cancel$/);
  if (cancel && request.method === "POST") return cancelRegistration(decodeURIComponent(cancel[1]!), request, env, access);

  const admin = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/registrations$/);
  if (admin && request.method === "GET") return adminRegistrations(decodeURIComponent(admin[1]!), request, env, access);

  const promote = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/promote$/);
  if (promote && request.method === "POST") return adminPromote(decodeURIComponent(promote[1]!), request, env, access);

  const adjustment = url.pathname.match(/^\/api\/admin\/registrations\/([^/]+)\/adjustment$/);
  if (adjustment && request.method === "POST") return adminAdjustment(decodeURIComponent(adjustment[1]!), request, env, access);

  return null;
}
