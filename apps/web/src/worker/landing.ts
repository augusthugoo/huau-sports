import { handleLandingTutorialApi, loadPublicLandingTutorials } from "./landing-tutorials";
import type { PublicLandingTutorial } from "./landing-tutorials";
type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isPlatformAdmin: (userId: string, email: string, env: Env) => Promise<boolean>;
};

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...init.headers },
});
const heroKey = (slot: number) => `landing/hero-${slot}`;
const publicLandingSnapshotKey = "public/landing.json";
const platformSupportKey = "platform/support.json";
const validSlot = (raw: string) => { const slot = Number(raw); return Number.isInteger(slot) && slot >= 1 && slot <= 3 ? slot : null; };
const now = () => Date.now();
const unixNow = () => Math.floor(Date.now() / 1000);

type LandingTournamentRow = {
  id: string;
  name: string;
  slug: string;
  sport: string;
  status: string;
  startAt: number;
  endAt: number | null;
  heroImageUrl: string | null;
};

type PublicLandingPayload = {
  ok: true;
  heroes: Array<{ slot: number; url: string }>;
  tournaments: LandingTournamentRow[];
  tutorials: PublicLandingTutorial[];
};

type PublicLandingSnapshot = {
  version: 2;
  generatedAt: number;
  validUntil: number;
  payload: PublicLandingPayload;
};

function normalizeWhatsapp(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (/^09\d{7}$/.test(digits)) digits = `598${digits.slice(1)}`;
  else if (/^9\d{7}$/.test(digits)) digits = `598${digits}`;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

async function loadSupportWhatsapp(env: Env): Promise<string> {
  const object = await env.HUAU_ASSETS.get(platformSupportKey);
  if (!object) return "";
  try {
    const parsed = JSON.parse(await object.text()) as { whatsapp?: unknown };
    return typeof parsed.whatsapp === "string" ? parsed.whatsapp : "";
  } catch {
    return "";
  }
}

async function platformUser(request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return { response: json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!(await access.isPlatformAdmin(user.id, user.email, env))) return { response: json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) };
  return { user };
}

async function buildPublicLandingSnapshot(env: Env): Promise<PublicLandingSnapshot> {
  const generatedAt = unixNow();
  const tournamentCutoff = generatedAt - 86_400;
  const rows = await env.HUAU_DB.prepare(
    `SELECT id,name,slug,sport,status,start_at as startAt,end_at as endAt,
            CASE WHEN public_hero_r2_key IS NOT NULL AND TRIM(public_hero_r2_key) <> ''
                 THEN '/api/public/tournaments/' || slug || '/hero' ELSE NULL END as heroImageUrl
       FROM tournaments
      WHERE visibility='public'
        AND status IN ('registration_open','registration_closed','draw_ready','scheduled','live')
        AND (end_at IS NULL OR end_at >= ?)
      ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'registration_open' THEN 1 ELSE 2 END,start_at
      LIMIT 9`,
  ).bind(tournamentCutoff).all<LandingTournamentRow>();

  const timeExpiryCandidates = rows.results
    .map((row) => row.endAt === null ? null : row.endAt + 86_400)
    .filter((value): value is number => value !== null && value > generatedAt);
  const safetyExpiry = generatedAt + 3_600;
  const validUntil = Math.max(
    generatedAt + 60,
    timeExpiryCandidates.length ? Math.min(safetyExpiry, ...timeExpiryCandidates) : safetyExpiry,
  );

  const tutorials = await loadPublicLandingTutorials(env);

  return {
    version: 2,
    generatedAt,
    validUntil,
    payload: {
      ok: true,
      heroes: [1, 2, 3].map((slot) => ({ slot, url: `/api/public/landing/hero/${slot}` })),
      tournaments: rows.results,
      tutorials,
    },
  };
}

async function publicLanding(env: Env) {
  const cached = await env.HUAU_ASSETS.get(publicLandingSnapshotKey);
  if (cached) {
    try {
      const snapshot = JSON.parse(await cached.text()) as PublicLandingSnapshot;
      if (
        snapshot.version === 2 &&
        snapshot.payload?.ok === true &&
        Number(snapshot.validUntil) > unixNow()
      ) {
        return json(snapshot.payload, { headers: { "x-huau-public-source": "r2" } });
      }
    } catch {
      // Corrupt/old cache is disposable; D1 remains canonical.
    }
    await env.HUAU_ASSETS.delete(publicLandingSnapshotKey).catch(() => undefined);
  }

  const snapshot = await buildPublicLandingSnapshot(env);
  await env.HUAU_ASSETS.put(publicLandingSnapshotKey, JSON.stringify(snapshot), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      kind: "public-landing",
      generatedAt: String(snapshot.generatedAt),
      validUntil: String(snapshot.validUntil),
    },
  }).catch(() => undefined);

  return json(snapshot.payload, { headers: { "x-huau-public-source": "d1-fill" } });
}

async function publicHero(slot: number, env: Env) {
  const object = await env.HUAU_ASSETS.get(heroKey(slot));
  if (!object) return json({ ok: false, code: "LANDING_HERO_NOT_FOUND" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType || "image/jpeg",
      "cache-control": "public, max-age=60, must-revalidate",
      "etag": object.httpEtag,
      "x-content-type-options": "nosniff",
    },
  });
}

async function submitContact(request: Request, env: Env) {
  const body = await request.json() as {
    name?: string; organization?: string; email?: string; phone?: string | null;
    organizationType?: string; message?: string; website?: string;
  };
  if (body.website?.trim()) return json({ ok: true });
  const name = body.name?.trim() || "";
  const organization = body.organization?.trim() || "";
  const email = body.email?.trim().toLowerCase() || "";
  const phone = body.phone?.trim() || null;
  const organizationType = body.organizationType?.trim() || "other";
  const message = body.message?.trim() || "";
  if (!name || name.length > 120 || !organization || organization.length > 160 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 200 || message.length < 3 || message.length > 3000 || (phone && phone.length > 60)) {
    return json({ ok: false, code: "INVALID_CONTACT" }, { status: 400 });
  }
  if (!["club","league","academy","federation","organizer","other"].includes(organizationType)) return json({ ok: false, code: "INVALID_ORGANIZATION_TYPE" }, { status: 400 });
  const stamp = now();
  try {
    await env.HUAU_DB.prepare(
      `INSERT INTO platform_contact_leads (id,name,organization,email,phone,organization_type,message,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'new',?,?)`,
    ).bind(crypto.randomUUID(), name, organization, email, phone, organizationType, message, stamp, stamp).run();
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "";
    if (messageText.includes("no such table")) return json({ ok: false, code: "CONTACT_STORAGE_NOT_READY" }, { status: 503 });
    throw error;
  }
  return json({ ok: true }, { status: 201 });
}

async function platformLanding(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const [heroObjects, supportWhatsapp] = await Promise.all([
    Promise.all([1, 2, 3].map((slot) => env.HUAU_ASSETS.head(heroKey(slot)))),
    loadSupportWhatsapp(env),
  ]);
  let leads: unknown[] = [];
  let contactStorageReady = true;
  try {
    const result = await env.HUAU_DB.prepare(
      `SELECT id,name,organization,email,phone,organization_type as organizationType,message,status,created_at as createdAt
         FROM platform_contact_leads ORDER BY created_at DESC LIMIT 50`,
    ).all();
    leads = result.results;
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) contactStorageReady = false;
    else throw error;
  }
  return json({
    ok: true,
    heroes: [1, 2, 3].map((slot, index) => ({ slot, url: `/api/public/landing/hero/${slot}`, configured: Boolean(heroObjects[index]) })),
    leads,
    contactStorageReady,
    supportWhatsapp,
  });
}

async function updateSupportWhatsapp(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const body = await request.json() as { whatsapp?: unknown };
  const raw = typeof body.whatsapp === "string" ? body.whatsapp.trim() : "";
  const whatsapp = normalizeWhatsapp(raw);
  if (whatsapp === null) return json({ ok: false, code: "INVALID_SUPPORT_WHATSAPP" }, { status: 400 });
  const stamp = now();
  await env.HUAU_ASSETS.put(platformSupportKey, JSON.stringify({ whatsapp, updatedAt: stamp }), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { kind: "platform-support", updatedAt: String(stamp) },
  });
  return json({ ok: true, supportWhatsapp: whatsapp });
}

async function updateHero(request: Request, slot: number, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  if (request.method === "DELETE") {
    await env.HUAU_ASSETS.delete(heroKey(slot));
    return json({ ok: true });
  }
  if (request.method !== "PUT") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  if (!["image/jpeg","image/png","image/webp","image/avif"].includes(contentType)) return json({ ok: false, code: "LANDING_HERO_TYPE_NOT_ALLOWED" }, { status: 415 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) return json({ ok: false, code: "LANDING_HERO_TOO_LARGE" }, { status: 413 });
  await env.HUAU_ASSETS.put(heroKey(slot), bytes, { httpMetadata: { contentType }, customMetadata: { updatedAt: String(now()) } });
  return json({ ok: true, url: `/api/public/landing/hero/${slot}` });
}

export async function handleLandingApi(request: Request, env: Env, url: URL, access: AccessHelpers): Promise<Response | null> {
  if (url.pathname === "/api/public/landing" && request.method === "GET") return publicLanding(env);
  if (url.pathname === "/api/public/contact" && request.method === "POST") return submitContact(request, env);
  const tutorialResponse = await handleLandingTutorialApi(request, env, url, access);
  if (tutorialResponse) return tutorialResponse;
  const publicHeroMatch = url.pathname.match(/^\/api\/public\/landing\/hero\/([1-3])$/);
  if (publicHeroMatch && request.method === "GET") return publicHero(Number(publicHeroMatch[1]), env);
  if (url.pathname === "/api/platform/landing" && request.method === "GET") return platformLanding(request, env, access);
  if (url.pathname === "/api/platform/support" && request.method === "PUT") return updateSupportWhatsapp(request, env, access);
  const platformHeroMatch = url.pathname.match(/^\/api\/platform\/landing\/hero\/([^/]+)$/);
  if (platformHeroMatch) {
    const slot = validSlot(decodeURIComponent(platformHeroMatch[1]!));
    if (!slot) return json({ ok: false, code: "INVALID_HERO_SLOT" }, { status: 400 });
    if (["PUT","DELETE"].includes(request.method)) return updateHero(request, slot, env, access);
  }
  return null;
}
