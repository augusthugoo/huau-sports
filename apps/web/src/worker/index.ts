import {
  organizationMembershipRequests,
  organizationMemberships,
  organizations,
  organizationUserCapabilities,
  platformAdmins,
  userProfiles,
  createDb,
} from "@huau/db";
import { and, eq, inArray } from "drizzle-orm";
import { createAuth } from "./auth";
import { handleTournamentAdminApi } from "./tournament-admin";
import { handleTeamAdminApi } from "./team-admin";
import { handleRegistrationApi } from "./registration";
import { handlePaymentApi } from "./payments";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

const readJson = async <T>(request: Request): Promise<T> => {
  const body = await request.json();
  return body as T;
};

const now = () => new Date();
const id = () => crypto.randomUUID();

function platformAllowlist(env: Env): Set<string> {
  return new Set(
    (env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function getSession(request: Request, env: Env) {
  const auth = createAuth(env);
  return auth.api.getSession({ headers: request.headers });
}

async function isPlatformAdmin(userId: string, email: string, env: Env) {
  if (platformAllowlist(env).has(email.toLowerCase())) return true;
  const db = createDb(env.HUAU_DB);
  const [row] = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.status, "active")))
    .limit(1);
  return Boolean(row);
}

async function isOrgAdmin(userId: string, organizationId: string, env: Env, request?: Request) {
  const db = createDb(env.HUAU_DB);
  const [row] = await db
    .select({ id: organizationUserCapabilities.id })
    .from(organizationUserCapabilities)
    .where(
      and(
        eq(organizationUserCapabilities.userId, userId),
        eq(organizationUserCapabilities.organizationId, organizationId),
        eq(organizationUserCapabilities.capability, "org_admin"),
        eq(organizationUserCapabilities.status, "active"),
      ),
    )
    .limit(1);
  if (row) return true;

  // Platform support access is explicit and scoped. A platform admin who is also
  // a real organization admin does not need the support header.
  if (await isPlatformAdminById(userId, env)) {
    return request?.headers.get("x-huau-support-org") === organizationId;
  }
  return false;
}

async function isPlatformAdminById(userId: string, env: Env) {
  const db = createDb(env.HUAU_DB);
  const [stored] = await db
    .select({ id: platformAdmins.userId })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.status, "active")))
    .limit(1);
  if (stored) return true;

  const sessionRows = await env.HUAU_DB.prepare('SELECT email FROM "user" WHERE id = ?')
    .bind(userId)
    .all<{ email: string }>();
  const email = sessionRows.results[0]?.email;
  return Boolean(email && platformAllowlist(env).has(email.toLowerCase()));
}

async function requireUser(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session?.user) return null;
  return session.user;
}

async function handleMe(request: Request, env: Env) {
  const currentUser = await requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });

  const db = createDb(env.HUAU_DB);
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, currentUser.id))
    .limit(1);

  const memberships = await db
    .select({
      id: organizationMemberships.id,
      status: organizationMemberships.status,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      organizationType: organizations.type,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(eq(organizationMemberships.userId, currentUser.id));

  const capabilities = await db
    .select()
    .from(organizationUserCapabilities)
    .where(
      and(
        eq(organizationUserCapabilities.userId, currentUser.id),
        eq(organizationUserCapabilities.status, "active"),
      ),
    );

  const membershipRequests = await db
    .select({
      id: organizationMembershipRequests.id,
      organizationId: organizationMembershipRequests.organizationId,
      status: organizationMembershipRequests.status,
    })
    .from(organizationMembershipRequests)
    .where(eq(organizationMembershipRequests.userId, currentUser.id));

  return json({
    ok: true,
    user: currentUser,
    profile: profile ? { ...profile, avatarR2Key: undefined, avatarUrl: profile.avatarR2Key ? "/api/me/avatar" : null } : null,
    memberships,
    capabilities,
    membershipRequests,
    platformAdmin: await isPlatformAdmin(currentUser.id, currentUser.email, env),
  });
}

async function handleProfileUpdate(request: Request, env: Env) {
  const currentUser = await requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const body = await readJson<{
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    duprSingles?: number | null;
    duprDoubles?: number | null;
    duprId?: string | null;
    birthDate?: string | null;
    sportGender?: string | null;
    city?: string | null;
    countryCode?: string | null;
    preferredLocale?: string;
  }>(request);
  const current = await env.HUAU_DB.prepare(
    `SELECT first_name as firstName,last_name as lastName,phone,dupr_singles as duprSingles,dupr_doubles as duprDoubles,
            dupr_id as duprId,birth_date as birthDate,sport_gender as sportGender,city,country_code as countryCode,
            preferred_locale as preferredLocale
       FROM user_profiles WHERE user_id=?`,
  ).bind(currentUser.id).first<{
    firstName:string; lastName:string; phone:string|null; duprSingles:number|null; duprDoubles:number|null;
    duprId:string|null; birthDate:string|null; sportGender:string|null; city:string|null; countryCode:string|null;
    preferredLocale:string;
  }>();
  const firstName = body.firstName?.trim() || current?.firstName || currentUser.name.split(" ")[0] || "Player";
  const lastName = body.lastName?.trim() ?? current?.lastName ?? currentUser.name.split(" ").slice(1).join(" ");
  const sportGender = body.sportGender === undefined
    ? current?.sportGender ?? null
    : body.sportGender === "male" || body.sportGender === "female" ? body.sportGender : null;
  const birthDate = body.birthDate === undefined ? current?.birthDate ?? null : body.birthDate || null;
  const numericDupr = (value: number | null | undefined, currentValue: number | null | undefined) =>
    value === undefined ? currentValue ?? null : value === null ? null : Number(value);
  const duprSingles = numericDupr(body.duprSingles, current?.duprSingles);
  const duprDoubles = numericDupr(body.duprDoubles, current?.duprDoubles);
  const duprId = body.duprId === undefined ? current?.duprId ?? null : body.duprId?.trim() || null;
  const countryCode = body.countryCode === undefined
    ? current?.countryCode ?? null
    : body.countryCode?.trim().toUpperCase() || null;
  if (
    (duprSingles !== null && (!Number.isFinite(duprSingles) || duprSingles < 0 || duprSingles > 8)) ||
    (duprDoubles !== null && (!Number.isFinite(duprDoubles) || duprDoubles < 0 || duprDoubles > 8))
  ) return json({ok:false,code:"INVALID_DUPR"},{status:400});
  if (duprId && duprId.length > 80) return json({ ok:false, code:"INVALID_DUPR_ID" }, { status:400 });
  if (countryCode && countryCode.length > 3) return json({ ok:false, code:"INVALID_COUNTRY_CODE" }, { status:400 });
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return json({ ok:false, code:"INVALID_BIRTH_DATE" }, { status:400 });
  const stamp = now();
  const db = createDb(env.HUAU_DB);
  await db.insert(userProfiles).values({
    userId:currentUser.id,
    firstName,
    lastName,
    phone:body.phone===undefined?current?.phone??null:body.phone,
    duprSingles,
    duprDoubles,
    duprId,
    birthDate,
    sportGender,
    city:body.city===undefined?current?.city??null:body.city,
    countryCode,
    preferredLocale:body.preferredLocale??current?.preferredLocale??"es-UY",
    createdAt:stamp,
    updatedAt:stamp,
  }).onConflictDoUpdate({
    target:userProfiles.userId,
    set:{
      firstName,
      lastName,
      phone:body.phone===undefined?current?.phone??null:body.phone,
      duprSingles,
      duprDoubles,
      duprId,
      birthDate,
      sportGender,
      city:body.city===undefined?current?.city??null:body.city,
      countryCode,
      preferredLocale:body.preferredLocale??current?.preferredLocale??"es-UY",
      updatedAt:stamp,
    },
  });
  return json({ ok: true });
}

async function handleMeAvatar(request: Request, env: Env) {
  const currentUser = await requireUser(request, env);
  if (!currentUser) return json({ ok:false, code:"UNAUTHENTICATED" }, { status:401 });
  const current = await env.HUAU_DB.prepare(
    `SELECT avatar_r2_key as avatarR2Key FROM user_profiles WHERE user_id=?`,
  ).bind(currentUser.id).first<{ avatarR2Key:string|null }>();
  if (!current) return json({ ok:false, code:"PROFILE_NOT_FOUND" }, { status:404 });

  if (request.method === "GET") {
    if (!current.avatarR2Key) return json({ ok:false, code:"AVATAR_NOT_FOUND" }, { status:404 });
    const object = await env.HUAU_ASSETS.get(current.avatarR2Key);
    if (!object) return json({ ok:false, code:"AVATAR_NOT_FOUND" }, { status:404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "image/jpeg",
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (request.method === "DELETE") {
    await env.HUAU_DB.prepare(
      `UPDATE user_profiles SET avatar_r2_key=NULL,updated_at=? WHERE user_id=?`,
    ).bind(Date.now(), currentUser.id).run();
    if (current.avatarR2Key) await env.HUAU_ASSETS.delete(current.avatarR2Key);
    return json({ ok:true });
  }

  if (request.method !== "PUT") return json({ ok:false, code:"METHOD_NOT_ALLOWED" }, { status:405 });
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : contentType === "image/jpeg" ? "jpg" : "";
  if (!extension) return json({ ok:false, code:"AVATAR_TYPE_NOT_ALLOWED" }, { status:415 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) {
    return json({ ok:false, code:"AVATAR_TOO_LARGE" }, { status:413 });
  }

  const key = `profiles/${currentUser.id}/avatar/${crypto.randomUUID()}.${extension}`;
  await env.HUAU_ASSETS.put(key, bytes, { httpMetadata: { contentType } });
  try {
    await env.HUAU_DB.prepare(
      `UPDATE user_profiles SET avatar_r2_key=?,updated_at=? WHERE user_id=?`,
    ).bind(key, Date.now(), currentUser.id).run();
  } catch (error) {
    await env.HUAU_ASSETS.delete(key);
    throw error;
  }
  if (current.avatarR2Key && current.avatarR2Key !== key) await env.HUAU_ASSETS.delete(current.avatarR2Key);
  return json({ ok:true, avatarUrl:"/api/me/avatar" });
}

async function handleOrganizationList(env: Env) {
  const db = createDb(env.HUAU_DB);
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      type: organizations.type,
      status: organizations.status,
      description: organizations.publicDescription,
    })
    .from(organizations)
    .where(inArray(organizations.status, ["active", "trial"]));
  return json({ ok: true, organizations: rows });
}

async function handleOrganizationPublic(slug: string, env: Env) {
  const db = createDb(env.HUAU_DB);
  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!organization || organization.status === "archived") {
    return json({ ok: false, code: "ORGANIZATION_NOT_FOUND" }, { status: 404 });
  }
  return json({ ok: true, organization });
}

async function handleMembershipRequest(request: Request, organizationId: string, env: Env) {
  const currentUser = await requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const db = createDb(env.HUAU_DB);
  const [organization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return json({ ok: false, code: "ORGANIZATION_NOT_FOUND" }, { status: 404 });

  const [membership] = await db
    .select({ status: organizationMemberships.status })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, currentUser.id),
      ),
    )
    .limit(1);
  if (membership?.status === "active") {
    return json({ ok: false, code: "ALREADY_MEMBER" }, { status: 409 });
  }
  const [pending] = await db
    .select({ id: organizationMembershipRequests.id })
    .from(organizationMembershipRequests)
    .where(
      and(
        eq(organizationMembershipRequests.organizationId, organizationId),
        eq(organizationMembershipRequests.userId, currentUser.id),
        eq(organizationMembershipRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) return json({ ok: false, code: "REQUEST_ALREADY_PENDING" }, { status: 409 });

  let body: { note?: string } = {};
  try {
    body = await readJson<{ note?: string }>(request);
  } catch {
    body = {};
  }
  const stamp = now();
  await db.insert(organizationMembershipRequests).values({
    id: id(),
    organizationId,
    userId: currentUser.id,
    status: "pending",
    note: body.note?.trim() || null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  return json({ ok: true }, { status: 201 });
}

async function handleAdminRequests(request: Request, organizationId: string, env: Env) {
  const currentUser = await requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (!(await isOrgAdmin(currentUser.id, organizationId, env, request))) {
    return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  const result = await env.HUAU_DB.prepare(
    `SELECT r.id, r.user_id as userId, r.note, r.created_at as createdAt,
            u.name, u.email,
            p.first_name as firstName, p.last_name as lastName
       FROM organization_membership_requests r
       JOIN "user" u ON u.id = r.user_id
       LEFT JOIN user_profiles p ON p.user_id = r.user_id
      WHERE r.organization_id = ? AND r.status = 'pending'
      ORDER BY r.created_at ASC`,
  )
    .bind(organizationId)
    .all();
  return json({ ok: true, requests: result.results });
}

async function handleReviewRequest(request: Request, requestId: string, env: Env) {
  const currentUser = await requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const requestRow = await env.HUAU_DB.prepare(
    `SELECT organization_id as organizationId, user_id as userId, status
       FROM organization_membership_requests WHERE id = ?`,
  )
    .bind(requestId)
    .first<{ organizationId: string; userId: string; status: string }>();
  if (!requestRow) return json({ ok: false, code: "REQUEST_NOT_FOUND" }, { status: 404 });
  if (!(await isOrgAdmin(currentUser.id, requestRow.organizationId, env, request))) {
    return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  if (requestRow.status !== "pending") {
    return json({ ok: false, code: "REQUEST_ALREADY_REVIEWED" }, { status: 409 });
  }
  const body = await readJson<{ decision: "approve" | "reject" }>(request);
  const stamp = Date.now();
  if (body.decision === "reject") {
    await env.HUAU_DB.prepare(
      `UPDATE organization_membership_requests
          SET status='rejected', reviewed_by_user_id=?, reviewed_at=?, updated_at=?
        WHERE id=? AND status='pending'`,
    )
      .bind(currentUser.id, stamp, stamp, requestId)
      .run();
    return json({ ok: true });
  }
  if (body.decision !== "approve") {
    return json({ ok: false, code: "INVALID_DECISION" }, { status: 400 });
  }

  const target = await env.HUAU_DB.prepare(
    `SELECT u.name, u.email, p.first_name as firstName, p.last_name as lastName
       FROM "user" u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?`,
  )
    .bind(requestRow.userId)
    .first<{ name: string; email: string; firstName: string | null; lastName: string | null }>();
  if (!target) return json({ ok: false, code: "USER_NOT_FOUND" }, { status: 404 });
  const parts = target.name.trim().split(/\s+/);
  const firstName = target.firstName || parts[0] || "Usuario";
  const lastName = target.lastName || parts.slice(1).join(" ") || "HUAU";
  const existingPerson = await env.HUAU_DB.prepare(
    `SELECT id FROM organization_people WHERE organization_id=? AND user_id=? LIMIT 1`,
  )
    .bind(requestRow.organizationId, requestRow.userId)
    .first<{ id: string }>();
  const personId = existingPerson?.id ?? id();
  const membershipId = id();
  const statements = [];
  if (existingPerson) {
    statements.push(
      env.HUAU_DB.prepare(
        `UPDATE organization_people SET first_name=?,last_name=?,email=?,status='active',updated_at=? WHERE id=?`,
      ).bind(firstName, lastName, target.email, stamp, personId),
    );
  } else {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO organization_people
         (id,organization_id,user_id,first_name,last_name,email,source,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,'user','active',?,?)`,
      ).bind(personId, requestRow.organizationId, requestRow.userId, firstName, lastName, target.email, stamp, stamp),
    );
  }
  statements.push(
    env.HUAU_DB.prepare(
      `INSERT INTO organization_memberships
       (id,organization_id,user_id,organization_person_id,status,starts_at,created_at,updated_at)
       VALUES (?,?,?,?,'active',?,?,?)
       ON CONFLICT(organization_id,user_id) DO UPDATE SET organization_person_id=excluded.organization_person_id,status='active', starts_at=excluded.starts_at, updated_at=excluded.updated_at`,
    ).bind(membershipId, requestRow.organizationId, requestRow.userId, personId, stamp, stamp, stamp),
    env.HUAU_DB.prepare(
      `UPDATE organization_membership_requests
          SET status='approved', reviewed_by_user_id=?, reviewed_at=?, updated_at=?
        WHERE id=? AND status='pending'`,
    ).bind(currentUser.id, stamp, stamp, requestId),
  );
  await env.HUAU_DB.batch(statements);
  return json({ ok: true });
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function handlePlatformCreateOrganization(request: Request, env: Env) {
  const currentUser = await requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (!(await isPlatformAdmin(currentUser.id, currentUser.email, env))) {
    return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  const body = await readJson<{
    name?: string;
    slug?: string;
    type?: "club" | "sports_complex" | "community" | "academy" | "organizer" | "league" | "federation";
    description?: string;
  }>(request);
  const name = body.name?.trim();
  const slug = slugify(body.slug?.trim() || name || "");
  if (!name || !slug || !body.type) {
    return json({ ok: false, code: "INVALID_ORGANIZATION" }, { status: 400 });
  }
  const orgId = id();
  const stamp = Date.now();
  const personId = id();
  const membershipId = id();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `INSERT INTO organizations
       (id,name,slug,type,status,default_locale,timezone,default_currency,public_description,created_at,updated_at)
       VALUES (?,?,?,?,'trial','es-UY','America/Montevideo','UYU',?,?,?)`,
    ).bind(orgId, name, slug, body.type, body.description?.trim() || null, stamp, stamp),
    env.HUAU_DB.prepare(
      `INSERT INTO organization_people
       (id,organization_id,user_id,first_name,last_name,email,source,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'user','active',?,?)`,
    ).bind(personId, orgId, currentUser.id, currentUser.name.split(" ")[0] || "Admin", currentUser.name.split(" ").slice(1).join(" ") || "HUAU", currentUser.email, stamp, stamp),
    env.HUAU_DB.prepare(
      `INSERT INTO organization_memberships
       (id,organization_id,user_id,organization_person_id,status,starts_at,created_at,updated_at)
       VALUES (?,?,?,?,'active',?,?,?)`,
    ).bind(membershipId, orgId, currentUser.id, personId, stamp, stamp, stamp),
    env.HUAU_DB.prepare(
      `INSERT INTO organization_user_capabilities
       (id,organization_id,user_id,capability,status,created_at,updated_at)
       VALUES (?,?,?,'org_admin','active',?,?)`,
    ).bind(id(), orgId, currentUser.id, stamp, stamp),
    env.HUAU_DB.prepare(
      `INSERT INTO organization_modules (id,organization_id,module,enabled,created_at,updated_at)
       VALUES (?,?, 'club',1,?,?), (?,?,'tournament',1,?,?), (?,?,'ref',1,?,?)`,
    ).bind(id(), orgId, stamp, stamp, id(), orgId, stamp, stamp, id(), orgId, stamp, stamp),
  ]);
  return json({ ok: true, organization: { id: orgId, name, slug } }, { status: 201 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) {
      return createAuth(env).handler(request);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "huau-sports", env: env.APP_ENV, version: env.APP_VERSION });
    }

    if (url.pathname === "/api/db-health") {
      try {
        const row = await env.HUAU_DB.prepare("SELECT key,value,updated_at FROM app_meta WHERE key='schema_version'").first();
        return json({ ok: true, meta: row ? [row] : [] });
      } catch (error) {
        return json(
          { ok: false, code: "DB_UNAVAILABLE_OR_UNMIGRATED", message: error instanceof Error ? error.message : "Unknown D1 error" },
          { status: 503 },
        );
      }
    }

    if (url.pathname === "/api/me" && request.method === "GET") return handleMe(request, env);
    if (url.pathname === "/api/me/profile" && request.method === "PUT") return handleProfileUpdate(request, env);
    if (url.pathname === "/api/me/avatar" && ["GET","PUT","DELETE"].includes(request.method)) return handleMeAvatar(request, env);
    if (url.pathname === "/api/organizations" && request.method === "GET") return handleOrganizationList(env);

    const publicOrg = url.pathname.match(/^\/api\/organizations\/([^/]+)$/);
    if (publicOrg && request.method === "GET") return handleOrganizationPublic(decodeURIComponent(publicOrg[1]!), env);

    const joinOrg = url.pathname.match(/^\/api\/organizations\/([^/]+)\/membership-requests$/);
    if (joinOrg && request.method === "POST") return handleMembershipRequest(request, decodeURIComponent(joinOrg[1]!), env);

    const adminRequests = url.pathname.match(/^\/api\/admin\/organizations\/([^/]+)\/membership-requests$/);
    if (adminRequests && request.method === "GET") return handleAdminRequests(request, decodeURIComponent(adminRequests[1]!), env);

    const review = url.pathname.match(/^\/api\/admin\/membership-requests\/([^/]+)\/review$/);
    if (review && request.method === "POST") return handleReviewRequest(request, decodeURIComponent(review[1]!), env);

    if (url.pathname === "/api/platform/organizations" && request.method === "POST") {
      return handlePlatformCreateOrganization(request, env);
    }

    const paymentResponse = await handlePaymentApi(request, env, { requireUser, isOrgAdmin });
    if (paymentResponse) return paymentResponse;

    const registrationResponse = await handleRegistrationApi(request, env, { requireUser, isOrgAdmin });
    if (registrationResponse) return registrationResponse;

    const teamAdminResponse = await handleTeamAdminApi(request, env, url, {
      requireUser,
      isOrgAdmin,
    });
    if (teamAdminResponse) return teamAdminResponse;

    const tournamentAdminResponse = await handleTournamentAdminApi(request, env, url, {
      requireUser,
      isOrgAdmin,
    });
    if (tournamentAdminResponse) return tournamentAdminResponse;

    if (url.pathname.startsWith("/api/")) return json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    return json({ ok: false, code: "WORKER_ROUTE_NOT_FOUND" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
