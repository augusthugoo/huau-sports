import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "./i18n";

type Category = {
  id: string;
  name: string;
  entryType: "individual" | "pair" | "team";
};

type Player = {
  id: string;
  organizationPersonId: string | null;
  userId: string | null;
  displayName: string;
  club: string;
  contact: string;
  sportGender: "male" | "female" | "unspecified";
  duprSingles: number;
  duprDoubles: number;
  playerStatus: "pending" | "confirmed";
  notes: string;
};

type Assignment = { playerProfileId: string; categoryId: string; partnerProfileId: string | null };

type RegistrationMember = { personId: string; name: string; email: string | null; memberRole: string; status: string; userId: string | null };
type AdminRegistration = {
  id: string;
  userId: string;
  registrationNumber: number;
  status: string;
  categoryId: string;
  categoryName: string;
  entryType: "individual" | "pair" | "team";
  entryName: string | null;
  groupingState: "ready" | "free" | "paired" | "captain" | "member";
  finalAmountMinor: number;
  baseAmountMinor: number;
  discountMinor: number;
  currency: string | null;
  covered: boolean;
  userName: string;
  userEmail: string;
  members: RegistrationMember[];
};

type PaymentOrder = {
  id: string;
  payerKind: "user" | "manual_profile";
  payerUserId: string | null;
  payerProfileId: string | null;
  payerName: string;
  payerEmail: string | null;
  currency: string;
  totalAmountMinor: number;
  amountPaidMinor: number;
  amountRefundedMinor: number;
  status: "draft" | "awaiting_payment" | "pending_review" | "paid" | "cancelled" | "partially_refunded" | "refunded";
  selectedMethod: "mercado_pago" | "bank_transfer" | "cash" | null;
  items: Array<{ id: string; registrationId: string | null; playerProfileId: string | null; categoryId: string | null; label: string; amountMinor: number }>;
};

type Participant = {
  key: string;
  userId: string | null;
  player: Player | null;
  name: string;
  email: string;
  registrations: AdminRegistration[];
  orders: PaymentOrder[];
};

type Props = {
  tournamentId: string;
  locale: Locale;
  players: Player[];
  categories: Category[];
  playerCategories: Assignment[];
  onCompetitionChanged: () => Promise<void>;
  openPayments: () => void;
};

class ParticipantApiError extends Error {
  constructor(public code: string, public impact?: string) { super(code); }
}
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
const money = (minor: number, currency: string | null) => new Intl.NumberFormat("es-UY", { style: "currency", currency: currency || "UYU", maximumFractionDigits: 0 }).format(Math.max(0, minor) / 100);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const payload = await response.json() as T & { code?: string; impact?: string; message?: string };
  if (!response.ok) throw new ParticipantApiError(payload.message || payload.code || `HTTP_${response.status}`, payload.impact);
  return payload;
}

async function withImpact<T>(locale: Locale, path: string, method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>): Promise<T> {
  try {
    return await api<T>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ParticipantApiError && error.code === "STRUCTURE_CHANGE_CONFIRM_REQUIRED") {
      const fallback = tr(locale, "Este cambio modifica el armado competitivo. HUAU guardará el estado necesario antes de continuar. ¿Confirmar?", "This changes the competition setup. HUAU will preserve the required state before continuing. Confirm?");
      if (!window.confirm(error.impact || fallback)) throw error;
      return api<T>(path, { method, body: JSON.stringify({ ...body, confirmImpact: true }) });
    }
    throw error;
  }
}

function registrationLabel(rows: AdminRegistration[], locale: Locale) {
  if (!rows.length) return tr(locale, "Manual", "Manual");
  const current = rows.filter((row) => !["cancelled", "rejected"].includes(row.status));
  if (current.some((row) => row.status === "confirmed")) return tr(locale, "Confirmada", "Confirmed");
  if (current.length) return tr(locale, "En proceso", "In progress");
  return tr(locale, "Historial", "History");
}
function registrationTone(rows: AdminRegistration[]) {
  if (!rows.length) return "neutral";
  const current = rows.filter((row) => !["cancelled", "rejected"].includes(row.status));
  if (current.some((row) => row.status === "confirmed")) return "strong";
  if (current.length) return "pending";
  return "history";
}
function paymentLabel(orders: PaymentOrder[], locale: Locale) {
  if (!orders.length) return tr(locale, "Sin cobro", "No charge");
  if (orders.some((order) => order.status === "pending_review")) return tr(locale, "En revisión", "Under review");
  if (orders.some((order) => ["draft", "awaiting_payment"].includes(order.status))) return tr(locale, "Pendiente", "Pending");
  if (orders.some((order) => order.status === "paid")) return tr(locale, "Pagado", "Paid");
  if (orders.some((order) => order.status === "partially_refunded")) return tr(locale, "Devuelto parcial", "Partially refunded");
  if (orders.every((order) => order.status === "refunded")) return tr(locale, "Devuelto", "Refunded");
  return orders[0]?.status.replaceAll("_", " ") || tr(locale, "Sin cobro", "No charge");
}
function paymentTone(orders: PaymentOrder[]) {
  if (orders.some((order) => order.status === "pending_review")) return "pending";
  if (orders.some((order) => ["draft", "awaiting_payment"].includes(order.status))) return "pending";
  if (orders.some((order) => order.status === "paid")) return "strong";
  if (orders.some((order) => ["refunded", "partially_refunded"].includes(order.status))) return "history";
  return "neutral";
}
function groupingLabel(registration: AdminRegistration, locale: Locale) {
  if (registration.entryType === "individual") return tr(locale, "Individual", "Individual");
  if (registration.entryType === "pair") {
    return registration.groupingState === "paired" ? registration.members.map((member) => member.name).join(" / ") : tr(locale, "Libre · buscando pareja", "Free · looking for partner");
  }
  return registration.entryName ? `${registration.entryName} · ${registration.groupingState}` : tr(locale, "Libre · sin equipo", "Free · no team");
}

export function TournamentParticipantsAdmin({ tournamentId, locale, players, categories, playerCategories, onCompetitionChanged, openPayments }: Props) {
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([]);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "current" | "pending" | "history">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const registrationData = await api<{ ok: true; registrations: AdminRegistration[]; publicUrl: string }>(`/api/admin/tournaments/${tournamentId}/registrations`);
      setRegistrations(registrationData.registrations);
      setPublicUrl(registrationData.publicUrl);
      try { await api(`/api/admin/tournaments/${tournamentId}/payments/sync`, { method: "POST", body: "{}" }); } catch { /* Payments can be unavailable in old test data; participant administration still loads. */ }
      const paymentData = await api<{ ok: true; orders: PaymentOrder[] }>(`/api/admin/tournaments/${tournamentId}/payments`);
      setOrders(paymentData.orders);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PARTICIPANTS_LOAD_FAILED");
    }
  }, [tournamentId]);
  useEffect(() => { void load(); }, [load]);

  const refreshTimer = useRef<number | null>(null);
  const competitionRefreshPending = useRef(false);
  const scheduleRefresh = useCallback((competitionChanged = false) => {
    if (competitionChanged) competitionRefreshPending.current = true;
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      const refreshCompetition = competitionRefreshPending.current;
      competitionRefreshPending.current = false;
      if (refreshCompetition) void onCompetitionChanged();
      void load();
    }, 180);
  }, [load, onCompetitionChanged]);
  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
  }, []);

  const participants = useMemo(() => {
    const map = new Map<string, Participant>();
    const ensure = (key: string, seed: Omit<Participant, "key" | "registrations" | "orders">) => {
      const current = map.get(key);
      if (current) return current;
      const next: Participant = { key, ...seed, registrations: [], orders: [] };
      map.set(key, next);
      return next;
    };

    players.forEach((player) => {
      const key = player.userId ? `user:${player.userId}` : `profile:${player.id}`;
      ensure(key, { userId: player.userId, player, name: player.displayName, email: player.contact });
    });
    registrations.forEach((registration) => {
      const key = `user:${registration.userId}`;
      const row = ensure(key, { userId: registration.userId, player: players.find((candidate) => candidate.userId === registration.userId) ?? null, name: registration.userName, email: registration.userEmail });
      row.registrations.push(registration);
      if (!row.name) row.name = registration.userName;
      if (!row.email) row.email = registration.userEmail;
    });
    orders.forEach((order) => {
      const key = order.payerKind === "user" && order.payerUserId ? `user:${order.payerUserId}` : order.payerProfileId ? `profile:${order.payerProfileId}` : `payment:${order.id}`;
      const linkedPlayer = order.payerProfileId ? players.find((candidate) => candidate.id === order.payerProfileId) ?? null : order.payerUserId ? players.find((candidate) => candidate.userId === order.payerUserId) ?? null : null;
      const row = ensure(key, { userId: order.payerUserId, player: linkedPlayer, name: linkedPlayer?.displayName || order.payerName, email: linkedPlayer?.contact || order.payerEmail || "" });
      row.orders.push(order);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, locale === "es" ? "es" : "en"));
  }, [locale, orders, players, registrations]);

  const filtered = useMemo(() => participants.filter((participant) => {
    const currentRegs = participant.registrations.filter((row) => !["cancelled", "rejected"].includes(row.status));
    const pending = currentRegs.some((row) => row.status !== "confirmed") || participant.orders.some((order) => ["draft", "awaiting_payment", "pending_review"].includes(order.status));
    const historical = !participant.player && currentRegs.length === 0 && (participant.registrations.length > 0 || participant.orders.some((order) => ["cancelled", "partially_refunded", "refunded"].includes(order.status)));
    if (filter === "current" && !(participant.player || currentRegs.length > 0)) return false;
    if (filter === "pending" && !pending) return false;
    if (filter === "history" && !historical) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const haystack = [participant.name, participant.email, participant.player?.club ?? "", ...participant.registrations.map((row) => row.categoryName), ...participant.orders.flatMap((order) => order.items.map((item) => item.label))].join(" ").toLowerCase();
    return haystack.includes(needle);
  }), [filter, participants, query]);

  const counts = useMemo(() => ({
    all: participants.length,
    current: participants.filter((participant) => participant.player || participant.registrations.some((row) => !["cancelled", "rejected"].includes(row.status))).length,
    pending: participants.filter((participant) => participant.registrations.some((row) => !["confirmed", "cancelled", "rejected"].includes(row.status)) || participant.orders.some((order) => ["draft", "awaiting_payment", "pending_review"].includes(order.status))).length,
    history: participants.filter((participant) => !participant.player && !participant.registrations.some((row) => !["cancelled", "rejected"].includes(row.status)) && (participant.registrations.length > 0 || participant.orders.some((order) => ["cancelled", "partially_refunded", "refunded"].includes(order.status)))).length,
  }), [participants]);

  const act = async (key: string, fn: () => Promise<unknown>, message = "", competitionChanged = false) => {
    setBusy(key); setError(""); setNotice("");
    try {
      await fn();
      if (message) setNotice(message);
      scheduleRefresh(competitionChanged);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "PARTICIPANT_ACTION_FAILED"); return false; }
    finally { setBusy(""); }
  };

  const assignmentPayload = (form: FormData) => categories.filter((category) => category.entryType !== "team" && form.get(`cat:${category.id}`) === "on").map((category) => ({
    categoryId: category.id,
    partnerProfileId: category.entryType === "pair" ? String(form.get(`partner:${category.id}`) || "") || null : null,
  }));

  const createManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = {
      displayName: String(form.get("displayName") || ""), club: String(form.get("club") || ""), contact: String(form.get("contact") || ""),
      sportGender: String(form.get("sportGender") || "unspecified"), duprSingles: Number(form.get("duprSingles") || 0), duprDoubles: Number(form.get("duprDoubles") || 0),
      playerStatus: "confirmed", notes: String(form.get("notes") || ""), assignments: assignmentPayload(form),
    };
    void (async () => {
      const ok = await act("create", () => withImpact(locale, `/api/admin/tournaments/${tournamentId}/players`, "POST", body), tr(locale, "Participante agregado al torneo.", "Participant added to the tournament."), true);
      if (ok) { formElement.reset(); setShowCreate(false); }
    })();
  };

  const savePlayer = (participant: Participant, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!participant.player) return;
    const form = new FormData(event.currentTarget);
    const body = {
      displayName: String(form.get("displayName") || ""), club: String(form.get("club") || ""), contact: String(form.get("contact") || ""),
      sportGender: String(form.get("sportGender") || "unspecified"), duprSingles: Number(form.get("duprSingles") || 0), duprDoubles: Number(form.get("duprDoubles") || 0),
      playerStatus: String(form.get("playerStatus") || "confirmed"), notes: String(form.get("notes") || ""), assignments: assignmentPayload(form),
    };
    void act(`save-${participant.player.id}`, () => withImpact(locale, `/api/admin/tournament-players/${participant.player!.id}`, "PUT", body), tr(locale, "Ficha competitiva actualizada.", "Competition profile updated."), true);
  };

  const removeFromSetup = (participant: Participant) => {
    if (!participant.player) return;
    const activeCount = participant.registrations.filter((row) => !["cancelled", "rejected"].includes(row.status)).length;
    const warning = tr(locale,
      `¿Quitar a ${participant.name} del armado competitivo?${activeCount ? ` Tiene ${activeCount} inscripción(es) activa(s), que NO se cancelarán.` : ""} Pagos, comprobantes e historial se conservan.`,
      `Remove ${participant.name} from competition setup?${activeCount ? ` They have ${activeCount} active registration(s), which will NOT be cancelled.` : ""} Payments, proofs and history are preserved.`);
    if (!window.confirm(warning)) return;
    void act(`remove-${participant.player.id}`, () => withImpact(locale, `/api/admin/tournament-players/${participant.player!.id}`, "DELETE", {}), tr(locale, "Ficha competitiva quitada. Inscripciones y pagos no cambiaron.", "Competition profile removed. Registrations and payments were not changed."), true);
  };

  const addOnlineToSetup = (participant: Participant) => {
    if (!participant.userId || participant.player) return;
    const activeAssignments = participant.registrations.filter((row) => !["cancelled", "rejected"].includes(row.status) && row.entryType !== "team").map((row) => ({ categoryId: row.categoryId, partnerProfileId: null }));
    const body = { sourceUserId: participant.userId, displayName: participant.name, contact: participant.email, assignments: activeAssignments, playerStatus: "confirmed" };
    void act(`setup-${participant.userId}`, () => withImpact(locale, `/api/admin/tournaments/${tournamentId}/players`, "POST", body), tr(locale, "Ficha competitiva recreada desde la cuenta HUAU.", "Competition profile recreated from the HUAU account."), true);
  };

  const promote = (registration: AdminRegistration) => void act(registration.id, () => api(`/api/admin/registrations/${registration.id}/promote`, { method: "POST", body: "{}" }), tr(locale, "Jugador promovido.", "Player promoted."), true);
  const discount = (registration: AdminRegistration) => {
    const value = window.prompt(tr(locale, "Descuento en pesos (ej. 200)", "Discount amount (e.g. 200)")); if (value === null) return;
    void act(registration.id, () => api(`/api/admin/registrations/${registration.id}/adjustment`, { method: "POST", body: JSON.stringify({ kind: "discount", amountMinor: Math.round(Number(value.replace(",", ".")) * 100) }) }), tr(locale, "Descuento actualizado.", "Discount updated."), true);
  };
  const courtesy = (registration: AdminRegistration) => {
    const note = window.prompt(tr(locale, "Motivo de cortesía (opcional)", "Courtesy reason (optional)")); if (note === null) return;
    void act(registration.id, () => api(`/api/admin/registrations/${registration.id}/adjustment`, { method: "POST", body: JSON.stringify({ kind: "courtesy", amountMinor: 0, note }) }), tr(locale, "Cortesía aplicada.", "Courtesy applied."), true);
  };
  const restoreCharge = (registration: AdminRegistration) => {
    if (!window.confirm(tr(locale, "¿Restaurar el importe original?", "Restore the original amount?"))) return;
    void act(registration.id, () => api(`/api/admin/registrations/${registration.id}/adjustment`, { method: "POST", body: JSON.stringify({ kind: "fixed_total", amountMinor: registration.baseAmountMinor, note: tr(locale, "Cortesía/descuento revertido por administrador", "Courtesy/discount reverted by administrator") }) }), tr(locale, "Cobro restaurado.", "Charge restored."), true);
  };

  return <section className="participant-admin">
    <article className="panel participant-admin-hero">
      <div className="participant-admin-title"><div><div className="eyebrow">TOURNAMENT PEOPLE</div><h2>{tr(locale, "Participantes", "Participants")}</h2><p className="muted">{tr(locale, "Una sola vista por persona. Inscripción, armado competitivo y pago siguen siendo estados separados, pero ya no tenés que perseguir al jugador por tres pestañas.", "One person-centric view. Registration, competition setup and payment remain separate states without making you chase a player across three tabs.")}</p></div><div className="form-actions"><button className="ghost small" disabled={!publicUrl} onClick={() => { if (publicUrl) void navigator.clipboard.writeText(`${window.location.origin}${publicUrl}`); }}>{tr(locale, "Copiar link de inscripción", "Copy registration link")}</button><button className="ghost small" onClick={openPayments}>{tr(locale, "Abrir bandeja de Pagos", "Open Payments queue")}</button><button className="light small" onClick={() => setShowCreate((value) => !value)}>{showCreate ? tr(locale, "Cerrar alta", "Close form") : tr(locale, "+ Agregar participante", "+ Add participant")}</button></div></div>
      {showCreate && <form className="participant-create-form" onSubmit={createManual}>
        <div className="participant-form-grid four"><ParticipantField name="displayName" label={tr(locale, "Nombre y apellido", "Full name")} required/><ParticipantField name="club" label="Club"/><ParticipantField name="contact" label={tr(locale, "Contacto", "Contact")}/><ParticipantSelect name="sportGender" label={tr(locale, "Género deportivo", "Sport gender")} value="unspecified" options={[["unspecified",tr(locale,"Sin especificar","Unspecified")],["male",tr(locale,"Masculino","Male")],["female",tr(locale,"Femenino","Female")]]}/></div>
        <div className="participant-form-grid three"><ParticipantField name="duprSingles" label="DUPR Singles" type="number" step="0.01"/><ParticipantField name="duprDoubles" label="DUPR Doubles" type="number" step="0.01"/><ParticipantField name="notes" label={tr(locale,"Notas","Notes")}/></div>
        <ParticipantAssignments locale={locale} categories={categories} players={players}/>
        <button className="light" disabled={busy === "create"}>{busy === "create" ? "…" : tr(locale,"Agregar participante","Add participant")}</button>
      </form>}
    </article>

    {error && <div className="registration-alert">{error}</div>}{notice && <div className="notice-box">{notice}</div>}

    <div className="participant-kpis"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><strong>{counts.all}</strong><span>{tr(locale,"Todos","All")}</span></button><button className={filter === "current" ? "active" : ""} onClick={() => setFilter("current")}><strong>{counts.current}</strong><span>{tr(locale,"Vigentes","Current")}</span></button><button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}><strong>{counts.pending}</strong><span>{tr(locale,"En proceso","In progress")}</span></button><button className={filter === "history" ? "active" : ""} onClick={() => setFilter("history")}><strong>{counts.history}</strong><span>{tr(locale,"Historial","History")}</span></button></div>
    <div className="participant-toolbar"><input value={query} onChange={(event: { target: { value: string } }) => setQuery(event.target.value)} placeholder={tr(locale,"Buscar por nombre, email, club o categoría…","Search name, email, club or category…")}/><span>{filtered.length} / {participants.length}</span></div>

    <div className="participant-list">{filtered.length ? filtered.map((participant) => <ParticipantCard key={participant.key} participant={participant} locale={locale} categories={categories} players={players} playerCategories={playerCategories} busy={busy} savePlayer={savePlayer} removeFromSetup={removeFromSetup} addOnlineToSetup={addOnlineToSetup} promote={promote} discount={discount} courtesy={courtesy} restoreCharge={restoreCharge} openPayments={openPayments}/>) : <div className="empty-state">{tr(locale,"No hay participantes para este filtro.","No participants match this filter.")}</div>}</div>
  </section>;
}

function ParticipantCard({ participant, locale, categories, players, playerCategories, busy, savePlayer, removeFromSetup, addOnlineToSetup, promote, discount, courtesy, restoreCharge, openPayments }: {
  participant: Participant; locale: Locale; categories: Category[]; players: Player[]; playerCategories: Assignment[]; busy: string;
  savePlayer: (participant: Participant, event: FormEvent<HTMLFormElement>) => void; removeFromSetup: (participant: Participant) => void; addOnlineToSetup: (participant: Participant) => void;
  promote: (registration: AdminRegistration) => void; discount: (registration: AdminRegistration) => void; courtesy: (registration: AdminRegistration) => void; restoreCharge: (registration: AdminRegistration) => void; openPayments: () => void;
}) {
  const assignments = participant.player ? new Map(playerCategories.filter((row) => row.playerProfileId === participant.player!.id).map((row) => [row.categoryId, row.partnerProfileId])) : new Map<string, string | null>();
  const currentRegistrations = participant.registrations.filter((row) => !["cancelled", "rejected"].includes(row.status));
  const historyRegistrations = participant.registrations.filter((row) => ["cancelled", "rejected"].includes(row.status));
  const categoryNames = [...new Set([
    ...[...assignments.keys()].map((id) => categories.find((category) => category.id === id)?.name).filter((name): name is string => Boolean(name)),
    ...currentRegistrations.map((row) => row.categoryName),
  ])];
  const total = participant.orders.reduce((sum, order) => sum + order.totalAmountMinor, 0);
  const paid = participant.orders.reduce((sum, order) => sum + order.amountPaidMinor - order.amountRefundedMinor, 0);

  return <article className="participant-card">
    <header className="participant-card-head"><div className="participant-identity"><strong>{participant.name}</strong><span>{participant.email || participant.player?.club || tr(locale,"Sin contacto","No contact")}</span></div><div className="participant-state-grid"><ParticipantState label={tr(locale,"Inscripción","Registration")} value={registrationLabel(participant.registrations, locale)} tone={registrationTone(participant.registrations)}/><ParticipantState label={tr(locale,"Competencia","Competition")} value={participant.player ? tr(locale,"Ficha activa","Active profile") : tr(locale,"Sin ficha","No profile")} tone={participant.player ? "strong" : "neutral"}/><ParticipantState label={tr(locale,"Pago","Payment")} value={paymentLabel(participant.orders, locale)} tone={paymentTone(participant.orders)}/></div></header>
    {categoryNames.length > 0 && <div className="participant-tags">{categoryNames.map((name) => <span key={name}>{name}</span>)}</div>}
    <details className="participant-manage"><summary>{tr(locale,"Administrar participante","Manage participant")}</summary>
      <div className="participant-manage-grid">
        <section className="participant-subpanel"><div className="participant-subpanel-title"><div><span className="eyebrow">REGISTRATION</span><h3>{tr(locale,"Inscripciones","Registrations")}</h3></div><strong>{currentRegistrations.length}</strong></div>
          {currentRegistrations.length ? <div className="participant-registration-list">{currentRegistrations.map((registration) => <div className="participant-registration-row" key={registration.id}><div><span className={`pill status-${registration.status}`}>#{registration.registrationNumber} · {registration.status}</span><strong>{registration.categoryName}</strong><small>{groupingLabel(registration, locale)} · {money(registration.finalAmountMinor, registration.currency)}</small></div><div className="form-actions">{registration.status === "waitlisted" && <button className="light small" disabled={busy === registration.id} onClick={() => promote(registration)}>{tr(locale,"Promover","Promote")}</button>}<button className="ghost small" disabled={busy === registration.id} onClick={() => discount(registration)}>{tr(locale,"Descuento","Discount")}</button><button className="ghost small" disabled={busy === registration.id} onClick={() => courtesy(registration)}>{tr(locale,"Cortesía","Courtesy")}</button>{registration.discountMinor > 0 && <button className="ghost small" disabled={busy === registration.id} onClick={() => restoreCharge(registration)}>{tr(locale,"Restaurar cobro","Restore charge")}</button>}</div></div>)}</div> : <p className="muted">{tr(locale,"Alta manual: no tiene una inscripción online separada. Su participación competitiva se gestiona en la ficha de abajo.","Manual entry: there is no separate online registration. Competition participation is managed in the profile below.")}</p>}
          {historyRegistrations.length > 0 && <details className="participant-history"><summary>{tr(locale,"Cancelaciones e historial","Cancellations & history")} · {historyRegistrations.length}</summary>{historyRegistrations.map((registration) => <div key={registration.id}><span>#{registration.registrationNumber}</span><strong>{registration.categoryName}</strong><small>{registration.status}</small></div>)}</details>}
        </section>

        <section className="participant-subpanel"><div className="participant-subpanel-title"><div><span className="eyebrow">COMPETITION</span><h3>{tr(locale,"Armado competitivo","Competition setup")}</h3></div>{participant.player && <span className="pill strong">{participant.player.playerStatus}</span>}</div>
          {participant.player ? <form className="participant-edit-form" onSubmit={(event: FormEvent<HTMLFormElement>) => savePlayer(participant, event)}>
            <div className="participant-form-grid four"><ParticipantField name="displayName" label={tr(locale,"Nombre","Name")} value={participant.player.displayName} required/><ParticipantField name="club" label="Club" value={participant.player.club}/><ParticipantField name="contact" label={tr(locale,"Contacto","Contact")} value={participant.player.contact}/><ParticipantSelect name="sportGender" label={tr(locale,"Género deportivo","Sport gender")} value={participant.player.sportGender} options={[["unspecified",tr(locale,"Sin especificar","Unspecified")],["male",tr(locale,"Masculino","Male")],["female",tr(locale,"Femenino","Female")]]}/></div>
            <div className="participant-form-grid four"><ParticipantField name="duprSingles" label="DUPR Singles" type="number" step="0.01" value={String(participant.player.duprSingles)}/><ParticipantField name="duprDoubles" label="DUPR Doubles" type="number" step="0.01" value={String(participant.player.duprDoubles)}/><ParticipantSelect name="playerStatus" label={tr(locale,"Estado competitivo","Competition status")} value={participant.player.playerStatus} options={[["confirmed",tr(locale,"Confirmado","Confirmed")],["pending",tr(locale,"Pendiente","Pending")]]}/><ParticipantField name="notes" label={tr(locale,"Notas","Notes")} value={participant.player.notes}/></div>
            <ParticipantAssignments locale={locale} categories={categories} players={players} playerId={participant.player.id} selected={assignments}/>
            <div className="form-actions"><button className="light small" disabled={busy === `save-${participant.player.id}`}>{tr(locale,"Guardar ficha","Save profile")}</button><button className="danger small" type="button" disabled={busy === `remove-${participant.player.id}`} onClick={() => removeFromSetup(participant)}>{tr(locale,"Quitar del armado","Remove from setup")}</button></div>
            <p className="muted participant-boundary-note">{tr(locale,"Esta ficha alimenta el armado, seeding y categorías competitivas. Quitarla no cancela inscripciones ni modifica pagos.","This profile feeds competition setup, seeding and competition categories. Removing it does not cancel registrations or change payments.")}</p>
          </form> : participant.userId ? <div className="participant-empty-action"><p>{tr(locale,"La persona sigue inscripta, pero no tiene ficha en el armado competitivo. Esto puede ocurrir si fue quitada manualmente.","The person is still registered but has no competition profile. This can happen after a manual removal.")}</p><button className="light small" disabled={busy === `setup-${participant.userId}`} onClick={() => addOnlineToSetup(participant)}>{tr(locale,"Recrear ficha desde HUAU","Recreate profile from HUAU")}</button></div> : <p className="muted">{tr(locale,"Sin ficha competitiva activa.","No active competition profile.")}</p>}
        </section>

        <section className="participant-subpanel participant-payment-summary"><div className="participant-subpanel-title"><div><span className="eyebrow">PAYMENT</span><h3>{tr(locale,"Situación de pago","Payment status")}</h3></div><button className="ghost small" onClick={openPayments}>{tr(locale,"Abrir Pagos","Open Payments")}</button></div>
          {participant.orders.length ? <><div className="participant-payment-numbers"><div><span>{tr(locale,"Total","Total")}</span><strong>{money(total, participant.orders[0]?.currency ?? "UYU")}</strong></div><div><span>{tr(locale,"Cobrado neto","Net paid")}</span><strong>{money(paid, participant.orders[0]?.currency ?? "UYU")}</strong></div></div><div className="participant-order-list">{participant.orders.map((order) => <div key={order.id}><span className={`participant-order-status ${paymentTone([order])}`}>{paymentLabel([order], locale)}</span><strong>{money(order.totalAmountMinor, order.currency)}</strong><small>{order.items.map((item) => item.label).join(" · ")}</small></div>)}</div></> : <p className="muted">{tr(locale,"No hay orden de cobro para esta persona. Puede ser un torneo gratuito o una ficha sin conceptos facturables.","There is no payment order for this person. The tournament may be free or the profile may have no billable items.")}</p>}
        </section>
      </div>
    </details>
  </article>;
}

function ParticipantState({ label, value, tone }: { label: string; value: string; tone: "strong" | "pending" | "history" | "neutral" }) {
  return <div className={`participant-state ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function ParticipantAssignments({ locale, categories, players, playerId, selected = new Map<string, string | null>() }: { locale: Locale; categories: Category[]; players: Player[]; playerId?: string; selected?: Map<string, string | null> }) {
  const standard = categories.filter((category) => category.entryType !== "team");
  if (!standard.length) return null;
  return <fieldset className="participant-assignments"><legend>{tr(locale,"Categorías para el armado","Competition categories")}</legend><div>{standard.map((category) => <div className="participant-assignment" key={category.id}><label><input type="checkbox" name={`cat:${category.id}`} defaultChecked={selected.has(category.id)}/><span>{category.name}</span></label>{category.entryType === "pair" && <select name={`partner:${category.id}`} defaultValue={selected.get(category.id) || ""}><option value="">{tr(locale,"Sin pareja / pendiente","No partner / pending")}</option>{players.filter((player) => player.id !== playerId).map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select>}</div>)}</div></fieldset>;
}

function ParticipantField({ name, label, type = "text", step, value, required = false }: { name: string; label: string; type?: string; step?: string; value?: string; required?: boolean }) {
  return <label><span>{label}</span><input name={name} type={type} step={step} defaultValue={value} required={required}/></label>;
}
function ParticipantSelect({ name, label, value, options }: { name: string; label: string; value: string; options: Array<[string, string]> }) {
  return <label><span>{label}</span><select name={name} defaultValue={value}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}
