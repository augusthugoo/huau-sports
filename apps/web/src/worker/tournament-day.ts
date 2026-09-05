import {
  normalizeStandardFormat,
  parseTeamFormat,
  validateTeamRoster,
  type TeamRosterMember,
} from "@huau/core";
import { tournamentDayWorkspaceBundleForAdmin } from "./tournament-admin";
import { tournamentDayTeamBundleForAdmin } from "./team-admin";

type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isOrgAdmin: (
    userId: string,
    organizationId: string,
    env: Env,
    request?: Request,
  ) => Promise<boolean>;
};

type TournamentAccessRow = {
  id: string;
  organizerOrganizationId: string;
  name: string;
  workingRevision: number;
  createdByUserId: string;
};

type DaySyncStatus = "idle" | "syncing" | "synced" | "failed";

type DayStateRow = {
  tournamentId: string;
  tokenHash: string | null;
  snapshotR2Key: string | null;
  publishedRevision: number;
  publishedAt: number | null;
  finalizedAt: number | null;
  createdByUserId: string | null;
  syncStatus: DaySyncStatus;
  syncedRevision: number;
  syncedAt: number | null;
  syncError: string | null;
};

type DaySnapshot = {
  schemaVersion: 1;
  tournamentId: string;
  baseRevision: number;
  createdAt: number;
  workspace: {
    core: {
      tournament: Record<string, unknown>;
      settings: Record<string, unknown>;
      categories: Array<Record<string, unknown>>;
      summary: Record<string, unknown>;
    };
    participants: {
      players: Array<Record<string, unknown>>;
      playerCategories: Array<Record<string, unknown>>;
    };
    standard: {
      entries: Array<Record<string, unknown>>;
      groups: Array<Record<string, unknown>>;
      matches: Array<Record<string, unknown>>;
      drawSessions: Array<Record<string, unknown>>;
      standings: Array<Record<string, unknown>>;
      crossGroup: Array<Record<string, unknown>>;
      categoryProgress: Array<Record<string, unknown>>;
      competitions: Array<Record<string, unknown>>;
    };
    schedule: {
      schedule: Array<Record<string, unknown>>;
    };
  };
  team: {
    profiles: Array<Record<string, unknown>>;
    categories: Array<Record<string, unknown>>;
  };
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

const unixNow = () => Math.floor(Date.now() / 1000);
const uuid = () => crypto.randomUUID();

async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 70) {
    await db.batch(statements.slice(index, index + 70));
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  const result = stringValue(value).trim();
  return result ? result : null;
}

function allowed<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function localSource(value: string, prefixes: string[]) {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function scopedEntityKey(categoryId: string, entityId: string) {
  return `${categoryId}\u0000${entityId}`;
}

async function tournamentForAdmin(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
): Promise<{ user: CurrentUser; tournament: TournamentAccessRow } | Response> {
  const [user, tournament] = await Promise.all([
    access.requireUser(request, env),
    env.HUAU_DB.prepare(
      `SELECT id,organizer_organization_id as organizerOrganizationId,name,
              working_revision as workingRevision,created_by_user_id as createdByUserId
         FROM tournaments WHERE id=?`,
    )
      .bind(tournamentId)
      .first<TournamentAccessRow>(),
  ]);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (!tournament) return json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });
  if (!(await access.isOrgAdmin(user.id, tournament.organizerOrganizationId, env, request))) {
    return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  return { user, tournament };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function stableDayId(tournamentId: string, kind: string, sourceId: string) {
  if (!sourceId || sourceId.length > 300) throw new Error("TOURNAMENT_DAY_ENTITY_ID_INVALID");
  const digest = await sha256(`${tournamentId}:${kind}:${sourceId}`);
  return `day-${kind}-${digest.slice(0, 32)}`;
}

function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function snapshotShape(value: unknown, tournamentId: string): DaySnapshot {
  const root = record(value);
  const workspace = record(root.workspace);
  const core = record(workspace.core);
  const participants = record(workspace.participants);
  const standard = record(workspace.standard);
  const schedule = record(workspace.schedule);
  const team = record(root.team);
  if (
    root.schemaVersion !== 1 ||
    root.tournamentId !== tournamentId ||
    !Object.keys(core).length ||
    !Object.keys(participants).length ||
    !Object.keys(standard).length
  ) {
    throw new Error("TOURNAMENT_DAY_SNAPSHOT_INVALID");
  }
  return {
    schemaVersion: 1,
    tournamentId,
    baseRevision: numberValue(root.baseRevision),
    createdAt: numberValue(root.createdAt, Date.now()),
    workspace: {
      core: {
        tournament: record(core.tournament),
        settings: record(core.settings),
        categories: rows(core.categories),
        summary: record(core.summary),
      },
      participants: {
        players: rows(participants.players),
        playerCategories: rows(participants.playerCategories),
      },
      standard: {
        entries: rows(standard.entries),
        groups: rows(standard.groups),
        matches: rows(standard.matches),
        drawSessions: rows(standard.drawSessions),
        standings: rows(standard.standings),
        crossGroup: rows(standard.crossGroup),
        categoryProgress: rows(standard.categoryProgress),
        competitions: rows(standard.competitions),
      },
      schedule: {
        schedule: rows(schedule.schedule),
      },
    },
    team: {
      profiles: rows(team.profiles),
      categories: rows(team.categories),
    },
  };
}

async function dayState(env: Env, tournamentId: string) {
  return env.HUAU_DB.prepare(
    `SELECT tournament_id as tournamentId,token_hash as tokenHash,
            snapshot_r2_key as snapshotR2Key,published_revision as publishedRevision,
            published_at as publishedAt,finalized_at as finalizedAt,
            created_by_user_id as createdByUserId,
            COALESCE(sync_status,'idle') as syncStatus,
            COALESCE(synced_revision,0) as syncedRevision,
            synced_at as syncedAt,sync_error as syncError
       FROM tournament_day_state WHERE tournament_id=?`,
  )
    .bind(tournamentId)
    .first<DayStateRow>();
}

async function dayStateByToken(env: Env, token: string) {
  const hash = await sha256(token);
  return env.HUAU_DB.prepare(
    `SELECT tournament_id as tournamentId,token_hash as tokenHash,
            snapshot_r2_key as snapshotR2Key,published_revision as publishedRevision,
            published_at as publishedAt,finalized_at as finalizedAt,
            created_by_user_id as createdByUserId,
            COALESCE(sync_status,'idle') as syncStatus,
            COALESCE(synced_revision,0) as syncedRevision,
            synced_at as syncedAt,sync_error as syncError
       FROM tournament_day_state WHERE token_hash=?`,
  )
    .bind(hash)
    .first<DayStateRow>();
}

async function putSnapshot(
  env: Env,
  input: {
    tournamentId: string;
    snapshot: unknown;
    actorUserId: string | null;
    finalized: boolean;
    basePublishedRevision: number;
  },
) {
  let snapshot: DaySnapshot;
  try {
    snapshot = snapshotShape(input.snapshot, input.tournamentId);
  } catch (error) {
    return {
      response: json(
        {
          ok: false,
          code: error instanceof Error ? error.message : "TOURNAMENT_DAY_SNAPSHOT_INVALID",
        },
        { status: 400 },
      ),
    };
  }

  const serialized = JSON.stringify(snapshot);
  if (serialized.length > 20_000_000) {
    return {
      response: json(
        { ok: false, code: "TOURNAMENT_DAY_SNAPSHOT_TOO_LARGE" },
        { status: 413 },
      ),
    };
  }

  const current = await dayState(env, input.tournamentId);
  const currentRevision = Number(current?.publishedRevision ?? 0);
  if (Number(input.basePublishedRevision) !== currentRevision) {
    return {
      response: json(
        {
          ok: false,
          code: "TOURNAMENT_DAY_PUBLISH_CONFLICT",
          serverPublishedRevision: currentRevision,
        },
        { status: 409 },
      ),
    };
  }

  const revision = currentRevision + 1;
  const stamp = unixNow();
  const key = `tournaments/${input.tournamentId}/day/checkpoints/${revision}-${uuid()}.json`;
  await env.HUAU_ASSETS.put(key, serialized, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      tournamentId: input.tournamentId,
      publishedRevision: String(revision),
      finalized: input.finalized ? "1" : "0",
    },
  });

  let writeResult: D1Result<unknown>;
  try {
    writeResult = await env.HUAU_DB.prepare(
      `INSERT INTO tournament_day_state
         (tournament_id,token_hash,snapshot_r2_key,published_revision,published_at,finalized_at,
          created_by_user_id,sync_status,synced_revision,synced_at,sync_error,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(tournament_id) DO UPDATE SET
         snapshot_r2_key=excluded.snapshot_r2_key,
         published_revision=excluded.published_revision,
         published_at=excluded.published_at,
         finalized_at=excluded.finalized_at,
         created_by_user_id=COALESCE(tournament_day_state.created_by_user_id,excluded.created_by_user_id),
         sync_status='idle',
         sync_error=NULL,
         updated_at=excluded.updated_at
       WHERE tournament_day_state.published_revision=?`,
    )
      .bind(
        input.tournamentId,
        current?.tokenHash ?? null,
        key,
        revision,
        stamp,
        input.finalized ? stamp : null,
        current?.createdByUserId ?? input.actorUserId,
        "idle",
        Number(current?.syncedRevision ?? 0),
        current?.syncedAt ?? null,
        null,
        stamp,
        stamp,
        currentRevision,
      )
      .run();
  } catch (error) {
    await env.HUAU_ASSETS.delete(key).catch(() => undefined);
    throw error;
  }

  if (Number(writeResult.meta.changes ?? 0) !== 1) {
    await env.HUAU_ASSETS.delete(key).catch(() => undefined);
    const latest = await dayState(env, input.tournamentId);
    return {
      response: json(
        {
          ok: false,
          code: "TOURNAMENT_DAY_PUBLISH_CONFLICT",
          serverPublishedRevision: Number(latest?.publishedRevision ?? currentRevision),
        },
        { status: 409 },
      ),
    };
  }

  if (current?.snapshotR2Key && current.snapshotR2Key !== key) {
    await env.HUAU_ASSETS.delete(current.snapshotR2Key).catch(() => undefined);
  }

  return {
    snapshot,
    revision,
    publishedAt: stamp,
    finalizedAt: input.finalized ? stamp : null,
  };
}

async function publishedSnapshotBundle(env: Env, state: DayStateRow) {
  if (!state.snapshotR2Key) throw new Error("TOURNAMENT_DAY_SNAPSHOT_NOT_PUBLISHED");
  const object = await env.HUAU_ASSETS.get(state.snapshotR2Key);
  if (!object) throw new Error("TOURNAMENT_DAY_SNAPSHOT_MISSING");
  const parsed = JSON.parse(await object.text()) as unknown;
  return {
    snapshot: snapshotShape(parsed, state.tournamentId),
    publishedRevision: Number(state.publishedRevision ?? 0),
    finalizedAt: state.finalizedAt ?? null,
    syncStatus: state.syncStatus,
    syncError: state.syncError,
  };
}

async function markSync(
  env: Env,
  tournamentId: string,
  status: DaySyncStatus,
  input: { revision?: number; error?: string | null } = {},
) {
  const stamp = unixNow();
  await env.HUAU_DB.prepare(
    `UPDATE tournament_day_state
        SET sync_status=?,
            synced_revision=CASE WHEN ?='synced' THEN ? ELSE synced_revision END,
            synced_at=CASE WHEN ?='synced' THEN ? ELSE synced_at END,
            sync_error=?,
            updated_at=?
      WHERE tournament_id=?`,
  )
    .bind(
      status,
      status,
      Number(input.revision ?? 0),
      status,
      stamp,
      status === "failed" ? (input.error ?? "TOURNAMENT_DAY_SYNC_FAILED").slice(0, 1000) : null,
      stamp,
      tournamentId,
    )
    .run();
}

function splitName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "Jugador",
    lastName: parts.slice(1).join(" "),
  };
}

function competitionComplete(snapshot: DaySnapshot) {
  const completeStatuses = new Set(["finished", "bye", "skipped"]);
  const standardCompetitionByCategory = new Map(
    snapshot.workspace.standard.competitions.map((competition) => [
      stringValue(competition.categoryId),
      competition,
    ] as const),
  );
  const standardEntryCountByCategory = new Map<string, number>();
  snapshot.workspace.standard.entries.forEach((entry) => {
    const categoryId = stringValue(entry.categoryId);
    const status = stringValue(entry.status);
    if (!categoryId || status === "withdrawn" || status === "rejected") return;
    standardEntryCountByCategory.set(
      categoryId,
      (standardEntryCountByCategory.get(categoryId) ?? 0) + 1,
    );
  });

  for (const category of snapshot.workspace.core.categories) {
    const categoryId = stringValue(category.id);
    const entryType = stringValue(category.entryType);
    if (!categoryId || entryType === "team") continue;
    if ((standardEntryCountByCategory.get(categoryId) ?? 0) < 2) continue;
    const competition = standardCompetitionByCategory.get(categoryId);
    const encounters = competition ? rows(competition.encounters) : [];
    if (!competition || !encounters.length) return false;
    if (
      encounters.some(
        (encounter) => !completeStatuses.has(stringValue(encounter.status, "pending")),
      )
    ) return false;
  }

  for (const category of snapshot.team.categories) {
    const entries = rows(category.entries).filter(
      (entry) => !["withdrawn", "rejected"].includes(stringValue(entry.status)),
    );
    if (entries.length < 2) continue;
    const encounters = rows(category.encounters);
    if (!encounters.length) return false;
    if (
      encounters.some(
        (encounter) => !completeStatuses.has(stringValue(encounter.status, "pending")),
      )
    ) return false;
  }
  return true;
}

async function syncFinalizedSnapshot(
  env: Env,
  tournamentId: string,
  snapshot: DaySnapshot,
  actorUserId: string,
  publishedRevision: number,
) {
  if (!competitionComplete(snapshot)) throw new Error("TOURNAMENT_DAY_NOT_COMPLETE");

  const tournament = await env.HUAU_DB.prepare(
    `SELECT id,organizer_organization_id as organizationId,created_by_user_id as createdByUserId,
            working_revision as workingRevision
       FROM tournaments WHERE id=?`,
  )
    .bind(tournamentId)
    .first<{
      id: string;
      organizationId: string;
      createdByUserId: string;
      workingRevision: number;
    }>();
  if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
  const effectiveActor = actorUserId || tournament.createdByUserId;
  const stamp = unixNow();

  const [existingCategoriesResult, existingEntriesResult, existingPlayersResult, existingPeopleResult, maxFormatsResult] =
    await Promise.all([
      env.HUAU_DB.prepare(
        `SELECT id,name,entry_type as entryType
           FROM tournament_categories WHERE tournament_id=?`,
      )
        .bind(tournamentId)
        .all<{ id: string; name: string; entryType: string }>(),
      env.HUAU_DB.prepare(
        `SELECT e.id,e.category_id as categoryId
           FROM tournament_entries e
           JOIN tournament_categories tc ON tc.id=e.category_id
          WHERE tc.tournament_id=?`,
      )
        .bind(tournamentId)
        .all<{ id: string; categoryId: string }>(),
      env.HUAU_DB.prepare(
        `SELECT id,organization_person_id as organizationPersonId
           FROM tournament_player_profiles WHERE tournament_id=?`,
      )
        .bind(tournamentId)
        .all<{ id: string; organizationPersonId: string | null }>(),
      env.HUAU_DB.prepare(
        `SELECT id FROM organization_people WHERE organization_id=?`,
      )
        .bind(tournament.organizationId)
        .all<{ id: string }>(),
      env.HUAU_DB.prepare(
        `SELECT fv.category_id as categoryId,MAX(fv.version_number) as maxVersion
           FROM competition_format_versions fv
           JOIN tournament_categories tc ON tc.id=fv.category_id
          WHERE tc.tournament_id=?
          GROUP BY fv.category_id`,
      )
        .bind(tournamentId)
        .all<{ categoryId: string; maxVersion: number }>(),
    ]);

  const existingCategoryById = new Map(
    existingCategoriesResult.results.map((row) => [row.id, row] as const),
  );
  const existingCategoryByName = new Map(
    existingCategoriesResult.results.map((row) => [row.name.trim().toLowerCase(), row] as const),
  );
  const existingEntryById = new Map(
    existingEntriesResult.results.map((row) => [row.id, row] as const),
  );
  const existingPlayerById = new Map(
    existingPlayersResult.results.map((row) => [row.id, row] as const),
  );
  const existingPeople = new Set(existingPeopleResult.results.map((row) => row.id));
  const maxFormatVersion = new Map(
    maxFormatsResult.results.map((row) => [row.categoryId, Number(row.maxVersion ?? 0)] as const),
  );

  const categoryMap = new Map<string, string>();
  const categorySnapshotBySource = new Map<string, Record<string, unknown>>();
  const localCategoryStatements: D1PreparedStatement[] = [];

  for (const category of snapshot.workspace.core.categories) {
    const sourceId = stringValue(category.id);
    if (!sourceId) throw new Error("TOURNAMENT_DAY_CATEGORY_ID_REQUIRED");
    categorySnapshotBySource.set(sourceId, category);
    const existing = existingCategoryById.get(sourceId);
    if (existing) {
      categoryMap.set(sourceId, sourceId);
      continue;
    }
    if (!localSource(sourceId, ["local-category:"])) {
      throw new Error(`TOURNAMENT_DAY_CATEGORY_UNKNOWN:${sourceId}`);
    }
    const mappedId = await stableDayId(tournamentId, "category", sourceId);
    const previouslySynced = existingCategoryById.get(mappedId);
    if (previouslySynced) {
      categoryMap.set(sourceId, mappedId);
      continue;
    }
    const name = stringValue(category.name).trim();
    if (!name) throw new Error("TOURNAMENT_DAY_CATEGORY_NAME_REQUIRED");
    const collision = existingCategoryByName.get(name.toLowerCase());
    if (collision && collision.id !== mappedId) {
      throw new Error(`TOURNAMENT_DAY_CATEGORY_NAME_CONFLICT:${name}`);
    }
    if (collision?.id === mappedId) {
      categoryMap.set(sourceId, mappedId);
      continue;
    }
    categoryMap.set(sourceId, mappedId);
    const entryType = allowed(category.entryType, ["individual", "pair", "team"] as const, "individual");
    const gender = allowed(
      category.competitionGender,
      ["male", "female", "mixed", "open"] as const,
      "open",
    );
    const registrationStatus = allowed(
      category.registrationStatus,
      ["closed", "open", "waitlist_only"] as const,
      "closed",
    );
    const priceScope = allowed(
      category.priceScope,
      ["free", "per_entry", "per_person"] as const,
      "free",
    );
    localCategoryStatements.push(
      env.HUAU_DB.prepare(
        `INSERT OR IGNORE INTO tournament_categories
         (id,tournament_id,name,entry_type,competition_gender,min_age,max_age,max_entries,
          registration_status,price_scope,price_minor,currency,format_version_id,scheduled_date,
          sort_order,structure_locked,created_at,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,0,?,?,1)`,
      ).bind(
        mappedId,
        tournamentId,
        name.slice(0, 180),
        entryType,
        gender,
        nullableNumber(category.minAge),
        nullableNumber(category.maxAge),
        nullableNumber(category.maxEntries),
        registrationStatus,
        priceScope,
        nullableNumber(category.priceMinor),
        nullableString(category.currency) ?? "UYU",
        nullableString(category.scheduledDate),
        Math.max(0, Math.trunc(numberValue(category.sortOrder))),
        stamp,
        stamp,
      ),
    );
  }
  if (localCategoryStatements.length) await runBatches(env.HUAU_DB, localCategoryStatements);

  const personMap = new Map<string, string>();
  existingPeople.forEach((id) => personMap.set(id, id));
  const playerMap = new Map<string, string>();
  const playerToPerson = new Map<string, string>();
  existingPlayerById.forEach((row, id) => {
    playerMap.set(id, id);
    if (row.organizationPersonId) playerToPerson.set(id, row.organizationPersonId);
  });

  const localPeopleStatements: D1PreparedStatement[] = [];
  const localPlayerStatements: D1PreparedStatement[] = [];
  for (const player of snapshot.workspace.participants.players) {
    const sourceProfileId = stringValue(player.id);
    if (!sourceProfileId) continue;
    if (existingPlayerById.has(sourceProfileId)) continue;
    if (!localSource(sourceProfileId, ["local-player:"])) {
      throw new Error(`TOURNAMENT_DAY_PLAYER_UNKNOWN:${sourceProfileId}`);
    }
    const sourcePersonId = stringValue(player.organizationPersonId);
    if (!localSource(sourcePersonId, ["local-person:"])) {
      throw new Error(`TOURNAMENT_DAY_PERSON_INVALID:${sourcePersonId}`);
    }
    const mappedPersonId = await stableDayId(tournamentId, "person", sourcePersonId);
    const mappedProfileId = await stableDayId(tournamentId, "profile", sourceProfileId);
    personMap.set(sourcePersonId, mappedPersonId);
    playerMap.set(sourceProfileId, mappedProfileId);
    playerToPerson.set(sourceProfileId, mappedPersonId);

    const displayName = stringValue(player.displayName, "Jugador").trim() || "Jugador";
    const names = splitName(displayName);
    const contact = stringValue(player.contact).trim();
    const gender = allowed(
      player.sportGender,
      ["male", "female", "unspecified"] as const,
      "unspecified",
    );
    localPeopleStatements.push(
      env.HUAU_DB.prepare(
        `INSERT OR IGNORE INTO organization_people
         (id,organization_id,user_id,first_name,last_name,email,phone,birth_date,sport_gender,
          source,status,created_at,updated_at)
         VALUES (?,?,NULL,?,?,?,?,NULL,?,'manual','active',?,?)`,
      ).bind(
        mappedPersonId,
        tournament.organizationId,
        names.firstName.slice(0, 120),
        names.lastName.slice(0, 120),
        contact.includes("@") ? contact.slice(0, 254) : null,
        contact && !contact.includes("@") ? contact.slice(0, 80) : null,
        gender === "unspecified" ? null : gender,
        stamp,
        stamp,
      ),
    );
    localPlayerStatements.push(
      env.HUAU_DB.prepare(
        `INSERT OR IGNORE INTO tournament_player_profiles
         (id,tournament_id,organization_person_id,display_name,club,contact,dupr_singles,dupr_doubles,
          payment_status,player_status,notes,sort_order,created_at,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      ).bind(
        mappedProfileId,
        tournamentId,
        mappedPersonId,
        displayName.slice(0, 180),
        stringValue(player.club).slice(0, 180),
        contact.slice(0, 254),
        Math.max(0, numberValue(player.duprSingles)),
        Math.max(0, numberValue(player.duprDoubles)),
        allowed(player.paymentStatus, ["pending", "paid"] as const, "pending"),
        allowed(player.playerStatus, ["pending", "confirmed"] as const, "confirmed"),
        stringValue(player.notes, "Tournament Day walk-in").slice(0, 1000),
        Math.max(0, Math.trunc(numberValue(player.sortOrder))),
        stamp,
        stamp,
      ),
    );
  }
  if (localPeopleStatements.length) await runBatches(env.HUAU_DB, localPeopleStatements);
  if (localPlayerStatements.length) await runBatches(env.HUAU_DB, localPlayerStatements);

  await env.HUAU_DB.prepare(
    `DELETE FROM tournament_player_categories
      WHERE category_id IN (SELECT id FROM tournament_categories WHERE tournament_id=?)`,
  )
    .bind(tournamentId)
    .run();

  const playerCategoryStatements: D1PreparedStatement[] = [];
  for (const assignment of snapshot.workspace.participants.playerCategories) {
    const sourceProfileId = stringValue(assignment.playerProfileId);
    const sourceCategoryId = stringValue(assignment.categoryId);
    const mappedProfileId = playerMap.get(sourceProfileId);
    const mappedCategoryId = categoryMap.get(sourceCategoryId);
    if (!mappedProfileId || !mappedCategoryId) continue;
    const sourcePartnerId = nullableString(assignment.partnerProfileId);
    const mappedPartnerId = sourcePartnerId ? playerMap.get(sourcePartnerId) ?? null : null;
    playerCategoryStatements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_player_categories
         (player_profile_id,category_id,partner_profile_id,created_at,updated_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(player_profile_id,category_id) DO UPDATE SET
           partner_profile_id=excluded.partner_profile_id,updated_at=excluded.updated_at`,
      ).bind(mappedProfileId, mappedCategoryId, mappedPartnerId, stamp, stamp),
    );
  }
  if (playerCategoryStatements.length) await runBatches(env.HUAU_DB, playerCategoryStatements);

  const standardEntries = snapshot.workspace.standard.entries;
  const teamEntries = snapshot.team.categories.flatMap((category) =>
    rows(category.entries).map((entry) => ({ category, entry })),
  );
  const entryMap = new Map<string, string>();
  existingEntryById.forEach((_row, id) => entryMap.set(id, id));
  const localEntryStatements: D1PreparedStatement[] = [];

  for (const entry of standardEntries) {
    const sourceId = stringValue(entry.id);
    const sourceCategoryId = stringValue(entry.categoryId);
    const mappedCategoryId = categoryMap.get(sourceCategoryId);
    if (!sourceId || !mappedCategoryId) continue;
    const existing = existingEntryById.get(sourceId);
    if (existing) {
      if (existing.categoryId !== mappedCategoryId) {
        throw new Error(`TOURNAMENT_DAY_ENTRY_CATEGORY_MISMATCH:${sourceId}`);
      }
      continue;
    }
    if (!localSource(sourceId, ["local-entry:"])) {
      throw new Error(`TOURNAMENT_DAY_ENTRY_UNKNOWN:${sourceId}`);
    }
    const mappedId = await stableDayId(tournamentId, "entry", sourceId);
    entryMap.set(sourceId, mappedId);
    const category = categorySnapshotBySource.get(sourceCategoryId) ?? {};
    const entryType = allowed(
      category.entryType ?? entry.entryType,
      ["individual", "pair"] as const,
      "individual",
    );
    localEntryStatements.push(
      env.HUAU_DB.prepare(
        `INSERT OR IGNORE INTO tournament_entries
         (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,
          seed_rating,created_by_user_id,created_by_admin,created_at,updated_at,version,source_kind,source_key)
         VALUES (?,?,?,?,NULL,'ready',NULL,?,?,1,?,?,1,'tournament_day',?)`,
      ).bind(
        mappedId,
        mappedCategoryId,
        entryType,
        stringValue(entry.displayName, "Walk-in").slice(0, 180),
        nullableNumber(entry.seedRating),
        effectiveActor,
        stamp,
        stamp,
        sourceId,
      ),
    );
  }

  for (const item of teamEntries) {
    const entry = item.entry;
    const sourceId = stringValue(entry.id);
    const sourceCategoryId = stringValue(item.category.id);
    const mappedCategoryId = categoryMap.get(sourceCategoryId);
    if (!sourceId || !mappedCategoryId) continue;
    const existing = existingEntryById.get(sourceId);
    if (existing) {
      if (existing.categoryId !== mappedCategoryId) {
        throw new Error(`TOURNAMENT_DAY_TEAM_CATEGORY_MISMATCH:${sourceId}`);
      }
      continue;
    }
    if (!localSource(sourceId, ["local-team:"])) {
      throw new Error(`TOURNAMENT_DAY_TEAM_UNKNOWN:${sourceId}`);
    }
    const mappedId = await stableDayId(tournamentId, "team", sourceId);
    entryMap.set(sourceId, mappedId);
    localEntryStatements.push(
      env.HUAU_DB.prepare(
        `INSERT OR IGNORE INTO tournament_entries
         (id,category_id,entry_type,display_name,captain_user_id,status,waitlist_position,
          seed_rating,created_by_user_id,created_by_admin,created_at,updated_at,version,source_kind,source_key)
         VALUES (?,?,'team',?,NULL,'ready',NULL,NULL,?,1,?,?,1,'tournament_day',?)`,
      ).bind(
        mappedId,
        mappedCategoryId,
        stringValue(entry.displayName, "Team").slice(0, 180),
        effectiveActor,
        stamp,
        stamp,
        sourceId,
      ),
    );
  }
  if (localEntryStatements.length) await runBatches(env.HUAU_DB, localEntryStatements);

  const localStandardMemberStatements: D1PreparedStatement[] = [];
  for (const entry of standardEntries) {
    const sourceId = stringValue(entry.id);
    if (!localSource(sourceId, ["local-entry:"])) continue;
    const mappedEntryId = entryMap.get(sourceId);
    if (!mappedEntryId) continue;
    const sourceProfiles = Array.isArray(entry.localProfileIds)
      ? entry.localProfileIds.map((value) => String(value)).filter(Boolean)
      : stringValue(entry.sourceKey)
        ? [stringValue(entry.sourceKey)]
        : [];
    const uniqueProfiles = [...new Set(sourceProfiles)];
    for (let index = 0; index < uniqueProfiles.length; index += 1) {
      const sourceProfileId = uniqueProfiles[index]!;
      const personId = playerToPerson.get(sourceProfileId);
      if (!personId) throw new Error(`TOURNAMENT_DAY_ENTRY_PERSON_UNKNOWN:${sourceProfileId}`);
      localStandardMemberStatements.push(
        env.HUAU_DB.prepare(
          `INSERT OR IGNORE INTO entry_members
           (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,
            accepted_at,created_at,updated_at)
           VALUES (?,? ,?,'player',?,'manual',NULL,?,?,?)`,
        ).bind(
          await stableDayId(tournamentId, "member", `${sourceId}:${personId}`),
          mappedEntryId,
          personId,
          String(index + 1),
          stamp,
          stamp,
          stamp,
        ),
      );
    }
  }
  if (localStandardMemberStatements.length) {
    await runBatches(env.HUAU_DB, localStandardMemberStatements);
  }

  const standardCompetitionByCategory = new Map<string, Record<string, unknown>>();
  for (const competition of snapshot.workspace.standard.competitions) {
    const sourceCategoryId = stringValue(competition.categoryId);
    if (sourceCategoryId) standardCompetitionByCategory.set(sourceCategoryId, competition);
  }
  const teamCategoryBySource = new Map(
    snapshot.team.categories
      .map((category) => [stringValue(category.id), category] as const)
      .filter(([id]) => Boolean(id)),
  );

  const formatIdByCategory = new Map<string, string>();
  const formatStatements: D1PreparedStatement[] = [];
  const categoryFormatUpdateStatements: D1PreparedStatement[] = [];

  for (const [sourceCategoryId, mappedCategoryId] of categoryMap) {
    const category = categorySnapshotBySource.get(sourceCategoryId) ?? {};
    const teamCategory = teamCategoryBySource.get(sourceCategoryId);
    const standardCompetition = standardCompetitionByCategory.get(sourceCategoryId);
    const entryType = stringValue(category.entryType);
    let kind: "standard" | "team";
    let config: unknown;
    if (entryType === "team" || teamCategory) {
      kind = "team";
      const raw = teamCategory?.format ?? (() => {
        try {
          return JSON.parse(stringValue(category.configJson, "{}")) as unknown;
        } catch {
          return null;
        }
      })();
      config = parseTeamFormat(raw);
    } else {
      kind = "standard";
      let raw: unknown = standardCompetition?.format;
      if (!raw && category.configJson) {
        try {
          raw = JSON.parse(stringValue(category.configJson, "{}")) as unknown;
        } catch {
          raw = {};
        }
      }
      config = normalizeStandardFormat(record(raw));
    }
    const formatId = await stableDayId(
      tournamentId,
      "format",
      `${sourceCategoryId}:${publishedRevision}:${kind}`,
    );
    formatIdByCategory.set(mappedCategoryId, formatId);
    const nextVersion = (maxFormatVersion.get(mappedCategoryId) ?? 0) + 1;
    formatStatements.push(
      env.HUAU_DB.prepare(
        `INSERT OR IGNORE INTO competition_format_versions
         (id,category_id,version_number,format_kind,config_json,explanation_schema_version,
          created_by_user_id,created_at,locked_at)
         VALUES (?,?,?,?,?,1,?,?,?)`,
      ).bind(
        formatId,
        mappedCategoryId,
        nextVersion,
        kind,
        JSON.stringify(config),
        effectiveActor,
        stamp,
        stamp,
      ),
    );
    categoryFormatUpdateStatements.push(
      env.HUAU_DB.prepare(
        `UPDATE tournament_categories
            SET format_version_id=?,updated_at=?,version=version+1
          WHERE id=? AND tournament_id=?`,
      ).bind(formatId, stamp, mappedCategoryId, tournamentId),
    );
  }
  if (formatStatements.length) await runBatches(env.HUAU_DB, formatStatements);
  if (categoryFormatUpdateStatements.length) {
    await runBatches(env.HUAU_DB, categoryFormatUpdateStatements);
  }

  const teamRosterStatements: D1PreparedStatement[] = [];
  for (const [sourceCategoryId, teamCategory] of teamCategoryBySource) {
    const mappedCategoryId = categoryMap.get(sourceCategoryId);
    if (!mappedCategoryId) continue;
    const format = parseTeamFormat(teamCategory.format);
    for (const entry of rows(teamCategory.entries)) {
      const sourceEntryId = stringValue(entry.id);
      const mappedEntryId = entryMap.get(sourceEntryId);
      if (!mappedEntryId) continue;
      const roster: TeamRosterMember[] = [];
      for (const member of rows(entry.roster)) {
        const sourcePersonId = stringValue(member.personId);
        const mappedPersonId = personMap.get(sourcePersonId);
        if (!mappedPersonId) throw new Error(`TOURNAMENT_DAY_ROSTER_PERSON_UNKNOWN:${sourcePersonId}`);
        roster.push({
          personId: mappedPersonId,
          name: stringValue(member.name, "Jugador"),
          sportGender: allowed(
            member.sportGender,
            ["male", "female", "unspecified"] as const,
            "unspecified",
          ),
          role: allowed(
            member.role,
            ["player", "captain", "substitute"] as const,
            "player",
          ),
        });
      }
      if (roster.length) {
        const validation = validateTeamRoster(format, roster);
        if (!validation.valid) {
          throw new Error(
            `TOURNAMENT_DAY_TEAM_ROSTER_INVALID:${sourceEntryId}:${validation.issues
              .map((issue) => issue.code)
              .join(",")}`,
          );
        }
      }
      teamRosterStatements.push(
        env.HUAU_DB.prepare(`DELETE FROM entry_members WHERE entry_id=?`).bind(mappedEntryId),
      );
      for (let index = 0; index < roster.length; index += 1) {
        const member = roster[index]!;
        teamRosterStatements.push(
          env.HUAU_DB.prepare(
            `INSERT INTO entry_members
             (id,entry_id,organization_person_id,member_role,roster_slot,status,invited_user_id,
              accepted_at,created_at,updated_at)
             VALUES (?,?,?,?,?,'manual',NULL,?,?,?)`,
          ).bind(
            await stableDayId(
              tournamentId,
              "teammember",
              `${sourceEntryId}:${member.personId}`,
            ),
            mappedEntryId,
            member.personId,
            member.role,
            String(index + 1),
            stamp,
            stamp,
            stamp,
          ),
        );
      }
    }
  }
  if (teamRosterStatements.length) await runBatches(env.HUAU_DB, teamRosterStatements);

  const structureCategoryIds = new Set<string>();
  snapshot.workspace.standard.competitions.forEach((competition) => {
    const mapped = categoryMap.get(stringValue(competition.categoryId));
    if (mapped && rows(competition.encounters).length) structureCategoryIds.add(mapped);
  });
  snapshot.team.categories.forEach((category) => {
    const mapped = categoryMap.get(stringValue(category.id));
    if (mapped && rows(category.encounters).length) structureCategoryIds.add(mapped);
  });

  await env.HUAU_DB.prepare(`DELETE FROM schedule_items WHERE tournament_id=?`)
    .bind(tournamentId)
    .run();
  for (const mappedCategoryId of structureCategoryIds) {
    await env.HUAU_DB.prepare(`DELETE FROM competitions WHERE category_id=?`)
      .bind(mappedCategoryId)
      .run();
  }

  const encounterMap = new Map<string, string>();
  const matchMap = new Map<string, string>();
  const matchByEncounterSource = new Map<string, string>();
  const structureStatements: D1PreparedStatement[] = [];

  for (const competition of snapshot.workspace.standard.competitions) {
    const sourceCategoryId = stringValue(competition.categoryId);
    const mappedCategoryId = categoryMap.get(sourceCategoryId);
    const encounterRows = rows(competition.encounters);
    if (!mappedCategoryId || !encounterRows.length) continue;
    const formatId = formatIdByCategory.get(mappedCategoryId);
    if (!formatId) throw new Error("TOURNAMENT_DAY_FORMAT_MISSING");
    const compId = await stableDayId(
      tournamentId,
      "stdcomp",
      stringValue(competition.id, sourceCategoryId),
    );
    const finalGenerated = Boolean(competition.finalGenerated);
    const allComplete = encounterRows.every((encounter) =>
      ["finished", "bye", "skipped"].includes(stringValue(encounter.status)),
    );
    structureStatements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO competitions
         (id,category_id,format_version_id,status,structure_revision,created_at,updated_at)
         VALUES (?,?,?,?,1,?,?)`,
      ).bind(
        compId,
        mappedCategoryId,
        formatId,
        allComplete ? "completed" : finalGenerated ? "final_phase" : "group_stage",
        stamp,
        stamp,
      ),
      env.HUAU_DB.prepare(
        `UPDATE tournament_categories SET structure_locked=1,updated_at=?,version=version+1 WHERE id=?`,
      ).bind(stamp, mappedCategoryId),
    );

    const groupMap = new Map<string, string>();
    const groups = rows(competition.groups);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]!;
      const sourceGroupId = stringValue(group.id, `group-${groupIndex + 1}`);
      const mappedGroupId = await stableDayId(
        tournamentId,
        "stdgroup",
        `${sourceCategoryId}:${sourceGroupId}`,
      );
      groupMap.set(sourceGroupId, mappedGroupId);
      structureStatements.push(
        env.HUAU_DB.prepare(
          `INSERT INTO competition_groups (id,competition_id,name,sort_order) VALUES (?,?,?,?)`,
        ).bind(
          mappedGroupId,
          compId,
          stringValue(group.name, String.fromCharCode(65 + groupIndex)).slice(0, 80),
          groupIndex,
        ),
      );
      const groupEntries = rows(group.entries);
      for (let entryIndex = 0; entryIndex < groupEntries.length; entryIndex += 1) {
        const sourceEntryId = stringValue(groupEntries[entryIndex]!.id);
        const mappedEntryId = entryMap.get(sourceEntryId);
        if (!mappedEntryId) {
          throw new Error(`TOURNAMENT_DAY_GROUP_ENTRY_UNKNOWN:${sourceEntryId}`);
        }
        structureStatements.push(
          env.HUAU_DB.prepare(
            `INSERT INTO competition_group_entries (group_id,entry_id,seed,sort_order)
             VALUES (?,?,?,?)`,
          ).bind(mappedGroupId, mappedEntryId, entryIndex + 1, entryIndex),
        );
      }
    }

    for (const encounter of encounterRows) {
      const sourceEncounterId = stringValue(encounter.id);
      if (!sourceEncounterId) throw new Error("TOURNAMENT_DAY_ENCOUNTER_ID_REQUIRED");
      encounterMap.set(
        scopedEntityKey(sourceCategoryId, sourceEncounterId),
        await stableDayId(
          tournamentId,
          "stdenc",
          `${sourceCategoryId}:${sourceEncounterId}`,
        ),
      );
    }

    const category = categorySnapshotBySource.get(sourceCategoryId) ?? {};
    const entryType = allowed(category.entryType, ["individual", "pair"] as const, "individual");
    const competitionGender = allowed(
      category.competitionGender,
      ["male", "female", "mixed", "open"] as const,
      "open",
    );
    const matchRowsByEncounter = new Map(
      snapshot.workspace.standard.matches
        .filter((row) => stringValue(row.categoryId) === sourceCategoryId)
        .map((row) => [stringValue(row.encounterId), row] as const),
    );

    for (const encounter of encounterRows) {
      const sourceEncounterId = stringValue(encounter.id);
      const mappedEncounterId = encounterMap.get(
        scopedEntityKey(sourceCategoryId, sourceEncounterId),
      )!;
      const sourceGroupId = nullableString(encounter.groupId);
      const sourceEntryA = nullableString(record(encounter.entryA).id);
      const sourceEntryB = nullableString(record(encounter.entryB).id);
      const mappedEntryA = sourceEntryA ? entryMap.get(sourceEntryA) ?? null : null;
      const mappedEntryB = sourceEntryB ? entryMap.get(sourceEntryB) ?? null : null;
      const sourceWinner = nullableString(encounter.winnerEntryId);
      const mappedWinner = sourceWinner ? entryMap.get(sourceWinner) ?? null : null;
      const status = allowed(
        encounter.status,
        ["pending", "bye", "ready", "in_progress", "finished", "skipped"] as const,
        "pending",
      );
      structureStatements.push(
        env.HUAU_DB.prepare(
          `INSERT INTO competition_encounters
           (id,competition_id,stage,group_id,round_label,round_number,leg_number,
            entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,
            source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        ).bind(
          mappedEncounterId,
          compId,
          allowed(
            encounter.stage,
            ["group", "playoff", "consolation", "bronze", "final"] as const,
            "group",
          ),
          sourceGroupId ? groupMap.get(sourceGroupId) ?? null : null,
          nullableString(encounter.roundLabel),
          nullableNumber(encounter.roundNumber),
          Math.max(1, Math.trunc(numberValue(encounter.legNumber, 1))),
          mappedEntryA,
          mappedEntryB,
          nullableString(encounter.sourceEncounterAId)
            ? encounterMap.get(scopedEntityKey(sourceCategoryId, stringValue(encounter.sourceEncounterAId))) ?? null
            : null,
          nullableString(encounter.sourceEncounterBId)
            ? encounterMap.get(scopedEntityKey(sourceCategoryId, stringValue(encounter.sourceEncounterBId))) ?? null
            : null,
          nullableString(encounter.sourceLoserAId)
            ? encounterMap.get(scopedEntityKey(sourceCategoryId, stringValue(encounter.sourceLoserAId))) ?? null
            : null,
          nullableString(encounter.sourceLoserBId)
            ? encounterMap.get(scopedEntityKey(sourceCategoryId, stringValue(encounter.sourceLoserBId))) ?? null
            : null,
          status,
          mappedWinner,
          stamp,
          stamp,
        ),
      );

      if (status === "bye") continue;
      const matchSnapshot = matchRowsByEncounter.get(sourceEncounterId) ?? {};
      const sourceMatchId =
        nullableString(matchSnapshot.matchId) ?? `std-match:${sourceEncounterId}`;
      const mappedMatchId = await stableDayId(
        tournamentId,
        "stdmatch",
        `${sourceCategoryId}:${sourceMatchId}`,
      );
      matchMap.set(scopedEntityKey(sourceCategoryId, sourceMatchId), mappedMatchId);
      matchByEncounterSource.set(
        scopedEntityKey(sourceCategoryId, sourceEncounterId),
        mappedMatchId,
      );
      const winnerSide =
        mappedWinner && mappedWinner === mappedEntryA
          ? "A"
          : mappedWinner && mappedWinner === mappedEntryB
            ? "B"
            : null;
      structureStatements.push(
        env.HUAU_DB.prepare(
          `INSERT INTO matches
           (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,
            scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,
            created_at,updated_at,version)
           VALUES (?,?,NULL,1,?,?,?,?,?,?,?,?,?,0,?,?,1)`,
        ).bind(
          mappedMatchId,
          mappedEncounterId,
          entryType === "pair" ? "doubles" : "singles",
          competitionGender,
          numberValue(encounter.bestOf, 1) === 3 ? 3 : 1,
          Math.max(1, Math.trunc(numberValue(encounter.pointTarget, 15))),
          null,
          status === "finished" ? "finished" : status === "in_progress" ? "in_progress" : status === "skipped" ? "skipped" : "ready",
          nullableString(record(encounter.entryA).name),
          nullableString(record(encounter.entryB).name),
          winnerSide,
          stamp,
          stamp,
        ),
      );
      if (status === "finished" && winnerSide) {
        structureStatements.push(
          env.HUAU_DB.prepare(
            `INSERT INTO match_results
             (match_id,score_a,score_b,winner_side,result_status,entered_by_user_id,
              entered_at,corrected_at,updated_at)
             VALUES (?,?,?,?, 'final',?,?,NULL,?)`,
          ).bind(
            mappedMatchId,
            nullableNumber(encounter.scoreA),
            nullableNumber(encounter.scoreB),
            winnerSide,
            effectiveActor,
            stamp,
            stamp,
          ),
        );
        const sets = rows(encounter.sets);
        for (let setIndex = 0; setIndex < sets.length; setIndex += 1) {
          const set = sets[setIndex]!;
          const scoreA = Math.max(0, Math.trunc(numberValue(set.scoreA)));
          const scoreB = Math.max(0, Math.trunc(numberValue(set.scoreB)));
          structureStatements.push(
            env.HUAU_DB.prepare(
              `INSERT INTO match_sets (id,match_id,set_number,score_a,score_b,winner_side)
               VALUES (?,?,?,?,?,?)`,
            ).bind(
              await stableDayId(
                tournamentId,
                "stdset",
                `${sourceMatchId}:${setIndex + 1}`,
              ),
              mappedMatchId,
              setIndex + 1,
              scoreA,
              scoreB,
              scoreA > scoreB ? "A" : "B",
            ),
          );
        }
      }
    }
  }

  for (const [sourceCategoryId, teamCategory] of teamCategoryBySource) {
    const mappedCategoryId = categoryMap.get(sourceCategoryId);
    const encounterRows = rows(teamCategory.encounters);
    if (!mappedCategoryId || !encounterRows.length) continue;
    const formatId = formatIdByCategory.get(mappedCategoryId);
    if (!formatId) throw new Error("TOURNAMENT_DAY_TEAM_FORMAT_MISSING");
    const format = parseTeamFormat(teamCategory.format);
    const compId = await stableDayId(
      tournamentId,
      "teamcomp",
      `${sourceCategoryId}:${stringValue(teamCategory.competitionStatus, "competition")}`,
    );
    const allComplete = encounterRows.every((encounter) =>
      ["finished", "bye", "skipped"].includes(stringValue(encounter.status)),
    );
    const hasFinal = encounterRows.some(
      (encounter) => stringValue(encounter.stage) !== "group",
    );
    structureStatements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO competitions
         (id,category_id,format_version_id,status,structure_revision,created_at,updated_at)
         VALUES (?,?,?,?,1,?,?)`,
      ).bind(
        compId,
        mappedCategoryId,
        formatId,
        allComplete ? "completed" : hasFinal ? "final_phase" : "group_stage",
        stamp,
        stamp,
      ),
      env.HUAU_DB.prepare(
        `UPDATE tournament_categories SET structure_locked=1,updated_at=?,version=version+1 WHERE id=?`,
      ).bind(stamp, mappedCategoryId),
    );

    const groupRows = rows(teamCategory.groups);
    const sourceGroupIds = [...new Set(groupRows.map((row) => stringValue(row.id)).filter(Boolean))];
    const groupMap = new Map<string, string>();
    for (let groupIndex = 0; groupIndex < sourceGroupIds.length; groupIndex += 1) {
      const sourceGroupId = sourceGroupIds[groupIndex]!;
      const mappedGroupId = await stableDayId(
        tournamentId,
        "teamgroup",
        `${sourceCategoryId}:${sourceGroupId}`,
      );
      groupMap.set(sourceGroupId, mappedGroupId);
      const first = groupRows.find((row) => stringValue(row.id) === sourceGroupId) ?? {};
      structureStatements.push(
        env.HUAU_DB.prepare(
          `INSERT INTO competition_groups (id,competition_id,name,sort_order) VALUES (?,?,?,?)`,
        ).bind(
          mappedGroupId,
          compId,
          stringValue(first.name, String.fromCharCode(65 + groupIndex)).slice(0, 80),
          groupIndex,
        ),
      );
      const members = groupRows
        .filter((row) => stringValue(row.id) === sourceGroupId && row.entryId)
        .sort((a, b) => numberValue(a.sortOrder) - numberValue(b.sortOrder));
      for (let entryIndex = 0; entryIndex < members.length; entryIndex += 1) {
        const sourceEntryId = stringValue(members[entryIndex]!.entryId);
        const mappedEntryId = entryMap.get(sourceEntryId);
        if (!mappedEntryId) throw new Error(`TOURNAMENT_DAY_TEAM_GROUP_ENTRY_UNKNOWN:${sourceEntryId}`);
        structureStatements.push(
          env.HUAU_DB.prepare(
            `INSERT INTO competition_group_entries (group_id,entry_id,seed,sort_order)
             VALUES (?,?,?,?)`,
          ).bind(mappedGroupId, mappedEntryId, entryIndex + 1, entryIndex),
        );
      }
    }

    for (const encounter of encounterRows) {
      const sourceEncounterId = stringValue(encounter.id);
      encounterMap.set(
        scopedEntityKey(sourceCategoryId, sourceEncounterId),
        await stableDayId(
          tournamentId,
          "teamenc",
          `${sourceCategoryId}:${sourceEncounterId}`,
        ),
      );
    }

    const lineupMap = new Map<string, string>();
    for (const encounter of encounterRows) {
      const sourceEncounterId = stringValue(encounter.id);
      const mappedEncounterId = encounterMap.get(
        scopedEntityKey(sourceCategoryId, sourceEncounterId),
      )!;
      const sourceEntryA = nullableString(encounter.entryAId);
      const sourceEntryB = nullableString(encounter.entryBId);
      const mappedEntryA = sourceEntryA ? entryMap.get(sourceEntryA) ?? null : null;
      const mappedEntryB = sourceEntryB ? entryMap.get(sourceEntryB) ?? null : null;
      const sourceWinner = nullableString(encounter.winnerEntryId);
      const mappedWinner = sourceWinner ? entryMap.get(sourceWinner) ?? null : null;
      const status = allowed(
        encounter.status,
        ["pending", "bye", "ready", "in_progress", "finished", "skipped"] as const,
        "pending",
      );
      structureStatements.push(
        env.HUAU_DB.prepare(
          `INSERT INTO competition_encounters
           (id,competition_id,stage,group_id,round_label,round_number,leg_number,
            entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,
            source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        ).bind(
          mappedEncounterId,
          compId,
          allowed(
            encounter.stage,
            ["group", "playoff", "consolation", "bronze", "final"] as const,
            "group",
          ),
          nullableString(encounter.groupId)
            ? groupMap.get(stringValue(encounter.groupId)) ?? null
            : null,
          nullableString(encounter.roundLabel),
          nullableNumber(encounter.roundNumber),
          Math.max(1, Math.trunc(numberValue(encounter.legNumber, 1))),
          mappedEntryA,
          mappedEntryB,
          nullableString(encounter.sourceEncounterAId)
            ? encounterMap.get(scopedEntityKey(sourceCategoryId, stringValue(encounter.sourceEncounterAId))) ?? null
            : null,
          nullableString(encounter.sourceEncounterBId)
            ? encounterMap.get(scopedEntityKey(sourceCategoryId, stringValue(encounter.sourceEncounterBId))) ?? null
            : null,
          nullableString(encounter.sourceLoserAId)
            ? encounterMap.get(scopedEntityKey(sourceCategoryId, stringValue(encounter.sourceLoserAId))) ?? null
            : null,
          nullableString(encounter.sourceLoserBId)
            ? encounterMap.get(scopedEntityKey(sourceCategoryId, stringValue(encounter.sourceLoserBId))) ?? null
            : null,
          status,
          mappedWinner,
          stamp,
          stamp,
        ),
      );

      const matchRows = rows(encounter.matches);
      const rubberByKey = new Map(
        format.encounter.rubbers.map((rubber) => [rubber.key, rubber] as const),
      );
      for (const match of matchRows) {
        const sourceMatchId = stringValue(match.id);
        if (!sourceMatchId) continue;
        const mappedMatchId = await stableDayId(
          tournamentId,
          "teammatch",
          `${sourceCategoryId}:${sourceMatchId}`,
        );
        matchMap.set(scopedEntityKey(sourceCategoryId, sourceMatchId), mappedMatchId);
        const encounterKey = scopedEntityKey(sourceCategoryId, sourceEncounterId);
        if (!matchByEncounterSource.has(encounterKey)) {
          matchByEncounterSource.set(encounterKey, mappedMatchId);
        }
        const rubberKey = stringValue(match.rubberKey);
        const definition = rubberByKey.get(rubberKey);
        const matchStatus = allowed(
          match.status,
          ["pending", "ready", "in_progress", "finished", "skipped"] as const,
          "pending",
        );
        const winnerSide = allowed(
          match.winnerSide,
          ["A", "B", ""] as const,
          "",
        );
        structureStatements.push(
          env.HUAU_DB.prepare(
            `INSERT INTO matches
             (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,
              point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,
              manual_override,created_at,updated_at,version)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,1)`,
          ).bind(
            mappedMatchId,
            mappedEncounterId,
            rubberKey,
            Math.max(1, Math.trunc(numberValue(match.rubberOrder, definition?.order ?? 1))),
            allowed(match.mode ?? definition?.mode, ["singles", "doubles"] as const, "doubles"),
            allowed(
              match.competitionGender ?? definition?.gender,
              ["male", "female", "mixed", "open"] as const,
              "open",
            ),
            numberValue(match.bestOf, definition?.bestOf ?? 1) === 3 ? 3 : 1,
            Math.max(1, Math.trunc(numberValue(match.pointTarget, definition?.pointTarget ?? 15))),
            definition?.scoringMode ?? null,
            matchStatus,
            nullableString(encounter.sideA),
            nullableString(encounter.sideB),
            winnerSide || null,
            stamp,
            stamp,
          ),
        );
        if (match.resultStatus && winnerSide) {
          structureStatements.push(
            env.HUAU_DB.prepare(
              `INSERT INTO match_results
               (match_id,score_a,score_b,winner_side,result_status,entered_by_user_id,
                entered_at,corrected_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)`,
            ).bind(
              mappedMatchId,
              nullableNumber(match.scoreA),
              nullableNumber(match.scoreB),
              winnerSide,
              stringValue(match.resultStatus) === "corrected" ? "corrected" : "final",
              effectiveActor,
              stamp,
              stringValue(match.resultStatus) === "corrected" ? stamp : null,
              stamp,
            ),
          );
          const sets = rows(match.sets);
          for (let setIndex = 0; setIndex < sets.length; setIndex += 1) {
            const set = sets[setIndex]!;
            const scoreA = Math.max(0, Math.trunc(numberValue(set.scoreA)));
            const scoreB = Math.max(0, Math.trunc(numberValue(set.scoreB)));
            structureStatements.push(
              env.HUAU_DB.prepare(
                `INSERT INTO match_sets (id,match_id,set_number,score_a,score_b,winner_side)
                 VALUES (?,?,?,?,?,?)`,
              ).bind(
                await stableDayId(
                  tournamentId,
                  "teamset",
                  `${sourceMatchId}:${setIndex + 1}`,
                ),
                mappedMatchId,
                setIndex + 1,
                scoreA,
                scoreB,
                scoreA > scoreB ? "A" : "B",
              ),
            );
          }
        }
      }

      for (const lineup of rows(encounter.lineups)) {
        const sourceLineupId =
          stringValue(lineup.id) ||
          `${sourceEncounterId}:${stringValue(lineup.entryId)}`;
        const mappedEntryId = entryMap.get(stringValue(lineup.entryId));
        if (!mappedEntryId) continue;
        const mappedLineupId = await stableDayId(
          tournamentId,
          "lineup",
          `${sourceCategoryId}:${sourceLineupId}`,
        );
        lineupMap.set(sourceLineupId, mappedLineupId);
        const lineupStatus = allowed(lineup.status, ["draft", "locked"] as const, "draft");
        structureStatements.push(
          env.HUAU_DB.prepare(
            `INSERT INTO team_encounter_lineups
             (id,encounter_id,entry_id,status,locked_at,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?)`,
          ).bind(
            mappedLineupId,
            mappedEncounterId,
            mappedEntryId,
            lineupStatus,
            lineupStatus === "locked" ? stamp : null,
            stamp,
            stamp,
          ),
        );
        for (const assignment of rows(lineup.assignments)) {
          const sourcePersonId = stringValue(
            assignment.personId ?? assignment.organizationPersonId,
          );
          const mappedPersonId = personMap.get(sourcePersonId);
          if (!mappedPersonId) {
            throw new Error(`TOURNAMENT_DAY_LINEUP_PERSON_UNKNOWN:${sourcePersonId}`);
          }
          const rubberKey = stringValue(assignment.rubberKey);
          const position = Math.max(1, Math.trunc(numberValue(assignment.position, 1)));
          structureStatements.push(
            env.HUAU_DB.prepare(
              `INSERT INTO team_lineup_assignments
               (id,lineup_id,rubber_key,organization_person_id,position,created_at)
               VALUES (?,?,?,?,?,?)`,
            ).bind(
              await stableDayId(
                tournamentId,
                "lineupassignment",
                `${sourceLineupId}:${rubberKey}:${sourcePersonId}:${position}`,
              ),
              mappedLineupId,
              rubberKey,
              mappedPersonId,
              position,
              stamp,
            ),
          );
        }
      }

      for (const match of rows(encounter.matches)) {
        if (!match.resultStatus) continue;
        const mappedMatchId = matchMap.get(
          scopedEntityKey(sourceCategoryId, stringValue(match.id)),
        );
        if (!mappedMatchId) continue;
        const rubberKey = stringValue(match.rubberKey);
        for (const side of ["A", "B"] as const) {
          const sourceEntryId = side === "A" ? sourceEntryA : sourceEntryB;
          if (!sourceEntryId) continue;
          const lineup = rows(encounter.lineups).find(
            (candidate) =>
              stringValue(candidate.entryId) === sourceEntryId &&
              stringValue(candidate.status) === "locked",
          );
          if (!lineup) continue;
          const assignments = rows(lineup.assignments)
            .filter((assignment) => stringValue(assignment.rubberKey) === rubberKey)
            .sort((a, b) => numberValue(a.position) - numberValue(b.position));
          for (let position = 0; position < assignments.length; position += 1) {
            const sourcePersonId = stringValue(
              assignments[position]!.personId ??
                assignments[position]!.organizationPersonId,
            );
            const mappedPersonId = personMap.get(sourcePersonId);
            if (!mappedPersonId) continue;
            structureStatements.push(
              env.HUAU_DB.prepare(
                `INSERT OR IGNORE INTO match_side_members
                 (match_id,side,organization_person_id,position)
                 VALUES (?,?,?,?)`,
              ).bind(mappedMatchId, side, mappedPersonId, position + 1),
            );
          }
        }
      }
    }
  }

  if (structureStatements.length) await runBatches(env.HUAU_DB, structureStatements);

  const scheduleStatements: D1PreparedStatement[] = [];
  for (const scheduleRow of snapshot.workspace.schedule.schedule) {
    const sourceCategoryId = stringValue(scheduleRow.categoryId);
    const mappedCategoryId = categoryMap.get(sourceCategoryId);
    if (!mappedCategoryId) continue;
    const sourceEncounterId = nullableString(scheduleRow.encounterId);
    const sourceMatchId = nullableString(scheduleRow.matchId);
    const mappedEncounterId = sourceEncounterId
      ? encounterMap.get(scopedEntityKey(sourceCategoryId, sourceEncounterId)) ?? null
      : null;
    const mappedMatchId = sourceMatchId
      ? matchMap.get(scopedEntityKey(sourceCategoryId, sourceMatchId)) ??
        (sourceEncounterId
          ? matchByEncounterSource.get(scopedEntityKey(sourceCategoryId, sourceEncounterId)) ?? null
          : null)
      : sourceEncounterId
        ? matchByEncounterSource.get(scopedEntityKey(sourceCategoryId, sourceEncounterId)) ?? null
        : null;
    const startAt = Math.trunc(numberValue(scheduleRow.startAt));
    const endAt = Math.max(startAt + 60, Math.trunc(numberValue(scheduleRow.endAt, startAt + 1800)));
    const sourceScheduleId = stringValue(scheduleRow.id, `${sourceCategoryId}:${startAt}`);
    scheduleStatements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO schedule_items
         (id,tournament_id,category_id,encounter_id,match_id,placeholder_key,stage,round_label,
          court_label,start_at,end_at,status,created_at,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      ).bind(
        await stableDayId(tournamentId, "schedule", sourceScheduleId),
        tournamentId,
        mappedCategoryId,
        mappedEncounterId,
        mappedMatchId,
        mappedEncounterId || mappedMatchId ? null : `day:${sourceScheduleId}`.slice(0, 220),
        stringValue(scheduleRow.stage, "group").slice(0, 80),
        nullableString(scheduleRow.roundLabel),
        stringValue(scheduleRow.courtLabel, "Cancha 1").slice(0, 80),
        startAt,
        endAt,
        allowed(
          scheduleRow.status,
          ["reserved", "bound", "completed", "cancelled"] as const,
          "bound",
        ),
        stamp,
        stamp,
      ),
    );
  }
  if (scheduleStatements.length) await runBatches(env.HUAU_DB, scheduleStatements);

  const revisionRow = await env.HUAU_DB.prepare(
    `SELECT COALESCE(MAX(revision_number),0)+1 as nextRevision
       FROM schedule_revisions WHERE tournament_id=?`,
  )
    .bind(tournamentId)
    .first<{ nextRevision: number }>();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `UPDATE schedule_revisions SET is_current=0 WHERE tournament_id=? AND is_current=1`,
    ).bind(tournamentId),
    env.HUAU_DB.prepare(
      `INSERT INTO schedule_revisions
       (id,tournament_id,revision_number,generated_from_structure_revision,
        created_by_user_id,created_at,is_current)
       VALUES (?,?,?,?,?,?,1)`,
    ).bind(
      uuid(),
      tournamentId,
      Number(revisionRow?.nextRevision ?? 1),
      Number(tournament.workingRevision) + 1,
      effectiveActor,
      stamp,
    ),
    env.HUAU_DB.prepare(
      `UPDATE tournament_settings
          SET daily_start=?,daily_end=?,default_match_minutes=?,
              minimum_group=?,preferred_group=?,maximum_group=?,
              suggested_qualifiers_per_group=?,seeding_method=?,minimum_rest_slots=?,
              updated_at=?
        WHERE tournament_id=?`,
    ).bind(
      stringValue(snapshot.workspace.core.settings.dailyStart, "09:00"),
      stringValue(snapshot.workspace.core.settings.dailyEnd, "20:00"),
      Math.max(5, Math.trunc(numberValue(snapshot.workspace.core.settings.defaultMatchMinutes, 30))),
      Math.max(2, Math.trunc(numberValue(snapshot.workspace.core.settings.minimumGroup, 3))),
      Math.max(2, Math.trunc(numberValue(snapshot.workspace.core.settings.preferredGroup, 4))),
      Math.max(2, Math.trunc(numberValue(snapshot.workspace.core.settings.maximumGroup, 4))),
      Math.max(0, Math.min(2, Math.trunc(numberValue(snapshot.workspace.core.settings.suggestedQualifiersPerGroup, 2)))),
      allowed(snapshot.workspace.core.settings.seedingMethod, ["snake","manual","random","live"] as const, "snake"),
      Math.max(0, Math.min(4, Math.trunc(numberValue(snapshot.workspace.core.settings.minimumRestSlots, 1)))),
      stamp,
      tournamentId,
    ),
    env.HUAU_DB.prepare(
      `UPDATE tournaments
          SET status='completed',structure_locked=1,court_count=?,
              working_revision=working_revision+1,published_revision=published_revision+1,
              updated_at=?
        WHERE id=?`,
    ).bind(
      Math.max(1, Math.trunc(numberValue(snapshot.workspace.core.tournament.courtCount, 1))),
      stamp,
      tournamentId,
    ),
    env.HUAU_DB.prepare(
      `INSERT INTO critical_audit_events
       (id,organization_id,tournament_id,actor_user_id,actor_type,action,entity_type,entity_id,
        summary,metadata_json,created_at)
       VALUES (?,?,?,?, 'user','tournament_day.final_sync','tournament',?,
               'Finalized Tournament Day local snapshot',?,?)`,
    ).bind(
      uuid(),
      tournament.organizationId,
      tournamentId,
      effectiveActor,
      tournamentId,
      JSON.stringify({ publishedRevision, source: "tournament_day_local" }),
      stamp,
    ),
  ]);
}

async function bootstrapAdmin(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
) {
  const accessResult = await tournamentForAdmin(request, env, tournamentId, access);
  if (accessResult instanceof Response) return accessResult;

  const state = await dayState(env, tournamentId);
  const forceD1 = new URL(request.url).searchParams.get("source") === "d1";
  if (!forceD1 && state?.snapshotR2Key) {
    try {
      const bundle = await publishedSnapshotBundle(env, state);
      return json({ ok: true, ...bundle });
    } catch {
      // If an R2 object is unexpectedly missing, fall through to the D1 source
      // so an organization admin can still recover the tournament.
    }
  }

  const [workspace, team] = await Promise.all([
    tournamentDayWorkspaceBundleForAdmin(env, tournamentId),
    tournamentDayTeamBundleForAdmin(request, env, tournamentId, access),
  ]);
  return json({
    ok: true,
    publishedRevision: Number(state?.publishedRevision ?? 0),
    finalizedAt: state?.finalizedAt ?? null,
    syncStatus: state?.syncStatus ?? "idle",
    syncError: state?.syncError ?? null,
    snapshot: {
      schemaVersion: 1,
      tournamentId,
      baseRevision: accessResult.tournament.workingRevision,
      createdAt: Date.now(),
      workspace,
      team,
    },
  });
}

async function adminState(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
) {
  const accessResult = await tournamentForAdmin(request, env, tournamentId, access);
  if (accessResult instanceof Response) return accessResult;
  const state = await dayState(env, tournamentId);
  return json({
    ok: true,
    hasOperatorAccess: Boolean(state?.tokenHash),
    hasPublishedSnapshot: Boolean(state?.snapshotR2Key),
    publishedRevision: Number(state?.publishedRevision ?? 0),
    publishedAt: state?.publishedAt ?? null,
    finalizedAt: state?.finalizedAt ?? null,
    syncStatus: state?.syncStatus ?? "idle",
    syncedRevision: Number(state?.syncedRevision ?? 0),
    syncedAt: state?.syncedAt ?? null,
    syncError: state?.syncError ?? null,
  });
}

async function rotateAccess(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
) {
  const accessResult = await tournamentForAdmin(request, env, tournamentId, access);
  if (accessResult instanceof Response) return accessResult;
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const stamp = unixNow();
  await env.HUAU_DB.prepare(
    `INSERT INTO tournament_day_state
       (tournament_id,token_hash,snapshot_r2_key,published_revision,published_at,finalized_at,
        created_by_user_id,sync_status,synced_revision,synced_at,sync_error,created_at,updated_at)
     VALUES (?,?,NULL,0,NULL,NULL,?,'idle',0,NULL,NULL,?,?)
     ON CONFLICT(tournament_id) DO UPDATE SET
       token_hash=excluded.token_hash,
       created_by_user_id=COALESCE(tournament_day_state.created_by_user_id,excluded.created_by_user_id),
       updated_at=excluded.updated_at`,
  )
    .bind(tournamentId, tokenHash, accessResult.user.id, stamp, stamp)
    .run();
  return json({
    ok: true,
    token,
    path: `/operate/${encodeURIComponent(token)}`,
  });
}

async function revokeAccess(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
) {
  const accessResult = await tournamentForAdmin(request, env, tournamentId, access);
  if (accessResult instanceof Response) return accessResult;
  await env.HUAU_DB.prepare(
    `UPDATE tournament_day_state SET token_hash=NULL,updated_at=? WHERE tournament_id=?`,
  )
    .bind(unixNow(), tournamentId)
    .run();
  return json({ ok: true });
}

async function publishWithOptionalFinalSync(
  env: Env,
  input: {
    tournamentId: string;
    snapshot: unknown;
    actorUserId: string | null;
    finalized: boolean;
    basePublishedRevision: number;
  },
) {
  if (input.finalized) {
    try {
      const candidate = snapshotShape(input.snapshot, input.tournamentId);
      if (!competitionComplete(candidate)) {
        return json(
          { ok: false, code: "TOURNAMENT_DAY_NOT_COMPLETE" },
          { status: 409 },
        );
      }
    } catch (error) {
      return json(
        {
          ok: false,
          code: error instanceof Error ? error.message : "TOURNAMENT_DAY_SNAPSHOT_INVALID",
        },
        { status: 400 },
      );
    }
  }

  const published = await putSnapshot(env, input);
  if ("response" in published && published.response) return published.response;

  let syncStatus: DaySyncStatus = "idle";
  let syncError: string | null = null;
  if (input.finalized) {
    syncStatus = "syncing";
    await markSync(env, input.tournamentId, "syncing");
    try {
      const state = await dayState(env, input.tournamentId);
      const actor = input.actorUserId ?? state?.createdByUserId;
      if (!actor) throw new Error("TOURNAMENT_DAY_SYNC_ACTOR_REQUIRED");
      await syncFinalizedSnapshot(
        env,
        input.tournamentId,
        published.snapshot,
        actor,
        published.revision,
      );
      syncStatus = "synced";
      await markSync(env, input.tournamentId, "synced", {
        revision: published.revision,
      });
    } catch (error) {
      syncStatus = "failed";
      syncError =
        error instanceof Error ? error.message : "TOURNAMENT_DAY_SYNC_FAILED";
      await markSync(env, input.tournamentId, "failed", {
        revision: published.revision,
        error: syncError,
      });
    }
  }

  return json({
    ok: true,
    revision: published.revision,
    publishedAt: published.publishedAt,
    finalizedAt: published.finalizedAt,
    syncStatus,
    syncError,
  });
}

async function publishAdmin(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
) {
  const accessResult = await tournamentForAdmin(request, env, tournamentId, access);
  if (accessResult instanceof Response) return accessResult;
  const body = (await request.json().catch(() => null)) as
    | {
        snapshot?: unknown;
        finalized?: boolean;
        basePublishedRevision?: number;
      }
    | null;
  return publishWithOptionalFinalSync(env, {
    tournamentId,
    snapshot: body?.snapshot,
    actorUserId: accessResult.user.id,
    finalized: Boolean(body?.finalized),
    basePublishedRevision: Number(body?.basePublishedRevision ?? 0),
  });
}

async function operatorBootstrap(env: Env, token: string) {
  const state = await dayStateByToken(env, token);
  if (!state) {
    return json({ ok: false, code: "TOURNAMENT_DAY_ACCESS_INVALID" }, { status: 404 });
  }
  try {
    const bundle = await publishedSnapshotBundle(env, state);
    return json({ ok: true, ...bundle });
  } catch (error) {
    return json(
      {
        ok: false,
        code:
          error instanceof Error
            ? error.message
            : "TOURNAMENT_DAY_SNAPSHOT_LOAD_FAILED",
      },
      { status: 409 },
    );
  }
}

async function operatorState(env: Env, token: string) {
  const state = await dayStateByToken(env, token);
  if (!state) {
    return json({ ok: false, code: "TOURNAMENT_DAY_ACCESS_INVALID" }, { status: 404 });
  }
  const tournament = await env.HUAU_DB.prepare(
    `SELECT id,name,slug,sport,status,start_at as startAt,end_at as endAt,court_count as courtCount
       FROM tournaments WHERE id=?`,
  )
    .bind(state.tournamentId)
    .first();
  return json({
    ok: true,
    tournament,
    hasPublishedSnapshot: Boolean(state.snapshotR2Key),
    publishedRevision: state.publishedRevision,
    publishedAt: state.publishedAt,
    finalizedAt: state.finalizedAt,
    syncStatus: state.syncStatus,
    syncedRevision: state.syncedRevision,
    syncedAt: state.syncedAt,
    syncError: state.syncError,
  });
}

async function publishOperator(request: Request, env: Env, token: string) {
  const state = await dayStateByToken(env, token);
  if (!state) {
    return json({ ok: false, code: "TOURNAMENT_DAY_ACCESS_INVALID" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as
    | {
        snapshot?: unknown;
        finalized?: boolean;
        basePublishedRevision?: number;
      }
    | null;
  return publishWithOptionalFinalSync(env, {
    tournamentId: state.tournamentId,
    snapshot: body?.snapshot,
    actorUserId: state.createdByUserId,
    finalized: Boolean(body?.finalized),
    basePublishedRevision: Number(body?.basePublishedRevision ?? 0),
  });
}

export async function handleTournamentDayApi(
  request: Request,
  env: Env,
  url: URL,
  access: AccessHelpers,
): Promise<Response | null> {
  const operator = url.pathname.match(
    /^\/api\/operate\/([^/]+)\/(bootstrap|state|publish)$/,
  );
  if (operator) {
    const token = decodeURIComponent(operator[1]!);
    const action = operator[2]!;
    if (action === "bootstrap" && request.method === "GET") {
      return operatorBootstrap(env, token);
    }
    if (action === "state" && request.method === "GET") {
      return operatorState(env, token);
    }
    if (action === "publish" && request.method === "PUT") {
      return publishOperator(request, env, token);
    }
    return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  const bootstrap = url.pathname.match(
    /^\/api\/admin\/tournaments\/([^/]+)\/day-bootstrap$/,
  );
  if (bootstrap && request.method === "GET") {
    return bootstrapAdmin(request, env, decodeURIComponent(bootstrap[1]!), access);
  }

  const state = url.pathname.match(
    /^\/api\/admin\/tournaments\/([^/]+)\/day-state$/,
  );
  if (state && request.method === "GET") {
    return adminState(request, env, decodeURIComponent(state[1]!), access);
  }

  const accessRoute = url.pathname.match(
    /^\/api\/admin\/tournaments\/([^/]+)\/day-access$/,
  );
  if (accessRoute && request.method === "POST") {
    return rotateAccess(request, env, decodeURIComponent(accessRoute[1]!), access);
  }
  if (accessRoute && request.method === "DELETE") {
    return revokeAccess(request, env, decodeURIComponent(accessRoute[1]!), access);
  }

  const publish = url.pathname.match(
    /^\/api\/admin\/tournaments\/([^/]+)\/day-publish$/,
  );
  if (publish && request.method === "PUT") {
    return publishAdmin(request, env, decodeURIComponent(publish[1]!), access);
  }

  return null;
}
