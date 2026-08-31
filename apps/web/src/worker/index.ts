import { appMeta, createDb } from "@huau/db";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "huau-sports",
        env: env.APP_ENV,
        version: env.APP_VERSION,
      });
    }

    if (url.pathname === "/api/db-health") {
      try {
        const db = createDb(env.HUAU_DB);
        const meta = await db.select().from(appMeta).limit(1);
        return json({ ok: true, meta });
      } catch (error) {
        return json(
          {
            ok: false,
            code: "DB_UNAVAILABLE_OR_UNMIGRATED",
            message: error instanceof Error ? error.message : "Unknown D1 error",
          },
          { status: 503 },
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }

    return json({ ok: false, code: "WORKER_ROUTE_NOT_FOUND" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
