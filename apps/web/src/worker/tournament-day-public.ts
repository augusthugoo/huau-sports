type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isOrgAdmin: (userId: string, organizationId: string, env: Env, request?: Request) => Promise<boolean>;
};

type ManifestEntry = {
  tournamentId: string;
  slug: string;
  name: string;
  sport: string;
  startAt: number;
  endAt: number | null;
  status: "scheduled" | "live" | "finished";
  showOnLanding?: boolean;
  structureRevision: number;
  liveRevision: number;
  updatedAt: number;
};

type LiveManifest = { schemaVersion: 1; updatedAt: number; tournaments: ManifestEntry[] };

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

const MANIFEST_KEY = "public/live-tournaments.json";
const MAX_PUBLIC_JSON = 1_500_000;
const PRIVATE_KEYS = new Set([
  "contact",
  "email",
  "phone",
  "payment",
  "paymentstatus",
  "proof",
  "proofkey",
  "proofr2key",
  "userid",
  "organizationpersonid",
  "registrationid",
  "notes",
  "token",
]);

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[_-]/g, "");
}

function hasPrivateKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPrivateKey);
  if (!value || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_KEYS.has(normalizeKey(key))) return true;
    if (hasPrivateKey(item)) return true;
  }
  return false;
}

function publicModelShape(value: unknown, kind: "structure" | "live", tournamentId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PUBLIC_MODEL_INVALID");
  const model = value as Record<string, unknown>;
  if (model.schemaVersion !== 1 || model.kind !== kind) throw new Error("PUBLIC_MODEL_INVALID");
  const tournament = model.tournament as Record<string, unknown> | undefined;
  if (!tournament || String(tournament.id ?? "") !== tournamentId) throw new Error("PUBLIC_MODEL_TOURNAMENT_MISMATCH");
  if (hasPrivateKey(model)) throw new Error("PUBLIC_MODEL_PRIVATE_FIELD");
  const serialized = JSON.stringify(model);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PUBLIC_JSON) throw new Error("PUBLIC_MODEL_TOO_LARGE");
  return { model, serialized, tournament };
}

async function readManifest(env: Env): Promise<LiveManifest> {
  const object = await env.HUAU_ASSETS.get(MANIFEST_KEY);
  if (!object) return { schemaVersion: 1, updatedAt: Date.now(), tournaments: [] };
  try {
    const value = JSON.parse(await object.text()) as LiveManifest;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.tournaments)) throw new Error("INVALID");
    return value;
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), tournaments: [] };
  }
}

async function writeManifest(env: Env, manifest: LiveManifest) {
  manifest.updatedAt = Date.now();
  manifest.tournaments.sort((a, b) => {
    const rank = (status: ManifestEntry["status"]) => status === "live" ? 0 : status === "scheduled" ? 1 : 2;
    return rank(a.status) - rank(b.status) || a.startAt - b.startAt || a.name.localeCompare(b.name);
  });
  await env.HUAU_ASSETS.put(MANIFEST_KEY, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=30" },
  });
}

export async function setTournamentLandingPromotion(
  env: Env,
  tournamentId: string,
  enabled: boolean,
): Promise<boolean> {
  const manifest = await readManifest(env);
  const entry = manifest.tournaments.find((candidate) => candidate.tournamentId === tournamentId);
  if (!entry) return false;
  entry.showOnLanding = enabled;
  entry.updatedAt = Date.now();
  await writeManifest(env, manifest);
  return true;
}

export async function cleanupDeletedTournamentPublicArtifacts(
  env: Env,
  tournamentId: string,
  slug: string,
): Promise<void> {
  const manifest = await readManifest(env);
  const next = manifest.tournaments.filter((entry) => entry.tournamentId !== tournamentId);
  if (next.length !== manifest.tournaments.length) {
    manifest.tournaments = next;
    await writeManifest(env, manifest);
  }
  await Promise.all([
    env.HUAU_ASSETS.delete(`public/tournaments/${tournamentId}/structure.json`),
    env.HUAU_ASSETS.delete(`public/tournaments/${tournamentId}/live.json`),
    env.HUAU_ASSETS.delete(`public/tournaments/${slug}/core.json`),
    env.HUAU_ASSETS.delete(`public/tournaments/${slug}/community-link.json`),
    env.HUAU_ASSETS.delete("public/landing.json"),
  ]);
}

async function adminTournament(request: Request, env: Env, tournamentId: string, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const tournament = await env.HUAU_DB.prepare(
    `SELECT id,organizer_organization_id as organizationId,name,slug,sport,start_at as startAt,end_at as endAt,
            public_live as publicLive
       FROM tournaments WHERE id=?`,
  ).bind(tournamentId).first<{ id: string; organizationId: string; name: string; slug: string; sport: string; startAt: number; endAt: number | null; publicLive: number }>();
  if (!tournament) return json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });
  if (!(await access.isOrgAdmin(user.id, tournament.organizationId, env, request))) {
    return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  return { user, tournament };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function operatorTournament(env: Env, token: string) {
  const tokenHash = await sha256(token);
  const row = await env.HUAU_DB.prepare(
    `SELECT t.id,t.name,t.slug,t.sport,t.start_at as startAt,t.end_at as endAt,t.public_live as publicLive
       FROM tournament_day_state ds
       JOIN tournaments t ON t.id=ds.tournament_id
      WHERE ds.token_hash=? LIMIT 1`,
  ).bind(tokenHash).first<{ id: string; name: string; slug: string; sport: string; startAt: number; endAt: number | null; publicLive: number }>();
  if (!row) return null;
  return row;
}

async function publishModel(env: Env, tournament: { id: string; name: string; slug: string; sport: string; startAt: number; endAt: number | null; publicLive: number }, kind: "structure" | "live", body: unknown) {
  const { model, serialized } = publicModelShape(body, kind, tournament.id);
  const key = `public/tournaments/${tournament.id}/${kind}.json`;
  await env.HUAU_ASSETS.put(key, serialized, {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=10" },
    customMetadata: { tournamentId: tournament.id, kind, revision: String(Number(model.revision ?? 0)) },
  });

  const manifest = await readManifest(env);
  const index = manifest.tournaments.findIndex((entry) => entry.tournamentId === tournament.id);
  const prior = index >= 0 ? manifest.tournaments[index]! : null;
  const requestedStatus = kind === "live" && ["scheduled", "live", "finished"].includes(String(model.status))
    ? String(model.status) as ManifestEntry["status"]
    : kind === "live"
      ? "live"
      : prior?.status ?? "scheduled";
  const entry: ManifestEntry = {
    tournamentId: tournament.id,
    slug: tournament.slug,
    name: tournament.name,
    sport: tournament.sport,
    startAt: Number(tournament.startAt),
    endAt: tournament.endAt === null ? null : Number(tournament.endAt),
    status: requestedStatus,
    showOnLanding: Boolean(tournament.publicLive),
    structureRevision: kind === "structure" ? Number(model.revision ?? 0) : Number(prior?.structureRevision ?? 0),
    liveRevision: kind === "live" ? Number(model.revision ?? 0) : Number(prior?.liveRevision ?? 0),
    updatedAt: Date.now(),
  };
  if (index >= 0) manifest.tournaments[index] = entry; else manifest.tournaments.push(entry);
  await writeManifest(env, manifest);
  return json({ ok: true, key, revision: Number(model.revision ?? 0), publishedAt: Date.now(), status: entry.status });
}

async function unpublish(env: Env, tournamentId: string) {
  const manifest = await readManifest(env);
  manifest.tournaments = manifest.tournaments.filter((entry) => entry.tournamentId !== tournamentId);
  await writeManifest(env, manifest);
  await Promise.all([
    env.HUAU_ASSETS.delete(`public/tournaments/${tournamentId}/structure.json`),
    env.HUAU_ASSETS.delete(`public/tournaments/${tournamentId}/live.json`),
  ]);
  return json({ ok: true });
}

async function publicBundle(env: Env, slug: string) {
  const manifest = await readManifest(env);
  const entry = manifest.tournaments.find((candidate) => candidate.slug === slug);
  if (!entry) return json({ ok: false, code: "TOURNAMENT_LIVE_NOT_PUBLISHED" }, { status: 404, headers: { "cache-control": "public, max-age=15" } });
  const [structureObject, liveObject] = await Promise.all([
    env.HUAU_ASSETS.get(`public/tournaments/${entry.tournamentId}/structure.json`),
    env.HUAU_ASSETS.get(`public/tournaments/${entry.tournamentId}/live.json`),
  ]);
  if (!structureObject) return json({ ok: false, code: "TOURNAMENT_STRUCTURE_NOT_PUBLISHED" }, { status: 404 });
  const structure = JSON.parse(await structureObject.text());
  const live = liveObject ? JSON.parse(await liveObject.text()) : null;
  return new Response(JSON.stringify({ ok: true, manifest: entry, structure, live }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=10, stale-while-revalidate=20" },
  });
}

export async function handleTournamentDayPublicApi(request: Request, env: Env, url: URL, access: AccessHelpers): Promise<Response | null> {
  if (url.pathname === "/api/public/live-tournaments" && request.method === "GET") {
    const manifest = await readManifest(env);
    return new Response(JSON.stringify({ ok: true, ...manifest }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=5, must-revalidate" } });
  }

  const publicRoute = url.pathname.match(/^\/api\/public\/tournaments\/([^/]+)\/day-live$/);
  if (publicRoute && request.method === "GET") return publicBundle(env, decodeURIComponent(publicRoute[1]!));

  const admin = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/day-public\/(structure|live)$/);
  if (admin && request.method === "PUT") {
    const tournamentId = decodeURIComponent(admin[1]!);
    const accessResult = await adminTournament(request, env, tournamentId, access);
    if (accessResult instanceof Response) return accessResult;
    const body = await request.json().catch(() => null);
    try { return await publishModel(env, accessResult.tournament, admin[2] as "structure" | "live", body); }
    catch (error) { return json({ ok: false, code: error instanceof Error ? error.message : "PUBLIC_MODEL_PUBLISH_FAILED" }, { status: 400 }); }
  }
  if (admin && request.method === "DELETE") {
    const tournamentId = decodeURIComponent(admin[1]!);
    const accessResult = await adminTournament(request, env, tournamentId, access);
    if (accessResult instanceof Response) return accessResult;
    return unpublish(env, tournamentId);
  }

  const operator = url.pathname.match(/^\/api\/operate\/([^/]+)\/public-(structure|live)$/);
  if (operator && request.method === "PUT") {
    const token = decodeURIComponent(operator[1]!);
    const tournament = await operatorTournament(env, token);
    if (!tournament) return json({ ok: false, code: "TOURNAMENT_DAY_ACCESS_INVALID" }, { status: 404 });
    const body = await request.json().catch(() => null);
    try { return await publishModel(env, tournament, operator[2] as "structure" | "live", body); }
    catch (error) { return json({ ok: false, code: error instanceof Error ? error.message : "PUBLIC_MODEL_PUBLISH_FAILED" }, { status: 400 }); }
  }

  return null;
}
