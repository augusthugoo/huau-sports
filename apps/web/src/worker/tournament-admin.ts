import {
  buildCompetitionFromGroups,
  distributeEntriesIntoGroups,
  generateFinalPhase,
  generateTournamentSchedule,
  normalizeStandardFormat,
  tournamentSetupChecklist,
  withEncounterResult,
  type Competition,
  type CompetitionEncounter,
  type ScheduleCategory,
  type StandardCompetitionFormat,
  type TournamentEntry,
  type TournamentGroup,
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
  category: SqlRow;
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

async function snapshotCategory(
  env: Env,
  tournament: TournamentRow,
  category: CategoryRow,
  userId: string,
  reason: string,
): Promise<string> {
  const [categoryFull, formatVersions, competitions, groups, groupEntries, encounters, matches, matchResults, matchSets, scheduleItems] =
    await Promise.all([
      env.HUAU_DB.prepare(`SELECT * FROM tournament_categories WHERE id=?`).bind(category.id).first(),
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
    category: (categoryFull ?? {}) as SqlRow,
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
  const entries = await loadEntryModels(env, categoryId);
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const groupRows = await env.HUAU_DB.prepare(
    `SELECT g.id,g.name,g.sort_order as sortOrder FROM competition_groups g WHERE g.competition_id=? ORDER BY g.sort_order`,
  )
    .bind(competitionRow.id)
    .all<{ id: string; name: string; sortOrder: number }>();
  const membershipRows = await env.HUAU_DB.prepare(
    `SELECT ge.group_id as groupId,ge.entry_id as entryId,ge.sort_order as sortOrder
       FROM competition_group_entries ge JOIN competition_groups g ON g.id=ge.group_id
      WHERE g.competition_id=? ORDER BY ge.sort_order`,
  )
    .bind(competitionRow.id)
    .all<{ groupId: string; entryId: string; sortOrder: number }>();
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
  const encounterRows = await env.HUAU_DB.prepare(
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
  )
    .bind(competitionRow.id)
    .all<{
      id: string; stage: CompetitionEncounter["stage"]; groupId: string | null; groupName: string | null;
      roundLabel: string | null; roundNumber: number | null; legNumber: number; entryAId: string | null; entryBId: string | null;
      sourceA: string | null; sourceB: string | null; sourceLoserA: string | null; sourceLoserB: string | null;
      status: CompetitionEncounter["status"]; winnerEntryId: string | null; matchId: string | null; bestOf: 1 | 3 | null;
      pointTarget: number | null; scoreA: number | null; scoreB: number | null;
    }>();
  const setRows = await env.HUAU_DB.prepare(
    `SELECT s.match_id as matchId,s.set_number as setNumber,s.score_a as scoreA,s.score_b as scoreB
       FROM match_sets s JOIN matches m ON m.id=s.match_id JOIN competition_encounters e ON e.id=m.encounter_id
      WHERE e.competition_id=? ORDER BY s.match_id,s.set_number`,
  )
    .bind(competitionRow.id)
    .all<{ matchId: string; setNumber: number; scoreA: number; scoreB: number }>();
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
  let preferredRestSlots = 0;
  for (const row of categoryRows.results) {
    const competition = await loadCompetition(env, row.id);
    if (!competition) continue;
    const config = JSON.parse(row.configJson) as { matchMinutes?: number; preferredRestSlots?: number; dailyStart?: string };
    preferredRestSlots = Math.max(preferredRestSlots, Math.max(0, Math.trunc(Number(config.preferredRestSlots ?? competition.format.preferredRestSlots ?? 1))));
    categories.push({
      categoryId: row.id,
      scheduledDate: row.scheduledDate,
      order: row.sortOrder,
      matchMinutes: Math.max(5, Number(config.matchMinutes ?? 15)),
      competition,
    });
  }
  const schedule = generateTournamentSchedule({
    settings: {
      startDate: dateFromUnix(tournament.startAt),
      dailyStart,
      courtCount: tournament.courtCount,
      preferredRestSlots,
    },
    categories,
  });
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE tournament_id=?`).bind(tournament.id),
  ];
  for (const item of schedule.items) {
    const start = unixFromLocal(item.date, item.time, tournament.timezone);
    const end = start + item.durationMinutes * 60;
    const matchId = item.encounterId
      ? await env.HUAU_DB.prepare(`SELECT id FROM matches WHERE encounter_id=? AND rubber_order=1 LIMIT 1`).bind(item.encounterId).first<{ id: string }>()
      : null;
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO schedule_items
         (id,tournament_id,category_id,encounter_id,match_id,placeholder_key,stage,round_label,court_label,start_at,end_at,status,created_at,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      ).bind(
        uuid(), tournament.id, item.categoryId, item.encounterId, matchId?.id ?? null,
        item.reserved ? `${item.categoryId}:${item.stage}:${item.blockIndex}:${item.court}` : null,
        item.stage, item.roundLabel, `Court ${item.court}`, start, end,
        item.reserved ? "reserved" : "bound", unixNow(), unixNow(),
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
  const categories = await env.HUAU_DB.prepare(
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
       LEFT JOIN competition_format_versions f ON f.id=c.format_version_id
      WHERE tc.tournament_id=? ORDER BY tc.sort_order,tc.name`,
  ).bind(tournamentId).all();
  const entries = await env.HUAU_DB.prepare(
    `SELECT e.id,e.category_id as categoryId,e.display_name as displayName,e.entry_type as entryType,e.status,
            COALESCE(e.seed_rating,0) as seedRating,
            GROUP_CONCAT(TRIM(p.first_name || ' ' || p.last_name),' · ') as members
       FROM tournament_entries e
       LEFT JOIN entry_members em ON em.entry_id=e.id AND em.status IN ('accepted','manual')
       LEFT JOIN organization_people p ON p.id=em.organization_person_id
       JOIN tournament_categories tc ON tc.id=e.category_id
      WHERE tc.tournament_id=? GROUP BY e.id ORDER BY e.created_at`,
  ).bind(tournamentId).all();
  const groups = await env.HUAU_DB.prepare(
    `SELECT g.id,g.name,c.category_id as categoryId,ge.entry_id as entryId,e.display_name as entryName,ge.sort_order as sortOrder
       FROM competition_groups g JOIN competitions c ON c.id=g.competition_id
       LEFT JOIN competition_group_entries ge ON ge.group_id=g.id
       LEFT JOIN tournament_entries e ON e.id=ge.entry_id
      WHERE c.category_id IN (SELECT id FROM tournament_categories WHERE tournament_id=?)
      ORDER BY c.category_id,g.sort_order,ge.sort_order`,
  ).bind(tournamentId).all();
  const matches = await env.HUAU_DB.prepare(
    `SELECT ce.id as encounterId,ce.competition_id as competitionId,c.category_id as categoryId,tc.name as categoryName,
            ce.stage,ce.group_id as groupId,g.name as groupName,ce.round_label as roundLabel,ce.leg_number as legNumber,
            ce.entry_a_id as entryAId,ea.display_name as sideA,ce.entry_b_id as entryBId,eb.display_name as sideB,
            ce.status,ce.winner_entry_id as winnerEntryId,m.id as matchId,m.best_of as bestOf,m.point_target as pointTarget,
            mr.score_a as scoreA,mr.score_b as scoreB,mr.result_status as resultStatus
       FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id JOIN tournament_categories tc ON tc.id=c.category_id
       LEFT JOIN competition_groups g ON g.id=ce.group_id LEFT JOIN tournament_entries ea ON ea.id=ce.entry_a_id
       LEFT JOIN tournament_entries eb ON eb.id=ce.entry_b_id LEFT JOIN matches m ON m.encounter_id=ce.id AND m.rubber_order=1
       LEFT JOIN match_results mr ON mr.match_id=m.id
      WHERE tc.tournament_id=? ORDER BY tc.sort_order,CASE ce.stage WHEN 'group' THEN 0 WHEN 'playoff' THEN 1 WHEN 'consolation' THEN 2 WHEN 'bronze' THEN 3 ELSE 4 END,ce.round_number,ce.created_at`,
  ).bind(tournamentId).all();
  const schedule = await env.HUAU_DB.prepare(
    `SELECT si.id,si.category_id as categoryId,tc.name as categoryName,si.encounter_id as encounterId,si.match_id as matchId,
            si.stage,si.round_label as roundLabel,si.court_label as courtLabel,si.start_at as startAt,si.end_at as endAt,si.status
       FROM schedule_items si JOIN tournament_categories tc ON tc.id=si.category_id
      WHERE si.tournament_id=? ORDER BY si.start_at,si.court_label`,
  ).bind(tournamentId).all();
  const snapshots = await env.HUAU_DB.prepare(
    `SELECT s.id,s.scope_type as scopeType,s.scope_id as scopeId,s.reason,s.revision,s.created_at as createdAt,tc.name as categoryName
       FROM tournament_snapshots s LEFT JOIN tournament_categories tc ON tc.id=s.scope_id
      WHERE s.tournament_id=? ORDER BY s.created_at DESC LIMIT 30`,
  ).bind(tournamentId).all();
  const categoryRows = categories.results as Array<{ id: string; entryCount: number; competitionStatus: string | null; scheduledDate: string | null }>;
  const checklist = tournamentSetupChecklist({
    hasGeneral: Boolean(tournament.name && tournament.startAt && tournament.courtCount),
    categoryCount: categoryRows.length,
    entryCount: categoryRows.reduce((sum, row) => sum + Number(row.entryCount || 0), 0),
    generatedCategoryCount: categoryRows.filter((row) => row.competitionStatus).length,
    scheduledCategoryCount: categoryRows.filter((row) => row.competitionStatus && row.scheduledDate).length,
  });
  return { tournament, categories: categories.results, entries: entries.results, groups: groups.results, matches: matches.results, schedule: schedule.results, snapshots: snapshots.results, checklist };
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
  const categoryResult = await categoryForAccess(snapshot.scopeId, request, env, access);
  if (categoryResult instanceof Response) return categoryResult;
  await snapshotCategory(env, accessResult.tournament, categoryResult.category, accessResult.user.id, "Before restore");
  const payload = JSON.parse(snapshot.payloadJson) as CategorySnapshotPayload;
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE category_id=?`).bind(snapshot.scopeId),
    env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id=?`).bind(snapshot.scopeId),
  ];
  const category = payload.category;
  statements.push(env.HUAU_DB.prepare(
    `UPDATE tournament_categories SET name=?,entry_type=?,competition_gender=?,max_entries=?,registration_status=?,price_scope=?,price_minor=?,currency=?,format_version_id=?,scheduled_date=?,sort_order=?,structure_locked=?,updated_at=?,version=? WHERE id=?`,
  ).bind(
    category.name, category.entry_type, category.competition_gender, category.max_entries, category.registration_status,
    category.price_scope, category.price_minor, category.currency, category.format_version_id, category.scheduled_date,
    category.sort_order, category.structure_locked, unixNow(), category.version, snapshot.scopeId,
  ));
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
  statements.push(env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(unixNow(), snapshot.tournamentId));
  await runBatches(env.HUAU_DB, statements);
  await audit(env, accessResult.tournament, accessResult.user.id, "snapshot.restore", "Restored category snapshot", "category", snapshot.scopeId, { snapshotId });
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
    const categoryId=decodeURIComponent(finals[1]!); const accessResult=await categoryForAccess(categoryId,request,env,access); if(accessResult instanceof Response)return accessResult;
    const competition=await loadCompetition(env,categoryId); if(!competition)return json({ok:false,code:"COMPETITION_NOT_GENERATED"},{status:409});
    if(competition.finalGenerated)return json({ok:false,code:"FINAL_PHASE_ALREADY_GENERATED"},{status:409});
    if(competition.encounters.some((encounter)=>encounter.stage==="group"&&encounter.status!=="finished"))return json({ok:false,code:"GROUPS_INCOMPLETE"},{status:409});
    await snapshotCategory(env,accessResult.tournament,accessResult.category,accessResult.user.id,"Before final phase generation");
    const generated=generateFinalPhase(competition); const newEncounters=generated.encounters.filter((encounter)=>encounter.stage!=="group"); const stamp=unixNow(); const statements:D1PreparedStatement[]=[];
    newEncounters.forEach((encounter)=>{const matchId=uuid();statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_encounters (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).bind(encounter.id,competition.id,encounter.stage,null,encounter.roundLabel,encounter.roundNumber,encounter.legNumber,encounter.entryA?.id??null,encounter.entryB?.id??null,encounter.sourceEncounterAId,encounter.sourceEncounterBId,encounter.sourceLoserAId,encounter.sourceLoserBId,encounter.status,encounter.winnerEntryId,stamp,stamp));statements.push(env.HUAU_DB.prepare(`INSERT INTO matches (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version) VALUES (?,?,NULL,1,?,?,?, ?,NULL,?,?,?,NULL,0,?,?,1)`).bind(matchId,encounter.id,accessResult.category.entryType==="individual"?"singles":"doubles",accessResult.category.competitionGender,encounter.bestOf,encounter.pointTarget,encounter.status==="bye"?"finished":"pending",encounter.entryA?.name??null,encounter.entryB?.name??null,stamp,stamp));});
    statements.push(
      env.HUAU_DB.prepare(`UPDATE competitions SET status='final_phase',structure_revision=structure_revision+1,updated_at=? WHERE id=?`).bind(stamp,competition.id),
      env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`).bind(stamp, accessResult.tournament.id),
    );
    await runBatches(env.HUAU_DB,statements);
    const placeholders=await env.HUAU_DB.prepare(`SELECT id,stage,round_label as roundLabel FROM schedule_items WHERE category_id=? AND status='reserved' ORDER BY start_at,court_label`).bind(categoryId).all<{id:string;stage:string;roundLabel:string|null}>();
    const available=[...placeholders.results]; const binds:D1PreparedStatement[]=[]; for(const encounter of newEncounters){const index=available.findIndex((slot)=>slot.stage===encounter.stage&&slot.roundLabel===encounter.roundLabel); if(index<0)continue; const [slot]=available.splice(index,1); const match=await env.HUAU_DB.prepare(`SELECT id FROM matches WHERE encounter_id=? LIMIT 1`).bind(encounter.id).first<{id:string}>(); if(slot)binds.push(env.HUAU_DB.prepare(`UPDATE schedule_items SET encounter_id=?,match_id=?,status='bound',updated_at=? WHERE id=?`).bind(encounter.id,match?.id??null,stamp,slot.id));} if(binds.length)await runBatches(env.HUAU_DB,binds);
    await audit(env, accessResult.tournament, accessResult.user.id, "category.final_phase", "Generated final phase", "category", categoryId, { matchCount: newEncounters.length });
    return json({ok:true});
  }

  const matchResult=url.pathname.match(/^\/api\/admin\/matches\/([^/]+)\/result$/);
  if(matchResult && request.method==="POST"){
    const matchId=decodeURIComponent(matchResult[1]!); const lookup=await env.HUAU_DB.prepare(`SELECT tc.id as categoryId,tc.tournament_id as tournamentId,ce.id as encounterId,m.best_of as bestOf FROM matches m JOIN competition_encounters ce ON ce.id=m.encounter_id JOIN competitions c ON c.id=ce.competition_id JOIN tournament_categories tc ON tc.id=c.category_id WHERE m.id=?`).bind(matchId).first<{categoryId:string;tournamentId:string;encounterId:string;bestOf:number}>(); if(!lookup)return json({ok:false,code:"MATCH_NOT_FOUND"},{status:404});
    const accessResult=await tournamentForAccess(lookup.tournamentId,request,env,access); if(accessResult instanceof Response)return accessResult; const competition=await loadCompetition(env,lookup.categoryId); if(!competition)return json({ok:false,code:"COMPETITION_NOT_FOUND"},{status:404});
    const body=await readJson<{scoreA?:number;scoreB?:number;sets?:Array<{scoreA:number;scoreB:number}>}>(request); let updated:Competition; try{updated=lookup.bestOf===3?withEncounterResult(competition,lookup.encounterId,{sets:body.sets??[]}):withEncounterResult(competition,lookup.encounterId,{scoreA:Number(body.scoreA),scoreB:Number(body.scoreB)});}catch(error){return json({ok:false,code:error instanceof Error?error.message:"INVALID_RESULT"},{status:400});}
    const target=updated.encounters.find((encounter)=>encounter.id===lookup.encounterId)!; const stamp=unixNow(); const statements:D1PreparedStatement[]=[];
    for(const encounter of updated.encounters){const before=competition.encounters.find((candidate)=>candidate.id===encounter.id); if(!before)continue; if(before.entryA?.id!==encounter.entryA?.id||before.entryB?.id!==encounter.entryB?.id||before.status!==encounter.status||before.winnerEntryId!==encounter.winnerEntryId)statements.push(env.HUAU_DB.prepare(`UPDATE competition_encounters SET entry_a_id=?,entry_b_id=?,status=?,winner_entry_id=?,updated_at=?,version=version+1 WHERE id=?`).bind(encounter.entryA?.id??null,encounter.entryB?.id??null,encounter.status,encounter.winnerEntryId,stamp,encounter.id));}
    statements.push(env.HUAU_DB.prepare(`UPDATE matches SET status='finished',winner_side=?,side_a_label=?,side_b_label=?,updated_at=?,version=version+1 WHERE id=?`).bind(target.winnerEntryId===target.entryA?.id?"A":"B",target.entryA?.name??null,target.entryB?.name??null,stamp,matchId),env.HUAU_DB.prepare(`INSERT INTO match_results (match_id,score_a,score_b,winner_side,result_status,entered_by_user_id,entered_at,corrected_at,updated_at) VALUES (?,?,?,?, 'final',?,?,NULL,?) ON CONFLICT(match_id) DO UPDATE SET score_a=excluded.score_a,score_b=excluded.score_b,winner_side=excluded.winner_side,result_status='corrected',entered_by_user_id=excluded.entered_by_user_id,corrected_at=excluded.entered_at,updated_at=excluded.updated_at`).bind(matchId,target.scoreA,target.scoreB,target.winnerEntryId===target.entryA?.id?"A":"B",accessResult.user.id,stamp,stamp),env.HUAU_DB.prepare(`DELETE FROM match_sets WHERE match_id=?`).bind(matchId));
    target.sets.forEach((set,index)=>statements.push(env.HUAU_DB.prepare(`INSERT INTO match_sets (id,match_id,set_number,score_a,score_b,winner_side) VALUES (?,?,?,?,?,?)`).bind(uuid(),matchId,index+1,set.scoreA,set.scoreB,set.scoreA>set.scoreB?"A":"B")));
    statements.push(env.HUAU_DB.prepare(`UPDATE schedule_items SET status='completed',updated_at=?,version=version+1 WHERE match_id=?`).bind(stamp,matchId));
    await runBatches(env.HUAU_DB,statements);
    await audit(env, accessResult.tournament, accessResult.user.id, "match.result", "Saved match result", "match", matchId, { encounterId: lookup.encounterId });
    return json({ok:true});
  }

  const restore=url.pathname.match(/^\/api\/admin\/tournament-snapshots\/([^/]+)\/restore$/); if(restore && request.method==="POST")return restoreSnapshot(env,decodeURIComponent(restore[1]!),request,access);
  return null;
}
