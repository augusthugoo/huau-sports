/**
 * Tournament-scoped organizer access. This module intentionally does NOT grant
 * org_admin or reuse the existing, broader Tournament Day operator token.
 * Lote A: assignment and access inspection only. Financial/day mutations are
 * integrated in separate, audited lots.
 */

type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isPlatformAdmin: (userId: string, email: string, env: Env) => Promise<boolean>;
};

type Assignment = {
  tournamentId: string;
  organizerEmail: string;
  organizerUserId: string | null;
  dayEnabled: number;
  status: "active" | "revoked";
  assignedByUserId: string | null;
  createdAt: number;
  updatedAt: number;
};

type Tournament = { id: string; name: string };
type VerifiedUser = { id: string };
type Permission = "finance" | "day";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

/** Email matching always happens against the verified Better Auth user in D1. */
export function normalizeOrganizerEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Reusable authorization boundary for the upcoming financial/day modules.
 * NEVER trust an email, user ID or tournament ID passed by the browser as proof
 * of membership. `userId` must come exclusively from Better Auth's session.
 */
export async function hasTournamentOrganizerAccess(
  env: Env,
  userId: string,
  tournamentId: string,
  permission: Permission,
): Promise<boolean> {
  if (!userId || !tournamentId) return false;
  const row = await env.HUAU_DB.prepare(
    `SELECT 1 AS allowed
       FROM tournament_organizers a
       JOIN "user" u ON u.id=?
      WHERE a.tournament_id=?
        AND a.status='active'
        AND u.email_verified=1
        AND lower(trim(u.email))=a.organizer_email
        AND (a.organizer_user_id IS NULL OR a.organizer_user_id=u.id)
        AND (?='finance' OR a.day_enabled=1)
      LIMIT 1`,
  ).bind(userId, tournamentId, permission).first<{ allowed: number }>();
  return Number(row?.allowed ?? 0) === 1;
}

async function currentPlatformAdmin(request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return { response: json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 }) } as const;
  if (!(await access.isPlatformAdmin(user.id, user.email, env))) {
    return { response: json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) } as const;
  }
  return { user } as const;
}

async function tournamentById(env: Env, tournamentId: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,name FROM tournaments WHERE id=? LIMIT 1`,
  ).bind(tournamentId).first<Tournament>();
}

async function assignmentByTournament(env: Env, tournamentId: string) {
  return env.HUAU_DB.prepare(
    `SELECT tournament_id AS tournamentId,organizer_email AS organizerEmail,
            organizer_user_id AS organizerUserId,day_enabled AS dayEnabled,
            status,assigned_by_user_id AS assignedByUserId,
            created_at AS createdAt,updated_at AS updatedAt
       FROM tournament_organizers WHERE tournament_id=?`,
  ).bind(tournamentId).first<Assignment>();
}

async function verifiedUserByEmail(env: Env, email: string) {
  return env.HUAU_DB.prepare(
    `SELECT id FROM "user" WHERE lower(trim(email))=? AND email_verified=1 LIMIT 1`,
  ).bind(email).first<VerifiedUser>();
}

async function listMyOrganizerTournaments(request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });

  // No organization-level privileges are consulted or inherited here.
  const result = await env.HUAU_DB.prepare(
    `SELECT t.id,t.name,t.slug,t.status,t.start_at AS startAt,
            t.end_at AS endAt,o.name AS organizationName,
            a.day_enabled AS dayEnabled
       FROM "user" u
       JOIN tournament_organizers a ON lower(trim(u.email))=a.organizer_email
       JOIN tournaments t ON t.id=a.tournament_id
       JOIN organizations o ON o.id=t.organizer_organization_id
      WHERE u.id=? AND u.email_verified=1
        AND a.status='active'
        AND (a.organizer_user_id IS NULL OR a.organizer_user_id=u.id)
      ORDER BY t.start_at DESC,t.id ASC`,
  ).bind(user.id).all<{
    id: string; name: string; slug: string; status: string;
    startAt: number; endAt: number | null; organizationName: string; dayEnabled: number;
  }>();
  return json({
    ok: true,
    tournaments: (result.results ?? []).map((row) => ({
      ...row,
      canManageRegistrationsAndPayments: true,
      canOperateDay: row.dayEnabled === 1,
      dayEnabled: undefined,
    })),
  });
}

async function platformOrganizer(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
) {
  const allowed = await currentPlatformAdmin(request, env, access);
  if ("response" in allowed) return allowed.response;
  const tournament = await tournamentById(env, tournamentId);
  if (!tournament) return json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });

  if (request.method === "GET") {
    const assignment = await assignmentByTournament(env, tournamentId);
    return json({ ok: true, tournament, organizer: assignment ?? null });
  }

  if (request.method === "PUT") {
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    const email = normalizeOrganizerEmail(body?.email);
    if (!email) return json({ ok: false, code: "INVALID_ORGANIZER_EMAIL" }, { status: 400 });

    const [previous, linkedUser] = await Promise.all([
      assignmentByTournament(env, tournamentId),
      verifiedUserByEmail(env, email),
    ]);
    const now = Date.now();
    const keepDayEnabled = previous?.status === "active" && previous.organizerEmail === email && previous.dayEnabled === 1;
    const action = !previous ? "assigned"
      : previous.status === "revoked" ? "reactivated"
      : previous.organizerEmail === email ? "refreshed" : "reassigned";
    await env.HUAU_DB.batch([
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_organizers
           (tournament_id,organizer_email,organizer_user_id,day_enabled,status,assigned_by_user_id,created_at,updated_at)
         VALUES (?,?,?,?,'active',?,?,?)
         ON CONFLICT(tournament_id) DO UPDATE SET
           organizer_email=excluded.organizer_email,
           organizer_user_id=excluded.organizer_user_id,
           day_enabled=excluded.day_enabled,
           status='active',assigned_by_user_id=excluded.assigned_by_user_id,
           updated_at=excluded.updated_at`,
      ).bind(tournamentId, email, linkedUser?.id ?? null, keepDayEnabled ? 1 : 0, allowed.user.id, now, now),
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_organizer_audit
           (id,tournament_id,actor_user_id,action,old_email,new_email,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(crypto.randomUUID(), tournamentId, allowed.user.id, action, previous?.organizerEmail ?? null, email, now),
    ]);
    return json({ ok: true, tournamentId, email, pendingVerification: !linkedUser, dayEnabled: keepDayEnabled });
  }

  if (request.method === "DELETE") {
    const previous = await assignmentByTournament(env, tournamentId);
    if (!previous) return json({ ok: false, code: "ORGANIZER_NOT_ASSIGNED" }, { status: 404 });
    if (previous.status === "revoked") return json({ ok: true, revoked: true });
    const now = Date.now();
    await env.HUAU_DB.batch([
      env.HUAU_DB.prepare(
        `UPDATE tournament_organizers SET status='revoked',day_enabled=0,
            updated_at=? WHERE tournament_id=? AND status='active'`,
      ).bind(now, tournamentId),
      env.HUAU_DB.prepare(
        `INSERT INTO tournament_organizer_audit
           (id,tournament_id,actor_user_id,action,old_email,new_email,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(crypto.randomUUID(), tournamentId, allowed.user.id, "revoked", previous.organizerEmail, null, now),
    ]);
    return json({ ok: true, revoked: true });
  }

  return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
}

async function platformDayAccess(
  request: Request,
  env: Env,
  tournamentId: string,
  access: AccessHelpers,
) {
  const allowed = await currentPlatformAdmin(request, env, access);
  if ("response" in allowed) return allowed.response;
  const previous = await assignmentByTournament(env, tournamentId);
  if (!previous || previous.status !== "active") {
    return json({ ok: false, code: "ORGANIZER_NOT_ASSIGNED" }, { status: 409 });
  }
  const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return json({ ok: false, code: "INVALID_DAY_ACCESS" }, { status: 400 });
  }
  const enabled = body.enabled ? 1 : 0;
  if (previous.dayEnabled === enabled) return json({ ok: true, dayEnabled: body.enabled });
  const now = Date.now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `UPDATE tournament_organizers SET day_enabled=?,updated_at=?
        WHERE tournament_id=? AND status='active'`,
    ).bind(enabled, now, tournamentId),
    env.HUAU_DB.prepare(
      `INSERT INTO tournament_organizer_audit
         (id,tournament_id,actor_user_id,action,old_email,new_email,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(crypto.randomUUID(), tournamentId, allowed.user.id,
      enabled ? "day_enabled" : "day_disabled", previous.organizerEmail, previous.organizerEmail, now),
  ]);
  return json({ ok: true, dayEnabled: body.enabled });
}

export async function handleTournamentOrganizerApi(
  request: Request,
  env: Env,
  url: URL,
  access: AccessHelpers,
): Promise<Response | null> {
  if (url.pathname === "/api/me/organizer-tournaments" && request.method === "GET") {
    return listMyOrganizerTournaments(request, env, access);
  }
  const day = url.pathname.match(/^\/api\/platform\/tournaments\/([^/]+)\/organizer\/day$/);
  if (day) {
    if (request.method !== "PATCH") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
    return platformDayAccess(request, env, decodeURIComponent(day[1]!), access);
  }
  const assignment = url.pathname.match(/^\/api\/platform\/tournaments\/([^/]+)\/organizer$/);
  if (assignment) {
    return platformOrganizer(request, env, decodeURIComponent(assignment[1]!), access);
  }
  return null;
}
