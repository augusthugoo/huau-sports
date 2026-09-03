import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "./i18n";

type PaymentMethod = "mercado_pago" | "bank_transfer" | "cash";
type PaymentOrderStatus = "draft" | "awaiting_payment" | "pending_review" | "paid" | "cancelled" | "partially_refunded" | "refunded";

type PaymentSettings = {
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

type OrderItem = { id: string; registrationId: string | null; playerProfileId: string | null; categoryId: string | null; label: string; amountMinor: number };
type Attempt = {
  id: string;
  method: PaymentMethod;
  status: string;
  amountMinor: number;
  externalId: string | null;
  externalStatus: string | null;
  externalReference: string | null;
  note: string | null;
  submittedAt: number | null;
  reviewedAt: number | null;
  createdAt: number;
  proofId: string | null;
  proofName: string | null;
  proofContentType: string | null;
  proofSizeBytes: number | null;
};
type Refund = { id: string; registrationId: string | null; amountMinor: number; method: string; status: string; externalId: string | null; note: string | null; createdAt: number; completedAt: number | null };
type PaymentOrder = {
  id: string;
  tournamentId: string;
  payerKind: "user" | "manual_profile";
  payerUserId: string | null;
  payerProfileId: string | null;
  payerName: string;
  payerEmail: string | null;
  currency: string;
  totalAmountMinor: number;
  amountPaidMinor: number;
  amountRefundedMinor: number;
  status: PaymentOrderStatus;
  selectedMethod: PaymentMethod | null;
  dueAt: number | null;
  paidAt: number | null;
  tournamentName: string;
  slug: string;
  items: OrderItem[];
  attempts: Attempt[];
  refunds: Refund[];
  settings: PaymentSettings;
};
type MpAccount = { id: string; label: string; status: string; externalAccountId: string | null; publicKey: string | null; liveMode: number; updatedAt: number };
type Cancellation = {
  id: string;
  registrationId: string;
  status: string;
  reason: string | null;
  netPaidMinor: number;
  refundAmountMinor: number;
  adminNote: string | null;
  createdAt: number;
  reviewedAt: number | null;
  playerName: string;
  email: string;
  categoryName: string;
  finalAmountMinor: number;
  currency: string | null;
};
type AdminRefund = Refund & { orderId: string; payerName: string };
type AdminPayload = {
  ok: true;
  settings: PaymentSettings;
  accounts: MpAccount[];
  orders: PaymentOrder[];
  cancellations: Cancellation[];
  refunds: AdminRefund[];
  summary: { expectedMinor: number; paidMinor: number; refundedMinor: number; reviewMinor: number; pendingMinor: number };
  mercadoPagoConfigured: boolean;
};

const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
const money = (minor: number, currency = "UYU") => new Intl.NumberFormat("es-UY", { style: "currency", currency, maximumFractionDigits: 2 }).format(Math.max(0, minor) / 100);
const toMs = (value: number) => value < 10_000_000_000 ? value * 1000 : value;
const dateTime = (value: number | null) => value ? new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(toMs(value))) : "—";
const localInput = (value: number | null) => {
  if (!value) return "";
  const d = new Date(toMs(value));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const unixInput = (value: FormDataEntryValue | null) => typeof value === "string" && value ? Math.floor(new Date(value).getTime() / 1000) : null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const payload = await response.json() as T & { code?: string; message?: string };
  if (!response.ok) throw new Error(payload.message || payload.code || `HTTP_${response.status}`);
  return payload;
}
async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, { method: "POST", body: form });
  const payload = await response.json() as T & { code?: string; message?: string };
  if (!response.ok) throw new Error(payload.message || payload.code || `HTTP_${response.status}`);
  return payload;
}

function StatusPill({ status, locale }: { status: string; locale: Locale }) {
  const label: Record<string, [string, string]> = {
    draft: ["Borrador", "Draft"], awaiting_payment: ["Pendiente", "Pending"], pending_review: ["En revisión", "Under review"],
    paid: ["Pagado", "Paid"], partially_refunded: ["Devuelto parcial", "Partially refunded"], refunded: ["Devuelto", "Refunded"],
    submitted: ["Comprobante enviado", "Proof submitted"], approved: ["Aprobado", "Approved"], rejected: ["Rechazado", "Rejected"], pending: ["Pendiente", "Pending"],
  };
  return <span className={`payment-status status-${status}`}>{label[status]?.[locale === "es" ? 0 : 1] ?? status.replaceAll("_", " ")}</span>;
}

function OrderBreakdown({ order }: { order: PaymentOrder }) {
  return <div className="payment-breakdown">{order.items.map((item) => <div key={item.id}><span>{item.label}</span><strong>{money(item.amountMinor, order.currency)}</strong></div>)}<div className="payment-total"><span>Total</span><strong>{money(order.totalAmountMinor, order.currency)}</strong></div></div>;
}

export function MyTournamentPayments({ locale }: { locale: Locale }) {
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      await api("/api/me/payment-orders/sync", { method: "POST", body: "{}" });
      const data = await api<{ ok: true; orders: PaymentOrder[] }>("/api/me/payment-orders");
      setOrders(data.orders);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "PAYMENTS_ERROR"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); setNotice(message); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "PAYMENT_ERROR"); }
    finally { setBusy(""); }
  };

  const choose = (order: PaymentOrder, method: PaymentMethod) => act(order.id, async () => {
    await api(`/api/payment-orders/${order.id}/method`, { method: "POST", body: JSON.stringify({ method }) });
  }, tr(locale, "Método de pago actualizado.", "Payment method updated."));

  const checkout = (order: PaymentOrder) => act(order.id, async () => {
    const data = await api<{ ok: true; checkoutUrl: string }>(`/api/payment-orders/${order.id}/mercado-pago/checkout`, { method: "POST", body: "{}" });
    window.location.href = data.checkoutUrl;
  }, "");
  const cancelMp = (order: PaymentOrder) => act(order.id, async () => {
    await api(`/api/payment-orders/${order.id}/mercado-pago/cancel`, { method: "POST", body: "{}" });
  }, tr(locale, "Checkout de Mercado Pago cancelado. Ya podés elegir otro método.", "Mercado Pago checkout cancelled. You can choose another method."));

  const proof = (order: PaymentOrder, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void act(order.id, () => upload(`/api/payment-orders/${order.id}/transfer-proof`, form), tr(locale, "Comprobante enviado. El organizador debe revisarlo.", "Proof sent. The organizer must review it."));
  };

  const active = orders.filter((order) => !["paid", "refunded", "partially_refunded"].includes(order.status));
  const history = orders.filter((order) => ["paid", "refunded", "partially_refunded"].includes(order.status));
  if (!orders.length && !error) return null;

  return <section className="payments-user-section">
    <div className="section-heading"><div><div className="eyebrow">PAYMENTS</div><h1>{tr(locale, "Mis pagos", "My payments")}</h1><p>{tr(locale, "Un pago puede cubrir varias categorías del mismo torneo.", "One payment can cover several categories in the same tournament.")}</p></div></div>
    {error && <div className="error-box">{error}</div>}{notice && <div className="notice-box">{notice}</div>}
    {active.map((order) => <article className="panel payment-order-card" key={order.id}>
      <div className="payment-order-head"><div><div className="eyebrow">{order.tournamentName}</div><h2>{money(order.totalAmountMinor, order.currency)}</h2><p>{order.items.length} {tr(locale, "concepto(s)", "item(s)")}{order.dueAt ? ` · ${tr(locale, "vence", "due")} ${dateTime(order.dueAt)}` : ""}</p></div><StatusPill status={order.status} locale={locale}/></div>
      <details className="payment-order-detail"><summary>{tr(locale, "Ver detalle", "View details")} · {order.items.length} {tr(locale, "categoría(s)", "category(ies)")}</summary><OrderBreakdown order={order}/></details>
      {order.status === "pending_review" ? <div className="payment-callout"><strong>{tr(locale, "Pago en revisión", "Payment under review")}</strong><span>{tr(locale, "No hace falta volver a pagar. El organizador está verificando el comprobante o el cobro.", "Do not pay again. The organizer is reviewing the proof or payment.")}</span>{order.attempts[0]?.proofId && <a className="ghost small" href={`/api/payment-proofs/${order.attempts[0].proofId}`} target="_blank" rel="noreferrer">{tr(locale, "Ver comprobante", "View proof")}</a>}</div> : <>
        <div className="payment-method-grid">
          {order.settings.bankTransferEnabled === 1 && <button className={order.selectedMethod === "bank_transfer" ? "light" : "ghost"} disabled={busy === order.id || order.selectedMethod === "mercado_pago"} onClick={() => void choose(order, "bank_transfer")}>{tr(locale, "Transferencia", "Bank transfer")}</button>}
          {order.settings.cashEnabled === 1 && <button className={order.selectedMethod === "cash" ? "light" : "ghost"} disabled={busy === order.id || order.selectedMethod === "mercado_pago"} onClick={() => void choose(order, "cash")}>{tr(locale, "Efectivo", "Cash")}</button>}
          {order.settings.mercadoPagoEnabled === 1 && <button className="light" disabled={busy === order.id} onClick={() => void checkout(order)}>{tr(locale, order.selectedMethod === "mercado_pago" ? "Continuar con Mercado Pago" : "Pagar con Mercado Pago", order.selectedMethod === "mercado_pago" ? "Continue with Mercado Pago" : "Pay with Mercado Pago")}</button>}
        </div>
        {order.selectedMethod === "mercado_pago" && <div className="payment-callout"><strong>{tr(locale, "Checkout de Mercado Pago activo", "Active Mercado Pago checkout")}</strong><span>{tr(locale, "HUAU reutiliza el mismo checkout para evitar cobros duplicados. Cancelalo antes de cambiar a transferencia o efectivo.", "HUAU reuses the same checkout to avoid duplicate charges. Cancel it before switching to bank transfer or cash.")}</span><button className="ghost small" disabled={busy === order.id} onClick={() => void cancelMp(order)}>{tr(locale, "Cancelar checkout / cambiar método", "Cancel checkout / change method")}</button></div>}
        {order.selectedMethod === "bank_transfer" && <div className="payment-callout">
          <strong>{tr(locale, "Datos para transferir", "Bank transfer details")}</strong>
          <div className="payment-bank-data">{order.settings.bankName && <span><b>{tr(locale, "Banco", "Bank")}:</b> {order.settings.bankName}</span>}{order.settings.bankAccountHolder && <span><b>{tr(locale, "Titular", "Holder")}:</b> {order.settings.bankAccountHolder}</span>}{order.settings.bankAccountNumber && <span><b>{tr(locale, "Cuenta", "Account")}:</b> {order.settings.bankAccountNumber}</span>}{order.settings.bankAccountAlias && <span><b>{tr(locale, "Alias", "Alias")}:</b> {order.settings.bankAccountAlias}</span>}<span><b>{tr(locale, "Importe", "Amount")}:</b> {money(order.totalAmountMinor, order.settings.bankCurrency || order.currency)}</span></div>
          {order.settings.bankInstructions && <p>{order.settings.bankInstructions}</p>}
          <form className="payment-proof-upload" onSubmit={(event) => proof(order, event)}><label><span>{tr(locale, "Comprobante JPG, PNG, WEBP o PDF · Máx. 8 MB", "Proof JPG, PNG, WEBP or PDF · Max. 8 MB")}</span><input name="proof" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf"/></label><label><span>{tr(locale, "Nota opcional", "Optional note")}</span><input name="note" placeholder={tr(locale, "Ej.: transferencia desde cuenta de...", "E.g. transfer from account...")}/></label><button className="light" disabled={busy === order.id}>{tr(locale, "Subir comprobante", "Upload proof")}</button></form>
        </div>}
        {order.selectedMethod === "cash" && <div className="payment-callout"><strong>{tr(locale, "Pago en efectivo", "Cash payment")}</strong><span>{order.settings.cashInstructions || tr(locale, "Entregá el importe al organizador. El pago quedará confirmado cuando administración lo registre.", "Pay the organizer. It will be confirmed when administration records it.")}</span></div>}
      </>}
    </article>)}
    {history.length > 0 && <details className="panel payment-history"><summary>{tr(locale, "Pagos e historial", "Payments & history")} · {history.length}</summary>{history.map((order) => <div className="payment-history-row" key={order.id}><div><strong>{order.tournamentName}</strong><span>{order.items.map((item) => item.label).join(" · ")}</span></div><div><StatusPill status={order.status} locale={locale}/><strong>{money(Math.max(0, order.amountPaidMinor - order.amountRefundedMinor), order.currency)}</strong></div></div>)}</details>}
  </section>;
}

export function TournamentPaymentsAdmin({ tournamentId, locale }: { tournamentId: string; locale: Locale }) {
  const [data, setData] = useState<AdminPayload | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (sync = false) => {
    try {
      if (sync) await api(`/api/admin/tournaments/${tournamentId}/payments/sync`, { method: "POST", body: "{}" });
      setData(await api<AdminPayload>(`/api/admin/tournaments/${tournamentId}/payments`)); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "PAYMENTS_ERROR"); }
  }, [tournamentId]);
  useEffect(() => { void load(true); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, message = "") => {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); if (message) setNotice(message); await load(true); }
    catch (e) { setError(e instanceof Error ? e.message : "PAYMENT_ERROR"); }
    finally { setBusy(""); }
  };

  const saveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!data) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      bankTransferEnabled: form.get("bankTransferEnabled") === "on", cashEnabled: form.get("cashEnabled") === "on", mercadoPagoEnabled: form.get("mercadoPagoEnabled") === "on",
      mercadoPagoAccountId: String(form.get("mercadoPagoAccountId") || "") || null, bankName: String(form.get("bankName") || ""), bankAccountHolder: String(form.get("bankAccountHolder") || ""), bankAccountNumber: String(form.get("bankAccountNumber") || ""), bankAccountAlias: String(form.get("bankAccountAlias") || ""), bankCurrency: String(form.get("bankCurrency") || "UYU"), bankInstructions: String(form.get("bankInstructions") || ""), transferProofRequired: form.get("transferProofRequired") === "on", cashInstructions: String(form.get("cashInstructions") || ""), paymentDueAt: unixInput(form.get("paymentDueAt")), refundPolicy: String(form.get("refundPolicy") || "manual"), refundDeadlineAt: unixInput(form.get("refundDeadlineAt")), cancellationPolicyText: String(form.get("cancellationPolicyText") || ""),
    };
    void act("settings", () => api(`/api/admin/tournaments/${tournamentId}/payments`, { method: "PUT", body: JSON.stringify(payload) }), tr(locale, "Configuración guardada.", "Settings saved."));
  };

  const markPaid = (order: PaymentOrder, method: "bank_transfer" | "cash") => {
    const reference = window.prompt(tr(locale, "Referencia (opcional)", "Reference (optional)")) ?? undefined;
    if (reference === undefined) return;
    const note = window.prompt(tr(locale, "Nota (opcional)", "Note (optional)")) ?? undefined;
    if (note === undefined) return;
    void act(order.id, () => api(`/api/admin/payment-orders/${order.id}/mark-paid`, { method: "POST", body: JSON.stringify({ method, reference, note }) }), tr(locale, "Pago registrado.", "Payment recorded."));
  };
  const reviewAttempt = (attempt: Attempt, decision: "approve" | "reject") => {
    const note = decision === "reject" ? window.prompt(tr(locale, "Motivo del rechazo", "Rejection reason")) : "";
    if (decision === "reject" && note === null) return;
    void act(attempt.id, () => api(`/api/admin/payment-attempts/${attempt.id}/review`, { method: "POST", body: JSON.stringify({ decision, note }) }), tr(locale, "Revisión guardada.", "Review saved."));
  };
  const reverse = (attempt: Attempt) => {
    const note = window.prompt(tr(locale, "Motivo para revertir el cobro", "Reason to reverse the payment"));
    if (note === null) return;
    void act(attempt.id, () => api(`/api/admin/payment-attempts/${attempt.id}/reverse`, { method: "POST", body: JSON.stringify({ note }) }), tr(locale, "Cobro revertido.", "Payment reversed."));
  };
  const adminProof = (order: PaymentOrder, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void act(order.id, () => upload(`/api/admin/payment-orders/${order.id}/transfer-proof`, form), tr(locale, "Comprobante cargado.", "Proof uploaded."));
  };
  const connectMp = () => void act("mp-connect", async () => {
    const result = await api<{ ok: true; authorizationUrl: string }>(`/api/admin/tournaments/${tournamentId}/payments/mercado-pago/connect`, { method: "POST", body: "{}" });
    window.location.href = result.authorizationUrl;
  });

  const reviewCancellation = (item: Cancellation, decision: "approve" | "reject") => {
    let refundAmountMinor = 0; let refundMethod: string | undefined; let note: string | null = "";
    if (decision === "approve" && item.netPaidMinor > 0) {
      const policy = data?.settings.refundPolicy ?? "manual";
      if (policy === "manual") {
        const value = window.prompt(tr(locale, `Monto a devolver en ${item.currency || "UYU"} (0 si no corresponde)`, `Refund amount in ${item.currency || "UYU"} (0 if none)`), (item.netPaidMinor / 100).toFixed(2));
        if (value === null) return; refundAmountMinor = Math.max(0, Math.round(Number(value.replace(",", ".")) * 100));
      } else if (policy === "full_before_deadline") {
        const beforeDeadline = Boolean(data?.settings.refundDeadlineAt && Math.floor(Date.now() / 1000) <= data.settings.refundDeadlineAt);
        refundAmountMinor = beforeDeadline ? item.netPaidMinor : 0;
        const policyMessage = beforeDeadline
          ? tr(locale, `La política exige devolución total: ${money(refundAmountMinor, item.currency || "UYU")}.`, `Policy requires a full refund: ${money(refundAmountMinor, item.currency || "UYU")}.`)
          : tr(locale, "El plazo de devolución ya venció. La cancelación se aprobará sin devolución.", "The refund deadline has passed. Cancellation will be approved without a refund.");
        if (!window.confirm(policyMessage)) return;
      } else if (!window.confirm(tr(locale, "La política del torneo es sin devolución. ¿Aprobar la cancelación igualmente?", "Tournament policy has no refunds. Approve cancellation anyway?"))) return;
      if (refundAmountMinor > 0) { const method = window.prompt(tr(locale, "Método: bank_transfer, cash, mercado_pago u other", "Method: bank_transfer, cash, mercado_pago or other"), "bank_transfer"); if (method === null) return; refundMethod = method; }
    }
    note = window.prompt(tr(locale, "Nota de administración (opcional)", "Admin note (optional)")); if (note === null) return;
    void act(item.id, () => api(`/api/admin/cancellation-requests/${item.id}/review`, { method: "POST", body: JSON.stringify({ decision, refundAmountMinor, refundMethod, note }) }), tr(locale, "Solicitud resuelta.", "Request resolved."));
  };

  const createRefund = (order: PaymentOrder) => {
    const remaining = Math.max(0, order.amountPaidMinor - order.amountRefundedMinor);
    const value = window.prompt(tr(locale, `Monto a devolver en ${order.currency}`, `Refund amount in ${order.currency}`), (remaining / 100).toFixed(2));
    if (value === null) return;
    const amountMinor = Math.max(0, Math.round(Number(value.replace(",", ".")) * 100));
    const method = window.prompt(tr(locale, "Método: bank_transfer, cash, mercado_pago u other", "Method: bank_transfer, cash, mercado_pago or other"), order.selectedMethod || "bank_transfer");
    if (method === null) return;
    const note = window.prompt(tr(locale, "Nota de devolución (opcional)", "Refund note (optional)"));
    if (note === null) return;
    void act(`refund-${order.id}`, () => api(`/api/admin/payment-orders/${order.id}/refunds`, { method: "POST", body: JSON.stringify({ amountMinor, method, note }) }), tr(locale, "Devolución creada como pendiente.", "Refund created as pending."));
  };
  const completeRefund = (item: AdminRefund) => {
    const externalId = window.prompt(tr(locale, "Referencia de la devolución (opcional)", "Refund reference (optional)")); if (externalId === null) return;
    const note = window.prompt(tr(locale, "Nota (opcional)", "Note (optional)")); if (note === null) return;
    void act(item.id, () => api(`/api/admin/payment-refunds/${item.id}/complete`, { method: "POST", body: JSON.stringify({ externalId, note }) }), tr(locale, "Devolución registrada.", "Refund recorded."));
  };

  const sections = useMemo(() => data ? {
    review: data.orders.filter((o) => o.status === "pending_review"), pending: data.orders.filter((o) => ["draft", "awaiting_payment"].includes(o.status)), settled: data.orders.filter((o) => ["paid", "partially_refunded", "refunded"].includes(o.status)),
  } : { review: [], pending: [], settled: [] }, [data]);

  if (!data) return <section className="panel"><h2>{tr(locale, "Pagos", "Payments")}</h2>{error ? <div className="error-box">{error}</div> : <p>{tr(locale, "Cargando…", "Loading…")}</p>}</section>;
  const settings = data.settings;
  const renderOrder = (order: PaymentOrder) => {
    const submitted = order.attempts.find((a) => a.status === "submitted");
    const approvedManual = order.attempts.find((a) => a.status === "approved" && (a.method === "bank_transfer" || a.method === "cash"));
    return <article className="payment-admin-order" key={order.id}><div className="payment-order-head"><div><strong>{order.payerName}</strong><span>{order.payerEmail || (order.payerKind === "manual_profile" ? tr(locale, "Jugador cargado manualmente", "Manual player") : "")}</span></div><div><StatusPill status={order.status} locale={locale}/><strong>{money(order.totalAmountMinor, order.currency)}</strong></div></div><div className="payment-admin-items">{order.items.map((i) => <span key={i.id}>{i.label}</span>)}</div><div className="payment-admin-actions">
      {submitted?.proofId && <a className="ghost small" target="_blank" rel="noreferrer" href={`/api/payment-proofs/${submitted.proofId}`}>{tr(locale, "Ver comprobante", "View proof")}</a>}
      {submitted && <><button className="light small" disabled={busy === submitted.id} onClick={() => reviewAttempt(submitted, "approve")}>{tr(locale, "Aprobar", "Approve")}</button><button className="ghost small" disabled={busy === submitted.id} onClick={() => reviewAttempt(submitted, "reject")}>{tr(locale, "Rechazar", "Reject")}</button></>}
      {["draft", "awaiting_payment", "pending_review"].includes(order.status) && <><button className="ghost small" disabled={busy === order.id || !settings.bankTransferEnabled} onClick={() => markPaid(order, "bank_transfer")}>{tr(locale, "Marcar transferencia cobrada", "Mark transfer paid")}</button><button className="ghost small" disabled={busy === order.id || !settings.cashEnabled} onClick={() => markPaid(order, "cash")}>{tr(locale, "Marcar efectivo cobrado", "Mark cash paid")}</button></>}
      {approvedManual && order.status === "paid" && <button className="ghost small" disabled={busy === approvedManual.id} onClick={() => reverse(approvedManual)}>{tr(locale, "Revertir cobro", "Reverse payment")}</button>}
      {order.payerKind === "manual_profile" && ["paid", "partially_refunded"].includes(order.status) && order.amountPaidMinor > order.amountRefundedMinor && <button className="ghost small" disabled={busy === `refund-${order.id}`} onClick={() => createRefund(order)}>{tr(locale, "Crear devolución", "Create refund")}</button>}
    </div>{["draft", "awaiting_payment"].includes(order.status) && settings.bankTransferEnabled === 1 && <details className="payment-admin-upload"><summary>{tr(locale, "Cargar comprobante recibido por fuera", "Upload externally received proof")}</summary><form onSubmit={(event) => adminProof(order, event)}><input name="proof" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf"/><input name="note" placeholder={tr(locale, "Nota opcional", "Optional note")}/><button className="light small">{tr(locale, "Cargar", "Upload")}</button></form></details>}</article>;
  };

  return <section className="payment-admin-section">
    <div className="section-heading"><div><div className="eyebrow">PAYMENTS</div><h2>{tr(locale, "Cobros del torneo", "Tournament payments")}</h2><p>{tr(locale, "Transferencia, efectivo y Mercado Pago comparten un único registro financiero.", "Bank transfer, cash and Mercado Pago share one financial ledger.")}</p></div><button className="ghost" onClick={() => void load(true)} disabled={busy !== ""}>{tr(locale, "Sincronizar cobros", "Sync payments")}</button></div>
    {error && <div className="error-box">{error}</div>}{notice && <div className="notice-box">{notice}</div>}
    <div className="payment-kpis"><div><span>{tr(locale, "Esperado", "Expected")}</span><strong>{money(data.summary.expectedMinor, settings.bankCurrency)}</strong></div><div><span>{tr(locale, "Cobrado neto", "Net paid")}</span><strong>{money(data.summary.paidMinor, settings.bankCurrency)}</strong></div><div><span>{tr(locale, "Pendiente", "Pending")}</span><strong>{money(data.summary.pendingMinor, settings.bankCurrency)}</strong></div><div><span>{tr(locale, "En revisión", "Review")}</span><strong>{money(data.summary.reviewMinor, settings.bankCurrency)}</strong></div><div><span>{tr(locale, "Devuelto", "Refunded")}</span><strong>{money(data.summary.refundedMinor, settings.bankCurrency)}</strong></div></div>

    <article className="panel"><div className="payment-order-head"><div><h2>{tr(locale, "Configuración de cobro", "Payment settings")}</h2><p>{tr(locale, "Habilitá sólo los métodos que quieras ofrecer en este torneo.", "Enable only the methods you want for this tournament.")}</p></div></div><form className="payment-settings-form" onSubmit={saveSettings}>
      <div className="payment-toggle-row"><label><input name="bankTransferEnabled" type="checkbox" defaultChecked={settings.bankTransferEnabled === 1}/> {tr(locale, "Transferencia", "Bank transfer")}</label><label><input name="cashEnabled" type="checkbox" defaultChecked={settings.cashEnabled === 1}/> {tr(locale, "Efectivo", "Cash")}</label><label><input name="mercadoPagoEnabled" type="checkbox" defaultChecked={settings.mercadoPagoEnabled === 1}/> Mercado Pago</label></div>
      <div className="payment-settings-grid"><label><span>{tr(locale, "Banco", "Bank")}</span><input name="bankName" defaultValue={settings.bankName ?? ""}/></label><label><span>{tr(locale, "Titular", "Holder")}</span><input name="bankAccountHolder" defaultValue={settings.bankAccountHolder ?? ""}/></label><label><span>{tr(locale, "Cuenta", "Account")}</span><input name="bankAccountNumber" defaultValue={settings.bankAccountNumber ?? ""}/></label><label><span>{tr(locale, "Alias", "Alias")}</span><input name="bankAccountAlias" defaultValue={settings.bankAccountAlias ?? ""}/></label><label><span>{tr(locale, "Moneda", "Currency")}</span><input name="bankCurrency" defaultValue={settings.bankCurrency || "UYU"}/></label><label><span>{tr(locale, "Vencimiento", "Due date")}</span><input name="paymentDueAt" type="datetime-local" defaultValue={localInput(settings.paymentDueAt)}/></label></div>
      <label><span>{tr(locale, "Instrucciones de transferencia", "Transfer instructions")}</span><textarea name="bankInstructions" defaultValue={settings.bankInstructions ?? ""}/></label><label className="checkbox-line"><input name="transferProofRequired" type="checkbox" defaultChecked={settings.transferProofRequired === 1}/> {tr(locale, "Solicitar comprobante", "Request transfer proof")}</label><label><span>{tr(locale, "Instrucciones para efectivo", "Cash instructions")}</span><textarea name="cashInstructions" defaultValue={settings.cashInstructions ?? ""}/></label>
      <div className="payment-settings-grid"><label><span>{tr(locale, "Política de devolución", "Refund policy")}</span><select name="refundPolicy" defaultValue={settings.refundPolicy}><option value="manual">{tr(locale, "Revisión manual", "Manual review")}</option><option value="none">{tr(locale, "Sin devolución", "No refunds")}</option><option value="full_before_deadline">{tr(locale, "Total antes del plazo", "Full before deadline")}</option></select></label><label><span>{tr(locale, "Plazo de devolución", "Refund deadline")}</span><input name="refundDeadlineAt" type="datetime-local" defaultValue={localInput(settings.refundDeadlineAt)}/></label></div><label><span>{tr(locale, "Política de cancelación visible", "Visible cancellation policy")}</span><textarea name="cancellationPolicyText" defaultValue={settings.cancellationPolicyText ?? ""}/></label>
      <div className="payment-mp-connect"><label><span>{tr(locale, "Cuenta Mercado Pago", "Mercado Pago account")}</span><select name="mercadoPagoAccountId" defaultValue={settings.mercadoPagoAccountId ?? ""}><option value="">—</option>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.label}{account.liveMode ? " · LIVE" : " · TEST"}</option>)}</select></label><button className="ghost" type="button" disabled={!data.mercadoPagoConfigured || busy === "mp-connect"} onClick={connectMp}>{tr(locale, data.accounts.length ? "Conectar otra cuenta" : "Conectar Mercado Pago", data.accounts.length ? "Connect another account" : "Connect Mercado Pago")}</button>{!data.mercadoPagoConfigured && <span className="muted">{tr(locale, "Faltan secrets de Mercado Pago en Cloudflare.", "Mercado Pago Cloudflare secrets are missing.")}</span>}</div>
      <button className="light" disabled={busy === "settings"}>{tr(locale, "Guardar pagos", "Save payments")}</button>
    </form></article>

    {data.cancellations.some((c) => c.status === "pending") && <article className="panel"><h2>{tr(locale, "Solicitudes de cancelación", "Cancellation requests")}</h2><div className="payment-admin-list">{data.cancellations.filter((c) => c.status === "pending").map((item) => <div className="payment-admin-order" key={item.id}><div className="payment-order-head"><div><strong>{item.playerName}</strong><span>{item.categoryName} · {item.reason || tr(locale, "Sin motivo", "No reason")}</span></div><strong>{money(item.netPaidMinor, item.currency || "UYU")} {tr(locale, "pagado", "paid")}</strong></div><div className="payment-admin-actions"><button className="light small" onClick={() => reviewCancellation(item, "approve")}>{tr(locale, "Aprobar cancelación", "Approve cancellation")}</button><button className="ghost small" onClick={() => reviewCancellation(item, "reject")}>{tr(locale, "Rechazar", "Reject")}</button></div></div>)}</div></article>}
    {data.refunds.some((r) => r.status === "pending") && <article className="panel"><h2>{tr(locale, "Devoluciones pendientes", "Pending refunds")}</h2>{data.refunds.filter((r) => r.status === "pending").map((item) => <div className="payment-history-row" key={item.id}><div><strong>{item.payerName}</strong><span>{item.method}</span></div><div><strong>{money(item.amountMinor, settings.bankCurrency)}</strong><button className="light small" onClick={() => completeRefund(item)}>{tr(locale, "Registrar devolución", "Record refund")}</button></div></div>)}</article>}

    <article className="panel"><h2>{tr(locale, "En revisión", "Under review")} · {sections.review.length}</h2>{sections.review.length ? <div className="payment-admin-list">{sections.review.map(renderOrder)}</div> : <p className="muted">{tr(locale, "No hay comprobantes ni pagos en revisión.", "No payments are under review.")}</p>}</article>
    <article className="panel"><h2>{tr(locale, "Pendientes", "Pending")} · {sections.pending.length}</h2>{sections.pending.length ? <div className="payment-admin-list">{sections.pending.map(renderOrder)}</div> : <p className="muted">{tr(locale, "No hay cobros pendientes.", "No pending payments.")}</p>}</article>
    <details className="panel payment-history"><summary>{tr(locale, "Pagados e historial", "Paid & history")} · {sections.settled.length}</summary><div className="payment-admin-list">{sections.settled.map(renderOrder)}</div></details>
  </section>;
}
