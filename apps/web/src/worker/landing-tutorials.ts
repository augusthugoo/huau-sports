type CurrentUser = { id: string; name: string; email: string };

type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isPlatformAdmin: (userId: string, email: string, env: Env) => Promise<boolean>;
};

export type PublicLandingTutorial = {
  id: string;
  titleEs: string;
  titleEn: string;
  videoUrl: string;
};

type TutorialConfigItem = {
  id: string;
  fixed: boolean;
  titleEs: string;
  titleEn: string;
  hasVideo: boolean;
  contentType: string | null;
  updatedAt: number;
};

type TutorialConfig = {
  version: 1;
  tutorials: TutorialConfigItem[];
};

const configKey = "landing/tutorials/config.json";
const snapshotKey = "public/landing.json";
const maxVideoBytes = 60 * 1024 * 1024;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

const fixedTutorials = (): TutorialConfigItem[] => [
  {
    id: "tutorial-1",
    fixed: true,
    titleEs: "",
    titleEn: "",
    hasVideo: false,
    contentType: null,
    updatedAt: 0,
  },
  {
    id: "tutorial-2",
    fixed: true,
    titleEs: "",
    titleEn: "",
    hasVideo: false,
    contentType: null,
    updatedAt: 0,
  },
];

const validId = (value: string) => /^[a-zA-Z0-9-]{1,80}$/.test(value);
const videoKey = (id: string) => `landing/tutorials/${id}`;

async function platformUser(request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) {
    return { response: json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 }) };
  }
  if (!(await access.isPlatformAdmin(user.id, user.email, env))) {
    return { response: json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { user };
}

function normalizeConfig(raw: TutorialConfig | null): TutorialConfig {
  const fixed = fixedTutorials();
  const incoming = Array.isArray(raw?.tutorials) ? raw.tutorials : [];
  const byId = new Map(incoming.map((item) => [item.id, item]));

  const tutorials: TutorialConfigItem[] = fixed.map((fallback) => {
    const existing = byId.get(fallback.id);
    return existing
      ? {
          ...fallback,
          ...existing,
          id: fallback.id,
          fixed: true,
          titleEs: String(existing.titleEs ?? "").slice(0, 140),
          titleEn: String(existing.titleEn ?? "").slice(0, 140),
          hasVideo: Boolean(existing.hasVideo),
          contentType: existing.contentType || null,
          updatedAt: Number(existing.updatedAt || 0),
        }
      : fallback;
  });

  for (const item of incoming) {
    if (
      item.id === "tutorial-1" ||
      item.id === "tutorial-2" ||
      !validId(item.id)
    ) {
      continue;
    }
    tutorials.push({
      id: item.id,
      fixed: false,
      titleEs: String(item.titleEs ?? "").slice(0, 140),
      titleEn: String(item.titleEn ?? "").slice(0, 140),
      hasVideo: Boolean(item.hasVideo),
      contentType: item.contentType || null,
      updatedAt: Number(item.updatedAt || 0),
    });
  }

  return { version: 1, tutorials };
}

async function loadConfig(env: Env): Promise<TutorialConfig> {
  const object = await env.HUAU_ASSETS.get(configKey);
  if (!object) return normalizeConfig(null);
  try {
    const parsed = JSON.parse(await object.text()) as TutorialConfig;
    if (parsed.version !== 1) return normalizeConfig(null);
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(null);
  }
}

async function saveConfig(env: Env, config: TutorialConfig) {
  await env.HUAU_ASSETS.put(configKey, JSON.stringify(normalizeConfig(config)), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { kind: "landing-tutorial-config", updatedAt: String(Date.now()) },
  });
  await env.HUAU_ASSETS.delete(snapshotKey).catch(() => undefined);
}

export async function loadPublicLandingTutorials(
  env: Env,
): Promise<PublicLandingTutorial[]> {
  const config = await loadConfig(env);
  return config.tutorials
    .filter((item) => item.hasVideo)
    .map((item) => ({
      id: item.id,
      titleEs: item.titleEs,
      titleEn: item.titleEn,
      videoUrl: `/api/public/landing/tutorials/${encodeURIComponent(item.id)}/video`,
    }));
}

async function platformList(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;
  const config = await loadConfig(env);
  return json({ ok: true, tutorials: config.tutorials });
}

async function addTutorial(request: Request, env: Env, access: AccessHelpers) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;

  const config = await loadConfig(env);
  if (config.tutorials.length >= 12) {
    return json({ ok: false, code: "TUTORIAL_LIMIT_REACHED" }, { status: 409 });
  }

  const item: TutorialConfigItem = {
    id: `tutorial-${crypto.randomUUID()}`,
    fixed: false,
    titleEs: "",
    titleEn: "",
    hasVideo: false,
    contentType: null,
    updatedAt: Date.now(),
  };
  config.tutorials.push(item);
  await saveConfig(env, config);
  return json({ ok: true, tutorial: item }, { status: 201 });
}

async function updateTutorialMetadata(
  request: Request,
  env: Env,
  access: AccessHelpers,
  tutorialId: string,
) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;

  const body = (await request.json()) as { titleEs?: string; titleEn?: string };
  const titleEs = String(body.titleEs ?? "").trim().slice(0, 140);
  const titleEn = String(body.titleEn ?? "").trim().slice(0, 140);

  const config = await loadConfig(env);
  const tutorial = config.tutorials.find((item) => item.id === tutorialId);
  if (!tutorial) {
    return json({ ok: false, code: "TUTORIAL_NOT_FOUND" }, { status: 404 });
  }

  tutorial.titleEs = titleEs;
  tutorial.titleEn = titleEn;
  tutorial.updatedAt = Date.now();
  await saveConfig(env, config);
  return json({ ok: true });
}

async function updateTutorialVideo(
  request: Request,
  env: Env,
  access: AccessHelpers,
  tutorialId: string,
) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;

  const config = await loadConfig(env);
  const tutorial = config.tutorials.find((item) => item.id === tutorialId);
  if (!tutorial) {
    return json({ ok: false, code: "TUTORIAL_NOT_FOUND" }, { status: 404 });
  }

  if (request.method === "DELETE") {
    await env.HUAU_ASSETS.delete(videoKey(tutorialId));
    tutorial.hasVideo = false;
    tutorial.contentType = null;
    tutorial.updatedAt = Date.now();
    await saveConfig(env, config);
    return json({ ok: true });
  }

  const contentType =
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(contentType)) {
    return json({ ok: false, code: "TUTORIAL_VIDEO_TYPE_NOT_ALLOWED" }, { status: 415 });
  }

  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > maxVideoBytes) {
    return json({ ok: false, code: "TUTORIAL_VIDEO_TOO_LARGE" }, { status: 413 });
  }

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > maxVideoBytes) {
    return json({ ok: false, code: "TUTORIAL_VIDEO_TOO_LARGE" }, { status: 413 });
  }

  await env.HUAU_ASSETS.put(videoKey(tutorialId), bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      kind: "landing-tutorial-video",
      tutorialId,
      updatedAt: String(Date.now()),
    },
  });

  tutorial.hasVideo = true;
  tutorial.contentType = contentType;
  tutorial.updatedAt = Date.now();
  await saveConfig(env, config);
  return json({ ok: true });
}

async function deleteTutorialBlock(
  request: Request,
  env: Env,
  access: AccessHelpers,
  tutorialId: string,
) {
  const auth = await platformUser(request, env, access);
  if ("response" in auth) return auth.response;

  const config = await loadConfig(env);
  const tutorial = config.tutorials.find((item) => item.id === tutorialId);
  if (!tutorial) {
    return json({ ok: false, code: "TUTORIAL_NOT_FOUND" }, { status: 404 });
  }
  if (tutorial.fixed) {
    return json({ ok: false, code: "FIXED_TUTORIAL_BLOCK" }, { status: 409 });
  }

  await env.HUAU_ASSETS.delete(videoKey(tutorialId));
  config.tutorials = config.tutorials.filter((item) => item.id !== tutorialId);
  await saveConfig(env, config);
  return json({ ok: true });
}

async function publicVideo(request: Request, env: Env, tutorialId: string) {
  const options = request.headers.has("range") ? { range: request.headers } : undefined;
  const object = await env.HUAU_ASSETS.get(videoKey(tutorialId), options);
  if (!object) {
    return json({ ok: false, code: "TUTORIAL_VIDEO_NOT_FOUND" }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", object.httpMetadata?.contentType || "video/mp4");
  headers.set("cache-control", "public, max-age=300, must-revalidate");
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("x-content-type-options", "nosniff");

  const returnedRange = object.range;
  if (
    request.headers.has("range") &&
    returnedRange &&
    "offset" in returnedRange &&
    "length" in returnedRange
  ) {
    const offset = returnedRange.offset ?? 0;
    const length = returnedRange.length ?? object.size;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export async function handleLandingTutorialApi(
  request: Request,
  env: Env,
  url: URL,
  access: AccessHelpers,
): Promise<Response | null> {
  const publicVideoMatch = url.pathname.match(
    /^\/api\/public\/landing\/tutorials\/([^/]+)\/video$/,
  );
  if (publicVideoMatch && request.method === "GET") {
    const tutorialId = decodeURIComponent(publicVideoMatch[1]!);
    if (!validId(tutorialId)) {
      return json({ ok: false, code: "INVALID_TUTORIAL_ID" }, { status: 400 });
    }
    return publicVideo(request, env, tutorialId);
  }

  if (url.pathname === "/api/platform/landing/tutorials") {
    if (request.method === "GET") return platformList(request, env, access);
    if (request.method === "POST") return addTutorial(request, env, access);
  }

  const videoMatch = url.pathname.match(
    /^\/api\/platform\/landing\/tutorials\/([^/]+)\/video$/,
  );
  if (videoMatch && ["PUT", "DELETE"].includes(request.method)) {
    const tutorialId = decodeURIComponent(videoMatch[1]!);
    if (!validId(tutorialId)) {
      return json({ ok: false, code: "INVALID_TUTORIAL_ID" }, { status: 400 });
    }
    return updateTutorialVideo(request, env, access, tutorialId);
  }

  const tutorialMatch = url.pathname.match(
    /^\/api\/platform\/landing\/tutorials\/([^/]+)$/,
  );
  if (tutorialMatch) {
    const tutorialId = decodeURIComponent(tutorialMatch[1]!);
    if (!validId(tutorialId)) {
      return json({ ok: false, code: "INVALID_TUTORIAL_ID" }, { status: 400 });
    }
    if (request.method === "PUT") {
      return updateTutorialMetadata(request, env, access, tutorialId);
    }
    if (request.method === "DELETE") {
      return deleteTutorialBlock(request, env, access, tutorialId);
    }
  }

  return null;
}
