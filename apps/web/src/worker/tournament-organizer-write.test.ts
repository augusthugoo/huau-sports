import { describe, expect, it, vi } from "vitest";
import { handleRegistrationApi } from "./registration";
import { handlePaymentApi } from "./payments";

vi.mock("./email", () => ({ sendTransactionalEmailOnce: vi.fn(async () => undefined) }));

type EnvMode = "authorized" | "denied";

function fakeEnv(mode: EnvMode = "authorized", options: { settled?: boolean; mpActive?: boolean } = {}) {
  const sqls: string[] = [];
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const order = {
    id: "order-one", tournamentId: "t1", payerKind: "user", payerUserId: "payer", payerProfileId: null,
    payerName: "Jugador", payerEmail: null, currency: "UYU", subtotalMinor: 140000, discountMinor: 0,
    totalAmountMinor: 140000, amountPaidMinor: 0, amountRefundedMinor: 0,
    status: "awaiting_payment", selectedMethod: null, dueAt: null, paidAt: null, createdAt: 1, updatedAt: 1,
  };
  const reg = {
    id: "reg-one", tournamentId: "t1", categoryId: "cat-one", entryId: null,
    userId: "payer", status: "awaiting_payment", participantCount: 1, priceScope: "per_person",
    baseAmountMinor: 140000, discountMinor: 0, finalAmountMinor: 140000, currency: "UYU",
    waitlistPosition: null, registrationNumber: 1, coveredByRegistrationId: null,
    paidAmountMinor: 0, refundedAmountMinor: 0,
  };
  const env = {
    BETTER_AUTH_URL: "https://huau.app",
    HUAU_DB: {
      prepare(sql: string) {
        sqls.push(sql);
        return {
          bind(...args: unknown[]) {
            calls.push({ sql, args });
            return {
              async first(): Promise<Record<string, unknown> | null> {
                if (sql.includes('FROM tournament_organizers a')) {
                  return mode === "authorized" && args[1] === "t1" ? { allowed: 1 } : null;
                }
                if (sql.includes('FROM tournaments t JOIN organizations o')) {
                  return { id: "t1", name: "Torneo", slug: "torneo", currency: "UYU", organizerOrganizationId: "org-one" };
                }
                if (sql.includes('FROM tournaments WHERE id=?')) {
                  return { id: "t1", name: "Torneo", slug: "torneo", organizerOrganizationId: "org-one" };
                }
                if (sql.includes('FROM payment_orders WHERE id=?')) return args[0] === "order-other" ? { ...order, tournamentId: "t2" } : order;
                if (sql.includes('FROM tournament_registrations WHERE id=?')) return args[0] === "reg-other" ? { ...reg, tournamentId: "t2" } : reg;
                if (sql.includes('FROM payment_attempts pa JOIN payment_orders po') && sql.includes('pa.id,pa.order_id')) {
                  return { id: "attempt-one", orderId: "order-one", method: "bank_transfer", status: "submitted", amountMinor: 140000, tournamentId: args[0] === "attempt-other" ? "t2" : "t1" };
                }
                if (sql.includes('FROM payment_attempts WHERE id=?')) return { status: "created" };
                if (sql.includes('FROM payment_attempts') && sql.includes("method='mercado_pago'")) {
                  return options.mpActive ? { id: "mp-one" } : null;
                }
                if (sql.includes('FROM payment_order_items poi')) return options.settled ? { status: "paid" } : null;
                if (sql.includes('FROM tournament_payment_settings')) return null;
                if (sql.includes('FROM tournament_entries WHERE id=?')) return null;
                if (sql.includes('FROM tournament_categories WHERE id=?')) return {
                  id: "cat-one", tournamentId: "t1", entryType: "individual", name: "Open", priceScope: "per_person",
                  priceMinor: 140000, currency: "UYU", competitionGender: "open", registrationStatus: "open", structureLocked: 0,
                };
                throw new Error(`Unexpected SQL: ${sql.slice(0, 180)}`);
              },
              async all(): Promise<{ results: never[] }> { return { results: [] }; },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
        };
      },
      async batch() { return []; },
    },
  } as unknown as Env;
  return { env, sqls, calls };
}

const person = { id: "responsable", name: "Organizador", email: "organizador@ejemplo.com" };
const organizer = { requireUser: async () => person, isOrgAdmin: async () => false };
const anonymous = { requireUser: async () => null, isOrgAdmin: async () => false };
const req = (path: string, body: Record<string, unknown>) => new Request(`https://huau.app${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("HUAU organizer B2 — financial mutations are tournament-scoped", () => {
  it("does not touch D1 when an anonymous user requests manual payment", async () => {
    const { env, sqls } = fakeEnv();
    const r = await handlePaymentApi(req("/api/organizer/payment-orders/order-one/mark-paid", { method: "cash" }), env, anonymous);
    expect(r?.status).toBe(401);
    expect(sqls).toHaveLength(0);
  });
  it("does not touch D1 when an anonymous user requests a courtesy", async () => {
    const { env, sqls } = fakeEnv();
    const r = await handleRegistrationApi(req("/api/organizer/registrations/reg-one/courtesy", { kind: "courtesy" }), env, anonymous);
    expect(r?.status).toBe(401);
    expect(sqls).toHaveLength(0);
  });
  it("denies every write for an unassigned organizer", async () => {
    const { env } = fakeEnv("denied");
    const a = await handlePaymentApi(req("/api/organizer/payment-orders/order-one/mark-paid", { method: "cash" }), env, organizer);
    const b = await handlePaymentApi(req("/api/organizer/payment-attempts/attempt-one/review", { decision: "approve" }), env, organizer);
    const c = await handleRegistrationApi(req("/api/organizer/registrations/reg-one/courtesy", { kind: "courtesy" }), env, organizer);
    expect([a?.status, b?.status, c?.status]).toEqual([403, 403, 403]);
  });
  it("never authorizes IDs that belong to another tournament", async () => {
    const { env } = fakeEnv("authorized");
    const a = await handlePaymentApi(req("/api/organizer/payment-orders/order-other/mark-paid", { method: "cash" }), env, organizer);
    const b = await handlePaymentApi(req("/api/organizer/payment-attempts/attempt-other/review", { decision: "approve" }), env, organizer);
    const c = await handleRegistrationApi(req("/api/organizer/registrations/reg-other/courtesy", { kind: "courtesy" }), env, organizer);
    expect([a?.status, b?.status, c?.status]).toEqual([403, 403, 403]);
  });
  it("does not unlock broad admin operations for an organizer", async () => {
    const { env } = fakeEnv();
    const r = await handlePaymentApi(req("/api/admin/payment-orders/order-one/mark-paid", { method: "cash" }), env, organizer);
    expect(r?.status).toBe(403);
  });
  it("requires an auditable reason for a courtesy", async () => {
    const { env } = fakeEnv();
    const r = await handleRegistrationApi(req("/api/organizer/registrations/reg-one/courtesy", { kind: "courtesy" }), env, {
      ...organizer, refreshOrganizerCourtesyOrder: async () => undefined,
    });
    expect(r?.status).toBe(400);
  });
  it("blocks courtesy on a financially settled registration", async () => {
    const { env } = fakeEnv("authorized", { settled: true });
    const r = await handleRegistrationApi(req("/api/organizer/registrations/reg-one/courtesy", { kind: "courtesy", note: "Invitado" }), env, {
      ...organizer, refreshOrganizerCourtesyOrder: async () => undefined,
    });
    expect(r?.status).toBe(409);
  });
  it("only accepts courtesy, never an arbitrary discount or fixed total", async () => {
    const { env, sqls } = fakeEnv();
    const r = await handleRegistrationApi(req("/api/organizer/registrations/reg-one/courtesy", { kind: "discount", amountMinor: 80000 }), env, {
      ...organizer, refreshOrganizerCourtesyOrder: async () => undefined,
    });
    expect(r?.status).toBe(403);
    expect(sqls.some((s) => s.includes("INSERT INTO registration_adjustments"))).toBe(false);
  });
  it("blocks manual marking when an active Mercado Pago checkout exists", async () => {
    const { env } = fakeEnv("authorized", { mpActive: true });
    const r = await handlePaymentApi(req("/api/organizer/payment-orders/order-one/mark-paid", { method: "cash" }), env, organizer);
    expect(r?.status).toBe(409);
  });
  it("blocks a submitted-proof approval while Mercado Pago is active", async () => {
    const { env } = fakeEnv("authorized", { mpActive: true });
    const r = await handlePaymentApi(req("/api/organizer/payment-attempts/attempt-one/review", { decision: "approve" }), env, organizer);
    expect(r?.status).toBe(409);
  });
  it("rejects invented manual payment methods", async () => {
    const { env } = fakeEnv();
    const r = await handlePaymentApi(req("/api/organizer/payment-orders/order-one/mark-paid", { method: "mercado_pago" }), env, organizer);
    expect(r?.status).toBe(400);
  });
  it("grants an authorized courtesy with actor and financial reconciliation", async () => {
    const { env, calls } = fakeEnv();
    const refreshed = vi.fn(async () => undefined);
    const r = await handleRegistrationApi(req("/api/organizer/registrations/reg-one/courtesy", { kind: "courtesy", note: "Invitación" }), env, {
      ...organizer, refreshOrganizerCourtesyOrder: refreshed,
    });
    expect(r?.status).toBe(200);
    expect(refreshed).toHaveBeenCalledWith(env, "t1", "payer");
    const audit = calls.find((item) => item.sql.includes("INSERT INTO registration_adjustments"));
    expect(audit?.args).toContain("responsable");
    expect(audit?.args).toContain(140000);
  });
  it("registers an offline payment and records the responsible actor", async () => {
    const { env, calls } = fakeEnv();
    const r = await handlePaymentApi(req("/api/organizer/payment-orders/order-one/mark-paid", { method: "cash", note: "Recibido en mostrador" }), env, organizer);
    expect(r?.status).toBe(200);
    const audit = calls.find((item) => item.sql.includes("INSERT INTO payment_events") && item.args.includes("payment.approved"));
    expect(audit?.args).toContain("responsable");
  });
  it("approves a submitted manual proof and records the responsible actor", async () => {
    const { env, calls } = fakeEnv();
    const r = await handlePaymentApi(req("/api/organizer/payment-attempts/attempt-one/review", { decision: "approve" }), env, organizer);
    expect(r?.status).toBe(200);
    const audit = calls.find((item) => item.sql.includes("INSERT INTO payment_events") && item.args.includes("payment.approved"));
    expect(audit?.args).toContain("responsable");
  });
  it("only reviews submitted manual proofs", async () => {
    const { env } = fakeEnv();
    const r = await handlePaymentApi(req("/api/organizer/payment-attempts/attempt-one/review", { decision: "invalid" }), env, organizer);
    expect(r?.status).toBe(400);
  });
});
