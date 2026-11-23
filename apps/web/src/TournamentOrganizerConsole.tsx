import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "./i18n";
import { TournamentOrganizerDay } from "./TournamentOrganizerDay";
import "./TournamentOrganizerConsole.css";

export type OrganizerTournament = {
  id: string; name: string; slug: string; status: string; startAt: number;
  endAt: number | null; organizationName: string;
  canManageRegistrationsAndPayments: boolean; canOperateDay: boolean;
};
type Registration = {
  id: string; userName: string; userEmail: string; entryName: string | null;
  registrationNumber: number; categoryId: string; categoryName: string;
  entryType: "individual" | "pair" | "team"; members?: Array<{ name: string }>;
  status: string; finalAmountMinor: number; baseAmountMinor: number;
  discountMinor: number; paidAmountMinor?: number; refundedAmountMinor?: number;
  currency: string | null; covered?: boolean;
};
type Attempt = { id: string; method: string; status: string; amountMinor: number; proofId: string | null; proofName: string | null };
type Order = { id: string; payerName: string; payerEmail: string | null; currency: string;
  totalAmountMinor: number; amountPaidMinor: number; amountRefundedMinor: number;
  status: string; selectedMethod: string | null;
  items: Array<{ id: string; label: string; amountMinor: number }>;
  attempts: Attempt[];
};
type Summary = { expectedMinor: number; paidMinor: number; pendingMinor: number; reviewMinor: number; refundedMinor: number };
type RegistrationResponse = { ok: true; registrations: Registration[]; publicUrl: string };
type PaymentsResponse = { ok: true; orders: Order[]; summary: Summary };
type ListResponse = { ok: true; tournaments: OrganizerTournament[] };
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
export const formatOrganizerMoney = (minor: number, currency: string | null) =>
  `${new Intl.NumberFormat("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ${currency || "UYU"}`;
export const canOfferOrganizerCourtesy = (registration: Pick<Registration, "entryType" | "status" | "finalAmountMinor" | "paidAmountMinor" | "refundedAmountMinor" | "covered">) =>
  registration.entryType !== "team" && !registration.covered &&
  !["cancelled", "rejected"].includes(registration.status) &&
  registration.finalAmountMinor > 0 && registration.status !== "confirmed" &&
  (registration.paidAmountMinor ?? 0) === 0 && (registration.refundedAmountMinor ?? 0) === 0;
export const canMarkOrganizerPaid = (order: Pick<Order, "status" | "totalAmountMinor">) =>
  ["draft", "awaiting_payment", "pending_review"].includes(order.status) && order.totalAmountMinor > 0;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const result = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(result.code || `HTTP_${response.status}`);
  return result;
}

const money = formatOrganizerMoney;
const date = (value: number, locale: Locale) => new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value < 10000000000 ? value * 1000 : value));
const registrationName = (registration: Registration) => registration.entryName ||
  (registration.members?.length ? registration.members.map((member) => member.name).join(" / ") : registration.userName);

export function TournamentOrganizerConsole({ locale, go, tournamentId }: {
  locale: Locale; go: (path: string) => void; tournamentId?: string;
}) {
  const [tournaments, setTournaments] = useState<OrganizerTournament[] | null>(null);
  const [section, setSection] = useState<"registrations" | "payments" | "published" | "day">(() => new URLSearchParams(window.location.search).get("view") === "tv" ? "day" : "registrations");
  const [registrations, setRegistrations] = useState<RegistrationResponse | null>(null);
  const [payments, setPayments] = useState<PaymentsResponse | null>(null);
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [courtesyId, setCourtesyId] = useState("");
  const [courtesyReason, setCourtesyReason] = useState("");
  const [manualOrderId, setManualOrderId] = useState("");
  const [manualMethod, setManualMethod] = useState<"cash" | "bank_transfer">("bank_transfer");
  const [manualNote, setManualNote] = useState("");
  const [reviewId, setReviewId] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  useEffect(() => {
    let active = true;
    void request<ListResponse>("/api/me/organizer-tournaments").then((data) => {
      if (active) setTournaments(data.tournaments);
    }).catch((cause: unknown) => {
      if (active) setListError(cause instanceof Error ? cause.message : "ORGANIZER_LIST_FAILED");
    });
    return () => { active = false; };
  }, []);

  const selected = useMemo(() => tournaments?.find((item) => item.id === tournamentId) ?? null, [tournaments, tournamentId]);
  const loadRegistrations = useCallback(async () => {
    if (!tournamentId) return;
    setError("");
    try {
      const data = await request<RegistrationResponse>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/registrations`);
      setRegistrations(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ORGANIZER_REGISTRATIONS_FAILED"); }
  }, [tournamentId]);
  const loadPayments = useCallback(async () => {
    if (!tournamentId) return;
    setError("");
    try {
      const data = await request<PaymentsResponse>(`/api/organizer/tournaments/${encodeURIComponent(tournamentId)}/payments`);
      setPayments(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ORGANIZER_PAYMENTS_FAILED"); }
  }, [tournamentId]);

  useEffect(() => {
    if (!selected) return;
    if (section === "registrations") void loadRegistrations();
    if (section === "payments") void loadPayments();
  }, [selected, section, loadRegistrations, loadPayments]);

  const mutate = async (key: string, url: string, payload: object) => {
    setBusy(key); setNotice(""); setError("");
    try {
      await request(url, { method: "POST", body: JSON.stringify(payload) });
      setNotice(tr(locale, "Cambio registrado correctamente.", "Change recorded successfully."));
      setCourtesyId(""); setCourtesyReason(""); setManualOrderId(""); setManualNote(""); setReviewId(""); setReviewNote("");
      // Never run the expensive administrative sync; reload only the currently viewed resources.
      if (section === "payments") await loadPayments();
      else if (section === "registrations") await loadRegistrations();
      if (section === "payments") setRegistrations(null);
      if (section === "registrations") setPayments(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ORGANIZER_OPERATION_FAILED");
    } finally { setBusy(""); }
  };

  const activeRegistrations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (registrations?.registrations ?? []).filter((item) =>
      (category === "all" || item.categoryId === category) &&
      (!term || [registrationName(item), item.userName, item.userEmail, item.categoryName, ...((item.members ?? []).map((m) => m.name))].join(" ").toLowerCase().includes(term)),
    );
  }, [registrations, category, search]);
  const categories = useMemo(() => {
    const rows = new Map<string, string>();
    (registrations?.registrations ?? []).forEach((r) => rows.set(r.categoryId, r.categoryName));
    return [...rows.entries()];
  }, [registrations]);

  if (!tournamentId) {
    return <main className="dashboard tournament-list-page organizer-console">
      <section className="dashboard-head"><div><div className="eyebrow">HUAU / ORGANIZADOR</div><h1>{tr(locale, "Mis torneos asignados", "My assigned tournaments")}</h1><p>{tr(locale, "Administrá las inscripciones y cobros de tus eventos, sin acceder a otros torneos del complejo.", "Manage registrations and payments for your events, without access to other venue tournaments.")}</p></div></section>
      {listError && <p role="alert" className="h3-error">{listError}</p>}
      {!tournaments && !listError && <section className="panel"><p>{tr(locale, "Cargando torneos…", "Loading tournaments…")}</p></section>}
      {tournaments?.length === 0 && <section className="panel"><p>{tr(locale, "No tenés torneos asignados todavía. La asignación se realiza desde HUAU por email verificado.", "You have no assigned tournaments yet. HUAU assigns them to verified email accounts.")}</p></section>}
      <div className="tournament-card-list">{tournaments?.map((tournament) => <button className="tournament-card organizer-tournament-card" key={tournament.id} onClick={() => go(`/organizer/tournaments/${encodeURIComponent(tournament.id)}`)}><div><span className="pill">{tournament.organizationName}</span><h3>{tournament.name}</h3><p>{date(tournament.startAt, locale)} · {tournament.status.replaceAll("_", " ")}</p></div><div className="tournament-card-meta"><strong>{tr(locale, "Administrar", "Manage")}</strong><span>{tournament.canOperateDay ? tr(locale, "Jornada habilitada", "Day access enabled") : tr(locale, "Administración previa", "Pre-event administration")}</span></div></button>)}</div>
    </main>;
  }
  if (listError) return <main className="dashboard organizer-console"><p role="alert" className="h3-error">{listError}</p></main>;
  if (!tournaments) return <main className="dashboard organizer-console"><section className="panel">{tr(locale, "Comprobando acceso…", "Checking access…")}</section></main>;
  if (!selected) return <main className="dashboard organizer-console"><section className="panel"><h2>{tr(locale, "Torneo no asignado", "Tournament not assigned")}</h2><p>{tr(locale, "Este torneo no figura entre tus asignaciones activas.", "This tournament is not among your active assignments.")}</p><button className="ghost" onClick={() => go("/organizer")}>{tr(locale, "Volver a mis torneos", "Back to my tournaments")}</button></section></main>;

  if (new URLSearchParams(window.location.search).get("view") === "tv" && selected.canOperateDay) return <TournamentOrganizerDay locale={locale} tournamentId={selected.id} />;
  const submitted = payments?.orders.filter((order) => order.attempts.some((attempt) => attempt.status === "submitted")) ?? [];
  return <main className="dashboard organizer-console">
    <button className="section-back" onClick={() => go("/organizer")}>← {tr(locale, "Mis torneos", "My tournaments")}</button>
    <section className="dashboard-head organizer-heading"><div><div className="eyebrow">HUAU / {selected.organizationName}</div><h1>{selected.name}</h1><p>{date(selected.startAt, locale)} · {selected.status.replaceAll("_", " ")}</p></div><a href={`/tournaments/${encodeURIComponent(selected.slug)}`} target="_blank" rel="noreferrer" className="ghost organizer-public-link">{tr(locale, "Ver página pública", "View public page")}</a></section>
    <div className="admin-module-strip" role="tablist" aria-label={tr(locale, "Secciones del organizador", "Organizer sections")}>
      {(["registrations", "payments", "published", ...(selected.canOperateDay ? ["day" as const] : [])] as const).map((tab) => <button type="button" role="tab" aria-selected={section === tab} className={section === tab ? "active" : ""} key={tab} onClick={() => { setSection(tab); setError(""); setNotice(""); }}>
        {tab === "registrations" ? tr(locale, "Inscripciones", "Registrations") : tab === "payments" ? tr(locale, "Pagos y comprobantes", "Payments & proofs") : tab === "published" ? tr(locale, "Información publicada", "Published information") : tr(locale, "Día de torneo", "Tournament day")}
      </button>)}
    </div>
    {notice && <p className="notice-box" role="status">{notice}</p>}
    {error && <p className="h3-error" role="alert">{error}</p>}
    {section === "registrations" && <section className="organizer-stack">
      <div className="organizer-section-head"><div><h2>{tr(locale, "Inscripciones del torneo", "Tournament registrations")}</h2><p className="muted">{tr(locale, "Consulta por categoría; las cortesías quedan registradas con su motivo.", "Filter by category; courtesies are audited with a reason.")}</p></div><button className="ghost" disabled={!!busy} onClick={() => void loadRegistrations()}>{tr(locale, "Actualizar", "Refresh")}</button></div>
      <div className="organizer-filter-row"><label>{tr(locale, "Buscar", "Search")}<input type="search" placeholder={tr(locale, "Nombre o email…", "Name or email…")} value={search} onChange={(e) => setSearch(e.target.value)}/></label><label>{tr(locale, "Categoría", "Category")}<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">{tr(locale, "Todas", "All")}</option>{categories.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label></div>
      {!registrations && !error && <article className="panel">{tr(locale, "Cargando inscripciones…", "Loading registrations…")}</article>}
      {registrations && activeRegistrations.length === 0 && <article className="panel"><p>{tr(locale, "No hay inscripciones para este filtro.", "No registrations match this filter.")}</p></article>}
      <div className="organizer-card-stack">{activeRegistrations.map((registration) => <article className="panel organizer-person-card" key={registration.id}>
        <div className="payment-order-head"><div><span className="eyebrow">#{registration.registrationNumber} · {registration.categoryName}</span><strong>{registrationName(registration)}</strong><span>{registration.userName} · {registration.userEmail}</span></div><div><span className={`payment-status status-${registration.status}`}>{registration.status.replaceAll("_", " ")}</span><strong>{money(registration.finalAmountMinor, registration.currency)}</strong></div></div>
        {registration.members && registration.members.length > 0 && <p className="muted">{registration.members.map((member) => member.name).join(" / ")}</p>}
        <div className="organizer-card-actions">{canOfferOrganizerCourtesy(registration) && <button className="ghost small" disabled={!!busy} onClick={() => { setCourtesyId(registration.id); setCourtesyReason(""); }}>{tr(locale, "Exonerar por cortesía", "Grant courtesy")}</button>}</div>
        {courtesyId === registration.id && <form className="organizer-inline-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void mutate(registration.id, `/api/organizer/registrations/${encodeURIComponent(registration.id)}/courtesy`, { kind: "courtesy", note: courtesyReason.trim() }); }}><label>{tr(locale, "Motivo de la cortesía", "Courtesy reason")}<textarea required minLength={3} value={courtesyReason} onChange={(event) => setCourtesyReason(event.target.value)} placeholder={tr(locale, "Ej.: invitación de la organización", "E.g. organizer invitation")}/></label><div className="organizer-card-actions"><button type="submit" className="light small" disabled={!!busy || courtesyReason.trim().length < 3}>{tr(locale, "Confirmar cortesía", "Confirm courtesy")}</button><button type="button" className="ghost small" onClick={() => setCourtesyId("")}>{tr(locale, "Cancelar", "Cancel")}</button></div></form>}
      </article>)}</div>
    </section>}
    {section === "payments" && <section className="organizer-stack">
      <div className="organizer-section-head"><div><h2>{tr(locale, "Pagos y comprobantes", "Payments & proofs")}</h2><p className="muted">{tr(locale, "Confirmá cobros recibidos y revisá comprobantes sin modificar la configuración del torneo.", "Confirm received payments and review proofs without changing tournament settings.")}</p></div><button className="ghost" disabled={!!busy} onClick={() => void loadPayments()}>{tr(locale, "Actualizar", "Refresh")}</button></div>
      {payments && <div className="payment-kpis organizer-kpis"><div><span>{tr(locale, "Esperado", "Expected")}</span><strong>{money(payments.summary.expectedMinor, payments.orders[0]?.currency || "UYU")}</strong></div><div><span>{tr(locale, "Cobrado", "Paid")}</span><strong>{money(payments.summary.paidMinor, payments.orders[0]?.currency || "UYU")}</strong></div><div><span>{tr(locale, "Pendiente", "Pending")}</span><strong>{money(payments.summary.pendingMinor, payments.orders[0]?.currency || "UYU")}</strong></div><div><span>{tr(locale, "En revisión", "Review")}</span><strong>{money(payments.summary.reviewMinor, payments.orders[0]?.currency || "UYU")}</strong></div></div>}
      {!payments && !error && <article className="panel">{tr(locale, "Cargando pagos…", "Loading payments…")}</article>}
      {payments && payments.orders.length === 0 && <article className="panel"><p>{tr(locale, "No hay cobros para mostrar.", "No payment orders to show.")}</p></article>}
      {payments && submitted.length > 0 && <p className="muted">{submitted.length} {tr(locale, "órdenes con comprobantes enviados", "orders with submitted proofs")}</p>}
      <div className="organizer-card-stack">{payments?.orders.map((order) => <article className="panel organizer-person-card" key={order.id}>
        <div className="payment-order-head"><div><strong>{order.payerName}</strong><span>{order.payerEmail || "—"}</span><span>{order.items.map((item) => item.label).join(" · ")}</span></div><div><span className={`payment-status status-${order.status}`}>{order.status.replaceAll("_", " ")}</span><strong>{money(order.totalAmountMinor, order.currency)}</strong></div></div>
        <div className="organizer-card-actions">{canMarkOrganizerPaid(order) && <button className="ghost small" disabled={!!busy} onClick={() => { setManualOrderId(order.id); setManualNote(""); }}>{tr(locale, "Registrar pago recibido", "Record received payment")}</button>}</div>
        {order.attempts.filter((attempt) => attempt.status === "submitted").map((attempt) => <div className="organizer-proof" key={attempt.id}><span>{tr(locale, "Comprobante", "Proof")}: {attempt.proofName || attempt.method}</span><div className="organizer-card-actions">{attempt.proofId && <a className="ghost small" href={`/api/payment-proofs/${encodeURIComponent(attempt.proofId)}`} target="_blank" rel="noreferrer">{tr(locale, "Ver comprobante", "View proof")}</a>}<button className="light small" disabled={!!busy} onClick={() => { if (window.confirm(tr(locale, "¿Confirmar este cobro tras revisar el comprobante?", "Confirm this payment after reviewing its proof?"))) void mutate(attempt.id, `/api/organizer/payment-attempts/${encodeURIComponent(attempt.id)}/review`, { decision: "approve" }); }}>{tr(locale, "Aprobar", "Approve")}</button><button className="ghost small" disabled={!!busy} onClick={() => { setReviewId(attempt.id); setReviewNote(""); }}>{tr(locale, "Rechazar", "Reject")}</button></div>{reviewId === attempt.id && <form className="organizer-inline-form" onSubmit={(event) => { event.preventDefault(); void mutate(attempt.id, `/api/organizer/payment-attempts/${encodeURIComponent(attempt.id)}/review`, { decision: "reject", note: reviewNote.trim() }); }}><label>{tr(locale, "Motivo del rechazo", "Reason for rejection")}<textarea required value={reviewNote} onChange={(event) => setReviewNote(event.target.value)}/></label><div className="organizer-card-actions"><button className="light small" disabled={!!busy || !reviewNote.trim()}>{tr(locale, "Confirmar rechazo", "Confirm rejection")}</button><button className="ghost small" type="button" onClick={() => setReviewId("")}>{tr(locale, "Cancelar", "Cancel")}</button></div></form>}</div>)}
        {manualOrderId === order.id && <form className="organizer-inline-form" onSubmit={(event) => { event.preventDefault(); void mutate(order.id, `/api/organizer/payment-orders/${encodeURIComponent(order.id)}/mark-paid`, { method: manualMethod, note: manualNote.trim() }); }}><label>{tr(locale, "Medio recibido", "Received method")}<select value={manualMethod} onChange={(event) => setManualMethod(event.target.value as "cash" | "bank_transfer")}><option value="bank_transfer">{tr(locale, "Transferencia", "Bank transfer")}</option><option value="cash">{tr(locale, "Efectivo", "Cash")}</option></select></label><label>{tr(locale, "Observación (opcional)", "Note (optional)")}<input value={manualNote} onChange={(event) => setManualNote(event.target.value)} /></label><div className="organizer-card-actions"><button className="light small" disabled={!!busy}>{tr(locale, "Confirmar cobro", "Confirm payment")}</button><button type="button" className="ghost small" onClick={() => setManualOrderId("")}>{tr(locale, "Cancelar", "Cancel")}</button></div></form>}
      </article>)}</div>
    </section>}
    {section === "day" && selected.canOperateDay && <TournamentOrganizerDay locale={locale} tournamentId={selected.id} />}
    {section === "published" && <section className="organizer-stack"><article className="panel"><div className="eyebrow">HUAU / PUBLIC</div><h2>{tr(locale, "Grupos, cuadros y cronograma", "Groups, brackets & schedule")}</h2><p>{tr(locale, "Ves la misma información publicada que los jugadores. No podés cambiar grupos, formatos ni cronogramas desde este panel.", "You see the same published information as players. Groups, formats and schedules cannot be edited here.")}</p><a className="ghost organizer-public-link" href={`/tournaments/${encodeURIComponent(selected.slug)}`} target="_blank" rel="noreferrer">{tr(locale, "Abrir vista pública", "Open public view")}</a></article><article className="panel"><h2>{tr(locale, "Día de torneo", "Tournament day")}</h2><p>{selected.canOperateDay ? tr(locale, "HUAU habilitó tu permiso de jornada. La carga segura de resultados y WO se conectará en el Lote D.", "HUAU enabled your day permission. Safe result and walkover entry will be connected in Lot D.") : tr(locale, "La carga de resultados todavía no está habilitada para esta cuenta.", "Result entry is not yet enabled for this account.")}</p></article></section>}
  </main>;
}
