import {
  clampRefundMinor,
  paymentOrderStatus,
  registrationPriceMinor,
  resolveRegistrationPricing,
  resolveTeamIndividualPrice,
  type TeamAdditionalParticipationMode,
} from "@huau/core";
import { cancelRegistrationForPaymentAdmin } from "./registration";

type CurrentUser = { id: string; name: string; email: string };
type AccessHelpers = {
  requireUser: (request: Request, env: Env) => Promise<CurrentUser | null>;
  isOrgAdmin: (userId: string, organizationId: string, env: Env, request?: Request) => Promise<boolean>;
};

type PaymentMethod = "mercado_pago" | "bank_transfer" | "cash";
type OrderStatus = "draft" | "awaiting_payment" | "pending_review" | "paid" | "cancelled" | "partially_refunded" | "refunded";
type PayerKind = "user" | "manual_profile";

type TournamentRow = {
  id: string;
  organizerOrganizationId: string;
  name: string;
  slug: string;
  currency: string;
};

type PaymentSettingsRow = {
  tournamentId: string;
  bankTransferEnabled: number;
  cashEnabled: number;
  mercadoPagoEnabled: number;
  mercadoPagoAccountId: string | null;
  bankName: string | null;
  bankAccountHolder: string | null;
  bankAccountNumber: string | null;
  bankAccountAlias: string | null;
  bankCurrency: string;
  bankInstructions: string | null;
  transferProofRequired: number;
  cashInstructions: string | null;
  paymentDueAt: number | null;
  refundPolicy: "manual" | "none" | "full_before_deadline";
  refundDeadlineAt: number | null;
  cancellationPolicyText: string | null;
};

type PaymentOrderRow = {
  id: string;
  tournamentId: string;
  payerKind: PayerKind;
  payerUserId: string | null;
  payerProfileId: string | null;
  payerName: string;
  payerEmail: string | null;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  totalAmountMinor: number;
  amountPaidMinor: number;
  amountRefundedMinor: number;
  status: OrderStatus;
  selectedMethod: PaymentMethod | null;
  dueAt: number | null;
  paidAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type PaymentAccountRow = {
  id: string;
  organizationId: string;
  label: string;
  status: string;
  externalAccountId: string | null;
  publicKey: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: number | null;
  liveMode: number;
};

type ManualCategory = {
  profileId: string;
  displayName: string;
  contact: string;
  categoryId: string;
  categoryName: string;
  entryType: "individual" | "pair" | "team";
  priceScope: "free" | "per_entry" | "per_person";
  priceMinor: number | null;
  currency: string | null;
  sortOrder: number;
  linkedUserId: string | null;
};

type PricingSettings = {
  paymentType: "per_category" | "base_plus_extra" | "free";
  entryFeeMinor: number | null;
  baseFeeMinor: number | null;
  extraCategoryFeeMinor: number | null;
  teamIndividualFeeMinor: number | null;
  teamAdditionalParticipationMode: TeamAdditionalParticipationMode;
  teamAdditionalFeeMinor: number | null;
};

type MpOrderResponse = {
  id?: string;
  checkout_url?: string;
  external_reference?: string;
  status?: string;
  status_detail?: string;
  total_amount?: string;
  total_paid_amount?: string;
  transactions?: {
    payments?: Array<{ id?: string; status?: string; status_detail?: string; paid_amount?: string; amount?: string }>;
  };
  error?: string;
  message?: string;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });
const readJson = async <T>(request: Request): Promise<T> => (await request.json()) as T;
const uuid = () => crypto.randomUUID();
const now = () => Math.floor(Date.now() / 1000);
const clean = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const boolInt = (value: unknown, fallback: boolean) => value === undefined ? (fallback ? 1 : 0) : value ? 1 : 0;
const moneyString = (minor: number) => (Math.max(0, Math.trunc(minor)) / 100).toFixed(2);

async function tournamentById(env: Env, tournamentId: string) {
  return env.HUAU_DB.prepare(
    `SELECT t.id,t.organizer_organization_id as organizerOrganizationId,t.name,t.slug,COALESCE(o.default_currency,'UYU') as currency
       FROM tournaments t JOIN organizations o ON o.id=t.organizer_organization_id WHERE t.id=?`,
  ).bind(tournamentId).first<TournamentRow>();
}

async function requireAdmin(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return { response: json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 }) } as const;
  const tournament = await tournamentById(env, tournamentId);
  if (!tournament) return { response: json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 }) } as const;
  if (!(await access.isOrgAdmin(user.id, tournament.organizerOrganizationId, env, request))) {
    return { response: json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) } as const;
  }
  return { user, tournament } as const;
}

async function paymentSettings(env: Env, tournamentId: string, currency = "UYU"): Promise<PaymentSettingsRow> {
  const row = await env.HUAU_DB.prepare(
    `SELECT tournament_id as tournamentId,bank_transfer_enabled as bankTransferEnabled,cash_enabled as cashEnabled,
            mercado_pago_enabled as mercadoPagoEnabled,mercado_pago_account_id as mercadoPagoAccountId,
            bank_name as bankName,bank_account_holder as bankAccountHolder,bank_account_number as bankAccountNumber,
            bank_account_alias as bankAccountAlias,bank_currency as bankCurrency,bank_instructions as bankInstructions,
            transfer_proof_required as transferProofRequired,cash_instructions as cashInstructions,payment_due_at as paymentDueAt,
            refund_policy as refundPolicy,refund_deadline_at as refundDeadlineAt,cancellation_policy_text as cancellationPolicyText
       FROM tournament_payment_settings WHERE tournament_id=?`,
  ).bind(tournamentId).first<PaymentSettingsRow>();
  return row ?? {
    tournamentId,
    bankTransferEnabled: 1,
    cashEnabled: 0,
    mercadoPagoEnabled: 0,
    mercadoPagoAccountId: null,
    bankName: null,
    bankAccountHolder: null,
    bankAccountNumber: null,
    bankAccountAlias: null,
    bankCurrency: currency,
    bankInstructions: null,
    transferProofRequired: 1,
    cashInstructions: null,
    paymentDueAt: null,
    refundPolicy: "manual",
    refundDeadlineAt: null,
    cancellationPolicyText: null,
  };
}

async function pricingSettings(env: Env, tournamentId: string): Promise<PricingSettings> {
  const row = await env.HUAU_DB.prepare(
    `SELECT payment_type as paymentType,entry_fee_minor as entryFeeMinor,base_fee_minor as baseFeeMinor,
            extra_category_fee_minor as extraCategoryFeeMinor,team_individual_fee_minor as teamIndividualFeeMinor,
            COALESCE(team_additional_participation_mode,'full') as teamAdditionalParticipationMode,
            team_additional_fee_minor as teamAdditionalFeeMinor
       FROM tournament_settings WHERE tournament_id=?`,
  ).bind(tournamentId).first<PricingSettings>();
  return row ?? {
    paymentType: "free",
    entryFeeMinor: null,
    baseFeeMinor: null,
    extraCategoryFeeMinor: null,
    teamIndividualFeeMinor: null,
    teamAdditionalParticipationMode: "full",
    teamAdditionalFeeMinor: null,
  };
}

async function addEvent(
  env: Env,
  input: { tournamentId: string; orderId?: string | null; attemptId?: string | null; eventType: string; actorUserId?: string | null; summary: string; metadata?: unknown; providerEventId?: string | null },
) {
  await env.HUAU_DB.prepare(
    `INSERT INTO payment_events (id,tournament_id,order_id,attempt_id,event_type,provider_event_id,actor_user_id,summary,metadata_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    uuid(), input.tournamentId, input.orderId ?? null, input.attemptId ?? null, input.eventType, input.providerEventId ?? null,
    input.actorUserId ?? null, input.summary, input.metadata === undefined ? null : JSON.stringify(input.metadata), now(),
  ).run();
}

async function openOrder(env: Env, tournamentId: string, payerKind: PayerKind, payerId: string) {
  const field = payerKind === "user" ? "payer_user_id" : "payer_profile_id";
  return env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,payer_kind as payerKind,payer_user_id as payerUserId,payer_profile_id as payerProfileId,
            payer_name as payerName,payer_email as payerEmail,currency,subtotal_minor as subtotalMinor,discount_minor as discountMinor,
            total_amount_minor as totalAmountMinor,amount_paid_minor as amountPaidMinor,amount_refunded_minor as amountRefundedMinor,
            status,selected_method as selectedMethod,due_at as dueAt,paid_at as paidAt,created_at as createdAt,updated_at as updatedAt
       FROM payment_orders WHERE tournament_id=? AND ${field}=? AND status IN ('draft','awaiting_payment') ORDER BY created_at DESC LIMIT 1`,
  ).bind(tournamentId, payerId).first<PaymentOrderRow>();
}

async function replaceOrderItems(
  env: Env,
  order: PaymentOrderRow | null,
  input: {
    tournamentId: string;
    payerKind: PayerKind;
    payerId: string;
    payerName: string;
    payerEmail: string | null;
    currency: string;
    dueAt: number | null;
    items: Array<{ registrationId?: string | null; playerProfileId?: string | null; categoryId?: string | null; label: string; amountMinor: number }>;
  },
) {
  const total = input.items.reduce((sum, item) => sum + Math.max(0, Math.trunc(item.amountMinor)), 0);
  if (input.items.length === 0 || total <= 0) {
    if (order) {
      await env.HUAU_DB.batch([
        env.HUAU_DB.prepare(`DELETE FROM payment_order_items WHERE order_id=?`).bind(order.id),
        env.HUAU_DB.prepare(`UPDATE payment_orders SET status='cancelled',total_amount_minor=0,subtotal_minor=0,updated_at=?,version=version+1 WHERE id=?`).bind(now(), order.id),
      ]);
    }
    return null;
  }
  const stamp = now();
  const orderId = order?.id ?? uuid();
  const statements = [] as D1PreparedStatement[];
  if (order) {
    statements.push(
      env.HUAU_DB.prepare(`DELETE FROM payment_order_items WHERE order_id=?`).bind(orderId),
      env.HUAU_DB.prepare(
        `UPDATE payment_orders SET payer_name=?,payer_email=?,currency=?,subtotal_minor=?,discount_minor=0,total_amount_minor=?,due_at=?,updated_at=?,version=version+1 WHERE id=?`,
      ).bind(input.payerName, input.payerEmail, input.currency, total, total, input.dueAt, stamp, orderId),
    );
  } else {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO payment_orders (id,tournament_id,payer_kind,payer_user_id,payer_profile_id,payer_name,payer_email,currency,subtotal_minor,discount_minor,total_amount_minor,amount_paid_minor,amount_refunded_minor,status,selected_method,due_at,paid_at,created_at,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?,?,0,?,0,0,'awaiting_payment',NULL,?,NULL,?,?,1)`,
      ).bind(
        orderId,
        input.tournamentId,
        input.payerKind,
        input.payerKind === "user" ? input.payerId : null,
        input.payerKind === "manual_profile" ? input.payerId : null,
        input.payerName,
        input.payerEmail,
        input.currency,
        total,
        total,
        input.dueAt,
        stamp,
        stamp,
      ),
    );
  }
  for (const item of input.items) {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO payment_order_items (id,order_id,registration_id,player_profile_id,category_id,label,amount_minor,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      ).bind(uuid(), orderId, item.registrationId ?? null, item.playerProfileId ?? null, item.categoryId ?? null, item.label, Math.max(0, Math.trunc(item.amountMinor)), stamp),
    );
  }
  await env.HUAU_DB.batch(statements);
  if (!order) await addEvent(env, { tournamentId: input.tournamentId, orderId, eventType: "order.created", summary: `Cobro creado para ${input.payerName}` });
  return orderId;
}

async function userOutstandingItems(env: Env, tournamentId: string, userId: string) {
  const rows = await env.HUAU_DB.prepare(
    `SELECT tr.id as registrationId,tc.name as categoryName,tr.final_amount_minor as finalAmountMinor,
            tr.paid_amount_minor as paidAmountMinor,tr.refunded_amount_minor as refundedAmountMinor,COALESCE(tr.currency,'UYU') as currency
       FROM tournament_registrations tr JOIN tournament_categories tc ON tc.id=tr.category_id
      WHERE tr.tournament_id=? AND tr.user_id=? AND tr.status NOT IN ('cancelled','rejected') AND tr.covered_by_registration_id IS NULL
        AND tr.final_amount_minor > MAX(0,tr.paid_amount_minor-tr.refunded_amount_minor)
        AND NOT EXISTS (
          SELECT 1 FROM payment_order_items poi JOIN payment_orders po ON po.id=poi.order_id
           WHERE poi.registration_id=tr.id AND po.status='pending_review'
        )
      ORDER BY tr.registration_number`,
  ).bind(tournamentId, userId).all<{ registrationId: string; categoryName: string; finalAmountMinor: number; paidAmountMinor: number; refundedAmountMinor: number; currency: string }>();
  return rows.results.map((row) => ({
    registrationId: row.registrationId,
    categoryId: null,
    label: row.categoryName,
    amountMinor: Math.max(0, row.finalAmountMinor - Math.max(0, row.paidAmountMinor - row.refundedAmountMinor)),
    currency: row.currency,
  }));
}

async function syncUserOrder(env: Env, tournamentId: string, userId: string) {
  const tournament = await tournamentById(env, tournamentId);
  if (!tournament) return null;
  const user = await env.HUAU_DB.prepare(`SELECT name,email FROM user WHERE id=?`).bind(userId).first<{ name: string; email: string }>();
  if (!user) return null;
  const items = await userOutstandingItems(env, tournamentId, userId);
  const settings = await paymentSettings(env, tournamentId, tournament.currency);
  const current = await openOrder(env, tournamentId, "user", userId);
  const currency = items.find((item) => item.currency)?.currency || settings.bankCurrency || tournament.currency;
  return replaceOrderItems(env, current, {
    tournamentId,
    payerKind: "user",
    payerId: userId,
    payerName: user.name,
    payerEmail: user.email,
    currency,
    dueAt: settings.paymentDueAt,
    items: items.map((item) => ({ registrationId: item.registrationId, label: item.label, amountMinor: item.amountMinor })),
  });
}

async function coveredManualCategory(env: Env, profileId: string, categoryId: string) {
  const row = await env.HUAU_DB.prepare(
    `SELECT poi.id FROM payment_order_items poi JOIN payment_orders po ON po.id=poi.order_id
      WHERE poi.player_profile_id=? AND poi.category_id=? AND po.status IN ('pending_review','paid','partially_refunded','refunded') LIMIT 1`,
  ).bind(profileId, categoryId).first<{ id: string }>();
  return Boolean(row);
}

async function linkedOnlineRegistration(env: Env, linkedUserId: string | null, categoryId: string) {
  if (!linkedUserId) return false;
  const row = await env.HUAU_DB.prepare(
    `SELECT id FROM tournament_registrations WHERE user_id=? AND category_id=? AND status NOT IN ('cancelled','rejected') LIMIT 1`,
  ).bind(linkedUserId, categoryId).first<{ id: string }>();
  return Boolean(row);
}

function manualPrice(category: ManualCategory, settings: PricingSettings, priorCount: number, priorTeamCount: number) {
  if (category.priceMinor !== null) {
    return registrationPriceMinor({ priceScope: category.priceScope, priceMinor: category.priceMinor }, 1);
  }
  if (category.entryType === "team" && settings.teamIndividualFeeMinor !== null) {
    return resolveTeamIndividualPrice({
      individualFeeMinor: settings.teamIndividualFeeMinor,
      additionalMode: settings.teamAdditionalParticipationMode,
      additionalFeeMinor: settings.teamAdditionalFeeMinor,
      priorTeamRegistrationCount: priorTeamCount,
    });
  }
  const resolution = resolveRegistrationPricing({
    categoryPriceScope: category.priceScope,
    categoryPriceMinor: category.priceMinor,
    tournamentPaymentType: settings.paymentType,
    tournamentEntryFeeMinor: settings.entryFeeMinor,
    tournamentBaseFeeMinor: settings.baseFeeMinor,
    tournamentExtraCategoryFeeMinor: settings.extraCategoryFeeMinor,
    priorActiveRegistrationCount: priorCount,
  });
  return registrationPriceMinor({ priceScope: resolution.priceScope, priceMinor: resolution.priceMinor }, 1);
}

async function syncManualProfileOrder(env: Env, tournament: TournamentRow, profileId: string) {
  const rows = await env.HUAU_DB.prepare(
    `SELECT p.id as profileId,p.display_name as displayName,p.contact,tc.id as categoryId,tc.name as categoryName,tc.entry_type as entryType,
            tc.price_scope as priceScope,tc.price_minor as priceMinor,tc.currency,tc.sort_order as sortOrder,op.user_id as linkedUserId
       FROM tournament_player_profiles p
       JOIN tournament_player_categories tpc ON tpc.player_profile_id=p.id
       JOIN tournament_categories tc ON tc.id=tpc.category_id
       LEFT JOIN organization_people op ON op.id=p.organization_person_id
      WHERE p.id=? AND p.tournament_id=? AND p.player_status<>'pending'
      ORDER BY tc.sort_order,tc.name`,
  ).bind(profileId, tournament.id).all<ManualCategory>();
  if (!rows.results.length) {
    const existing = await openOrder(env, tournament.id, "manual_profile", profileId);
    if (existing) await replaceOrderItems(env, existing, { tournamentId: tournament.id, payerKind: "manual_profile", payerId: profileId, payerName: existing.payerName, payerEmail: existing.payerEmail, currency: existing.currency, dueAt: existing.dueAt, items: [] });
    return null;
  }
  const paymentConfig = await paymentSettings(env, tournament.id, tournament.currency);
  const priceConfig = await pricingSettings(env, tournament.id);
  const items: Array<{ playerProfileId: string; categoryId: string; label: string; amountMinor: number }> = [];
  let priorCount = 0;
  let priorTeamCount = 0;
  for (const category of rows.results) {
    const price = manualPrice(category, priceConfig, priorCount, priorTeamCount);
    priorCount += 1;
    if (category.entryType === "team") priorTeamCount += 1;
    if (await linkedOnlineRegistration(env, category.linkedUserId, category.categoryId)) continue;
    if (await coveredManualCategory(env, profileId, category.categoryId)) continue;
    if (price > 0) items.push({ playerProfileId: profileId, categoryId: category.categoryId, label: category.categoryName, amountMinor: price });
  }
  const first = rows.results[0]!;
  const existing = await openOrder(env, tournament.id, "manual_profile", profileId);
  const orderId = await replaceOrderItems(env, existing, {
    tournamentId: tournament.id,
    payerKind: "manual_profile",
    payerId: profileId,
    payerName: first.displayName,
    payerEmail: first.contact.includes("@") ? first.contact : null,
    currency: first.currency || paymentConfig.bankCurrency || tournament.currency,
    dueAt: paymentConfig.paymentDueAt,
    items,
  });
  await refreshManualProfilePaymentStatus(env, profileId);
  return orderId;
}

async function refreshManualProfilePaymentStatus(env: Env, profileId: string) {
  const outstanding = await env.HUAU_DB.prepare(
    `SELECT COUNT(*) as count FROM payment_orders
      WHERE payer_kind='manual_profile' AND payer_profile_id=? AND status IN ('draft','awaiting_payment','pending_review')`,
  ).bind(profileId).first<{ count: number }>();
  await env.HUAU_DB.prepare(`UPDATE tournament_player_profiles SET payment_status=?,updated_at=?,version=version+1 WHERE id=?`)
    .bind(Number(outstanding?.count ?? 0) === 0 ? "paid" : "pending", now(), profileId).run();
}

async function syncTournamentOrders(env: Env, tournamentId: string) {
  const tournament = await tournamentById(env, tournamentId);
  if (!tournament) return;
  const users = await env.HUAU_DB.prepare(
    `SELECT DISTINCT user_id as userId FROM tournament_registrations WHERE tournament_id=? AND status NOT IN ('cancelled','rejected')`,
  ).bind(tournamentId).all<{ userId: string }>();
  for (const item of users.results) await syncUserOrder(env, tournamentId, item.userId);
  const profiles = await env.HUAU_DB.prepare(`SELECT id FROM tournament_player_profiles WHERE tournament_id=?`).bind(tournamentId).all<{ id: string }>();
  for (const profile of profiles.results) await syncManualProfileOrder(env, tournament, profile.id);
}

async function syncMyOrders(request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const tournaments = await env.HUAU_DB.prepare(
    `SELECT DISTINCT tournament_id as tournamentId FROM tournament_registrations WHERE user_id=? AND status NOT IN ('cancelled','rejected')`,
  ).bind(user.id).all<{ tournamentId: string }>();
  for (const row of tournaments.results) await syncUserOrder(env, row.tournamentId, user.id);
  return json({ ok: true });
}

async function detailedOrders(env: Env, whereSql: string, values: unknown[]) {
  const orders = await env.HUAU_DB.prepare(
    `SELECT po.id,po.tournament_id as tournamentId,po.payer_kind as payerKind,po.payer_user_id as payerUserId,po.payer_profile_id as payerProfileId,
            po.payer_name as payerName,po.payer_email as payerEmail,po.currency,po.subtotal_minor as subtotalMinor,po.discount_minor as discountMinor,
            po.total_amount_minor as totalAmountMinor,po.amount_paid_minor as amountPaidMinor,po.amount_refunded_minor as amountRefundedMinor,
            po.status,po.selected_method as selectedMethod,po.due_at as dueAt,po.paid_at as paidAt,po.created_at as createdAt,po.updated_at as updatedAt,
            t.name as tournamentName,t.slug,t.organizer_organization_id as organizerOrganizationId
       FROM payment_orders po JOIN tournaments t ON t.id=po.tournament_id ${whereSql} ORDER BY po.updated_at DESC`,
  ).bind(...values).all<PaymentOrderRow & { tournamentName: string; slug: string; organizerOrganizationId: string }>();
  return Promise.all(orders.results.map(async (order) => {
    const [items, attempts, refunds] = await Promise.all([
      env.HUAU_DB.prepare(
        `SELECT id,registration_id as registrationId,player_profile_id as playerProfileId,category_id as categoryId,label,amount_minor as amountMinor FROM payment_order_items WHERE order_id=? ORDER BY created_at,id`,
      ).bind(order.id).all(),
      env.HUAU_DB.prepare(
        `SELECT pa.id,pa.method,pa.status,pa.amount_minor as amountMinor,pa.external_id as externalId,pa.external_status as externalStatus,
                pa.external_reference as externalReference,pa.note,pa.submitted_at as submittedAt,pa.reviewed_at as reviewedAt,pa.created_at as createdAt,
                pp.id as proofId,pp.original_name as proofName,pp.content_type as proofContentType,pp.size_bytes as proofSizeBytes
           FROM payment_attempts pa LEFT JOIN payment_proofs pp ON pp.attempt_id=pa.id WHERE pa.order_id=? ORDER BY pa.created_at DESC`,
      ).bind(order.id).all(),
      env.HUAU_DB.prepare(
        `SELECT id,registration_id as registrationId,amount_minor as amountMinor,method,status,external_id as externalId,note,created_at as createdAt,completed_at as completedAt FROM payment_refunds WHERE order_id=? ORDER BY created_at DESC`,
      ).bind(order.id).all(),
    ]);
    const settings = await paymentSettings(env, order.tournamentId, order.currency);
    return { ...order, items: items.results, attempts: attempts.results, refunds: refunds.results, settings };
  }));
}

async function myOrders(request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const orders = await detailedOrders(env, `WHERE po.payer_user_id=? AND po.status<>'cancelled'`, [user.id]);
  return json({ ok: true, orders });
}

async function orderForUser(env: Env, orderId: string, userId: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,payer_kind as payerKind,payer_user_id as payerUserId,payer_profile_id as payerProfileId,
            payer_name as payerName,payer_email as payerEmail,currency,subtotal_minor as subtotalMinor,discount_minor as discountMinor,
            total_amount_minor as totalAmountMinor,amount_paid_minor as amountPaidMinor,amount_refunded_minor as amountRefundedMinor,status,
            selected_method as selectedMethod,due_at as dueAt,paid_at as paidAt,created_at as createdAt,updated_at as updatedAt
       FROM payment_orders WHERE id=? AND payer_user_id=?`,
  ).bind(orderId, userId).first<PaymentOrderRow>();
}

async function methodEnabled(env: Env, order: PaymentOrderRow, method: PaymentMethod) {
  const tournament = await tournamentById(env, order.tournamentId);
  const settings = await paymentSettings(env, order.tournamentId, tournament?.currency ?? order.currency);
  if (method === "bank_transfer") return settings.bankTransferEnabled === 1;
  if (method === "cash") return settings.cashEnabled === 1;
  if (method === "mercado_pago") return settings.mercadoPagoEnabled === 1 && Boolean(settings.mercadoPagoAccountId);
  return false;
}

async function selectMethod(orderId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const order = await orderForUser(env, orderId, user.id);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  if (!["draft", "awaiting_payment"].includes(order.status)) return json({ ok: false, code: "PAYMENT_ORDER_LOCKED" }, { status: 409 });
  const body = await readJson<{ method?: PaymentMethod }>(request);
  if (!body.method || !(await methodEnabled(env, order, body.method))) return json({ ok: false, code: "PAYMENT_METHOD_NOT_AVAILABLE" }, { status: 409 });
  if (body.method !== "mercado_pago") {
    const activeMp = await env.HUAU_DB.prepare(
      `SELECT id FROM payment_attempts WHERE order_id=? AND method='mercado_pago' AND status IN ('created','pending') AND external_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    ).bind(order.id).first<{ id: string }>();
    if (activeMp) return json({ ok: false, code: "MERCADO_PAGO_CHECKOUT_ACTIVE", message: "Cancelá el checkout de Mercado Pago antes de cambiar de método." }, { status: 409 });
  }
  const stamp = now();
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`UPDATE payment_orders SET selected_method=?,status='awaiting_payment',updated_at=?,version=version+1 WHERE id=?`).bind(body.method, stamp, order.id),
    env.HUAU_DB.prepare(`UPDATE payment_attempts SET status='cancelled',updated_at=? WHERE order_id=? AND status IN ('created','pending') AND method<>?`).bind(stamp, order.id, body.method),
  ];
  if (body.method === "cash") {
    const existing = await env.HUAU_DB.prepare(`SELECT id FROM payment_attempts WHERE order_id=? AND method='cash' AND status='pending' ORDER BY created_at DESC LIMIT 1`).bind(order.id).first<{ id: string }>();
    if (!existing) statements.push(
      env.HUAU_DB.prepare(`INSERT INTO payment_attempts (id,order_id,method,status,amount_minor,created_at,updated_at,submitted_by_user_id,submitted_at) VALUES (?,?,'cash','pending',?,?,?,?,?)`)
        .bind(uuid(), order.id, order.totalAmountMinor, stamp, stamp, user.id, stamp),
    );
  }
  await env.HUAU_DB.batch(statements);
  await addEvent(env, { tournamentId: order.tournamentId, orderId: order.id, eventType: "method.selected", actorUserId: user.id, summary: `Método seleccionado: ${body.method}` });
  return json({ ok: true });
}

const proofTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
function safeFileName(name: string) {
  const cleanName = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleanName.slice(-120) || "comprobante";
}

async function saveTransferProof(
  order: PaymentOrderRow,
  user: CurrentUser,
  request: Request,
  env: Env,
  admin = false,
) {
  if (!["draft", "awaiting_payment"].includes(order.status)) return json({ ok: false, code: "PAYMENT_ORDER_LOCKED" }, { status: 409 });
  const settings = await paymentSettings(env, order.tournamentId, order.currency);
  if (!settings.bankTransferEnabled) return json({ ok: false, code: "BANK_TRANSFER_DISABLED" }, { status: 409 });
  const form = await request.formData();
  const raw = form.get("proof");
  if (!(raw instanceof File)) return json({ ok: false, code: "PROOF_REQUIRED" }, { status: 400 });
  if (!proofTypes.has(raw.type)) return json({ ok: false, code: "PROOF_TYPE_NOT_ALLOWED" }, { status: 415 });
  if (raw.size <= 0 || raw.size > 8 * 1024 * 1024) return json({ ok: false, code: "PROOF_SIZE_INVALID" }, { status: 413 });
  const stamp = now();
  const attemptId = uuid();
  const proofId = uuid();
  const objectKey = `tournaments/${order.tournamentId}/payments/${order.id}/${proofId}-${safeFileName(raw.name)}`;
  await env.HUAU_ASSETS.put(objectKey, raw.stream(), { httpMetadata: { contentType: raw.type }, customMetadata: { orderId: order.id, proofId } });
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `INSERT INTO payment_attempts (id,order_id,method,status,amount_minor,note,submitted_by_user_id,submitted_at,created_at,updated_at)
       VALUES (?,?,'bank_transfer','submitted',?,?,?,?,?,?)`,
    ).bind(attemptId, order.id, order.totalAmountMinor, clean(form.get("note")), user.id, stamp, stamp, stamp),
    env.HUAU_DB.prepare(
      `INSERT INTO payment_proofs (id,attempt_id,object_key,original_name,content_type,size_bytes,uploaded_by_user_id,uploaded_at) VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(proofId, attemptId, objectKey, raw.name, raw.type, raw.size, user.id, stamp),
    env.HUAU_DB.prepare(`UPDATE payment_orders SET selected_method='bank_transfer',status='pending_review',updated_at=?,version=version+1 WHERE id=?`).bind(stamp, order.id),
  ]);
  await addEvent(env, { tournamentId: order.tournamentId, orderId: order.id, attemptId, eventType: "transfer.submitted", actorUserId: user.id, summary: admin ? "Comprobante cargado por administración" : "Comprobante de transferencia enviado" });
  return json({ ok: true, attemptId });
}

async function transferProof(orderId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const order = await orderForUser(env, orderId, user.id);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  return saveTransferProof(order, user, request, env);
}

async function paymentAccountById(env: Env, accountId: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,organization_id as organizationId,label,status,external_account_id as externalAccountId,public_key as publicKey,
            access_token_encrypted as accessTokenEncrypted,refresh_token_encrypted as refreshTokenEncrypted,token_expires_at as tokenExpiresAt,live_mode as liveMode
       FROM payment_accounts WHERE id=?`,
  ).bind(accountId).first<PaymentAccountRow>();
}

function b64ToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function bytesToB64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function encryptionKey(env: Env) {
  if (!env.PAYMENT_ENCRYPTION_KEY) throw new Error("PAYMENT_ENCRYPTION_KEY_MISSING");
  const raw = b64ToBytes(env.PAYMENT_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("PAYMENT_ENCRYPTION_KEY_INVALID");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptSecret(env: Env, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const payload = new TextEncoder().encode(value);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload));
  return `v1:${bytesToB64(iv)}:${bytesToB64(cipher)}`;
}
async function decryptSecret(env: Env, value: string) {
  const [version, ivText, cipherText] = value.split(":");
  if (version !== "v1" || !ivText || !cipherText) throw new Error("PAYMENT_SECRET_FORMAT_INVALID");
  const key = await encryptionKey(env);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(ivText) }, key, b64ToBytes(cipherText));
  return new TextDecoder().decode(plain);
}

async function mpAccessToken(env: Env, account: PaymentAccountRow) {
  if (account.status !== "active") throw new Error("MERCADO_PAGO_ACCOUNT_INACTIVE");
  if (account.tokenExpiresAt && account.tokenExpiresAt < now() + 86_400 && account.refreshTokenEncrypted) {
    if (!env.MERCADO_PAGO_CLIENT_ID || !env.MERCADO_PAGO_CLIENT_SECRET) throw new Error("MERCADO_PAGO_NOT_CONFIGURED");
    const refreshToken = await decryptSecret(env, account.refreshTokenEncrypted);
    const response = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: env.MERCADO_PAGO_CLIENT_ID,
        client_secret: env.MERCADO_PAGO_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; public_key?: string; user_id?: number | string; live_mode?: boolean; message?: string };
    if (!response.ok || !payload.access_token) throw new Error(payload.message || "MERCADO_PAGO_REFRESH_FAILED");
    const stamp = now();
    await env.HUAU_DB.prepare(
      `UPDATE payment_accounts SET access_token_encrypted=?,refresh_token_encrypted=?,token_expires_at=?,public_key=COALESCE(?,public_key),external_account_id=COALESCE(?,external_account_id),live_mode=?,status='active',updated_at=? WHERE id=?`,
    ).bind(
      await encryptSecret(env, payload.access_token),
      payload.refresh_token ? await encryptSecret(env, payload.refresh_token) : account.refreshTokenEncrypted,
      payload.expires_in ? stamp + payload.expires_in : null,
      payload.public_key ?? null,
      payload.user_id ? String(payload.user_id) : null,
      payload.live_mode ? 1 : 0,
      stamp,
      account.id,
    ).run();
    return payload.access_token;
  }
  return decryptSecret(env, account.accessTokenEncrypted);
}

async function mercadoPagoCheckout(orderId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const order = await orderForUser(env, orderId, user.id);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  if (!["draft", "awaiting_payment"].includes(order.status)) return json({ ok: false, code: "PAYMENT_ORDER_LOCKED" }, { status: 409 });
  const settings = await paymentSettings(env, order.tournamentId, order.currency);
  if (!settings.mercadoPagoEnabled || !settings.mercadoPagoAccountId) return json({ ok: false, code: "MERCADO_PAGO_DISABLED" }, { status: 409 });
  const account = await paymentAccountById(env, settings.mercadoPagoAccountId);
  if (!account) return json({ ok: false, code: "MERCADO_PAGO_ACCOUNT_NOT_FOUND" }, { status: 409 });
  if (!env.MERCADO_PAGO_WEBHOOK_SECRET || !env.PAYMENT_ENCRYPTION_KEY) return json({ ok: false, code: "MERCADO_PAGO_NOT_CONFIGURED" }, { status: 503 });
  const accessToken = await mpAccessToken(env, account);
  const items = await env.HUAU_DB.prepare(`SELECT label,amount_minor as amountMinor FROM payment_order_items WHERE order_id=? ORDER BY created_at`).bind(order.id).all<{ label: string; amountMinor: number }>();
  if (!items.results.length || order.totalAmountMinor <= 0) return json({ ok: false, code: "PAYMENT_ORDER_EMPTY" }, { status: 409 });
  const tournament = await tournamentById(env, order.tournamentId);
  if (!tournament) return json({ ok: false, code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });
  const base = env.BETTER_AUTH_URL.replace(/\/$/, "");
  const returnBase = `${base}/app/registrations`;

  // Reuse an active external checkout instead of creating duplicate Mercado Pago orders.
  const activeAttempt = await env.HUAU_DB.prepare(
    `SELECT id,external_id as externalId FROM payment_attempts WHERE order_id=? AND method='mercado_pago' AND status IN ('created','pending') AND external_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
  ).bind(order.id).first<{ id: string; externalId: string }>();
  if (activeAttempt) {
    const lookup = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(activeAttempt.externalId)}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    const currentMp = await lookup.json() as MpOrderResponse;
    if (!lookup.ok) return json({ ok: false, code: "MERCADO_PAGO_LOOKUP_FAILED", message: currentMp.message || currentMp.error || "No se pudo consultar el checkout activo." }, { status: 502 });
    if (currentMp.external_reference !== order.id) return json({ ok: false, code: "MERCADO_PAGO_REFERENCE_MISMATCH" }, { status: 409 });
    const currentTotalMinor = Math.round(Number(currentMp.total_amount ?? "0") * 100);
    if (currentTotalMinor !== order.totalAmountMinor) return json({ ok: false, code: "MERCADO_PAGO_AMOUNT_MISMATCH" }, { status: 409 });
    const currentStatus = (currentMp.status || "").toLowerCase();
    const currentDetail = (currentMp.status_detail || "").toLowerCase();
    const currentPaidMinor = Math.round(Number(currentMp.total_paid_amount ?? "0") * 100);
    const approved = currentPaidMinor >= order.totalAmountMinor && (currentStatus === "processed" || currentDetail === "accredited");
    const failed = ["cancelled", "canceled", "failed", "expired", "rejected"].includes(currentStatus) || ["canceled", "rejected"].includes(currentDetail);
    if (approved) {
      await applyOrderPaid(env, order.id, activeAttempt.id, currentPaidMinor, null, `${currentStatus}:${currentDetail}`);
      return json({ ok: true, checkoutUrl: `${returnBase}?payment=approved`, alreadyPaid: true });
    }
    if (!failed && currentMp.checkout_url) {
      await env.HUAU_DB.prepare(`UPDATE payment_orders SET selected_method='mercado_pago',status='awaiting_payment',updated_at=?,version=version+1 WHERE id=?`).bind(now(), order.id).run();
      return json({ ok: true, checkoutUrl: currentMp.checkout_url, externalOrderId: activeAttempt.externalId, reused: true });
    }
    await rejectAttempt(env, activeAttempt.id, null, `Mercado Pago: ${currentStatus}/${currentDetail}`);
  }

  const idempotencyKey = uuid();
  const payload = {
    type: "online",
    processing_mode: "manual",
    capture_mode: "automatic_async",
    total_amount: moneyString(order.totalAmountMinor),
    external_reference: order.id,
    payer: { email: order.payerEmail || user.email },
    items: items.results.map((item, index) => ({
      title: `${tournament.name} · ${item.label}`.slice(0, 120),
      quantity: 1,
      unit_price: moneyString(item.amountMinor),
      unit_measure: "unit",
      total_amount: moneyString(item.amountMinor),
      external_code: `huau-${index + 1}`,
    })),
    config: {
      online: {
        success_url: `${returnBase}?payment=approved`,
        failure_url: `${returnBase}?payment=failure`,
        pending_url: `${returnBase}?payment=pending`,
        auto_return: "all",
      },
      statement_descriptor: "HUAU SPORTS",
    },
  };
  const response = await fetch("https://api.mercadopago.com/v1/orders", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      "x-idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const mp = await response.json() as MpOrderResponse;
  if (!response.ok || !mp.id || !mp.checkout_url) {
    await addEvent(env, { tournamentId: order.tournamentId, orderId: order.id, eventType: "mercado_pago.error", actorUserId: user.id, summary: "Mercado Pago rechazó la creación del checkout", metadata: { status: response.status, error: mp.error, message: mp.message } });
    return json({ ok: false, code: "MERCADO_PAGO_ORDER_FAILED", message: mp.message || mp.error || "Mercado Pago error" }, { status: 502 });
  }
  const stamp = now();
  const attemptId = uuid();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(
      `INSERT INTO payment_attempts (id,order_id,method,status,amount_minor,external_id,external_status,external_reference,idempotency_key,submitted_by_user_id,submitted_at,created_at,updated_at)
       VALUES (?,?,'mercado_pago','pending',?,?,?,?,?,?,?,?,?)`,
    ).bind(attemptId, order.id, order.totalAmountMinor, mp.id, mp.status ?? "created", order.id, idempotencyKey, user.id, stamp, stamp, stamp),
    env.HUAU_DB.prepare(`UPDATE payment_orders SET selected_method='mercado_pago',status='awaiting_payment',updated_at=?,version=version+1 WHERE id=?`).bind(stamp, order.id),
  ]);
  await addEvent(env, { tournamentId: order.tournamentId, orderId: order.id, attemptId, eventType: "mercado_pago.checkout_created", actorUserId: user.id, summary: "Checkout de Mercado Pago creado", metadata: { mpOrderId: mp.id } });
  return json({ ok: true, checkoutUrl: mp.checkout_url, externalOrderId: mp.id });
}

async function cancelMercadoPagoCheckout(orderId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const order = await orderForUser(env, orderId, user.id);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  if (!["draft", "awaiting_payment"].includes(order.status)) return json({ ok: false, code: "PAYMENT_ORDER_LOCKED" }, { status: 409 });
  const attempt = await env.HUAU_DB.prepare(
    `SELECT id,external_id as externalId FROM payment_attempts WHERE order_id=? AND method='mercado_pago' AND status IN ('created','pending') AND external_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
  ).bind(order.id).first<{ id: string; externalId: string }>();
  if (!attempt) {
    await env.HUAU_DB.prepare(`UPDATE payment_orders SET selected_method=NULL,status='awaiting_payment',updated_at=?,version=version+1 WHERE id=? AND selected_method='mercado_pago'`).bind(now(), order.id).run();
    return json({ ok: true, alreadyInactive: true });
  }
  const settings = await paymentSettings(env, order.tournamentId, order.currency);
  if (!settings.mercadoPagoAccountId) return json({ ok: false, code: "MERCADO_PAGO_ACCOUNT_NOT_FOUND" }, { status: 409 });
  const account = await paymentAccountById(env, settings.mercadoPagoAccountId);
  if (!account) return json({ ok: false, code: "MERCADO_PAGO_ACCOUNT_NOT_FOUND" }, { status: 409 });
  const accessToken = await mpAccessToken(env, account);
  const cancellation = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(attempt.externalId)}/cancel`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "content-type": "application/json", "x-idempotency-key": `huau-cancel-${attempt.id}` },
    body: "{}",
  });
  const mp = await cancellation.json() as MpOrderResponse;
  if (!cancellation.ok) {
    // A conflict can mean the order changed state between screens. Resolve it server-side before allowing another method.
    const lookup = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(attempt.externalId)}`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
    const currentMp = await lookup.json() as MpOrderResponse;
    if (!lookup.ok) return json({ ok: false, code: "MERCADO_PAGO_CANCEL_FAILED", message: mp.message || mp.error || "No se pudo cancelar el checkout." }, { status: 502 });
    const status = (currentMp.status || "").toLowerCase();
    const detail = (currentMp.status_detail || "").toLowerCase();
    const paidMinor = Math.round(Number(currentMp.total_paid_amount ?? "0") * 100);
    if (paidMinor >= order.totalAmountMinor && (status === "processed" || detail === "accredited")) {
      await applyOrderPaid(env, order.id, attempt.id, paidMinor, null, `${status}:${detail}`);
      return json({ ok: false, code: "MERCADO_PAGO_ALREADY_PAID", message: "Mercado Pago ya informó el pago. HUAU actualizó el cobro como pagado." }, { status: 409 });
    }
    if (!["cancelled", "canceled", "failed", "expired", "rejected"].includes(status)) {
      return json({ ok: false, code: "MERCADO_PAGO_CANCEL_FAILED", message: "Mercado Pago no permite cancelar este checkout en su estado actual." }, { status: 409 });
    }
  }
  const stamp = now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE payment_attempts SET status='cancelled',external_status=?,reviewed_by_user_id=?,reviewed_at=?,updated_at=? WHERE id=?`).bind((mp.status || "canceled").toLowerCase(), user.id, stamp, stamp, attempt.id),
    env.HUAU_DB.prepare(`UPDATE payment_orders SET selected_method=NULL,status='awaiting_payment',updated_at=?,version=version+1 WHERE id=?`).bind(stamp, order.id),
  ]);
  await addEvent(env, { tournamentId: order.tournamentId, orderId: order.id, attemptId: attempt.id, eventType: "mercado_pago.checkout_cancelled", actorUserId: user.id, summary: "Checkout de Mercado Pago cancelado" });
  return json({ ok: true });
}

async function orderById(env: Env, orderId: string) {
  return env.HUAU_DB.prepare(
    `SELECT id,tournament_id as tournamentId,payer_kind as payerKind,payer_user_id as payerUserId,payer_profile_id as payerProfileId,payer_name as payerName,
            payer_email as payerEmail,currency,subtotal_minor as subtotalMinor,discount_minor as discountMinor,total_amount_minor as totalAmountMinor,
            amount_paid_minor as amountPaidMinor,amount_refunded_minor as amountRefundedMinor,status,selected_method as selectedMethod,due_at as dueAt,
            paid_at as paidAt,created_at as createdAt,updated_at as updatedAt FROM payment_orders WHERE id=?`,
  ).bind(orderId).first<PaymentOrderRow>();
}

async function registrationFinancialRecalc(env: Env, registrationId: string) {
  const row = await env.HUAU_DB.prepare(
    `SELECT tr.id,tr.entry_id as entryId,tr.status,tr.final_amount_minor as finalAmountMinor,tr.paid_amount_minor as paidAmountMinor,
            tr.refunded_amount_minor as refundedAmountMinor,e.status as entryStatus
       FROM tournament_registrations tr LEFT JOIN tournament_entries e ON e.id=tr.entry_id WHERE tr.id=?`,
  ).bind(registrationId).first<{ id: string; entryId: string | null; status: string; finalAmountMinor: number; paidAmountMinor: number; refundedAmountMinor: number; entryStatus: string | null }>();
  if (!row || ["cancelled", "rejected"].includes(row.status)) return;
  const netPaid = Math.max(0, row.paidAmountMinor - row.refundedAmountMinor);
  const nextStatus = row.entryStatus === "waitlisted" ? "waitlisted" : row.finalAmountMinor === 0 || netPaid >= row.finalAmountMinor ? "confirmed" : "awaiting_payment";
  await env.HUAU_DB.prepare(`UPDATE tournament_registrations SET status=?,updated_at=?,version=version+1 WHERE id=?`).bind(nextStatus, now(), registrationId).run();
}

async function applyOrderPaid(env: Env, orderId: string, attemptId: string, paidAmountMinor: number, actorUserId: string | null, externalStatus?: string | null) {
  const order = await orderById(env, orderId);
  if (!order) throw new Error("PAYMENT_ORDER_NOT_FOUND");
  if (order.status === "paid" || order.status === "partially_refunded" || order.status === "refunded") return;
  const amount = Math.max(0, Math.trunc(paidAmountMinor));
  if (amount < order.totalAmountMinor) throw new Error("PAYMENT_AMOUNT_INSUFFICIENT");
  const attempt = await env.HUAU_DB.prepare(`SELECT status FROM payment_attempts WHERE id=?`).bind(attemptId).first<{ status: string }>();
  if (!attempt) throw new Error("PAYMENT_ATTEMPT_NOT_FOUND");
  if (attempt.status === "approved") return;
  const items = await env.HUAU_DB.prepare(`SELECT registration_id as registrationId,player_profile_id as playerProfileId,amount_minor as amountMinor FROM payment_order_items WHERE order_id=?`).bind(order.id).all<{ registrationId: string | null; playerProfileId: string | null; amountMinor: number }>();
  const stamp = now();
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`UPDATE payment_attempts SET status='approved',external_status=COALESCE(?,external_status),reviewed_by_user_id=COALESCE(?,reviewed_by_user_id),reviewed_at=?,updated_at=? WHERE id=?`).bind(externalStatus ?? null, actorUserId, stamp, stamp, attemptId),
    env.HUAU_DB.prepare(`UPDATE payment_orders SET status='paid',amount_paid_minor=?,paid_at=?,updated_at=?,version=version+1 WHERE id=?`).bind(Math.max(order.totalAmountMinor, amount), stamp, stamp, order.id),
  ];
  for (const item of items.results) {
    if (item.registrationId) statements.push(
      env.HUAU_DB.prepare(`UPDATE tournament_registrations SET paid_amount_minor=paid_amount_minor+?,updated_at=?,version=version+1 WHERE id=?`).bind(item.amountMinor, stamp, item.registrationId),
    );
  }
  await env.HUAU_DB.batch(statements);
  for (const item of items.results) if (item.registrationId) await registrationFinancialRecalc(env, item.registrationId);
  const profiles = [...new Set(items.results.map((item) => item.playerProfileId).filter((value): value is string => Boolean(value)))];
  for (const profileId of profiles) await refreshManualProfilePaymentStatus(env, profileId);
  await addEvent(env, { tournamentId: order.tournamentId, orderId: order.id, attemptId, eventType: "payment.approved", actorUserId, summary: `Pago aprobado: ${moneyString(order.totalAmountMinor)} ${order.currency}` });
}

async function rejectAttempt(env: Env, attemptId: string, actorUserId: string | null, note: string | null) {
  const row = await env.HUAU_DB.prepare(
    `SELECT pa.id,pa.order_id as orderId,pa.status,po.tournament_id as tournamentId,po.status as orderStatus FROM payment_attempts pa JOIN payment_orders po ON po.id=pa.order_id WHERE pa.id=?`,
  ).bind(attemptId).first<{ id: string; orderId: string; status: string; tournamentId: string; orderStatus: string }>();
  if (!row) throw new Error("PAYMENT_ATTEMPT_NOT_FOUND");
  if (row.status === "approved") throw new Error("APPROVED_PAYMENT_CANNOT_BE_REJECTED");
  const stamp = now();
  await env.HUAU_DB.batch([
    env.HUAU_DB.prepare(`UPDATE payment_attempts SET status='rejected',note=COALESCE(?,note),reviewed_by_user_id=?,reviewed_at=?,updated_at=? WHERE id=?`).bind(note, actorUserId, stamp, stamp, attemptId),
    env.HUAU_DB.prepare(`UPDATE payment_orders SET status='awaiting_payment',selected_method=NULL,updated_at=?,version=version+1 WHERE id=? AND status IN ('awaiting_payment','pending_review')`).bind(stamp, row.orderId),
  ]);
  await addEvent(env, { tournamentId: row.tournamentId, orderId: row.orderId, attemptId, eventType: "payment.rejected", actorUserId, summary: "Pago/comprobante rechazado", metadata: { note } });
}

async function adminPayments(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const allowed = await requireAdmin(tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  const settings = await paymentSettings(env, tournamentId, allowed.tournament.currency);
  const orders = await detailedOrders(env, `WHERE po.tournament_id=? AND po.status<>'cancelled'`, [tournamentId]);
  const accounts = await env.HUAU_DB.prepare(
    `SELECT id,label,status,external_account_id as externalAccountId,public_key as publicKey,live_mode as liveMode,updated_at as updatedAt FROM payment_accounts WHERE organization_id=? AND provider='mercado_pago' ORDER BY updated_at DESC`,
  ).bind(allowed.tournament.organizerOrganizationId).all();
  const cancellations = await env.HUAU_DB.prepare(
    `SELECT cr.id,cr.registration_id as registrationId,cr.status,cr.reason,cr.net_paid_minor as netPaidMinor,cr.refund_amount_minor as refundAmountMinor,
            cr.admin_note as adminNote,cr.created_at as createdAt,cr.reviewed_at as reviewedAt,u.name as playerName,u.email,tc.name as categoryName,
            tpr.final_amount_minor as finalAmountMinor,tpr.currency
       FROM registration_cancellation_requests cr JOIN tournament_registrations tpr ON tpr.id=cr.registration_id
       JOIN user u ON u.id=cr.requested_by_user_id JOIN tournament_categories tc ON tc.id=tpr.category_id
      WHERE cr.tournament_id=? ORDER BY CASE cr.status WHEN 'pending' THEN 0 ELSE 1 END,cr.created_at DESC`,
  ).bind(tournamentId).all();
  const refunds = await env.HUAU_DB.prepare(
    `SELECT pr.id,pr.order_id as orderId,pr.registration_id as registrationId,pr.amount_minor as amountMinor,pr.method,pr.status,pr.external_id as externalId,
            pr.note,pr.created_at as createdAt,pr.completed_at as completedAt,po.payer_name as payerName
       FROM payment_refunds pr JOIN payment_orders po ON po.id=pr.order_id WHERE po.tournament_id=? ORDER BY CASE pr.status WHEN 'pending' THEN 0 ELSE 1 END,pr.created_at DESC`,
  ).bind(tournamentId).all();
  const summary = orders.reduce((acc, order) => {
    if (!["refunded", "cancelled"].includes(order.status)) acc.expectedMinor += order.totalAmountMinor;
    acc.paidMinor += Math.max(0, order.amountPaidMinor - order.amountRefundedMinor);
    acc.refundedMinor += order.amountRefundedMinor;
    if (order.status === "pending_review") acc.reviewMinor += order.totalAmountMinor;
    if (["draft", "awaiting_payment"].includes(order.status)) acc.pendingMinor += order.totalAmountMinor;
    return acc;
  }, { expectedMinor: 0, paidMinor: 0, refundedMinor: 0, reviewMinor: 0, pendingMinor: 0 });
  return json({ ok: true, settings, accounts: accounts.results, orders, cancellations: cancellations.results, refunds: refunds.results, summary, mercadoPagoConfigured: Boolean(env.MERCADO_PAGO_CLIENT_ID && env.MERCADO_PAGO_CLIENT_SECRET && env.MERCADO_PAGO_WEBHOOK_SECRET && env.PAYMENT_ENCRYPTION_KEY) });
}

async function adminSync(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const allowed = await requireAdmin(tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  await syncTournamentOrders(env, tournamentId);
  return json({ ok: true });
}

async function updatePaymentSettings(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const allowed = await requireAdmin(tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  const body = await readJson<{
    bankTransferEnabled?: boolean; cashEnabled?: boolean; mercadoPagoEnabled?: boolean; mercadoPagoAccountId?: string | null;
    bankName?: string | null; bankAccountHolder?: string | null; bankAccountNumber?: string | null; bankAccountAlias?: string | null;
    bankCurrency?: string | null; bankInstructions?: string | null; transferProofRequired?: boolean; cashInstructions?: string | null;
    paymentDueAt?: number | null; refundPolicy?: "manual" | "none" | "full_before_deadline"; refundDeadlineAt?: number | null; cancellationPolicyText?: string | null;
  }>(request);
  const current = await paymentSettings(env, tournamentId, allowed.tournament.currency);
  const accountId = body.mercadoPagoAccountId === undefined ? current.mercadoPagoAccountId : body.mercadoPagoAccountId;
  if (accountId) {
    const account = await paymentAccountById(env, accountId);
    if (!account || account.organizationId !== allowed.tournament.organizerOrganizationId) return json({ ok: false, code: "PAYMENT_ACCOUNT_INVALID" }, { status: 400 });
  }
  const mpEnabled = body.mercadoPagoEnabled === undefined ? current.mercadoPagoEnabled : boolInt(body.mercadoPagoEnabled, false);
  if (mpEnabled && !accountId) return json({ ok: false, code: "MERCADO_PAGO_ACCOUNT_REQUIRED" }, { status: 400 });
  const refundPolicy = body.refundPolicy ?? current.refundPolicy;
  if (!["manual", "none", "full_before_deadline"].includes(refundPolicy)) return json({ ok: false, code: "INVALID_REFUND_POLICY" }, { status: 400 });
  const refundDeadlineAt = body.refundDeadlineAt === undefined ? current.refundDeadlineAt : body.refundDeadlineAt;
  if (refundPolicy === "full_before_deadline" && !refundDeadlineAt) return json({ ok: false, code: "REFUND_DEADLINE_REQUIRED", message: "La política de devolución total necesita una fecha límite." }, { status: 400 });
  const stamp = now();
  await env.HUAU_DB.prepare(
    `INSERT INTO tournament_payment_settings
      (tournament_id,bank_transfer_enabled,cash_enabled,mercado_pago_enabled,mercado_pago_account_id,bank_name,bank_account_holder,bank_account_number,bank_account_alias,bank_currency,bank_instructions,transfer_proof_required,cash_instructions,payment_due_at,refund_policy,refund_deadline_at,cancellation_policy_text,updated_by_user_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(tournament_id) DO UPDATE SET bank_transfer_enabled=excluded.bank_transfer_enabled,cash_enabled=excluded.cash_enabled,
       mercado_pago_enabled=excluded.mercado_pago_enabled,mercado_pago_account_id=excluded.mercado_pago_account_id,bank_name=excluded.bank_name,
       bank_account_holder=excluded.bank_account_holder,bank_account_number=excluded.bank_account_number,bank_account_alias=excluded.bank_account_alias,
       bank_currency=excluded.bank_currency,bank_instructions=excluded.bank_instructions,transfer_proof_required=excluded.transfer_proof_required,
       cash_instructions=excluded.cash_instructions,payment_due_at=excluded.payment_due_at,refund_policy=excluded.refund_policy,
       refund_deadline_at=excluded.refund_deadline_at,cancellation_policy_text=excluded.cancellation_policy_text,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`,
  ).bind(
    tournamentId,
    body.bankTransferEnabled === undefined ? current.bankTransferEnabled : boolInt(body.bankTransferEnabled, true),
    body.cashEnabled === undefined ? current.cashEnabled : boolInt(body.cashEnabled, false),
    mpEnabled,
    accountId,
    body.bankName === undefined ? current.bankName : clean(body.bankName),
    body.bankAccountHolder === undefined ? current.bankAccountHolder : clean(body.bankAccountHolder),
    body.bankAccountNumber === undefined ? current.bankAccountNumber : clean(body.bankAccountNumber),
    body.bankAccountAlias === undefined ? current.bankAccountAlias : clean(body.bankAccountAlias),
    clean(body.bankCurrency) ?? current.bankCurrency ?? allowed.tournament.currency,
    body.bankInstructions === undefined ? current.bankInstructions : clean(body.bankInstructions),
    body.transferProofRequired === undefined ? current.transferProofRequired : boolInt(body.transferProofRequired, true),
    body.cashInstructions === undefined ? current.cashInstructions : clean(body.cashInstructions),
    body.paymentDueAt === undefined ? current.paymentDueAt : body.paymentDueAt,
    refundPolicy,
    refundDeadlineAt,
    body.cancellationPolicyText === undefined ? current.cancellationPolicyText : clean(body.cancellationPolicyText),
    allowed.user.id,
    stamp,
    stamp,
  ).run();
  await addEvent(env, { tournamentId, eventType: "settings.updated", actorUserId: allowed.user.id, summary: "Configuración de pagos actualizada" });
  return json({ ok: true });
}

async function adminMarkPaid(orderId: string, request: Request, env: Env, access: AccessHelpers) {
  const order = await orderById(env, orderId);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  const allowed = await requireAdmin(order.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  if (!["draft", "awaiting_payment", "pending_review"].includes(order.status)) return json({ ok: false, code: "PAYMENT_ORDER_ALREADY_SETTLED" }, { status: 409 });
  const body = await readJson<{ method?: "bank_transfer" | "cash"; note?: string; reference?: string }>(request);
  if (!body.method || !["bank_transfer", "cash"].includes(body.method)) return json({ ok: false, code: "INVALID_MANUAL_PAYMENT_METHOD" }, { status: 400 });
  const settings = await paymentSettings(env, order.tournamentId, order.currency);
  if (body.method === "bank_transfer" && !settings.bankTransferEnabled) return json({ ok: false, code: "BANK_TRANSFER_DISABLED" }, { status: 409 });
  if (body.method === "cash" && !settings.cashEnabled) return json({ ok: false, code: "CASH_DISABLED" }, { status: 409 });
  const stamp = now();
  const attemptId = uuid();
  await env.HUAU_DB.prepare(
    `INSERT INTO payment_attempts (id,order_id,method,status,amount_minor,external_reference,note,submitted_by_user_id,reviewed_by_user_id,submitted_at,reviewed_at,created_at,updated_at)
     VALUES (?,?,?,'created',?,?,?,?,?,?,?,?,?)`,
  ).bind(attemptId, order.id, body.method, order.totalAmountMinor, clean(body.reference), clean(body.note), allowed.user.id, allowed.user.id, stamp, stamp, stamp, stamp).run();
  await applyOrderPaid(env, order.id, attemptId, order.totalAmountMinor, allowed.user.id, "manual_approved");
  return json({ ok: true });
}

async function adminReviewAttempt(attemptId: string, request: Request, env: Env, access: AccessHelpers) {
  const attempt = await env.HUAU_DB.prepare(
    `SELECT pa.id,pa.order_id as orderId,pa.method,pa.status,pa.amount_minor as amountMinor,po.tournament_id as tournamentId FROM payment_attempts pa JOIN payment_orders po ON po.id=pa.order_id WHERE pa.id=?`,
  ).bind(attemptId).first<{ id: string; orderId: string; method: PaymentMethod; status: string; amountMinor: number; tournamentId: string }>();
  if (!attempt) return json({ ok: false, code: "PAYMENT_ATTEMPT_NOT_FOUND" }, { status: 404 });
  const allowed = await requireAdmin(attempt.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  if (!["bank_transfer", "cash"].includes(attempt.method)) return json({ ok: false, code: "AUTOMATIC_PAYMENT_REVIEW_FORBIDDEN" }, { status: 409 });
  const body = await readJson<{ decision?: "approve" | "reject"; note?: string }>(request);
  if (body.decision === "approve") {
    await applyOrderPaid(env, attempt.orderId, attempt.id, attempt.amountMinor, allowed.user.id, "manual_approved");
    return json({ ok: true });
  }
  if (body.decision === "reject") {
    await rejectAttempt(env, attempt.id, allowed.user.id, clean(body.note));
    return json({ ok: true });
  }
  return json({ ok: false, code: "INVALID_DECISION" }, { status: 400 });
}

async function reverseManualAttempt(attemptId: string, request: Request, env: Env, access: AccessHelpers) {
  const attempt = await env.HUAU_DB.prepare(
    `SELECT pa.id,pa.order_id as orderId,pa.method,pa.status,pa.amount_minor as amountMinor,po.tournament_id as tournamentId,po.amount_refunded_minor as amountRefundedMinor
       FROM payment_attempts pa JOIN payment_orders po ON po.id=pa.order_id WHERE pa.id=?`,
  ).bind(attemptId).first<{ id: string; orderId: string; method: PaymentMethod; status: string; amountMinor: number; tournamentId: string; amountRefundedMinor: number }>();
  if (!attempt) return json({ ok: false, code: "PAYMENT_ATTEMPT_NOT_FOUND" }, { status: 404 });
  const allowed = await requireAdmin(attempt.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  if (!["bank_transfer", "cash"].includes(attempt.method) || attempt.status !== "approved") return json({ ok: false, code: "PAYMENT_ATTEMPT_NOT_REVERSIBLE" }, { status: 409 });
  if (attempt.amountRefundedMinor > 0) return json({ ok: false, code: "REFUND_EXISTS" }, { status: 409 });
  const order = await orderById(env, attempt.orderId);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  const body = await readJson<{ note?: string }>(request).catch(() => ({} as { note?: string }));
  const items = await env.HUAU_DB.prepare(`SELECT registration_id as registrationId,player_profile_id as playerProfileId,amount_minor as amountMinor FROM payment_order_items WHERE order_id=?`).bind(order.id).all<{ registrationId: string | null; playerProfileId: string | null; amountMinor: number }>();
  const stamp = now();
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`UPDATE payment_attempts SET status='cancelled',note=COALESCE(?,note),reviewed_by_user_id=?,reviewed_at=?,updated_at=? WHERE id=?`).bind(clean(body.note), allowed.user.id, stamp, stamp, attempt.id),
    env.HUAU_DB.prepare(`UPDATE payment_orders SET status='awaiting_payment',amount_paid_minor=MAX(0,amount_paid_minor-?),paid_at=NULL,selected_method=NULL,updated_at=?,version=version+1 WHERE id=?`).bind(order.totalAmountMinor, stamp, order.id),
  ];
  for (const item of items.results) if (item.registrationId) statements.push(
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET paid_amount_minor=MAX(0,paid_amount_minor-?),updated_at=?,version=version+1 WHERE id=?`).bind(item.amountMinor, stamp, item.registrationId),
  );
  await env.HUAU_DB.batch(statements);
  for (const item of items.results) if (item.registrationId) await registrationFinancialRecalc(env, item.registrationId);
  for (const profileId of [...new Set(items.results.map((item) => item.playerProfileId).filter((v): v is string => Boolean(v)))]) await refreshManualProfilePaymentStatus(env, profileId);
  await addEvent(env, { tournamentId: order.tournamentId, orderId: order.id, attemptId: attempt.id, eventType: "payment.reversed", actorUserId: allowed.user.id, summary: "Cobro manual revertido", metadata: { note: clean(body.note) } });
  return json({ ok: true });
}

async function adminProofUpload(orderId: string, request: Request, env: Env, access: AccessHelpers) {
  const order = await orderById(env, orderId);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  const allowed = await requireAdmin(order.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  return saveTransferProof(order, allowed.user, request, env, true);
}

async function proofFile(proofId: string, request: Request, env: Env, access: AccessHelpers) {
  const user = await access.requireUser(request, env);
  if (!user) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  const proof = await env.HUAU_DB.prepare(
    `SELECT pp.object_key as objectKey,pp.original_name as originalName,pp.content_type as contentType,po.payer_user_id as payerUserId,
            po.tournament_id as tournamentId,t.organizer_organization_id as organizerOrganizationId
       FROM payment_proofs pp JOIN payment_attempts pa ON pa.id=pp.attempt_id JOIN payment_orders po ON po.id=pa.order_id JOIN tournaments t ON t.id=po.tournament_id WHERE pp.id=?`,
  ).bind(proofId).first<{ objectKey: string; originalName: string; contentType: string; payerUserId: string | null; tournamentId: string; organizerOrganizationId: string }>();
  if (!proof) return json({ ok: false, code: "PAYMENT_PROOF_NOT_FOUND" }, { status: 404 });
  const owns = proof.payerUserId === user.id;
  const admin = owns ? false : await access.isOrgAdmin(user.id, proof.organizerOrganizationId, env, request);
  if (!owns && !admin) return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  const object = await env.HUAU_ASSETS.get(proof.objectKey);
  if (!object) return json({ ok: false, code: "PAYMENT_PROOF_MISSING" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": proof.contentType,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(proof.originalName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function sha256Base64Url(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return bytesToB64(digest);
}
function randomVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return bytesToB64(bytes);
}
function mpRedirectUri(env: Env) {
  return env.MERCADO_PAGO_REDIRECT_URI || `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/payments/mercado-pago/oauth/callback`;
}

async function connectMercadoPago(tournamentId: string, request: Request, env: Env, access: AccessHelpers) {
  const allowed = await requireAdmin(tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  if (!env.MERCADO_PAGO_CLIENT_ID || !env.MERCADO_PAGO_CLIENT_SECRET || !env.PAYMENT_ENCRYPTION_KEY) return json({ ok: false, code: "MERCADO_PAGO_NOT_CONFIGURED" }, { status: 503 });
  const verifier = randomVerifier();
  const challenge = await sha256Base64Url(verifier);
  const state = uuid();
  const stamp = now();
  await env.HUAU_DB.prepare(
    `INSERT INTO payment_oauth_states (id,state,organization_id,tournament_id,initiated_by_user_id,code_verifier,expires_at,consumed_at,created_at) VALUES (?,?,?,?,?,?,?,NULL,?)`,
  ).bind(uuid(), state, allowed.tournament.organizerOrganizationId, tournamentId, allowed.user.id, verifier, stamp + 600, stamp).run();
  const auth = new URL("https://auth.mercadopago.com/authorization");
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("client_id", env.MERCADO_PAGO_CLIENT_ID);
  auth.searchParams.set("redirect_uri", mpRedirectUri(env));
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");
  return json({ ok: true, authorizationUrl: auth.toString() });
}

async function oauthCallback(request: Request, env: Env, access: AccessHelpers) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return json({ ok: false, code: "OAUTH_CALLBACK_INVALID" }, { status: 400 });
  const currentUser = await access.requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED", message: "Iniciá sesión en HUAU y repetí la conexión." }, { status: 401 });
  const oauth = await env.HUAU_DB.prepare(
    `SELECT id,organization_id as organizationId,tournament_id as tournamentId,initiated_by_user_id as initiatedByUserId,code_verifier as codeVerifier,expires_at as expiresAt,consumed_at as consumedAt FROM payment_oauth_states WHERE state=?`,
  ).bind(state).first<{ id: string; organizationId: string; tournamentId: string; initiatedByUserId: string; codeVerifier: string; expiresAt: number; consumedAt: number | null }>();
  if (!oauth || oauth.consumedAt || oauth.expiresAt < now() || oauth.initiatedByUserId !== currentUser.id) return json({ ok: false, code: "OAUTH_STATE_INVALID" }, { status: 400 });
  if (!(await access.isOrgAdmin(currentUser.id, oauth.organizationId, env, request))) return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  if (!env.MERCADO_PAGO_CLIENT_ID || !env.MERCADO_PAGO_CLIENT_SECRET || !env.PAYMENT_ENCRYPTION_KEY) return json({ ok: false, code: "MERCADO_PAGO_NOT_CONFIGURED" }, { status: 503 });
  const response = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.MERCADO_PAGO_CLIENT_ID,
      client_secret: env.MERCADO_PAGO_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: mpRedirectUri(env),
      code_verifier: oauth.codeVerifier,
    }),
  });
  const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; public_key?: string; user_id?: string | number; live_mode?: boolean; message?: string };
  if (!response.ok || !token.access_token || !token.user_id) return json({ ok: false, code: "MERCADO_PAGO_OAUTH_FAILED", message: token.message || "OAuth error" }, { status: 502 });
  const stamp = now();
  const accountId = uuid();
  const external = String(token.user_id);
  const existing = await env.HUAU_DB.prepare(`SELECT id FROM payment_accounts WHERE provider='mercado_pago' AND external_account_id=?`).bind(external).first<{ id: string }>();
  const id = existing?.id ?? accountId;
  const accessEncrypted = await encryptSecret(env, token.access_token);
  const refreshEncrypted = token.refresh_token ? await encryptSecret(env, token.refresh_token) : null;
  await env.HUAU_DB.batch([
    existing
      ? env.HUAU_DB.prepare(`UPDATE payment_accounts SET organization_id=?,label=?,status='active',public_key=?,access_token_encrypted=?,refresh_token_encrypted=COALESCE(?,refresh_token_encrypted),token_expires_at=?,live_mode=?,updated_at=? WHERE id=?`)
          .bind(oauth.organizationId, `Mercado Pago ${external}`, token.public_key ?? null, accessEncrypted, refreshEncrypted, token.expires_in ? stamp + token.expires_in : null, token.live_mode ? 1 : 0, stamp, id)
      : env.HUAU_DB.prepare(`INSERT INTO payment_accounts (id,organization_id,provider,label,status,external_account_id,public_key,access_token_encrypted,refresh_token_encrypted,token_expires_at,live_mode,created_by_user_id,created_at,updated_at) VALUES (?,?,'mercado_pago',?,'active',?,?,?,?,?,?,?,?,?)`)
          .bind(id, oauth.organizationId, `Mercado Pago ${external}`, external, token.public_key ?? null, accessEncrypted, refreshEncrypted, token.expires_in ? stamp + token.expires_in : null, token.live_mode ? 1 : 0, currentUser.id, stamp, stamp),
    env.HUAU_DB.prepare(`UPDATE payment_oauth_states SET consumed_at=? WHERE id=?`).bind(stamp, oauth.id),
    env.HUAU_DB.prepare(
      `INSERT INTO tournament_payment_settings (tournament_id,bank_transfer_enabled,cash_enabled,mercado_pago_enabled,mercado_pago_account_id,bank_currency,transfer_proof_required,refund_policy,updated_by_user_id,created_at,updated_at)
       VALUES (?,1,0,1,?,'UYU',1,'manual',?,?,?)
       ON CONFLICT(tournament_id) DO UPDATE SET mercado_pago_enabled=1,mercado_pago_account_id=excluded.mercado_pago_account_id,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`,
    ).bind(oauth.tournamentId, id, currentUser.id, stamp, stamp),
  ]);
  await addEvent(env, { tournamentId: oauth.tournamentId, eventType: "mercado_pago.connected", actorUserId: currentUser.id, summary: "Cuenta de Mercado Pago conectada", metadata: { externalAccountId: external, liveMode: Boolean(token.live_mode) } });
  const target = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/admin/organizations/${encodeURIComponent(oauth.organizationId)}/tournaments/${encodeURIComponent(oauth.tournamentId)}?mp=connected`;
  return Response.redirect(target, 302);
}

function parseSignature(header: string | null) {
  if (!header) return null;
  const parts = Object.fromEntries(header.split(",").map((part) => part.trim().split("=", 2)));
  return parts.ts && parts.v1 ? { ts: parts.ts, v1: parts.v1.toLowerCase() } : null;
}
async function hmacHex(secret: string, manifest: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeHexEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function mercadoPagoWebhook(request: Request, env: Env) {
  if (!env.MERCADO_PAGO_WEBHOOK_SECRET) return json({ ok: false, code: "MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
  const url = new URL(request.url);
  const body = await request.json().catch(() => null) as { id?: string | number; type?: string; action?: string; user_id?: string | number; data?: { id?: string } } | null;
  const dataId = url.searchParams.get("data.id") || body?.data?.id || "";
  const requestId = request.headers.get("x-request-id") || "";
  const sig = parseSignature(request.headers.get("x-signature"));
  if (!dataId || !requestId || !sig) return json({ ok: false, code: "WEBHOOK_SIGNATURE_MISSING" }, { status: 401 });
  const manifest = `id:${dataId};request-id:${requestId};ts:${sig.ts};`;
  const expected = await hmacHex(env.MERCADO_PAGO_WEBHOOK_SECRET, manifest);
  if (!constantTimeHexEqual(expected, sig.v1)) return json({ ok: false, code: "WEBHOOK_SIGNATURE_INVALID" }, { status: 401 });
  if (body?.type && body.type !== "order") return json({ ok: true, ignored: true });
  const providerEventId = body?.id ? `mp-order:${String(body.id)}` : `mp-order:${requestId}:${dataId}`;
  const duplicate = await env.HUAU_DB.prepare(`SELECT id FROM payment_events WHERE provider_event_id=?`).bind(providerEventId).first<{ id: string }>();
  if (duplicate) return json({ ok: true, duplicate: true });
  const attempt = await env.HUAU_DB.prepare(
    `SELECT pa.id,pa.order_id as orderId,po.tournament_id as tournamentId FROM payment_attempts pa JOIN payment_orders po ON po.id=pa.order_id WHERE pa.method='mercado_pago' AND pa.external_id=? ORDER BY pa.created_at DESC LIMIT 1`,
  ).bind(dataId).first<{ id: string; orderId: string; tournamentId: string }>();
  if (!attempt) {
    // Acknowledge valid signed events that do not belong to a known HUAU order.
    return json({ ok: true, ignored: true });
  }
  const account = await env.HUAU_DB.prepare(
    `SELECT pa.id,pa.organization_id as organizationId,pa.label,pa.status,pa.external_account_id as externalAccountId,pa.public_key as publicKey,
            pa.access_token_encrypted as accessTokenEncrypted,pa.refresh_token_encrypted as refreshTokenEncrypted,pa.token_expires_at as tokenExpiresAt,pa.live_mode as liveMode
       FROM tournament_payment_settings tps JOIN payment_accounts pa ON pa.id=tps.mercado_pago_account_id
      WHERE tps.tournament_id=? AND pa.provider='mercado_pago' LIMIT 1`,
  ).bind(attempt.tournamentId).first<PaymentAccountRow>();
  if (!account) return json({ ok: true, ignored: true });
  if (body?.user_id && account.externalAccountId && String(body.user_id) !== account.externalAccountId) {
    return json({ ok: false, code: "MERCADO_PAGO_ACCOUNT_MISMATCH" }, { status: 409 });
  }
  const token = await mpAccessToken(env, account);
  const mpResponse = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  const mp = await mpResponse.json() as MpOrderResponse;
  if (!mpResponse.ok) return json({ ok: false, code: "MERCADO_PAGO_LOOKUP_FAILED" }, { status: 502 });
  const order = await orderById(env, attempt.orderId);
  if (!order || mp.external_reference !== order.id) return json({ ok: false, code: "MERCADO_PAGO_REFERENCE_MISMATCH" }, { status: 409 });
  const totalMinor = Math.round(Number(mp.total_amount ?? "0") * 100);
  const paidMinor = Math.round(Number(mp.total_paid_amount ?? "0") * 100);
  if (totalMinor !== order.totalAmountMinor) return json({ ok: false, code: "MERCADO_PAGO_AMOUNT_MISMATCH" }, { status: 409 });
  const status = (mp.status || "").toLowerCase();
  const detail = (mp.status_detail || "").toLowerCase();
  const approved = paidMinor >= order.totalAmountMinor && order.totalAmountMinor > 0 && (status === "processed" || detail === "accredited");
  const failed = ["cancelled", "canceled", "failed", "expired", "rejected"].includes(status) || ["canceled", "rejected"].includes(detail);
  if (approved) await applyOrderPaid(env, order.id, attempt.id, paidMinor, null, `${status}:${detail}`);
  else if (failed) await rejectAttempt(env, attempt.id, null, `Mercado Pago: ${status}/${detail}`);
  else await env.HUAU_DB.prepare(`UPDATE payment_attempts SET external_status=?,updated_at=? WHERE id=?`).bind(`${status}:${detail}`, now(), attempt.id).run();
  await addEvent(env, { tournamentId: attempt.tournamentId, orderId: order.id, attemptId: attempt.id, eventType: "mercado_pago.webhook", summary: `Webhook Mercado Pago ${status}/${detail}`, metadata: { mpOrderId: dataId, action: body?.action }, providerEventId });
  return json({ ok: true });
}

async function findOrderCoveringRegistration(env: Env, registrationId: string) {
  return env.HUAU_DB.prepare(
    `SELECT po.id,po.selected_method as selectedMethod,po.status,po.total_amount_minor as totalAmountMinor
       FROM payment_order_items poi JOIN payment_orders po ON po.id=poi.order_id
      WHERE poi.registration_id=? AND po.status IN ('paid','partially_refunded','refunded') ORDER BY po.paid_at DESC LIMIT 1`,
  ).bind(registrationId).first<{ id: string; selectedMethod: PaymentMethod | null; status: string; totalAmountMinor: number }>();
}

async function reviewCancellation(requestId: string, request: Request, env: Env, access: AccessHelpers) {
  const row = await env.HUAU_DB.prepare(
    `SELECT cr.id,cr.registration_id as registrationId,cr.tournament_id as tournamentId,cr.status,cr.net_paid_minor as netPaidMinor FROM registration_cancellation_requests cr WHERE cr.id=?`,
  ).bind(requestId).first<{ id: string; registrationId: string; tournamentId: string; status: string; netPaidMinor: number }>();
  if (!row) return json({ ok: false, code: "CANCELLATION_REQUEST_NOT_FOUND" }, { status: 404 });
  const allowed = await requireAdmin(row.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  if (row.status !== "pending") return json({ ok: false, code: "CANCELLATION_ALREADY_REVIEWED" }, { status: 409 });
  const body = await readJson<{ decision?: "approve" | "reject"; refundAmountMinor?: number; refundMethod?: "mercado_pago" | "bank_transfer" | "cash" | "other"; note?: string }>(request);
  const stamp = now();
  if (body.decision === "reject") {
    await env.HUAU_DB.prepare(`UPDATE registration_cancellation_requests SET status='rejected',admin_note=?,reviewed_by_user_id=?,reviewed_at=?,updated_at=? WHERE id=?`).bind(clean(body.note), allowed.user.id, stamp, stamp, row.id).run();
    await addEvent(env, { tournamentId: row.tournamentId, eventType: "cancellation.rejected", actorUserId: allowed.user.id, summary: "Solicitud de cancelación rechazada", metadata: { registrationId: row.registrationId } });
    return json({ ok: true });
  }
  if (body.decision !== "approve") return json({ ok: false, code: "INVALID_DECISION" }, { status: 400 });
  const settings = await paymentSettings(env, row.tournamentId);
  const requestedRefund = clampRefundMinor({ requestedMinor: Number(body.refundAmountMinor ?? 0), paidAmountMinor: row.netPaidMinor, refundedAmountMinor: 0 });
  let refundAmount = requestedRefund;
  if (settings.refundPolicy === "none") {
    if (requestedRefund > 0) return json({ ok: false, code: "REFUND_POLICY_LIMIT", message: "La política del torneo no contempla devolución." }, { status: 409 });
    refundAmount = 0;
  } else if (settings.refundPolicy === "full_before_deadline") {
    const allowedRefund = settings.refundDeadlineAt && stamp <= settings.refundDeadlineAt ? row.netPaidMinor : 0;
    if (requestedRefund !== allowedRefund) return json({ ok: false, code: "REFUND_POLICY_LIMIT", message: allowedRefund > 0 ? "La política exige devolución total antes del plazo." : "El plazo de devolución ya venció." , allowedRefundMinor: allowedRefund }, { status: 409 });
    refundAmount = allowedRefund;
  }
  const refundMethod = body.refundMethod ?? null;
  if (refundAmount > 0 && refundMethod && !["mercado_pago", "bank_transfer", "cash", "other"].includes(refundMethod)) return json({ ok: false, code: "REFUND_METHOD_INVALID" }, { status: 400 });
  const order = await findOrderCoveringRegistration(env, row.registrationId);
  if (refundAmount > 0 && !order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 409 });
  await cancelRegistrationForPaymentAdmin(env, row.registrationId);
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`UPDATE registration_cancellation_requests SET status='approved',refund_amount_minor=?,admin_note=?,reviewed_by_user_id=?,reviewed_at=?,updated_at=? WHERE id=?`)
      .bind(refundAmount, clean(body.note), allowed.user.id, stamp, stamp, row.id),
  ];
  let refundId: string | null = null;
  if (refundAmount > 0 && order) {
    refundId = uuid();
    statements.push(env.HUAU_DB.prepare(
      `INSERT INTO payment_refunds (id,order_id,registration_id,amount_minor,method,status,external_id,note,created_by_user_id,completed_by_user_id,created_at,completed_at,updated_at)
       VALUES (?,?,?,?,?,'pending',NULL,?,?,NULL,?,NULL,?)`,
    ).bind(refundId, order.id, row.registrationId, refundAmount, refundMethod ?? order.selectedMethod ?? "other", clean(body.note), allowed.user.id, stamp, stamp));
  }
  await env.HUAU_DB.batch(statements);
  await addEvent(env, { tournamentId: row.tournamentId, orderId: order?.id ?? null, eventType: "cancellation.approved", actorUserId: allowed.user.id, summary: refundAmount > 0 ? "Cancelación aprobada con devolución pendiente" : "Cancelación aprobada sin devolución", metadata: { registrationId: row.registrationId, refundAmountMinor: refundAmount, refundId } });
  return json({ ok: true, refundId });
}


async function createManualRefund(orderId: string, request: Request, env: Env, access: AccessHelpers) {
  const order = await orderById(env, orderId);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  const allowed = await requireAdmin(order.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  const remaining = Math.max(0, order.amountPaidMinor - order.amountRefundedMinor);
  if (remaining <= 0 || !["paid", "partially_refunded"].includes(order.status)) return json({ ok: false, code: "PAYMENT_NOT_REFUNDABLE" }, { status: 409 });
  const body = await readJson<{ amountMinor?: number; method?: "mercado_pago" | "bank_transfer" | "cash" | "other"; note?: string }>(request);
  const amount = Math.min(remaining, Math.max(0, Math.trunc(Number(body.amountMinor ?? remaining))));
  if (amount <= 0) return json({ ok: false, code: "REFUND_AMOUNT_INVALID" }, { status: 400 });
  const method = body.method ?? order.selectedMethod ?? "other";
  if (!["mercado_pago", "bank_transfer", "cash", "other"].includes(method)) return json({ ok: false, code: "REFUND_METHOD_INVALID" }, { status: 400 });
  const refundId = uuid();
  const stamp = now();
  await env.HUAU_DB.prepare(
    `INSERT INTO payment_refunds (id,order_id,registration_id,amount_minor,method,status,external_id,note,created_by_user_id,completed_by_user_id,created_at,completed_at,updated_at)
     VALUES (?,?,NULL,?,?,'pending',NULL,?,?,NULL,?,NULL,?)`,
  ).bind(refundId, order.id, amount, method, clean(body.note), allowed.user.id, stamp, stamp).run();
  await addEvent(env, { tournamentId: order.tournamentId, orderId: order.id, eventType: "refund.created", actorUserId: allowed.user.id, summary: `Devolución pendiente: ${moneyString(amount)} ${order.currency}`, metadata: { refundId, method } });
  return json({ ok: true, refundId });
}

async function completeRefund(refundId: string, request: Request, env: Env, access: AccessHelpers) {
  const refund = await env.HUAU_DB.prepare(
    `SELECT pr.id,pr.order_id as orderId,pr.registration_id as registrationId,pr.amount_minor as amountMinor,pr.status,po.tournament_id as tournamentId FROM payment_refunds pr JOIN payment_orders po ON po.id=pr.order_id WHERE pr.id=?`,
  ).bind(refundId).first<{ id: string; orderId: string; registrationId: string | null; amountMinor: number; status: string; tournamentId: string }>();
  if (!refund) return json({ ok: false, code: "REFUND_NOT_FOUND" }, { status: 404 });
  const allowed = await requireAdmin(refund.tournamentId, request, env, access);
  if ("response" in allowed) return allowed.response;
  if (refund.status !== "pending") return json({ ok: false, code: "REFUND_ALREADY_REVIEWED" }, { status: 409 });
  const body = await readJson<{ externalId?: string; note?: string }>(request).catch(() => ({} as { externalId?: string; note?: string }));
  const order = await orderById(env, refund.orderId);
  if (!order) return json({ ok: false, code: "PAYMENT_ORDER_NOT_FOUND" }, { status: 404 });
  const newRefunded = Math.min(order.amountPaidMinor, order.amountRefundedMinor + refund.amountMinor);
  const nextStatus = paymentOrderStatus({ totalAmountMinor: order.totalAmountMinor, amountPaidMinor: order.amountPaidMinor, amountRefundedMinor: newRefunded });
  const stamp = now();
  const statements: D1PreparedStatement[] = [
    env.HUAU_DB.prepare(`UPDATE payment_refunds SET status='completed',external_id=?,note=COALESCE(?,note),completed_by_user_id=?,completed_at=?,updated_at=? WHERE id=?`).bind(clean(body.externalId), clean(body.note), allowed.user.id, stamp, stamp, refund.id),
    env.HUAU_DB.prepare(`UPDATE payment_orders SET amount_refunded_minor=?,status=?,updated_at=?,version=version+1 WHERE id=?`).bind(newRefunded, nextStatus, stamp, order.id),
  ];
  if (refund.registrationId) statements.push(
    env.HUAU_DB.prepare(`UPDATE tournament_registrations SET refunded_amount_minor=refunded_amount_minor+?,updated_at=?,version=version+1 WHERE id=?`).bind(refund.amountMinor, stamp, refund.registrationId),
  );
  await env.HUAU_DB.batch(statements);
  await addEvent(env, { tournamentId: refund.tournamentId, orderId: order.id, eventType: "refund.completed", actorUserId: allowed.user.id, summary: `Devolución registrada: ${moneyString(refund.amountMinor)} ${order.currency}`, metadata: { refundId: refund.id, externalId: clean(body.externalId) } });
  return json({ ok: true });
}

export async function handlePaymentApi(request: Request, env: Env, access: AccessHelpers): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/api/payments/mercado-pago/oauth/callback" && request.method === "GET") return oauthCallback(request, env, access);
  if (url.pathname === "/api/payments/mercado-pago/webhook" && request.method === "POST") return mercadoPagoWebhook(request, env);

  if (url.pathname === "/api/me/payment-orders/sync" && request.method === "POST") return syncMyOrders(request, env, access);
  if (url.pathname === "/api/me/payment-orders" && request.method === "GET") return myOrders(request, env, access);

  const select = url.pathname.match(/^\/api\/payment-orders\/([^/]+)\/method$/);
  if (select && request.method === "POST") return selectMethod(decodeURIComponent(select[1]!), request, env, access);
  const proof = url.pathname.match(/^\/api\/payment-orders\/([^/]+)\/transfer-proof$/);
  if (proof && request.method === "POST") return transferProof(decodeURIComponent(proof[1]!), request, env, access);
  const checkout = url.pathname.match(/^\/api\/payment-orders\/([^/]+)\/mercado-pago\/checkout$/);
  if (checkout && request.method === "POST") return mercadoPagoCheckout(decodeURIComponent(checkout[1]!), request, env, access);
  const cancelCheckout = url.pathname.match(/^\/api\/payment-orders\/([^/]+)\/mercado-pago\/cancel$/);
  if (cancelCheckout && request.method === "POST") return cancelMercadoPagoCheckout(decodeURIComponent(cancelCheckout[1]!), request, env, access);
  const proofRead = url.pathname.match(/^\/api\/payment-proofs\/([^/]+)$/);
  if (proofRead && request.method === "GET") return proofFile(decodeURIComponent(proofRead[1]!), request, env, access);

  const admin = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/payments$/);
  if (admin && request.method === "GET") return adminPayments(decodeURIComponent(admin[1]!), request, env, access);
  if (admin && request.method === "PUT") return updatePaymentSettings(decodeURIComponent(admin[1]!), request, env, access);
  const sync = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/payments\/sync$/);
  if (sync && request.method === "POST") return adminSync(decodeURIComponent(sync[1]!), request, env, access);
  const connect = url.pathname.match(/^\/api\/admin\/tournaments\/([^/]+)\/payments\/mercado-pago\/connect$/);
  if (connect && request.method === "POST") return connectMercadoPago(decodeURIComponent(connect[1]!), request, env, access);
  const markPaid = url.pathname.match(/^\/api\/admin\/payment-orders\/([^/]+)\/mark-paid$/);
  if (markPaid && request.method === "POST") return adminMarkPaid(decodeURIComponent(markPaid[1]!), request, env, access);
  const adminProof = url.pathname.match(/^\/api\/admin\/payment-orders\/([^/]+)\/transfer-proof$/);
  if (adminProof && request.method === "POST") return adminProofUpload(decodeURIComponent(adminProof[1]!), request, env, access);
  const review = url.pathname.match(/^\/api\/admin\/payment-attempts\/([^/]+)\/review$/);
  if (review && request.method === "POST") return adminReviewAttempt(decodeURIComponent(review[1]!), request, env, access);
  const reverse = url.pathname.match(/^\/api\/admin\/payment-attempts\/([^/]+)\/reverse$/);
  if (reverse && request.method === "POST") return reverseManualAttempt(decodeURIComponent(reverse[1]!), request, env, access);
  const refundCreate = url.pathname.match(/^\/api\/admin\/payment-orders\/([^/]+)\/refunds$/);
  if (refundCreate && request.method === "POST") return createManualRefund(decodeURIComponent(refundCreate[1]!), request, env, access);
  const cancelReview = url.pathname.match(/^\/api\/admin\/cancellation-requests\/([^/]+)\/review$/);
  if (cancelReview && request.method === "POST") return reviewCancellation(decodeURIComponent(cancelReview[1]!), request, env, access);
  const refund = url.pathname.match(/^\/api\/admin\/payment-refunds\/([^/]+)\/complete$/);
  if (refund && request.method === "POST") return completeRefund(decodeURIComponent(refund[1]!), request, env, access);

  return null;
}
