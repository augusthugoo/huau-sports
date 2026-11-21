import { describe, expect, it, vi } from "vitest";
import {
  handleTournamentOrganizerApi,
  hasTournamentOrganizerAccess,
  normalizeOrganizerEmail,
} from "./tournament-organizer";

type Query = { sql: string; params: unknown[] };
type FakeOptions = {
  first?: (query: Query) => unknown;
  all?: (query: Query) => unknown[];
};
function fakeDb(options: FakeOptions = {}) {
  const queries: Query[] = [];
  const batches: Query[][] = [];
  const env = {
    HUAU_DB: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            const query = { sql, params };
            queries.push(query);
            return {
              first: async () => options.first?.(query) ?? null,
              all: async () => ({ results: options.all?.(query) ?? [] }),
              run: async () => ({ success: true }),
              __query: query,
            };
          },
        };
      },
      batch: async (statements: Array<{ __query: Query }>) => {
        batches.push(statements.map((statement) => statement.__query));
        return statements.map(() => ({ success: true }));
      },
    },
  } as unknown as Env;
  return { env, queries, batches };
}

const manager = { id: "user-1", email: "organizador@ejemplo.com", name: "Organizador" };
const platformAdmin = { id: "admin-1", email: "admin@huau.app", name: "Admin" };
const request = (path: string, method = "GET", body?: unknown) =>
  new Request(`https://huau.app${path}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
const handler = (req: Request, env: Env, user: typeof manager | null, isAdmin = false) =>
  handleTournamentOrganizerApi(req, env, new URL(req.url), {
    requireUser: vi.fn(async () => user),
    isPlatformAdmin: vi.fn(async () => isAdmin),
  });

const assigned = {
  tournamentId: "t-1", organizerEmail: manager.email, organizerUserId: manager.id,
  dayEnabled: 0, status: "active", assignedByUserId: platformAdmin.id,
  createdAt: 10, updatedAt: 10,
};

describe("HUAU organizer Lote A — permission boundary", () => {
  it("normalizes email and refuses malformed identifiers", () => {
    expect(normalizeOrganizerEmail("  ANA@Ejemplo.COM  ")).toBe("ana@ejemplo.com");
    expect(normalizeOrganizerEmail("not-an-email")).toBeNull();
    expect(normalizeOrganizerEmail("ana@ejemplo.com\nadmin@ejemplo.com")).toBeNull();
    expect(normalizeOrganizerEmail(null)).toBeNull();
  });

  it("checks the exact tournament, server user, verified email and active assignment", async () => {
    const { env, queries } = fakeDb({ first: ({ params }) =>
      params[0] === "user-1" && params[1] === "t-1" ? { allowed: 1 } : null,
    });
    expect(await hasTournamentOrganizerAccess(env, "user-1", "t-1", "finance")).toBe(true);
    expect(await hasTournamentOrganizerAccess(env, "user-1", "t-2", "finance")).toBe(false);
    const sql = queries[0]!.sql;
    expect(sql).toContain("a.tournament_id=?");
    expect(sql).toContain("a.status='active'");
    expect(sql).toContain("u.email_verified=1");
    expect(sql).toContain("lower(trim(u.email))=a.organizer_email");
    expect(sql).toContain("a.organizer_user_id IS NULL OR a.organizer_user_id=u.id");
    expect(sql).toContain("a.day_enabled=1");
  });

  it("does not enable Tournament Day without the separate day flag", async () => {
    const { env } = fakeDb({ first: ({ params }) =>
      params[2] === "finance" ? { allowed: 1 } : null,
    });
    expect(await hasTournamentOrganizerAccess(env, "user-1", "t-1", "finance")).toBe(true);
    expect(await hasTournamentOrganizerAccess(env, "user-1", "t-1", "day")).toBe(false);
  });

  it("never exposes the private organizer list to an anonymous user", async () => {
    const { env, queries } = fakeDb();
    const res = await handler(request("/api/me/organizer-tournaments"), env, null);
    expect(res?.status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("lists only assigned tournaments using the verified server session identity", async () => {
    const { env, queries } = fakeDb({ all: () => [
      { id: "t-1", name: "Cup", slug: "cup", status: "draft", startAt: 1, endAt: null, organizationName: "Club", dayEnabled: 0 },
    ] });
    const res = await handler(request("/api/me/organizer-tournaments"), env, manager);
    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({
      ok: true,
      tournaments: [{ id: "t-1", canManageRegistrationsAndPayments: true, canOperateDay: false }],
    });
    expect(queries[0]?.params).toEqual([manager.id]);
    expect(queries[0]?.sql).toContain("u.email_verified=1");
    expect(queries[0]?.sql).toContain("a.status='active'");
  });

  it("denies assignment mutations to anyone except HUAU platform-admin", async () => {
    const { env, queries, batches } = fakeDb();
    const req = request("/api/platform/tournaments/t-1/organizer", "PUT", { email: manager.email });
    const res = await handler(req, env, manager, false);
    expect(res?.status).toBe(403);
    expect(queries).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });

  it("denies assignment mutations when not authenticated", async () => {
    const { env, queries } = fakeDb();
    const res = await handler(request("/api/platform/tournaments/t-1/organizer", "DELETE"), env, null);
    expect(res?.status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("creates a pending-email assignment with day operation disabled", async () => {
    const { env, batches } = fakeDb({ first: ({ sql }) =>
      sql.includes("SELECT id,name FROM tournaments") ? { id: "t-1", name: "Cup" } : null,
    });
    const res = await handler(
      request("/api/platform/tournaments/t-1/organizer", "PUT", { email: "  ORGANIZADOR@EJEMPLO.COM " }),
      env, platformAdmin, true,
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({
      ok: true, email: "organizador@ejemplo.com", pendingVerification: true, dayEnabled: false,
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]?.sql).toContain("INSERT INTO tournament_organizers");
    expect(batches[0]?.[0]?.params.slice(0, 4)).toEqual(["t-1", manager.email, null, 0]);
    expect(batches[0]?.[1]?.sql).toContain("INSERT INTO tournament_organizer_audit");
  });

  it("keeps day operation disabled when the assigned email changes", async () => {
    const { env, batches } = fakeDb({ first: ({ sql }) => {
      if (sql.includes("SELECT id,name FROM tournaments")) return { id: "t-1", name: "Cup" };
      if (sql.includes("FROM tournament_organizers WHERE")) return { ...assigned, dayEnabled: 1 };
      return null;
    } });
    const res = await handler(request("/api/platform/tournaments/t-1/organizer", "PUT", {
      email: "otro@ejemplo.com",
    }), env, platformAdmin, true);
    expect(res?.status).toBe(200);
    expect(batches[0]?.[0]?.params[3]).toBe(0);
  });

  it("revokes a specific tournament assignment and clears day access", async () => {
    const { env, batches } = fakeDb({ first: ({ sql }) => {
      if (sql.includes("SELECT id,name FROM tournaments")) return { id: "t-1", name: "Cup" };
      if (sql.includes("FROM tournament_organizers WHERE")) return assigned;
      return null;
    } });
    const res = await handler(request("/api/platform/tournaments/t-1/organizer", "DELETE"), env, platformAdmin, true);
    expect(res?.status).toBe(200);
    expect(batches[0]?.[0]?.sql).toContain("status='revoked',day_enabled=0");
  });

  it("enables day permission only with an explicit platform-admin PATCH", async () => {
    const { env, batches } = fakeDb({ first: ({ sql }) =>
      sql.includes("FROM tournament_organizers WHERE") ? assigned : null,
    });
    const res = await handler(request("/api/platform/tournaments/t-1/organizer/day", "PATCH", {
      enabled: true,
    }), env, platformAdmin, true);
    expect(res?.status).toBe(200);
    expect(batches[0]?.[0]?.params[0]).toBe(1);
  });
});
