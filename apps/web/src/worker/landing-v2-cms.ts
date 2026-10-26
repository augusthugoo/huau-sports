import {
  defaultLandingV2AssetModes,
  defaultLandingV2AssetUrls,
  defaultLandingV2EditableContent,
  landingV2AssetIds,
} from "../LandingV2Content";
import type {
  LandingV2AssetId,
  LandingV2AssetMode,
  LandingV2AssetModes,
  LandingV2Content,
  LandingV2EditableContent,
  LandingLocalizedText,
} from "../LandingV2Content";

type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isPlatformAdmin: (userId: string, email: string, env: Env) => Promise<boolean>;
};

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...init.headers },
});

const draftKey = "landing/v2/draft.json";
const publishedKey = "landing/v2/published.json";
const snapshotKey = "public/landing.json";
const draftAssetKey = (id: LandingV2AssetId) => `landing/v2/draft-assets/${id}`;
const publishedAssetKey = (id: LandingV2AssetId) => `landing/v2/published-assets/${id}`;
const now = () => Date.now();

const assetSpecs: Record<LandingV2AssetId, { kind: "image" | "video"; maxBytes: number }> = {
  heroPoster: { kind: "image", maxBytes: 8 * 1024 * 1024 },
  heroVideoMobile: { kind: "video", maxBytes: 60 * 1024 * 1024 },
  heroVideoDesktop: { kind: "video", maxBytes: 60 * 1024 * 1024 },
  journey1: { kind: "image", maxBytes: 8 * 1024 * 1024 },
  journey2: { kind: "image", maxBytes: 8 * 1024 * 1024 },
  journey3: { kind: "image", maxBytes: 8 * 1024 * 1024 },
  journey4: { kind: "image", maxBytes: 8 * 1024 * 1024 },
  scenePoster: { kind: "image", maxBytes: 8 * 1024 * 1024 },
  sceneVideoMobile: { kind: "video", maxBytes: 60 * 1024 * 1024 },
  sceneVideoDesktop: { kind: "video", maxBytes: 60 * 1024 * 1024 },
  personPhoto: { kind: "image", maxBytes: 8 * 1024 * 1024 },
};

const isAssetId = (raw: string): raw is LandingV2AssetId => (landingV2AssetIds as readonly string[]).includes(raw);

async function platformUser(request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return { response: json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!(await access.isPlatformAdmin(user.id, user.email, env))) {
    return { response: json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { user };
}

const localized = (value: unknown, fallback: LandingLocalizedText, max = 240): LandingLocalizedText => {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as { es?: unknown; en?: unknown };
  const es = typeof candidate.es === "string" ? candidate.es.trim().slice(0, max) : fallback.es;
  const en = typeof candidate.en === "string" ? candidate.en.trim().slice(0, max) : fallback.en;
  return { es: es || fallback.es, en: en || fallback.en };
};

const line = (value: unknown, fallback: string, max = 120): string => {
  if (typeof value !== "string") return fallback;
  const next = value.trim().slice(0, max);
  return next || fallback;
};

const paragraph = (value: unknown, fallback: LandingLocalizedText, max = 1200) => localized(value, fallback, max);

export function normalizeLandingV2EditableContent(value: unknown): LandingV2EditableContent {
  const raw = value && typeof value === "object" ? value as Partial<LandingV2EditableContent> : {};
  const d = defaultLandingV2EditableContent;
  const rawItems = Array.isArray(raw.journey?.items) ? raw.journey?.items : [];
  return {
    nav: {
      tournaments: localized(raw.nav?.tournaments, d.nav.tournaments, 60),
      how: localized(raw.nav?.how, d.nav.how, 60),
      person: localized(raw.nav?.person, d.nav.person, 60),
      organize: localized(raw.nav?.organize, d.nav.organize, 60),
      help: localized(raw.nav?.help, d.nav.help, 60),
    },
    hero: {
      title: localized(raw.hero?.title, d.hero.title, 160),
      body: paragraph(raw.hero?.body, d.hero.body, 900),
      cta: localized(raw.hero?.cta, d.hero.cta, 80),
    },
    tournaments: {
      title: localized(raw.tournaments?.title, d.tournaments.title, 120),
      body: paragraph(raw.tournaments?.body, d.tournaments.body, 700),
      upcoming: localized(raw.tournaments?.upcoming, d.tournaments.upcoming, 50),
      results: localized(raw.tournaments?.results, d.tournaments.results, 50),
      emptyUpcoming: localized(raw.tournaments?.emptyUpcoming, d.tournaments.emptyUpcoming, 240),
      emptyResults: localized(raw.tournaments?.emptyResults, d.tournaments.emptyResults, 240),
    },
    metrics: {
      playersLabel: localized(raw.metrics?.playersLabel, d.metrics.playersLabel, 80),
      matchesLabel: localized(raw.metrics?.matchesLabel, d.metrics.matchesLabel, 80),
      suffix: typeof raw.metrics?.suffix === "string" ? raw.metrics.suffix.trim().slice(0, 4) : d.metrics.suffix,
    },
    journey: {
      heading: localized(raw.journey?.heading, d.journey.heading, 140),
      keepScrolling: localized(raw.journey?.keepScrolling, d.journey.keepScrolling, 60),
      items: d.journey.items.map((fallback, index) => {
        const item = rawItems[index];
        return {
          label: localized(item?.label, fallback.label, 100),
          title: localized(item?.title, fallback.title, 120),
          body: paragraph(item?.body, fallback.body, 700),
        };
      }),
    },
    scene: {
      title: localized(raw.scene?.title, d.scene.title, 180),
      body: paragraph(raw.scene?.body, d.scene.body, 700),
    },
    person: {
      sectionTitle: localized(raw.person?.sectionTitle, d.person.sectionTitle, 120),
      kicker: localized(raw.person?.kicker, d.person.kicker, 100),
      headline: localized(raw.person?.headline, d.person.headline, 180),
      name: line(raw.person?.name, d.person.name, 80),
      body: paragraph(raw.person?.body, d.person.body, 900),
      learnMore: localized(raw.person?.learnMore, d.person.learnMore, 60),
      close: localized(raw.person?.close, d.person.close, 60),
    },
    organize: {
      heading: localized(raw.organize?.heading, d.organize.heading, 100),
      body: paragraph(raw.organize?.body, d.organize.body, 700),
      messageLabel: localized(raw.organize?.messageLabel, d.organize.messageLabel, 100),
      submit: localized(raw.organize?.submit, d.organize.submit, 80),
      sent: localized(raw.organize?.sent, d.organize.sent, 120),
    },
    help: {
      title: localized(raw.help?.title, d.help.title, 100),
      body: paragraph(raw.help?.body, d.help.body, 500),
    },
    footer: {
      terms: localized(raw.footer?.terms, d.footer.terms, 100),
      privacy: localized(raw.footer?.privacy, d.footer.privacy, 100),
      tagline: line(raw.footer?.tagline, d.footer.tagline, 100),
    },
    seo: {
      title: localized(raw.seo?.title, d.seo.title, 120),
      description: paragraph(raw.seo?.description, d.seo.description, 320),
    },
  };
}

const normalizeModes = (value: unknown): LandingV2AssetModes => {
  const raw = value && typeof value === "object" ? value as Partial<Record<LandingV2AssetId, unknown>> : {};
  return Object.fromEntries(
    landingV2AssetIds.map((id) => [id, raw[id] === "custom" ? "custom" : "default"]),
  ) as LandingV2AssetModes;
};

type StoredLandingV2 = {
  version: 1;
  content: LandingV2EditableContent;
  assets: LandingV2AssetModes;
  updatedAt: number;
  publishedAt?: number;
};

const defaultStored = (): StoredLandingV2 => ({
  version: 1,
  content: defaultLandingV2EditableContent,
  assets: defaultLandingV2AssetModes,
  updatedAt: 0,
});

async function readStored(env: Env, key: string): Promise<StoredLandingV2 | null> {
  const object = await env.HUAU_ASSETS.get(key);
  if (!object) return null;
  try {
    const parsed = JSON.parse(await object.text()) as Partial<StoredLandingV2>;
    return {
      version: 1,
      content: normalizeLandingV2EditableContent(parsed.content),
      assets: normalizeModes(parsed.assets),
      updatedAt: Number(parsed.updatedAt ?? 0),
      ...(Number(parsed.publishedAt ?? 0) > 0 ? { publishedAt: Number(parsed.publishedAt) } : {}),
    };
  } catch {
    return null;
  }
}

async function loadPublishedStored(env: Env): Promise<StoredLandingV2> {
  return await readStored(env, publishedKey) ?? defaultStored();
}

async function loadDraftStored(env: Env): Promise<StoredLandingV2> {
  return await readStored(env, draftKey) ?? await loadPublishedStored(env);
}

async function writeStored(env: Env, key: string, value: StoredLandingV2, kind: string) {
  await env.HUAU_ASSETS.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { kind, updatedAt: String(value.updatedAt) },
  });
}

const publicAssetUrl = (id: LandingV2AssetId) => `/api/public/landing/v2/assets/${id}`;
const previewAssetUrl = (id: LandingV2AssetId) => `/api/platform/landing/v2/draft-assets/${id}`;

function resolveContent(stored: StoredLandingV2, preview: boolean): LandingV2Content {
  const assets = Object.fromEntries(landingV2AssetIds.map((id) => [
    id,
    stored.assets[id] === "custom"
      ? (preview ? previewAssetUrl(id) : publicAssetUrl(id))
      : defaultLandingV2AssetUrls[id],
  ])) as LandingV2Content["assets"];
  return { ...stored.content, assets };
}

export async function loadPublishedLandingV2Content(env: Env): Promise<LandingV2Content> {
  return resolveContent(await loadPublishedStored(env), false);
}

async function assetState(env: Env, draft: StoredLandingV2, published: StoredLandingV2) {
  const states = await Promise.all(landingV2AssetIds.map(async (id) => {
    const [draftObject, publishedObject] = await Promise.all([
      env.HUAU_ASSETS.head(draftAssetKey(id)),
      env.HUAU_ASSETS.head(publishedAssetKey(id)),
    ]);
    const mode = draft.assets[id];
    const previewUrl = mode === "custom"
      ? previewAssetUrl(id)
      : defaultLandingV2AssetUrls[id];
    return [id, {
      mode,
      publishedMode: published.assets[id],
      draftUploaded: Boolean(draftObject),
      publishedCustom: Boolean(publishedObject),
      previewUrl,
      defaultUrl: defaultLandingV2AssetUrls[id],
    }] as const;
  }));
  return Object.fromEntries(states);
}

async function adminState(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const [published, draft] = await Promise.all([loadPublishedStored(env), loadDraftStored(env)]);
  return json({
    ok: true,
    draft,
    published,
    assets: await assetState(env, draft, published),
    dirty: JSON.stringify(draft) !== JSON.stringify(published),
  });
}

async function saveDraft(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const body = await request.json() as { content?: unknown; assets?: unknown };
  const current = await loadDraftStored(env);
  const next: StoredLandingV2 = {
    version: 1,
    content: normalizeLandingV2EditableContent(body.content),
    assets: body.assets ? normalizeModes(body.assets) : current.assets,
    updatedAt: now(),
  };
  await writeStored(env, draftKey, next, "landing-v2-draft");
  return json({ ok: true, draft: next });
}

async function resetDraft(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const published = await loadPublishedStored(env);
  await writeStored(env, draftKey, published, "landing-v2-draft");
  await Promise.all(landingV2AssetIds.map((id) => env.HUAU_ASSETS.delete(draftAssetKey(id)).catch(() => undefined)));
  return json({ ok: true });
}

async function publishDraft(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const draft = await loadDraftStored(env);
  const publishedModes: LandingV2AssetModes = { ...draft.assets };
  for (const id of landingV2AssetIds) {
    if (draft.assets[id] === "default") {
      await env.HUAU_ASSETS.delete(publishedAssetKey(id)).catch(() => undefined);
      continue;
    }
    const staged = await env.HUAU_ASSETS.get(draftAssetKey(id));
    if (staged) {
      await env.HUAU_ASSETS.put(publishedAssetKey(id), staged.body, {
        ...(staged.httpMetadata ? { httpMetadata: staged.httpMetadata } : {}),
        customMetadata: { ...(staged.customMetadata ?? {}), publishedAt: String(now()) },
      });
    } else if (!(await env.HUAU_ASSETS.head(publishedAssetKey(id)))) {
      publishedModes[id] = "default";
    }
  }
  const stamp = now();
  const published: StoredLandingV2 = { ...draft, assets: publishedModes, updatedAt: stamp, publishedAt: stamp };
  await writeStored(env, publishedKey, published, "landing-v2-published");
  await writeStored(env, draftKey, published, "landing-v2-draft");
  await Promise.all(landingV2AssetIds.map((id) => env.HUAU_ASSETS.delete(draftAssetKey(id)).catch(() => undefined)));
  await env.HUAU_ASSETS.delete(snapshotKey).catch(() => undefined);
  return json({ ok: true, publishedAt: stamp });
}

async function preview(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  return json({ ok: true, content: resolveContent(await loadDraftStored(env), true) });
}

async function uploadDraftAsset(request: Request, id: LandingV2AssetId, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const spec = assetSpecs[id];
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  const allowed = spec.kind === "image"
    ? ["image/jpeg", "image/png", "image/webp", "image/avif"]
    : ["video/mp4"];
  if (!allowed.includes(contentType)) return json({ ok: false, code: "LANDING_V2_ASSET_TYPE_NOT_ALLOWED" }, { status: 415 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > spec.maxBytes) {
    return json({ ok: false, code: "LANDING_V2_ASSET_TOO_LARGE" }, { status: 413 });
  }
  await env.HUAU_ASSETS.put(draftAssetKey(id), bytes, {
    httpMetadata: { contentType },
    customMetadata: { kind: `landing-v2-${spec.kind}`, updatedAt: String(now()) },
  });
  const draft = await loadDraftStored(env);
  const next: StoredLandingV2 = {
    ...draft,
    assets: { ...draft.assets, [id]: "custom" as LandingV2AssetMode },
    updatedAt: now(),
  };
  await writeStored(env, draftKey, next, "landing-v2-draft");
  return json({ ok: true, previewUrl: previewAssetUrl(id) });
}

async function resetDraftAsset(request: Request, id: LandingV2AssetId, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  await env.HUAU_ASSETS.delete(draftAssetKey(id)).catch(() => undefined);
  const draft = await loadDraftStored(env);
  const next: StoredLandingV2 = {
    ...draft,
    assets: { ...draft.assets, [id]: "default" as LandingV2AssetMode },
    updatedAt: now(),
  };
  await writeStored(env, draftKey, next, "landing-v2-draft");
  return json({ ok: true });
}

function assetResponse(request: Request, object: R2ObjectBody, cacheControl: string) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("cache-control", cacheControl);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("x-content-type-options", "nosniff");
  const returnedRange = object.range;
  if (request.headers.has("range") && returnedRange && "offset" in returnedRange && "length" in returnedRange) {
    const offset = returnedRange.offset ?? 0;
    const length = returnedRange.length ?? object.size;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

async function serveDraftAsset(request: Request, id: LandingV2AssetId, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const stagedExists = await env.HUAU_ASSETS.head(draftAssetKey(id));
  const key = stagedExists ? draftAssetKey(id) : publishedAssetKey(id);
  const options = request.headers.has("range") ? { range: request.headers } : undefined;
  const object = await env.HUAU_ASSETS.get(key, options);
  if (!object) return json({ ok: false, code: "LANDING_V2_ASSET_NOT_FOUND" }, { status: 404 });
  return assetResponse(request, object, "no-store");
}

async function servePublishedAsset(request: Request, id: LandingV2AssetId, env: Env) {
  const options = request.headers.has("range") ? { range: request.headers } : undefined;
  const object = await env.HUAU_ASSETS.get(publishedAssetKey(id), options);
  if (!object) return json({ ok: false, code: "LANDING_V2_ASSET_NOT_FOUND" }, { status: 404 });
  return assetResponse(request, object, "public, max-age=300, must-revalidate");
}

export async function handleLandingV2CmsApi(
  request: Request,
  env: Env,
  url: URL,
  access: AccessHelpers,
): Promise<Response | null> {
  const publicAsset = url.pathname.match(/^\/api\/public\/landing\/v2\/assets\/([^/]+)$/);
  if (publicAsset && request.method === "GET") {
    const id = decodeURIComponent(publicAsset[1] ?? "");
    if (!isAssetId(id)) return json({ ok: false, code: "INVALID_LANDING_V2_ASSET" }, { status: 400 });
    return servePublishedAsset(request, id, env);
  }

  if (url.pathname === "/api/platform/landing/v2" && request.method === "GET") return adminState(request, env, access);
  if (url.pathname === "/api/platform/landing/v2/draft" && request.method === "PUT") return saveDraft(request, env, access);
  if (url.pathname === "/api/platform/landing/v2/reset" && request.method === "POST") return resetDraft(request, env, access);
  if (url.pathname === "/api/platform/landing/v2/publish" && request.method === "POST") return publishDraft(request, env, access);
  if (url.pathname === "/api/platform/landing/v2/preview" && request.method === "GET") return preview(request, env, access);

  const draftAsset = url.pathname.match(/^\/api\/platform\/landing\/v2\/draft-assets\/([^/]+)$/);
  if (draftAsset && request.method === "GET") {
    const id = decodeURIComponent(draftAsset[1] ?? "");
    if (!isAssetId(id)) return json({ ok: false, code: "INVALID_LANDING_V2_ASSET" }, { status: 400 });
    return serveDraftAsset(request, id, env, access);
  }

  const platformAsset = url.pathname.match(/^\/api\/platform\/landing\/v2\/assets\/([^/]+)$/);
  if (platformAsset) {
    const id = decodeURIComponent(platformAsset[1] ?? "");
    if (!isAssetId(id)) return json({ ok: false, code: "INVALID_LANDING_V2_ASSET" }, { status: 400 });
    if (request.method === "PUT") return uploadDraftAsset(request, id, env, access);
    if (request.method === "DELETE") return resetDraftAsset(request, id, env, access);
  }
  return null;
}
