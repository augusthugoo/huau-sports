import {
  calculateTeamStandings,
  createMixedFiveRubberTeamFormat,
  generateTeamRoundRobinEncounters,
  generateTeamFinalPhasePlan,
  parseTeamFormat,
  scoreTeamEncounter,
  validateTeamLineup,
  validateTeamLineupMutation,
  validateTeamRoster,
  type TeamEntry,
  type TeamFormat,
  type TeamGroupStandingSnapshot,
  type TeamLineupAssignment,
  type TeamRosterMember,
  type TeamRubberResult,
  type TeamSportGender,
  type TeamStandingEncounter,
} from "@huau/core";
import { regenerateTournamentScheduleForAdmin, snapshotCategoryByIdForAdmin } from "./tournament-admin";

type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isOrgAdmin: (userId: string, organizationId: string, env: Env, request?: Request) => Promise<boolean>;
};

type TournamentRow = {
  id: string;
  organizerOrganizationId: string;
  name: string;
  workingRevision: number;
};

type CategoryRow = {
  id: string;
  tournamentId: string;
  name: string;
  entryType: "team";
  formatVersionId: string | null;
  structureLocked: number;
};

type EntryRow = {
  id: string;
  categoryId: string;
  displayName: string;
  status: string;
};

type TeamMemberInput = {
  personId: string;
  role?: "player" | "captain" | "substitute";
};

type ResultSetInput = { scoreA: number; scoreB: number };

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
    `SELECT id,organizer_organization_id as organizerOrganizationId,name,working_revision as workingRevision
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
    `SELECT id,tournament_id as tournamentId,name,entry_type as entryType,format_version_id as formatVersionId,
            structure_locked as structureLocked
       FROM tournament_categories WHERE id=? AND entry_type='team'`,
  )
    .bind(categoryId)
    .first<CategoryRow>();
  if (!category) return json({ ok: false, code: "TEAM_CATEGORY_NOT_FOUND" }, { status: 404 });
  const result = await tournamentForAccess(category.tournamentId, request, env, access);
  if (result instanceof Response) return result;
  return { ...result, category };
}

async function entryForAccess(
  entryId: string,
  request: Request,
  env: Env,
  access: AccessHelpers,
): Promise<{ user: CurrentUser; tournament: TournamentRow; category: CategoryRow; entry: EntryRow } | Response> {
  const entry = await env.HUAU_DB.prepare(
    `SELECT e.id,e.category_id as categoryId,e.display_name as displayName,e.status
       FROM tournament_entries e JOIN tournament_categories tc ON tc.id=e.category_id
      WHERE e.id=? AND e.entry_type='team' AND tc.entry_type='team'`,
  )
    .bind(entryId)
    .first<EntryRow>();
  if (!entry) return json({ ok: false, code: "TEAM_NOT_FOUND" }, { status: 404 });
  const categoryResult = await categoryForAccess(entry.categoryId, request, env, access);
  if (categoryResult instanceof Response) return categoryResult;
  return { ...categoryResult, entry };
}

async function formatForCategory(env: Env, categoryId: string): Promise<TeamFormat> {
  const row = await env.HUAU_DB.prepare(
    `SELECT f.config_json as configJson
       FROM tournament_categories tc
       JOIN competition_format_versions f ON f.id=tc.format_version_id
      WHERE tc.id=? AND f.format_kind='team'`,
  )
    .bind(categoryId)
    .first<{ configJson: string }>();
  if (!row) throw new Error("TEAM_FORMAT_NOT_FOUND");
  return parseTeamFormat(JSON.parse(row.configJson) as unknown);
}

async function competitionExists(env: Env, categoryId: string): Promise<boolean> {
  return Boolean(await env.HUAU_DB.prepare(`SELECT id FROM competitions WHERE category_id=? LIMIT 1`).bind(categoryId).first());
}

async function invalidateTeamCompetition(env: Env, categoryId: string) {
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE category_id=?`).bind(categoryId),
    env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id=?`).bind(categoryId),
    env.HUAU_DB.prepare(`UPDATE tournament_categories SET structure_locked=0,updated_at=?,version=version+1 WHERE id=?`).bind(unixNow(), categoryId),
  ]);
}

async function bumpTournament(env: Env, tournamentId: string) {
  await env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`)
    .bind(unixNow(), tournamentId)
    .run();
}

async function audit(
  env: Env,
  tournament: TournamentRow,
  userId: string,
  action: string,
  summary: string,
  entityType: string,
  entityId: string,
  metadata?: unknown,
) {
  await env.HUAU_DB.prepare(
    `INSERT INTO critical_audit_events
     (id,organization_id,tournament_id,actor_user_id,actor_type,action,entity_type,entity_id,summary,metadata_json,created_at)
     VALUES (?,?,?,?, 'user', ?,?,?,?,?,?)`,
  )
    .bind(
      uuid(),
      tournament.organizerOrganizationId,
      tournament.id,
      userId,
      action,
      entityType,
      entityId,
      summary,
      metadata ? JSON.stringify(metadata) : null,
      unixNow(),
    )
    .run();
}

async function bumpTournamentAndAudit(
  env: Env,
  tournament: TournamentRow,
  userId: string,
  action: string,
  summary: string,
  entityType: string,
  entityId: string,
  metadata?: unknown,
) {
  const stamp = unixNow();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE tournaments SET working_revision=working_revision+1,updated_at=? WHERE id=?`)
      .bind(stamp, tournament.id),
    env.HUAU_DB.prepare(
      `INSERT INTO critical_audit_events
       (id,organization_id,tournament_id,actor_user_id,actor_type,action,entity_type,entity_id,summary,metadata_json,created_at)
       VALUES (?,?,?,?, 'user', ?,?,?,?,?,?)`,
    ).bind(
      uuid(),
      tournament.organizerOrganizationId,
      tournament.id,
      userId,
      action,
      entityType,
      entityId,
      summary,
      metadata ? JSON.stringify(metadata) : null,
      stamp,
    ),
  ]);
}

async function saveTeamFormatVersion(env: Env, categoryId: string, userId: string, format: TeamFormat): Promise<string> {
  const version = await env.HUAU_DB.prepare(
    `SELECT COALESCE(MAX(version_number),0)+1 as nextVersion FROM competition_format_versions WHERE category_id=?`,
  )
    .bind(categoryId)
    .first<{ nextVersion: number }>();
  const id = uuid();
  const stamp = unixNow();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `INSERT INTO competition_format_versions
       (id,category_id,version_number,format_kind,config_json,explanation_schema_version,created_by_user_id,created_at,locked_at)
       VALUES (?,?,?,'team',?,1,?,?,NULL)`,
    ).bind(id, categoryId, version?.nextVersion ?? 1, JSON.stringify(format), userId, stamp),
    env.HUAU_DB.prepare(
      `UPDATE tournament_categories SET format_version_id=?,updated_at=?,version=version+1 WHERE id=?`,
    ).bind(id, stamp, categoryId),
  ]);
  return id;
}

async function loadRoster(env: Env, entryId: string): Promise<TeamRosterMember[]> {
  const rows = await env.HUAU_DB.prepare(
    `SELECT em.organization_person_id as personId,
            TRIM(op.first_name || ' ' || op.last_name) as name,
            COALESCE(op.sport_gender,'unspecified') as sportGender,
            em.member_role as role
       FROM entry_members em JOIN organization_people op ON op.id=em.organization_person_id
      WHERE em.entry_id=? AND em.status IN ('accepted','manual')
      ORDER BY CASE em.member_role WHEN 'captain' THEN 0 WHEN 'player' THEN 1 ELSE 2 END,em.created_at,em.id`,
  )
    .bind(entryId)
    .all<{ personId: string; name: string; sportGender: string; role: "player" | "captain" | "substitute" }>();
  return rows.results.map((row) => ({
    personId: row.personId,
    name: row.name,
    sportGender: row.sportGender === "male" || row.sportGender === "female" ? row.sportGender : "unspecified",
    role: row.role,
  }));
}

async function resolveRoster(
  env: Env,
  categoryId: string,
  currentEntryId: string | null,
  format: TeamFormat,
  members: TeamMemberInput[],
): Promise<TeamRosterMember[]> {
  const uniquePersonIds = [...new Set(members.map((member) => member.personId).filter(Boolean))];
  if (uniquePersonIds.length !== members.length) throw new Error("TEAM_ROSTER_DUPLICATE_PERSON");
  if (!uniquePersonIds.length) throw new Error("TEAM_ROSTER_REQUIRED");
  const placeholders = uniquePersonIds.map(() => "?").join(",");
  const people = await env.HUAU_DB.prepare(
    `SELECT op.id,TRIM(op.first_name || ' ' || op.last_name) as name,COALESCE(op.sport_gender,'unspecified') as sportGender,
            p.player_status as playerStatus
       FROM tournament_categories tc
       JOIN tournament_player_profiles p ON p.tournament_id=tc.tournament_id
       JOIN organization_people op ON op.id=p.organization_person_id
      WHERE tc.id=? AND p.organization_person_id IN (${placeholders})
      GROUP BY op.id,p.player_status`,
  )
    .bind(categoryId, ...uniquePersonIds)
    .all<{ id: string; name: string; sportGender: string; playerStatus: string }>();
  const peopleById = new Map(people.results.map((person) => [person.id, person] as const));
  if (peopleById.size !== uniquePersonIds.length) throw new Error("TEAM_ROSTER_PERSON_NOT_IN_TOURNAMENT");
  const inactive = uniquePersonIds.find((personId) => peopleById.get(personId)?.playerStatus !== "confirmed");
  if (inactive) throw new Error("TEAM_ROSTER_PLAYER_NOT_CONFIRMED");

  const conflicts = await env.HUAU_DB.prepare(
    `SELECT em.organization_person_id as personId,e.id as entryId,e.display_name as teamName
       FROM entry_members em
       JOIN tournament_entries e ON e.id=em.entry_id
      WHERE e.category_id=? AND e.entry_type='team' AND e.status NOT IN ('withdrawn','rejected')
        AND em.status IN ('accepted','manual') AND em.organization_person_id IN (${placeholders})
        ${currentEntryId ? "AND e.id<>?" : ""}`,
  )
    .bind(categoryId, ...uniquePersonIds, ...(currentEntryId ? [currentEntryId] : []))
    .all<{ personId: string; entryId: string; teamName: string }>();
  if (conflicts.results.length) {
    const names = [...new Set(conflicts.results.map((row) => row.teamName))].join(", ");
    throw new Error(`TEAM_ROSTER_PERSON_ALREADY_ASSIGNED:${names}`);
  }

  const roster: TeamRosterMember[] = members.map((member) => {
    const person = peopleById.get(member.personId)!;
    const sportGender: TeamSportGender = person.sportGender === "male" || person.sportGender === "female" ? person.sportGender : "unspecified";
    return {
      personId: member.personId,
      name: person.name,
      sportGender,
      role: member.role === "captain" || member.role === "substitute" ? member.role : "player",
    };
  });
  const validation = validateTeamRoster(format, roster);
  if (!validation.valid) {
    throw new Error(`TEAM_ROSTER_INVALID:${validation.issues.map((issue) => issue.code).join(",")}`);
  }
  return roster;
}

async function replaceRoster(env: Env, entryId: string, roster: TeamRosterMember[]) {
  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [env.HUAU_DB.prepare(`DELETE FROM entry_members WHERE entry_id=?`).bind(entryId)];
  roster.forEach((member, index) => {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO entry_members
         (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,accepted_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'manual',NULL,?,?,?)`,
      ).bind(uuid(), entryId, member.personId, member.role, String(index + 1), stamp, stamp, stamp),
    );
  });
  await runBatches(env.HUAU_DB, statements);
}

function balancedSizes(total: number, groupCount: number): number[] {
  const count = Math.max(1, Math.min(groupCount, Math.max(1, Math.floor(total / 2))));
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function distributeSnake<T>(items: T[], sizes: number[]): T[][] {
  const groups = sizes.map(() => [] as T[]);
  let itemIndex = 0;
  let row = 0;
  while (itemIndex < items.length) {
    const indices = row % 2 === 0 ? groups.map((_, index) => index) : groups.map((_, index) => groups.length - 1 - index);
    for (const groupIndex of indices) {
      if (itemIndex >= items.length) break;
      if (groups[groupIndex]!.length >= sizes[groupIndex]!) continue;
      groups[groupIndex]!.push(items[itemIndex++]!);
    }
    row += 1;
    if (row > items.length * 2) throw new Error("TEAM_GROUP_DISTRIBUTION_FAILED");
  }
  return groups;
}

function setWinner(sets: ResultSetInput[], bestOf: number): { winnerSide: "A" | "B"; pointsA: number; pointsB: number } {
  const needed = bestOf === 3 ? 2 : 1;
  if (sets.length < needed || sets.length > bestOf) throw new Error("TEAM_RESULT_SET_COUNT_INVALID");
  let winsA = 0;
  let winsB = 0;
  let pointsA = 0;
  let pointsB = 0;
  for (const set of sets) {
    if (!Number.isInteger(set.scoreA) || !Number.isInteger(set.scoreB) || set.scoreA < 0 || set.scoreB < 0 || set.scoreA === set.scoreB) {
      throw new Error("TEAM_RESULT_SET_INVALID");
    }
    if (winsA >= needed || winsB >= needed) throw new Error("TEAM_RESULT_EXTRA_SET");
    pointsA += set.scoreA;
    pointsB += set.scoreB;
    if (set.scoreA > set.scoreB) winsA += 1;
    else winsB += 1;
  }
  if (winsA !== needed && winsB !== needed) throw new Error("TEAM_RESULT_INCOMPLETE");
  return { winnerSide: winsA > winsB ? "A" : "B", pointsA, pointsB };
}


async function teamStandingSnapshots(
  env: Env,
  categoryId: string,
  format: TeamFormat,
): Promise<TeamGroupStandingSnapshot[]> {
  const [groupRows, encounterRows] = await Promise.all([
    env.HUAU_DB.prepare(
      `SELECT g.id as groupId,g.name as groupName,ge.entry_id as entryId,e.display_name as entryName,ge.sort_order as sortOrder
         FROM competition_groups g JOIN competitions c ON c.id=g.competition_id
         JOIN competition_group_entries ge ON ge.group_id=g.id JOIN tournament_entries e ON e.id=ge.entry_id
        WHERE c.category_id=? ORDER BY g.sort_order,ge.sort_order`,
    ).bind(categoryId).all<{ groupId: string; groupName: string; entryId: string; entryName: string; sortOrder: number }>(),
    env.HUAU_DB.prepare(
      `SELECT ce.id,ce.group_id as groupId,ce.entry_a_id as entryAId,ce.entry_b_id as entryBId,ce.winner_entry_id as winnerEntryId,
              SUM(CASE WHEN mr.result_status IN ('final','corrected') AND m.winner_side='A' THEN 1 ELSE 0 END) as rubbersWonA,
              SUM(CASE WHEN mr.result_status IN ('final','corrected') AND m.winner_side='B' THEN 1 ELSE 0 END) as rubbersWonB,
              SUM(CASE WHEN mr.result_status IN ('final','corrected') THEN COALESCE(mr.score_a,0) ELSE 0 END) as pointsA,
              SUM(CASE WHEN mr.result_status IN ('final','corrected') THEN COALESCE(mr.score_b,0) ELSE 0 END) as pointsB
         FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id
         LEFT JOIN matches m ON m.encounter_id=ce.id LEFT JOIN match_results mr ON mr.match_id=m.id
        WHERE c.category_id=? AND ce.stage='group' AND ce.status='finished'
        GROUP BY ce.id,ce.group_id,ce.entry_a_id,ce.entry_b_id,ce.winner_entry_id`,
    ).bind(categoryId).all<{ id: string; groupId: string; entryAId: string; entryBId: string; winnerEntryId: string; rubbersWonA: number; rubbersWonB: number; pointsA: number; pointsB: number }>(),
  ]);
  const snapshots: TeamGroupStandingSnapshot[] = [];
  const groupIds = [...new Set(groupRows.results.map((row) => row.groupId))];
  for (const groupId of groupIds) {
    const rows = groupRows.results.filter((row) => row.groupId === groupId);
    const entries: TeamEntry[] = rows.map((row) => ({ id: row.entryId, name: row.entryName, roster: [] }));
    const results: TeamStandingEncounter[] = encounterRows.results
      .filter((row) => row.groupId === groupId && row.winnerEntryId)
      .map((row) => ({
        id: row.id,
        entryAId: row.entryAId,
        entryBId: row.entryBId,
        winnerEntryId: row.winnerEntryId,
        rubbersWonA: Number(row.rubbersWonA ?? 0),
        rubbersWonB: Number(row.rubbersWonB ?? 0),
        pointsA: Number(row.pointsA ?? 0),
        pointsB: Number(row.pointsB ?? 0),
      }));
    const standing = calculateTeamStandings({ entries, encounters: results, criteria: format.standings.criteria });
    snapshots.push({ groupId, groupName: rows[0]?.groupName ?? "", rows: standing.rows });
  }
  return snapshots;
}

function appendTeamRubberMatches(
  statements: D1PreparedStatement[],
  env: Env,
  encounterId: string,
  format: TeamFormat,
  encounterStatus: "pending" | "ready",
  sideA: string | null,
  sideB: string | null,
  stamp: number,
) {
  [...format.encounter.rubbers].sort((a, b) => a.order - b.order).forEach((rubber, index) => {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO matches
         (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,?,?,1)`,
      ).bind(
        uuid(), encounterId, rubber.key, rubber.order, rubber.mode, rubber.gender, rubber.bestOf, rubber.pointTarget,
        rubber.scoringMode, encounterStatus === "ready" && index === 0 ? "ready" : "pending", sideA, sideB, stamp, stamp,
      ),
    );
  });
}

type PersistedTeamFinalEncounter = {
  id: string;
  stage: string;
  entryAId: string | null;
  entryBId: string | null;
  sourceEncounterAId: string | null;
  sourceEncounterBId: string | null;
  sourceLoserAId: string | null;
  sourceLoserBId: string | null;
  status: string;
  winnerEntryId: string | null;
};

function sourceEntry(
  source: PersistedTeamFinalEncounter | undefined,
  loser: boolean,
): string | null {
  if (!source || (source.status !== "finished" && source.status !== "bye") || !source.winnerEntryId) return null;
  if (!loser) return source.winnerEntryId;
  if (!source.entryAId || !source.entryBId) return null;
  return source.winnerEntryId === source.entryAId ? source.entryBId : source.entryAId;
}

async function progressTeamFinalPhase(env: Env, competitionId: string) {
  const names = await env.HUAU_DB.prepare(
    `SELECT e.id,e.display_name as displayName FROM tournament_entries e JOIN competitions c ON c.category_id=e.category_id WHERE c.id=?`,
  ).bind(competitionId).all<{ id: string; displayName: string }>();
  const nameById = new Map(names.results.map((entry) => [entry.id, entry.displayName] as const));

  for (let pass = 0; pass < 64; pass += 1) {
    const result = await env.HUAU_DB.prepare(
      `SELECT id,stage,entry_a_id as entryAId,entry_b_id as entryBId,
              source_encounter_a_id as sourceEncounterAId,source_encounter_b_id as sourceEncounterBId,
              source_loser_a_id as sourceLoserAId,source_loser_b_id as sourceLoserBId,status,winner_entry_id as winnerEntryId
         FROM competition_encounters WHERE competition_id=? AND stage<>'group' ORDER BY round_number,created_at`,
    ).bind(competitionId).all<PersistedTeamFinalEncounter>();
    const byId = new Map(result.results.map((encounter) => [encounter.id, encounter] as const));
    const statements: D1PreparedStatement[] = [];
    let changed = false;
    for (const encounter of result.results) {
      if (encounter.status === "finished" || encounter.status === "bye") continue;
      const desiredA = encounter.sourceEncounterAId
        ? sourceEntry(byId.get(encounter.sourceEncounterAId), false)
        : encounter.sourceLoserAId
          ? sourceEntry(byId.get(encounter.sourceLoserAId), true)
          : encounter.entryAId;
      const desiredB = encounter.sourceEncounterBId
        ? sourceEntry(byId.get(encounter.sourceEncounterBId), false)
        : encounter.sourceLoserBId
          ? sourceEntry(byId.get(encounter.sourceLoserBId), true)
          : encounter.entryBId;
      const participantChanged = desiredA !== encounter.entryAId || desiredB !== encounter.entryBId;
      const nextStatus = desiredA && desiredB ? "ready" : "pending";
      if (!participantChanged && encounter.status === nextStatus) continue;
      changed = true;
      if (participantChanged) {
        statements.push(env.HUAU_DB.prepare(`DELETE FROM team_encounter_lineups WHERE encounter_id=?`).bind(encounter.id));
      }
      statements.push(
        env.HUAU_DB.prepare(
          `UPDATE competition_encounters SET entry_a_id=?,entry_b_id=?,status=?,updated_at=?,version=version+1 WHERE id=?`,
        ).bind(desiredA, desiredB, nextStatus, unixNow(), encounter.id),
        env.HUAU_DB.prepare(
          `UPDATE matches SET side_a_label=?,side_b_label=?,
                  status=CASE WHEN ?='ready' AND rubber_order=(SELECT MIN(rubber_order) FROM matches WHERE encounter_id=?) THEN 'ready' ELSE 'pending' END,
                  winner_side=NULL,updated_at=?,version=version+1
            WHERE encounter_id=? AND status NOT IN ('finished','skipped')`,
        ).bind(desiredA ? nameById.get(desiredA) ?? null : null, desiredB ? nameById.get(desiredB) ?? null : null, nextStatus, encounter.id, unixNow(), encounter.id),
      );
    }
    if (statements.length) await runBatches(env.HUAU_DB, statements);
    if (!changed) break;
  }
  const final = await env.HUAU_DB.prepare(
    `SELECT id FROM competition_encounters WHERE competition_id=? AND stage='final' AND status IN ('finished','bye') LIMIT 1`,
  ).bind(competitionId).first();
  const unfinishedMedal = await env.HUAU_DB.prepare(
    `SELECT id FROM competition_encounters WHERE competition_id=? AND stage IN ('final','bronze') AND status NOT IN ('finished','bye') LIMIT 1`,
  ).bind(competitionId).first();
  await env.HUAU_DB.prepare(`UPDATE competitions SET status=?,updated_at=? WHERE id=?`)
    .bind(final && !unfinishedMedal ? "completed" : "final_phase", unixNow(), competitionId)
    .run();
}

async function ensureTeamFinalPhase(
  env: Env,
  tournament: TournamentRow,
  categoryId: string,
  userId: string,
): Promise<boolean> {
  const competition = await env.HUAU_DB.prepare(`SELECT id,status FROM competitions WHERE category_id=?`).bind(categoryId).first<{ id: string; status: string }>();
  if (!competition) return false;
  const existing = await env.HUAU_DB.prepare(`SELECT id FROM competition_encounters WHERE competition_id=? AND stage<>'group' LIMIT 1`).bind(competition.id).first();
  if (existing || competition.status === "completed") return false;
  const counts = await env.HUAU_DB.prepare(
    `SELECT COUNT(*) as total,SUM(CASE WHEN status='finished' THEN 1 ELSE 0 END) as finished
       FROM competition_encounters WHERE competition_id=? AND stage='group'`,
  ).bind(competition.id).first<{ total: number; finished: number }>();
  if (!counts || Number(counts.total) === 0 || Number(counts.finished ?? 0) !== Number(counts.total)) return false;

  const format = await formatForCategory(env, categoryId);
  const standings = await teamStandingSnapshots(env, categoryId, format);
  const plan = generateTeamFinalPhasePlan({ format, standings });
  if (format.competition.playoffMode === "league_only" || !plan.encounters.length) {
    await env.HUAU_DB.prepare(`UPDATE competitions SET status='completed',updated_at=? WHERE id=?`).bind(unixNow(), competition.id).run();
    await audit(env, tournament, userId, "team.final_phase.complete_league", "Completed Team category by standings", "category", categoryId);
    return true;
  }

  const ids = new Map(plan.encounters.map((encounter) => [encounter.id, uuid()] as const));
  const names = await env.HUAU_DB.prepare(`SELECT id,display_name as displayName FROM tournament_entries WHERE category_id=?`).bind(categoryId).all<{ id: string; displayName: string }>();
  const nameById = new Map(names.results.map((entry) => [entry.id, entry.displayName] as const));
  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [];
  for (const encounter of plan.encounters) {
    const encounterId = ids.get(encounter.id)!;
    const sourceA = encounter.sourceEncounterAId ? ids.get(encounter.sourceEncounterAId) ?? null : null;
    const sourceB = encounter.sourceEncounterBId ? ids.get(encounter.sourceEncounterBId) ?? null : null;
    const loserA = encounter.sourceLoserAId ? ids.get(encounter.sourceLoserAId) ?? null : null;
    const loserB = encounter.sourceLoserBId ? ids.get(encounter.sourceLoserBId) ?? null : null;
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO competition_encounters
         (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version)
         VALUES (?,?,?,NULL,?,?,1,?,?,?,?,?,?,?,?,?,?,1)`,
      ).bind(
        encounterId, competition.id, encounter.stage, encounter.roundLabel, encounter.roundNumber,
        encounter.entryAId, encounter.entryBId, sourceA, sourceB, loserA, loserB, encounter.status, encounter.winnerEntryId, stamp, stamp,
      ),
    );
    if (encounter.status !== "bye") {
      appendTeamRubberMatches(
        statements, env, encounterId, format, encounter.status === "ready" ? "ready" : "pending",
        encounter.entryAId ? nameById.get(encounter.entryAId) ?? null : null,
        encounter.entryBId ? nameById.get(encounter.entryBId) ?? null : null,
        stamp,
      );
    }
  }
  statements.push(env.HUAU_DB.prepare(`UPDATE competitions SET status='final_phase',updated_at=? WHERE id=?`).bind(stamp, competition.id));
  await runBatches(env.HUAU_DB, statements);
  await progressTeamFinalPhase(env, competition.id);
  await regenerateTournamentScheduleForAdmin(env, tournament.id, userId);
  await audit(env, tournament, userId, "team.final_phase.generate", `Generated Team final phase (${format.competition.playoffMode})`, "category", categoryId, { qualifiers: plan.qualifiers.length, encounters: plan.encounters.length });
  return true;
}

async function downstreamTeamResultExists(env: Env, encounterId: string): Promise<boolean> {
  const row = await env.HUAU_DB.prepare(
    `WITH RECURSIVE downstream(id) AS (
       SELECT id FROM competition_encounters
        WHERE source_encounter_a_id=? OR source_encounter_b_id=? OR source_loser_a_id=? OR source_loser_b_id=?
       UNION
       SELECT ce.id FROM competition_encounters ce JOIN downstream d
         ON ce.source_encounter_a_id=d.id OR ce.source_encounter_b_id=d.id OR ce.source_loser_a_id=d.id OR ce.source_loser_b_id=d.id
     )
     SELECT mr.match_id as matchId FROM downstream d JOIN matches m ON m.encounter_id=d.id JOIN match_results mr ON mr.match_id=m.id
      WHERE mr.result_status IN ('final','corrected') LIMIT 1`,
  ).bind(encounterId, encounterId, encounterId, encounterId).first();
  return Boolean(row);
}

async function createTeamCategory(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await tournamentForAccess(tournamentId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const body = await readJson<{ name?: string; scheduledDate?: string | null; mixedDoublesPlay?: "always" | "if_tied" }>(request);
  const name = body.name?.trim();
  if (!name) return json({ ok: false, code: "TEAM_CATEGORY_NAME_REQUIRED" }, { status: 400 });
  const duplicate = await env.HUAU_DB.prepare(
    `SELECT id FROM tournament_categories WHERE tournament_id=? AND lower(name)=lower(?)`,
  )
    .bind(tournamentId, name)
    .first();
  if (duplicate) return json({ ok: false, code: "CATEGORY_NAME_EXISTS" }, { status: 409 });
  const categoryId = uuid();
  const stamp = unixNow();
  const sort = await env.HUAU_DB.prepare(
    `SELECT COALESCE(MAX(sort_order),-1)+1 as nextSort FROM tournament_categories WHERE tournament_id=?`,
  )
    .bind(tournamentId)
    .first<{ nextSort: number }>();
  await env.HUAU_DB.prepare(
    `INSERT INTO tournament_categories
     (id,tournament_id,name,entry_type,competition_gender,max_entries,registration_status,price_scope,price_minor,currency,format_version_id,scheduled_date,sort_order,structure_locked,created_at,updated_at,version)
     VALUES (?,? ,?,'team','mixed',NULL,'closed','free',NULL,NULL,NULL,?,?,0,?,?,1)`,
  )
    .bind(categoryId, tournamentId, name, body.scheduledDate ?? null, sort?.nextSort ?? 0, stamp, stamp)
    .run();
  const format = createMixedFiveRubberTeamFormat(body.mixedDoublesPlay ?? "always");
  await saveTeamFormatVersion(env, categoryId, accessResult.user.id, format);
  await bumpTournament(env, tournamentId);
  await audit(env, accessResult.tournament, accessResult.user.id, "team.category.create", `Created team category ${name}`, "category", categoryId);
  return json({ ok: true, categoryId }, { status: 201 });
}

async function saveFormat(
  request: Request,
  env: Env,
  categoryId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await categoryForAccess(categoryId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const body = await readJson<{ format?: unknown; confirmImpact?: boolean }>(request);
  let format: TeamFormat;
  try {
    format = parseTeamFormat(body.format);
  } catch (error) {
    return json({ ok: false, code: error instanceof Error ? error.message : "TEAM_FORMAT_INVALID" }, { status: 400 });
  }
  const hasCompetition = await competitionExists(env, categoryId);
  if (hasCompetition && !body.confirmImpact) {
    return json(
      {
        ok: false,
        code: "STRUCTURE_CHANGE_CONFIRM_REQUIRED",
        impact: "Cambiar el formato Team invalida grupos, series, alineaciones y resultados de esta categoría. HUAU guardará un snapshot antes.",
      },
      { status: 409 },
    );
  }
  if (hasCompetition) {
    await snapshotCategoryByIdForAdmin(env, accessResult.tournament.id, categoryId, accessResult.user.id, "Before Team format change");
    await invalidateTeamCompetition(env, categoryId);
  }
  const formatVersionId = await saveTeamFormatVersion(env, categoryId, accessResult.user.id, format);
  await bumpTournament(env, accessResult.tournament.id);
  await audit(env, accessResult.tournament, accessResult.user.id, "team.format.save", "Saved Team competition format", "category", categoryId, { formatVersionId });
  return json({ ok: true, formatVersionId });
}

async function createTeam(
  request: Request,
  env: Env,
  categoryId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await categoryForAccess(categoryId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const body = await readJson<{ name?: string; members?: TeamMemberInput[]; confirmImpact?: boolean }>(request);
  const name = body.name?.trim();
  if (!name) return json({ ok: false, code: "TEAM_NAME_REQUIRED" }, { status: 400 });
  const duplicate = await env.HUAU_DB.prepare(`SELECT id FROM tournament_entries WHERE category_id=? AND lower(display_name)=lower(?)`)
    .bind(categoryId, name)
    .first();
  if (duplicate) return json({ ok: false, code: "TEAM_NAME_EXISTS" }, { status: 409 });
  const format = await formatForCategory(env, categoryId);
  let roster: TeamRosterMember[];
  try {
    roster = await resolveRoster(env, categoryId, null, format, body.members ?? []);
  } catch (error) {
    const code = error instanceof Error ? error.message : "TEAM_ROSTER_INVALID";
    return json({ ok: false, code }, { status: code.startsWith("TEAM_ROSTER_PERSON_ALREADY_ASSIGNED") ? 409 : 400 });
  }
  const hasCompetition = await competitionExists(env, categoryId);
  if (hasCompetition && !body.confirmImpact) {
    return json(
      {
        ok: false,
        code: "STRUCTURE_CHANGE_CONFIRM_REQUIRED",
        impact: "Agregar un equipo invalida la estructura Team ya generada. HUAU guardará un snapshot antes.",
      },
      { status: 409 },
    );
  }
  if (hasCompetition) {
    await snapshotCategoryByIdForAdmin(env, accessResult.tournament.id, categoryId, accessResult.user.id, "Before adding Team entry");
    await invalidateTeamCompetition(env, categoryId);
  }
  const entryId = uuid();
  const stamp = unixNow();
  await env.HUAU_DB.prepare(
    `INSERT INTO tournament_entries
     (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,seed_rating,created_by_user_id,created_by_admin,source_kind,source_key,created_at,updated_at,version)
     VALUES (?,?,'team',?,NULL,'confirmed',NULL,0,?,1,'team_admin',?, ?,?,1)`,
  )
    .bind(entryId, categoryId, name, accessResult.user.id, entryId, stamp, stamp)
    .run();
  await replaceRoster(env, entryId, roster);
  await bumpTournament(env, accessResult.tournament.id);
  await audit(env, accessResult.tournament, accessResult.user.id, "team.entry.create", `Created team ${name}`, "entry", entryId);
  return json({ ok: true, entryId }, { status: 201 });
}

async function updateTeam(
  request: Request,
  env: Env,
  entryId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await entryForAccess(entryId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const body = await readJson<{ name?: string; members?: TeamMemberInput[]; confirmImpact?: boolean }>(request);
  const name = body.name?.trim() || accessResult.entry.displayName;
  if (name !== accessResult.entry.displayName) {
    const duplicate = await env.HUAU_DB.prepare(
      `SELECT id FROM tournament_entries WHERE category_id=? AND lower(display_name)=lower(?) AND id<>?`,
    ).bind(accessResult.category.id, name, entryId).first();
    if (duplicate) return json({ ok: false, code: "TEAM_NAME_EXISTS" }, { status: 409 });
  }
  const format = await formatForCategory(env, accessResult.category.id);
  let roster: TeamRosterMember[] | null = null;
  if (body.members) {
    try {
      roster = await resolveRoster(env, accessResult.category.id, entryId, format, body.members);
    } catch (error) {
      const code = error instanceof Error ? error.message : "TEAM_ROSTER_INVALID";
      return json({ ok: false, code }, { status: code.startsWith("TEAM_ROSTER_PERSON_ALREADY_ASSIGNED") ? 409 : 400 });
    }
  }
  const hasCompetition = await competitionExists(env, accessResult.category.id);
  if (hasCompetition && !body.confirmImpact) {
    return json(
      {
        ok: false,
        code: "STRUCTURE_CHANGE_CONFIRM_REQUIRED",
        impact: "Editar nombre o roster invalida la estructura Team ya generada. HUAU guardará un snapshot antes.",
      },
      { status: 409 },
    );
  }
  if (hasCompetition) {
    await snapshotCategoryByIdForAdmin(env, accessResult.tournament.id, accessResult.category.id, accessResult.user.id, "Before Team roster edit");
    await invalidateTeamCompetition(env, accessResult.category.id);
  }
  if (roster) await replaceRoster(env, entryId, roster);
  await env.HUAU_DB.prepare(`UPDATE tournament_entries SET display_name=?,updated_at=?,version=version+1 WHERE id=?`)
    .bind(name, unixNow(), entryId)
    .run();
  await bumpTournament(env, accessResult.tournament.id);
  await audit(env, accessResult.tournament, accessResult.user.id, "team.entry.update", `Updated team ${name}`, "entry", entryId);
  return json({ ok: true });
}


async function deleteTeam(
  request: Request,
  env: Env,
  entryId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await entryForAccess(entryId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const body: { confirmImpact?: boolean } = await readJson<{ confirmImpact?: boolean }>(request).catch(() => ({}));
  const hasCompetition = await competitionExists(env, accessResult.category.id);
  if (hasCompetition && !body.confirmImpact) {
    return json(
      {
        ok: false,
        code: "STRUCTURE_CHANGE_CONFIRM_REQUIRED",
        impact: "Eliminar un equipo invalida la estructura Team ya generada. HUAU guardará un snapshot antes.",
      },
      { status: 409 },
    );
  }
  if (hasCompetition) {
    await snapshotCategoryByIdForAdmin(env, accessResult.tournament.id, accessResult.category.id, accessResult.user.id, "Before deleting Team entry");
    await invalidateTeamCompetition(env, accessResult.category.id);
  }
  await env.HUAU_DB.prepare(`DELETE FROM tournament_entries WHERE id=?`).bind(entryId).run();
  await bumpTournament(env, accessResult.tournament.id);
  await audit(env, accessResult.tournament, accessResult.user.id, "team.entry.delete", `Deleted team ${accessResult.entry.displayName}`, "entry", entryId);
  return json({ ok: true });
}

async function generateStructure(
  request: Request,
  env: Env,
  categoryId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await categoryForAccess(categoryId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const body = await readJson<{ groupCount?: number; confirmImpact?: boolean }>(request);
  const format = await formatForCategory(env, categoryId);
  const entryRows = await env.HUAU_DB.prepare(
    `SELECT id,category_id as categoryId,display_name as displayName,status
       FROM tournament_entries WHERE category_id=? AND entry_type='team' AND status IN ('ready','confirmed') ORDER BY created_at,id`,
  )
    .bind(categoryId)
    .all<EntryRow>();
  if (entryRows.results.length < 2) return json({ ok: false, code: "TEAM_STRUCTURE_REQUIRES_TWO_TEAMS" }, { status: 400 });
  const teams: TeamEntry[] = [];
  for (const entry of entryRows.results) {
    const roster = await loadRoster(env, entry.id);
    const rosterValidation = validateTeamRoster(format, roster);
    if (!rosterValidation.valid) {
      return json(
        { ok: false, code: "TEAM_ROSTER_INVALID", teamId: entry.id, teamName: entry.displayName, issues: rosterValidation.issues },
        { status: 400 },
      );
    }
    teams.push({ id: entry.id, name: entry.displayName, roster });
  }
  const existing = await competitionExists(env, categoryId);
  if (existing && !body.confirmImpact) {
    return json(
      {
        ok: false,
        code: "STRUCTURE_CHANGE_CONFIRM_REQUIRED",
        impact: "Regenerar grupos Team reemplaza series, alineaciones y resultados actuales. HUAU guardará un snapshot antes.",
      },
      { status: 409 },
    );
  }
  if (existing) {
    await snapshotCategoryByIdForAdmin(env, accessResult.tournament.id, categoryId, accessResult.user.id, "Before regenerating Team structure");
    await invalidateTeamCompetition(env, categoryId);
  }
  const maxGroups = format.competition.playoffMode === "standard" ? Math.max(1, Math.floor(teams.length / 2)) : 1;
  const groupCount = Math.max(1, Math.min(Math.trunc(body.groupCount ?? 1), maxGroups));
  const sizes = balancedSizes(teams.length, groupCount);
  const distributed = distributeSnake(teams, sizes);
  if (distributed.some((group, index) => group.length !== sizes[index])) {
    return json({ ok: false, code: "TEAM_GROUP_DISTRIBUTION_FAILED" }, { status: 500 });
  }
  const formatRow = await env.HUAU_DB.prepare(`SELECT format_version_id as formatVersionId FROM tournament_categories WHERE id=?`)
    .bind(categoryId)
    .first<{ formatVersionId: string }>();
  if (!formatRow?.formatVersionId) return json({ ok: false, code: "TEAM_FORMAT_NOT_FOUND" }, { status: 409 });
  const competitionId = uuid();
  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(
      `INSERT INTO competitions (id,category_id,format_version_id,status,structure_revision,created_at,updated_at)
       VALUES (?,?,?,'groups_generated',1,?,?)`,
    ).bind(competitionId, categoryId, formatRow.formatVersionId, stamp, stamp),
  ];
  const teamNameById = new Map(teams.map((team) => [team.id, team.name] as const));
  distributed.forEach((groupEntries, groupIndex) => {
    const groupId = uuid();
    const groupName = String.fromCharCode(65 + groupIndex);
    statements.push(env.HUAU_DB.prepare(`INSERT INTO competition_groups (id,competition_id,name,sort_order) VALUES (?,?,?,?)`).bind(groupId, competitionId, groupName, groupIndex));
    groupEntries.forEach((entry, entryIndex) => {
      statements.push(
        env.HUAU_DB.prepare(`INSERT INTO competition_group_entries (group_id,entry_id,seed,sort_order) VALUES (?,?,?,?)`).bind(
          groupId,
          entry.id,
          entryIndex + 1,
          entryIndex,
        ),
      );
    });
    const plans = generateTeamRoundRobinEncounters({ id: groupId, name: groupName, entries: groupEntries }, format);
    plans.forEach((plan, encounterIndex) => {
      const encounterId = uuid();
      statements.push(
        env.HUAU_DB.prepare(
          `INSERT INTO competition_encounters
           (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version)
           VALUES (?,?,'group',?,?,?, ?,?,?,NULL,NULL,NULL,NULL,'ready',NULL,?,?,1)`,
        ).bind(encounterId, competitionId, groupId, `Grupo ${groupName}`, encounterIndex + 1, plan.legNumber, plan.entryAId, plan.entryBId, stamp, stamp),
      );
      plan.rubbers.forEach((rubber, rubberIndex) => {
        statements.push(
          env.HUAU_DB.prepare(
            `INSERT INTO matches
             (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,?,?,1)`,
          ).bind(
            uuid(),
            encounterId,
            rubber.key,
            rubber.order,
            rubber.mode,
            rubber.gender,
            rubber.bestOf,
            rubber.pointTarget,
            rubber.scoringMode,
            rubberIndex === 0 ? "ready" : "pending",
            teamNameById.get(plan.entryAId) ?? null,
            teamNameById.get(plan.entryBId) ?? null,
            stamp,
            stamp,
          ),
        );
      });
    });
  });
  statements.push(
    env.HUAU_DB.prepare(`UPDATE tournament_categories SET structure_locked=1,updated_at=?,version=version+1 WHERE id=?`).bind(stamp, categoryId),
  );
  await runBatches(env.HUAU_DB, statements);
  await bumpTournament(env, accessResult.tournament.id);
  await regenerateTournamentScheduleForAdmin(env, accessResult.tournament.id, accessResult.user.id);
  await audit(env, accessResult.tournament, accessResult.user.id, "team.structure.generate", `Generated ${groupCount} Team group(s)`, "category", categoryId, { groupCount });
  return json({ ok: true, groupCount });
}


async function generateFinalPhaseNow(
  request: Request,
  env: Env,
  categoryId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await categoryForAccess(categoryId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const generated = await ensureTeamFinalPhase(env, accessResult.tournament, categoryId, accessResult.user.id);
  if (!generated) {
    const pending = await env.HUAU_DB.prepare(
      `SELECT id FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id
        WHERE c.category_id=? AND ce.stage='group' AND ce.status<>'finished' LIMIT 1`,
    ).bind(categoryId).first();
    if (pending) return json({ ok: false, code: "TEAM_GROUP_STAGE_INCOMPLETE" }, { status: 409 });
  }
  await bumpTournament(env, accessResult.tournament.id);
  return json({ ok: true, generated });
}

async function saveLineup(
  request: Request,
  env: Env,
  encounterId: string,
  entryId: string,
  access: AccessHelpers,
): Promise<Response> {
  const encounter = await env.HUAU_DB.prepare(
    `SELECT ce.id,ce.status,ce.entry_a_id as entryAId,ce.entry_b_id as entryBId,c.category_id as categoryId,tc.tournament_id as tournamentId
       FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id JOIN tournament_categories tc ON tc.id=c.category_id
      WHERE ce.id=? AND tc.entry_type='team'`,
  )
    .bind(encounterId)
    .first<{ id: string; status: string; entryAId: string; entryBId: string; categoryId: string; tournamentId: string }>();
  if (!encounter) return json({ ok: false, code: "TEAM_ENCOUNTER_NOT_FOUND" }, { status: 404 });
  if (entryId !== encounter.entryAId && entryId !== encounter.entryBId) {
    return json({ ok: false, code: "TEAM_LINEUP_ENTRY_MISMATCH" }, { status: 400 });
  }
  const accessResult = await tournamentForAccess(encounter.tournamentId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const body = await readJson<{
    assignments?: TeamLineupAssignment[];
    lock?: boolean;
    administrativeOverride?: boolean;
  }>(request);
  const [format, roster] = await Promise.all([
    formatForCategory(env, encounter.categoryId),
    loadRoster(env, entryId),
  ]);
  const assignments = (body.assignments ?? []).map((assignment) => ({
    rubberKey: String(assignment.rubberKey),
    personIds: Array.isArray(assignment.personIds) ? assignment.personIds.map(String) : [],
  }));
  const validation = validateTeamLineup(format, roster, assignments);
  if (!validation.valid) return json({ ok: false, code: "TEAM_LINEUP_INVALID", issues: validation.issues }, { status: 400 });
  const [current, resultCount] = await Promise.all([
    env.HUAU_DB.prepare(
      `SELECT id,status FROM team_encounter_lineups WHERE encounter_id=? AND entry_id=?`,
    )
      .bind(encounterId, entryId)
      .first<{ id: string; status: "draft" | "locked" }>(),
    env.HUAU_DB.prepare(
      `SELECT COUNT(*) as count FROM match_results mr JOIN matches m ON m.id=mr.match_id WHERE m.encounter_id=? AND mr.result_status IN ('final','corrected')`,
    )
      .bind(encounterId)
      .first<{ count: number }>(),
  ]);
  if (current) {
    const mutationValidation = validateTeamLineupMutation({
      lineupStatus: current.status,
      encounterStatus:
        encounter.status === "in_progress" || encounter.status === "finished" || encounter.status === "skipped"
          ? encounter.status
          : encounter.status === "ready"
            ? "ready"
            : "pending",
      hasResults: Number(resultCount?.count ?? 0) > 0,
      administrativeOverride: Boolean(body.administrativeOverride),
    });
    if (!mutationValidation.valid) {
      return json({ ok: false, code: mutationValidation.issues[0]?.code ?? "TEAM_LINEUP_LOCKED", issues: mutationValidation.issues }, { status: 409 });
    }
  }
  const lineupId = current?.id ?? uuid();
  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [];
  if (current) {
    statements.push(env.HUAU_DB.prepare(`DELETE FROM team_lineup_assignments WHERE lineup_id=?`).bind(lineupId));
    statements.push(
      env.HUAU_DB.prepare(`UPDATE team_encounter_lineups SET status=?,locked_at=?,updated_at=? WHERE id=?`).bind(
        body.lock ? "locked" : "draft",
        body.lock ? stamp : null,
        stamp,
        lineupId,
      ),
    );
  } else {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO team_encounter_lineups (id,encounter_id,entry_id,status,locked_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
      ).bind(lineupId, encounterId, entryId, body.lock ? "locked" : "draft", body.lock ? stamp : null, stamp, stamp),
    );
  }
  assignments.forEach((assignment) => {
    assignment.personIds.forEach((personId, index) => {
      statements.push(
        env.HUAU_DB.prepare(
          `INSERT INTO team_lineup_assignments (id,lineup_id,rubber_key,organization_person_id,position,created_at) VALUES (?,?,?,?,?,?)`,
        ).bind(uuid(), lineupId, assignment.rubberKey, personId, index + 1, stamp),
      );
    });
  });
  await runBatches(env.HUAU_DB, statements);
  await bumpTournament(env, accessResult.tournament.id);
  await audit(env, accessResult.tournament, accessResult.user.id, body.lock ? "team.lineup.lock" : "team.lineup.save", body.lock ? "Locked Team lineup" : "Saved Team lineup", "encounter", encounterId, { entryId });
  return json({ ok: true, lineupId, status: body.lock ? "locked" : "draft" });
}

async function saveTeamMatchResult(
  request: Request,
  env: Env,
  matchId: string,
  access: AccessHelpers,
): Promise<Response> {
  const match = await env.HUAU_DB.prepare(
    `SELECT m.id,m.encounter_id as encounterId,m.rubber_key as rubberKey,m.rubber_order as rubberOrder,m.best_of as bestOf,m.status,
            ce.entry_a_id as entryAId,ce.entry_b_id as entryBId,ce.stage,c.id as competitionId,c.category_id as categoryId,
            tc.tournament_id as tournamentId,f.config_json as configJson
       FROM matches m
       JOIN competition_encounters ce ON ce.id=m.encounter_id
       JOIN competitions c ON c.id=ce.competition_id
       JOIN tournament_categories tc ON tc.id=c.category_id
       JOIN competition_format_versions f ON f.id=c.format_version_id AND f.format_kind='team'
      WHERE m.id=? AND tc.entry_type='team'`,
  )
    .bind(matchId)
    .first<{
      id: string;
      encounterId: string;
      rubberKey: string;
      rubberOrder: number;
      bestOf: number;
      status: string;
      entryAId: string;
      entryBId: string;
      stage: string;
      competitionId: string;
      categoryId: string;
      tournamentId: string;
      configJson: string;
    }>();
  if (!match || !match.rubberKey) return json({ ok: false, code: "TEAM_MATCH_NOT_FOUND" }, { status: 404 });

  const accessResult = await tournamentForAccess(match.tournamentId, request, env, access);
  if (accessResult instanceof Response) return accessResult;

  const body = await readJson<{ sets?: ResultSetInput[] }>(request);
  let outcome: { winnerSide: "A" | "B"; pointsA: number; pointsB: number };
  try {
    outcome = setWinner(body.sets ?? [], match.bestOf);
  } catch (error) {
    return json({ ok: false, code: error instanceof Error ? error.message : "TEAM_RESULT_INVALID" }, { status: 400 });
  }

  const [guards, previousEncounterResults] = await Promise.all([
    env.HUAU_DB.prepare(
      `SELECT
         (SELECT COUNT(DISTINCT tl.entry_id)
            FROM team_encounter_lineups tl
           WHERE tl.encounter_id=? AND tl.status='locked' AND tl.entry_id IN (?,?)) as lockedCount,
         EXISTS(
           SELECT 1 FROM matches lm JOIN match_results lmr ON lmr.match_id=lm.id
            WHERE lm.encounter_id=? AND lm.rubber_order>? AND lmr.result_status IN ('final','corrected')
         ) as laterResult,
         EXISTS(
           SELECT 1 FROM match_results emr
            WHERE emr.match_id=? AND emr.result_status IN ('final','corrected')
         ) as existingResult,
         (SELECT COUNT(*)
            FROM match_results pmr
            JOIN matches pm ON pm.id=pmr.match_id
            JOIN competition_encounters pce ON pce.id=pm.encounter_id
            JOIN competitions pc ON pc.id=pce.competition_id
           WHERE pc.category_id=? AND pmr.result_status IN ('final','corrected')) as previousResultCount`,
    )
      .bind(
        match.encounterId,
        match.entryAId,
        match.entryBId,
        match.encounterId,
        match.rubberOrder,
        matchId,
        match.categoryId,
      )
      .first<{ lockedCount: number; laterResult: number; existingResult: number; previousResultCount: number }>(),
    env.HUAU_DB.prepare(
      `SELECT m.id as matchId,m.rubber_key as rubberKey,m.winner_side as winnerSide,
              mr.score_a as pointsA,mr.score_b as pointsB
         FROM matches m JOIN match_results mr ON mr.match_id=m.id
        WHERE m.encounter_id=? AND mr.result_status IN ('final','corrected')
        ORDER BY m.rubber_order`,
    )
      .bind(match.encounterId)
      .all<{ matchId: string; rubberKey: string; winnerSide: "A" | "B"; pointsA: number; pointsB: number }>(),
  ]);

  if (Number(guards?.lockedCount ?? 0) < 2) {
    return json({ ok: false, code: "TEAM_MATCH_LINEUPS_NOT_LOCKED" }, { status: 409 });
  }

  const existingResult = Boolean(Number(guards?.existingResult ?? 0));
  const laterResult = Boolean(Number(guards?.laterResult ?? 0));

  if (!existingResult && match.status !== "ready") {
    return json({ ok: false, code: "TEAM_MATCH_NOT_READY" }, { status: 409 });
  }

  if (existingResult && (laterResult || await downstreamTeamResultExists(env, match.encounterId))) {
    return json({ ok: false, code: "TEAM_RESULT_CORRECTION_BLOCKED_BY_LATER_RESULT" }, { status: 409 });
  }

  if (existingResult) {
    await snapshotCategoryByIdForAdmin(
      env,
      accessResult.tournament.id,
      match.categoryId,
      accessResult.user.id,
      "Before Team result correction",
    );
  } else if (Number(guards?.previousResultCount ?? 0) === 0) {
    await snapshotCategoryByIdForAdmin(
      env,
      accessResult.tournament.id,
      match.categoryId,
      accessResult.user.id,
      "Before first Team result",
    );
  }

  let format: TeamFormat;
  try {
    format = parseTeamFormat(JSON.parse(match.configJson) as unknown);
  } catch {
    return json({ ok: false, code: "TEAM_FORMAT_NOT_FOUND" }, { status: 409 });
  }

  const scoringResults: TeamRubberResult[] = previousEncounterResults.results
    .filter((row) => row.matchId !== match.id)
    .map((row) => ({
      rubberKey: row.rubberKey,
      winnerSide: row.winnerSide,
      pointsA: Number(row.pointsA),
      pointsB: Number(row.pointsB),
    }));

  scoringResults.push({
    rubberKey: match.rubberKey,
    winnerSide: outcome.winnerSide,
    pointsA: outcome.pointsA,
    pointsB: outcome.pointsB,
  });

  let score;
  try {
    score = scoreTeamEncounter({
      format,
      entryAId: match.entryAId,
      entryBId: match.entryBId,
      results: scoringResults,
    });
  } catch (error) {
    return json({ ok: false, code: error instanceof Error ? error.message : "TEAM_ENCOUNTER_SCORE_INVALID" }, { status: 409 });
  }

  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`DELETE FROM match_side_members WHERE match_id=?`).bind(matchId),
    env.HUAU_DB.prepare(
      `INSERT INTO match_side_members (match_id,side,organization_person_id,position)
       SELECT ?,'A',tla.organization_person_id,tla.position
         FROM team_encounter_lineups tl
         JOIN team_lineup_assignments tla ON tla.lineup_id=tl.id
        WHERE tl.encounter_id=? AND tl.entry_id=? AND tl.status='locked' AND tla.rubber_key=?
        ORDER BY tla.position`,
    ).bind(matchId, match.encounterId, match.entryAId, match.rubberKey),
    env.HUAU_DB.prepare(
      `INSERT INTO match_side_members (match_id,side,organization_person_id,position)
       SELECT ?,'B',tla.organization_person_id,tla.position
         FROM team_encounter_lineups tl
         JOIN team_lineup_assignments tla ON tla.lineup_id=tl.id
        WHERE tl.encounter_id=? AND tl.entry_id=? AND tl.status='locked' AND tla.rubber_key=?
        ORDER BY tla.position`,
    ).bind(matchId, match.encounterId, match.entryBId, match.rubberKey),
    env.HUAU_DB.prepare(`DELETE FROM match_sets WHERE match_id=?`).bind(matchId),
    env.HUAU_DB.prepare(
      `INSERT INTO match_results (match_id,score_a,score_b,winner_side,result_status,entered_by_user_id,entered_at,corrected_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(match_id) DO UPDATE SET score_a=excluded.score_a,score_b=excluded.score_b,winner_side=excluded.winner_side,
         result_status='corrected',corrected_at=excluded.updated_at,updated_at=excluded.updated_at`,
    ).bind(
      matchId,
      outcome.pointsA,
      outcome.pointsB,
      outcome.winnerSide,
      existingResult ? "corrected" : "final",
      accessResult.user.id,
      stamp,
      existingResult ? stamp : null,
      stamp,
    ),
    env.HUAU_DB.prepare(`UPDATE matches SET status='finished',winner_side=?,updated_at=?,version=version+1 WHERE id=?`)
      .bind(outcome.winnerSide, stamp, matchId),
    env.HUAU_DB.prepare(`UPDATE schedule_items SET status='completed',updated_at=?,version=version+1 WHERE match_id=?`)
      .bind(stamp, matchId),
  ];

  (body.sets ?? []).forEach((set, index) => {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO match_sets (id,match_id,set_number,score_a,score_b,winner_side) VALUES (?,?,?,?,?,?)`,
      ).bind(
        uuid(),
        matchId,
        index + 1,
        set.scoreA,
        set.scoreB,
        set.scoreA > set.scoreB ? "A" : "B",
      ),
    );
  });

  score.rubbers.forEach((rubber) => {
    if (rubber.status === "finished") return;
    statements.push(
      env.HUAU_DB.prepare(
        `UPDATE matches SET status=?,winner_side=NULL,updated_at=?,version=version+1
          WHERE encounter_id=? AND rubber_key=?`,
      ).bind(rubber.status, stamp, match.encounterId, rubber.definition.key),
      env.HUAU_DB.prepare(
        `UPDATE schedule_items SET status=?,updated_at=?,version=version+1
          WHERE match_id=(SELECT id FROM matches WHERE encounter_id=? AND rubber_key=? LIMIT 1)`,
      ).bind(
        rubber.status === "skipped" ? "cancelled" : "bound",
        stamp,
        match.encounterId,
        rubber.definition.key,
      ),
    );
  });

  statements.push(
    env.HUAU_DB.prepare(
      `UPDATE competition_encounters SET status=?,winner_entry_id=?,updated_at=?,version=version+1 WHERE id=?`,
    ).bind(
      score.complete ? "finished" : "in_progress",
      score.winnerEntryId,
      stamp,
      match.encounterId,
    ),
  );

  await runBatches(env.HUAU_DB, statements);

  if (score.complete) {
    if (match.stage === "group") {
      await ensureTeamFinalPhase(env, accessResult.tournament, match.categoryId, accessResult.user.id);
    } else {
      await progressTeamFinalPhase(env, match.competitionId);
    }
  }

  await bumpTournamentAndAudit(
    env,
    accessResult.tournament,
    accessResult.user.id,
    existingResult ? "team.result.correct" : "team.result.save",
    `${existingResult ? "Corrected" : "Saved"} Team rubber result`,
    "match",
    matchId,
    { encounterId: match.encounterId, rubberKey: match.rubberKey },
  );

  return json({ ok: true, score });
}

async function teamDetail(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await tournamentForAccess(tournamentId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const [categories, profiles, entries, members, groups, encounters, matches, lineups, assignments, sets] = await Promise.all([
    env.HUAU_DB.prepare(
      `SELECT tc.id,tc.name,tc.scheduled_date as scheduledDate,tc.structure_locked as structureLocked,tc.format_version_id as formatVersionId,
              c.status as competitionStatus,f.config_json as configJson,
              (SELECT COUNT(*) FROM tournament_entries e WHERE e.category_id=tc.id AND e.status IN ('ready','confirmed')) as entryCount
         FROM tournament_categories tc LEFT JOIN competition_format_versions f ON f.id=tc.format_version_id
         LEFT JOIN competitions c ON c.category_id=tc.id
        WHERE tc.tournament_id=? AND tc.entry_type='team' ORDER BY tc.sort_order,tc.name`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT p.id as profileId,p.organization_person_id as personId,p.display_name as displayName,p.club,p.player_status as playerStatus,
              COALESCE(op.sport_gender,'unspecified') as sportGender
         FROM tournament_player_profiles p LEFT JOIN organization_people op ON op.id=p.organization_person_id
        WHERE p.tournament_id=? AND p.organization_person_id IS NOT NULL AND p.player_status='confirmed' ORDER BY p.sort_order,p.display_name`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT e.id,e.category_id as categoryId,e.display_name as displayName,e.status,e.created_at as createdAt
         FROM tournament_entries e JOIN tournament_categories tc ON tc.id=e.category_id
        WHERE tc.tournament_id=? AND e.entry_type='team' AND e.status NOT IN ('withdrawn','rejected') ORDER BY e.created_at,e.display_name`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT em.entry_id as entryId,em.organization_person_id as personId,em.member_role as role,em.roster_slot as rosterSlot,
              TRIM(op.first_name || ' ' || op.last_name) as name,COALESCE(op.sport_gender,'unspecified') as sportGender
         FROM entry_members em JOIN tournament_entries e ON e.id=em.entry_id JOIN tournament_categories tc ON tc.id=e.category_id
         JOIN organization_people op ON op.id=em.organization_person_id
        WHERE tc.tournament_id=? AND e.entry_type='team' AND e.status NOT IN ('withdrawn','rejected') AND em.status IN ('accepted','manual')
        ORDER BY e.created_at,CAST(COALESCE(em.roster_slot,'999') AS INTEGER),em.created_at`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT g.id,g.name,c.category_id as categoryId,ge.entry_id as entryId,e.display_name as entryName,ge.sort_order as sortOrder
         FROM competition_groups g JOIN competitions c ON c.id=g.competition_id JOIN tournament_categories tc ON tc.id=c.category_id
         LEFT JOIN competition_group_entries ge ON ge.group_id=g.id LEFT JOIN tournament_entries e ON e.id=ge.entry_id
        WHERE tc.tournament_id=? AND tc.entry_type='team' ORDER BY c.category_id,g.sort_order,ge.sort_order`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT ce.id,c.category_id as categoryId,ce.stage,ce.round_label as roundLabel,ce.round_number as roundNumber,ce.group_id as groupId,g.name as groupName,ce.leg_number as legNumber,
              ce.entry_a_id as entryAId,ea.display_name as sideA,ce.entry_b_id as entryBId,eb.display_name as sideB,
              ce.status,ce.winner_entry_id as winnerEntryId
         FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id JOIN tournament_categories tc ON tc.id=c.category_id
         LEFT JOIN competition_groups g ON g.id=ce.group_id LEFT JOIN tournament_entries ea ON ea.id=ce.entry_a_id LEFT JOIN tournament_entries eb ON eb.id=ce.entry_b_id
        WHERE tc.tournament_id=? AND tc.entry_type='team' ORDER BY c.category_id,g.sort_order,ce.leg_number,ce.round_number,ce.created_at`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT m.id,m.encounter_id as encounterId,m.rubber_key as rubberKey,m.rubber_order as rubberOrder,m.mode,m.competition_gender as competitionGender,
              m.best_of as bestOf,m.point_target as pointTarget,m.status,m.winner_side as winnerSide,
              mr.score_a as scoreA,mr.score_b as scoreB,mr.result_status as resultStatus,
              si.start_at as scheduleStart,si.end_at as scheduleEnd,si.court_label as courtLabel,si.status as scheduleStatus
         FROM matches m JOIN competition_encounters ce ON ce.id=m.encounter_id JOIN competitions c ON c.id=ce.competition_id
         JOIN tournament_categories tc ON tc.id=c.category_id LEFT JOIN match_results mr ON mr.match_id=m.id
         LEFT JOIN schedule_items si ON si.match_id=m.id
        WHERE tc.tournament_id=? AND tc.entry_type='team' ORDER BY COALESCE(si.start_at,9223372036854775807),m.encounter_id,m.rubber_order`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT tl.id,tl.encounter_id as encounterId,tl.entry_id as entryId,tl.status,tl.locked_at as lockedAt
         FROM team_encounter_lineups tl JOIN competition_encounters ce ON ce.id=tl.encounter_id JOIN competitions c ON c.id=ce.competition_id
         JOIN tournament_categories tc ON tc.id=c.category_id WHERE tc.tournament_id=? ORDER BY tl.encounter_id,tl.entry_id`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT tla.lineup_id as lineupId,tla.rubber_key as rubberKey,tla.organization_person_id as personId,tla.position
         FROM team_lineup_assignments tla JOIN team_encounter_lineups tl ON tl.id=tla.lineup_id JOIN competition_encounters ce ON ce.id=tl.encounter_id
         JOIN competitions c ON c.id=ce.competition_id JOIN tournament_categories tc ON tc.id=c.category_id
        WHERE tc.tournament_id=? ORDER BY tla.lineup_id,tla.rubber_key,tla.position`,
    ).bind(tournamentId).all(),
    env.HUAU_DB.prepare(
      `SELECT s.match_id as matchId,s.set_number as setNumber,s.score_a as scoreA,s.score_b as scoreB,s.winner_side as winnerSide
         FROM match_sets s JOIN matches m ON m.id=s.match_id JOIN competition_encounters ce ON ce.id=m.encounter_id JOIN competitions c ON c.id=ce.competition_id
         JOIN tournament_categories tc ON tc.id=c.category_id WHERE tc.tournament_id=? AND tc.entry_type='team' ORDER BY s.match_id,s.set_number`,
    ).bind(tournamentId).all(),
  ]);

  const categoryRows = categories.results as Array<{ id: string; name: string; scheduledDate: string | null; structureLocked: number; formatVersionId: string | null; competitionStatus: string | null; configJson: string | null; entryCount: number }>;
  const entryRows = entries.results as Array<EntryRow & { createdAt: number }>;
  const memberRows = members.results as Array<{ entryId: string; personId: string; role: "player" | "captain" | "substitute"; rosterSlot: string | null; name: string; sportGender: string }>;
  const encounterRows = encounters.results as Array<{ id: string; categoryId: string; stage: "group" | "playoff" | "bronze" | "final"; roundLabel: string | null; roundNumber: number | null; groupId: string | null; groupName: string | null; legNumber: number; entryAId: string; sideA: string; entryBId: string; sideB: string; status: string; winnerEntryId: string | null }>;
  const matchRows = matches.results as Array<{ id: string; encounterId: string; rubberKey: string; rubberOrder: number; mode: string; competitionGender: string; bestOf: number; pointTarget: number; status: string; winnerSide: "A" | "B" | null; scoreA: number | null; scoreB: number | null; resultStatus: string | null; scheduleStart: number | null; scheduleEnd: number | null; courtLabel: string | null; scheduleStatus: string | null }>;
  const lineupRows = lineups.results as Array<{ id: string; encounterId: string; entryId: string; status: string; lockedAt: number | null }>;
  const assignmentRows = assignments.results as Array<{ lineupId: string; rubberKey: string; personId: string; position: number }>;
  const setRows = sets.results as Array<{ matchId: string; setNumber: number; scoreA: number; scoreB: number; winnerSide: string }>;

  const serializedCategories = [];
  for (const category of categoryRows) {
    let format: TeamFormat | null = null;
    try {
      format = category.configJson ? parseTeamFormat(JSON.parse(category.configJson) as unknown) : null;
    } catch {
      format = null;
    }
    const categoryEntries = entryRows
      .filter((entry) => entry.categoryId === category.id)
      .map((entry) => ({
        ...entry,
        roster: memberRows
          .filter((member) => member.entryId === entry.id)
          .map((member) => ({
            personId: member.personId,
            name: member.name,
            role: member.role,
            sportGender: (member.sportGender === "male" || member.sportGender === "female" ? member.sportGender : "unspecified") as TeamSportGender,
          })),
      }));
    const categoryEncounters = encounterRows.filter((encounter) => encounter.categoryId === category.id).map((encounter) => ({
      ...encounter,
      matches: matchRows.filter((match) => match.encounterId === encounter.id).map((match) => ({
        ...match,
        sets: setRows.filter((set) => set.matchId === match.id),
      })),
      lineups: lineupRows.filter((lineup) => lineup.encounterId === encounter.id).map((lineup) => ({
        ...lineup,
        assignments: assignmentRows.filter((assignment) => assignment.lineupId === lineup.id),
      })),
    }));
    const categoryGroups = (groups.results as Array<{ id: string; name: string; categoryId: string; entryId: string | null; entryName: string | null; sortOrder: number | null }>)
      .filter((group) => group.categoryId === category.id);
    const standings = [];
    if (format) {
      const entryById = new Map(categoryEntries.map((entry) => [entry.id, entry] as const));
      const groupIds = [...new Set(categoryGroups.map((group) => group.id))];
      for (const groupId of groupIds) {
        const groupName = categoryGroups.find((group) => group.id === groupId)?.name ?? "";
        const groupEntries: TeamEntry[] = categoryGroups
          .filter((group) => group.id === groupId && group.entryId)
          .map((group) => entryById.get(group.entryId!))
          .filter((entry): entry is (typeof categoryEntries)[number] => Boolean(entry))
          .map((entry) => ({ id: entry.id, name: entry.displayName, roster: entry.roster }));
        const standingEncounters: TeamStandingEncounter[] = [];
        categoryEncounters
          .filter((encounter) => encounter.groupId === groupId && encounter.status === "finished" && encounter.winnerEntryId)
          .forEach((encounter) => {
            const finished = encounter.matches.filter((match) => match.resultStatus === "final" || match.resultStatus === "corrected");
            standingEncounters.push({
              id: encounter.id,
              entryAId: encounter.entryAId,
              entryBId: encounter.entryBId,
              winnerEntryId: encounter.winnerEntryId!,
              rubbersWonA: finished.filter((match) => match.winnerSide === "A").length,
              rubbersWonB: finished.filter((match) => match.winnerSide === "B").length,
              pointsA: finished.reduce((sum, match) => sum + Number(match.scoreA ?? 0), 0),
              pointsB: finished.reduce((sum, match) => sum + Number(match.scoreB ?? 0), 0),
            });
          });
        standings.push({ groupId, groupName, ...calculateTeamStandings({ entries: groupEntries, encounters: standingEncounters, criteria: format.standings.criteria }) });
      }
    }
    serializedCategories.push({ ...category, format, entries: categoryEntries, groups: categoryGroups, encounters: categoryEncounters, standings });
  }

  return json({ ok: true, profiles: profiles.results, categories: serializedCategories });
}

export async function handleTeamAdminApi(
  request: Request,
  env: Env,
  url: URL,
  access: AccessHelpers,
): Promise<Response | null> {
  const detailRoute = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/team$/);
  if (detailRoute && request.method === "GET") return teamDetail(request, env, decodeURIComponent(detailRoute[1]!), access);

  const categoryCreate = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/team\/categories$/);
  if (categoryCreate && request.method === "POST") return createTeamCategory(request, env, decodeURIComponent(categoryCreate[1]!), access);

  const formatRoute = url.pathname.match(/^\/api\/admin\/team-categories\/([^/]+)\/format$/);
  if (formatRoute && request.method === "PUT") return saveFormat(request, env, decodeURIComponent(formatRoute[1]!), access);

  const teamsRoute = url.pathname.match(/^\/api\/admin\/team-categories\/([^/]+)\/teams$/);
  if (teamsRoute && request.method === "POST") return createTeam(request, env, decodeURIComponent(teamsRoute[1]!), access);

  const teamRoute = url.pathname.match(/^\/api\/admin\/team-entries\/([^/]+)$/);
  if (teamRoute && request.method === "PUT") return updateTeam(request, env, decodeURIComponent(teamRoute[1]!), access);
  if (teamRoute && request.method === "DELETE") return deleteTeam(request, env, decodeURIComponent(teamRoute[1]!), access);

  const generateRoute = url.pathname.match(/^\/api\/admin\/team-categories\/([^/]+)\/generate$/);
  if (generateRoute && request.method === "POST") return generateStructure(request, env, decodeURIComponent(generateRoute[1]!), access);

  const finalsRoute = url.pathname.match(/^\/api\/admin\/team-categories\/([^/]+)\/finals\/generate$/);
  if (finalsRoute && request.method === "POST") return generateFinalPhaseNow(request, env, decodeURIComponent(finalsRoute[1]!), access);

  const lineupRoute = url.pathname.match(/^\/api\/admin\/team-encounters\/([^/]+)\/lineups\/([^/]+)$/);
  if (lineupRoute && request.method === "PUT") {
    return saveLineup(request, env, decodeURIComponent(lineupRoute[1]!), decodeURIComponent(lineupRoute[2]!), access);
  }

  const resultRoute = url.pathname.match(/^\/api\/admin\/team-matches\/([^/]+)\/result$/);
  if (resultRoute && request.method === "POST") return saveTeamMatchResult(request, env, decodeURIComponent(resultRoute[1]!), access);

  return null;
}
