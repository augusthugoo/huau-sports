import { describe, expect, it, vi } from "vitest";
import { handleTournamentDayApi } from "./tournament-day";

const user = { id: "organizer-user", name: "Organizer", email: "organizer@example.com" };
const req = (suffix: string, method = "GET", body?: unknown) =>
  new Request(`https://huau.app/api/organizer/tournaments/t1/day-${suffix}`, { method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
const snapshot = {
  schemaVersion: 1, tournamentId: "t1", baseRevision: 0, createdAt: 1,
  workspace: {
    core: { tournament: { id: "t1" }, settings: {}, categories: [], summary: {} },
    participants: { players: [], playerCategories: [] },
    standard: { entries: [], groups: [], matches: [], drawSessions: [], standings: [], crossGroup: [], categoryProgress: [], competitions: [] },
    schedule: { schedule: [] },
  },
  team: { profiles: [], categories: [] },
};
function setup({ authorized = true, published = true } = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const get = vi.fn(async () => ({ text: async () => JSON.stringify(snapshot) }));
  const env = {
    HUAU_DB: { prepare(sql: string) { return { bind(...params: unknown[]) {
      queries.push({ sql, params });
      return { first: async () => {
        if (sql.includes("FROM tournament_organizers")) return authorized ? { allowed: 1 } : null;
        if (sql.includes("FROM tournament_day_state")) return published ? {
          tournamentId: "t1", snapshotR2Key: "tournaments/t1/day/checkpoints/3.json",
          publishedRevision: 3, finalizedAt: null, syncStatus: "idle", syncError: null,
        } : null;
        return null;
      } };
    } }; } },
    HUAU_ASSETS: { get },
  } as unknown as Env;
  const serve = (request: Request, currentUser: typeof user | null = user) =>
    handleTournamentDayApi(request, env, new URL(request.url), {
      requireUser: vi.fn(async () => currentUser),
      isOrgAdmin: vi.fn(async () => false),
    });
  return { serve, get, queries };
}

describe("Organizer Day D1 — scoped read-only checkpoint", () => {
  it("does not read D1 or R2 when unauthenticated", async () => {
    const { serve, queries, get } = setup();
    const response = await serve(req("bootstrap"), null);
    expect(response?.status).toBe(401);
    expect(queries).toHaveLength(0);
    expect(get).not.toHaveBeenCalled();
  });
  it("denies day when assignment is missing, revoked or disabled", async () => {
    const { serve, queries, get } = setup({ authorized: false });
    const response = await serve(req("bootstrap"));
    expect(response?.status).toBe(403);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.params).toEqual([user.id, "t1", "day"]);
    expect(get).not.toHaveBeenCalled();
  });
  it("reads a lightweight state without fetching checkpoint from R2", async () => {
    const { serve, queries, get } = setup();
    const response = await serve(req("state"));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ ok: true, userId: user.id, hasPublishedSnapshot: true, publishedRevision: 3 });
    expect(queries).toHaveLength(2);
    expect(get).not.toHaveBeenCalled();
  });
  it("allows a signed-in day organizer to fetch the published checkpoint", async () => {
    const { serve, get } = setup();
    const response = await serve(req("bootstrap"));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ ok: true, publishedRevision: 3, snapshot: { tournamentId: "t1" } });
    expect(get).toHaveBeenCalledWith("tournaments/t1/day/checkpoints/3.json");
  });
  it("does not bootstrap from administrative D1 if no checkpoint exists", async () => {
    const { serve, queries, get } = setup({ published: false });
    const response = await serve(req("bootstrap"));
    expect(response?.status).toBe(409);
    expect((await response?.json() as { code: string }).code).toBe("TOURNAMENT_DAY_NOT_PUBLISHED");
    expect(queries).toHaveLength(2);
    expect(get).not.toHaveBeenCalled();
  });
  it("denies any write method", async () => {
    const { serve, queries, get } = setup();
    const response = await serve(req("bootstrap", "PUT"));
    expect(response?.status).toBe(405);
    expect(queries).toHaveLength(0);
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects arbitrary client snapshots at the organizer write boundary", async () => {
    const { serve, queries, get } = setup();
    const result = await serve(req("publish", "PUT", { basePublishedRevision: 3, snapshot: { groups: ["malicious"] } }));
    expect(result?.status).toBe(400);
    expect((await result?.json() as { code: string }).code).toBe("ORGANIZER_DAY_INVALID_REQUEST");
    expect(queries).toHaveLength(1);
    expect(get).not.toHaveBeenCalled();
  });
  it("denies publishing by revoked or disabled organizer", async () => {
    const { serve, get } = setup({authorized:false});
    for (const action of ["publish","public"]) {
      const response = await serve(req(action, "PUT", { basePublishedRevision: 3, operations: [] }));
      expect(response?.status).toBe(403);
    }
    expect(get).not.toHaveBeenCalled();
  });
  it("rejects stale revisions before R2 writes", async () => {
    const { serve, get }=setup();
    for (const action of ["publish","public"]) {
      const response=await serve(req(action,"PUT",{basePublishedRevision:2,operations:[{kind:"standard",categoryId:"c",encounterId:"e",result:{scoreA:3,scoreB:0}}]}));
      expect(response?.status).toBe(409);
      expect((await response?.json() as {code:string}).code).toBe("TOURNAMENT_DAY_PUBLISH_CONFLICT");
    }
    expect(get).not.toHaveBeenCalled();
  });
  it("rejects unsupported mutation verbs before permission lookup", async () => {
    const {serve,queries}=setup();
    expect((await serve(req("publish","POST")))?.status).toBe(405);
    expect(queries).toHaveLength(0);
  });
});
