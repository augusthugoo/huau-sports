import { describe, expect, it } from "vitest";
import { handleRegistrationApi } from "./registration";
import { handlePaymentApi } from "./payments";

type DbValue = Record<string, unknown> | null;

function mockEnv(mode: "denied" | "allowed" = "denied") {
  const selects: string[] = [];
  const env = {
    HUAU_DB: {
      prepare(sql: string) {
        selects.push(sql);
        return {
          bind(...args: unknown[]) {
            void args;
            return {
              async first(): Promise<DbValue> {
                if (sql.includes("FROM payment_proofs pp")) {
                  return { objectKey: "proof-1", originalName: "proof.pdf", contentType: "application/pdf", payerUserId: "other", tournamentId: "t1", organizerOrganizationId: "org1" };
                }
                if (sql.includes("FROM tournament_organizers a")) return mode === "allowed" ? { allowed: 1 } : null;
                if (sql.includes("FROM tournaments t JOIN organizations o")) {
                  return { id: "t1", name: "Test", slug: "test", currency: "UYU", organizerOrganizationId: "org1" };
                }
                if (sql.includes("FROM tournaments WHERE id=?")) {
                  return { id: "t1", name: "Test", slug: "test", organizerOrganizationId: "org1" };
                }
                throw new Error(`Unexpected first SQL: ${sql.slice(0, 100)}`);
              },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    },
    HUAU_ASSETS: {
      async get(key: string) { return key === "proof-1" ? { body: "mock-pdf" } : null; },
    },
  } as unknown as Env;
  return { env, selects };
}

const user = { id: "u1", name: "Organizer", email: "organizer@example.com" };
const anonymous = { requireUser: async () => null, isOrgAdmin: async () => false };
const organizer = { requireUser: async () => user, isOrgAdmin: async () => false };
const req = (path: string) => new Request(`https://huau.app${path}`);

describe("HUAU organizer Lote B1 — isolated financial read access", () => {
  it("rejects unauthenticated registration read without touching D1", async () => {
    const { env, selects } = mockEnv();
    const result = await handleRegistrationApi(req("/api/organizer/tournaments/t1/registrations"), env, anonymous);
    expect(result?.status).toBe(401);
    expect(selects).toHaveLength(0);
  });
  it("rejects unauthenticated financial read without touching D1", async () => {
    const { env, selects } = mockEnv();
    const result = await handlePaymentApi(req("/api/organizer/tournaments/t1/payments"), env, anonymous);
    expect(result?.status).toBe(401);
    expect(selects).toHaveLength(0);
  });
  it("denies a user without an assignment in this tournament", async () => {
    const { env } = mockEnv();
    const a = await handleRegistrationApi(req("/api/organizer/tournaments/t1/registrations"), env, organizer);
    const b = await handlePaymentApi(req("/api/organizer/tournaments/t1/payments"), env, organizer);
    expect(a?.status).toBe(403);
    expect(b?.status).toBe(403);
  });
  it("preserves administrator boundaries for an organizer account", async () => {
    const { env } = mockEnv("allowed");
    const a = await handleRegistrationApi(req("/api/admin/tournaments/t1/registrations"), env, organizer);
    const b = await handlePaymentApi(req("/api/admin/tournaments/t1/payments"), env, organizer);
    expect(a?.status).toBe(403);
    expect(b?.status).toBe(403);
  });
  it("returns only sanitized empty payment data and summary for authorized organizer", async () => {
    const { env } = mockEnv("allowed");
    const response = await handlePaymentApi(req("/api/organizer/tournaments/t1/payments"), env, organizer);
    expect(response?.status).toBe(200);
    const body = await response!.json() as Record<string, unknown>;
    expect(body.orders).toEqual([]);
    expect(body).toHaveProperty("summary");
    expect(body).not.toHaveProperty("settings");
    expect(body).not.toHaveProperty("accounts");
    expect(body).not.toHaveProperty("mercadoPagoConfigured");
    expect(body).not.toHaveProperty("refunds");
  });
  it("rejects private payment proof for an unauthorized organizer", async () => {
    const { env } = mockEnv();
    const response = await handlePaymentApi(req("/api/payment-proofs/p1"), env, organizer);
    expect(response?.status).toBe(403);
  });
  it("allows only a verified assigned organizer to view a proof from their tournament", async () => {
    const { env } = mockEnv("allowed");
    const response = await handlePaymentApi(req("/api/payment-proofs/p1"), env, organizer);
    expect(response?.status).toBe(200);
    expect(await response!.text()).toBe("mock-pdf");
  });
});
