import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "./i18n";

type Registration = {
  id: string;
  categoryId: string;
  categoryName: string;
  entryType: "individual" | "pair" | "team";
  entryId?: string | null;
  entryName: string | null;
  status: string;
};
type Model = {
  ok: true;
  participants: Array<{ profileId: string; name: string; categoryId: string }>;
  entries: Array<{ id: string; name: string; categoryId: string; entryType: string; memberCount: number; teamPaymentMode: string | null }>;
  freeOnline: Array<{ id: string; categoryId: string; name: string }>;
};
type Action = "pair_online" | "pair_manual" | "create_team" | "join_team" | "add_online" | "add_manual";
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;

export function OnlineGroupingPanel({ tournamentId, registrations, locale, onChange }: {
  tournamentId: string;
  registrations: Registration[];
  locale: Locale;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<Model | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [choice, setChoice] = useState<Action>("pair_online");
  const [targetId, setTargetId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const list = useMemo(() => registrations.filter(r => r.entryType !== "individual" && !["cancelled", "rejected", "waitlisted"].includes(r.status)), [registrations]);
  const source = list.find(r => r.categoryId === categoryId) ?? list[0];
  const selectedId = source?.categoryId ?? "";
  const hasTeam = source?.entryType === "team" && Boolean(source.entryId);
  const isPair = source?.entryType === "pair";
  const allowed: Action[] = isPair
    ? ["pair_online", "pair_manual"]
    : hasTeam ? ["add_online", "add_manual"] : ["create_team", "join_team"];
  const action: Action = allowed.includes(choice) ? choice : allowed[0]!;
  const path = `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/manual-management`;
  const onlinePath = `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/online-grouping`;
  const fetchModel = useCallback(async () => {
    const response = await fetch(path, { credentials: "same-origin" });
    const result = await response.json() as Model & { code?: string };
    if (!response.ok) throw new Error(result.code ?? `HTTP_${response.status}`);
    setModel(result);
  }, [path]);
  useEffect(() => { if (open) void fetchModel().catch(e => setError(e instanceof Error ? e.message : "LOAD_FAILED")); }, [open, fetchModel]);
  const candidates = useMemo(() => {
    if (!model || !source) return [];
    if (action === "pair_online" || action === "add_online") {
      return model.freeOnline.filter(p => p.categoryId === selectedId && p.id !== source.id).map(p => ({ id: p.id, name: p.name }));
    }
    if (action === "pair_manual" || action === "add_manual") {
      return model.participants.filter(p => p.categoryId === selectedId).map(p => ({ id: p.profileId, name: p.name }));
    }
    if (action === "join_team") {
      return model.entries.filter(e => e.categoryId === selectedId && e.entryType === "team")
        .map(e => ({ id: e.id, name: `${e.name} (${e.memberCount})${e.teamPaymentMode === "team_full" ? " · pago completo" : ""}` }));
    }
    return [];
  }, [model, source, action, selectedId]);
  const submit = async () => {
    if (!source) return;
    if (!window.confirm(tr(locale, "Confirmá que los jugadores dieron su consentimiento para este vínculo administrativo.", "Confirm that the players agreed to this administrative grouping."))) return;
    let endpoint = onlinePath;
    let body: Record<string, unknown> = { action, sourceRegistrationId: source.id, categoryId: selectedId };
    if (action === "pair_online") body = { ...body, targetRegistrationId: targetId };
    if (action === "create_team") body = { ...body, teamName };
    if (action === "join_team") body = { ...body, entryId: targetId };
    if (action === "add_online") body = { ...body, action: "join_team", sourceRegistrationId: targetId, entryId: source.entryId };
    if (action === "pair_manual") {
      endpoint = path;
      body = { action: "pair_online", profileId: targetId, categoryId: selectedId, targetRegistrationId: source.id };
    }
    if (action === "add_manual") {
      endpoint = path;
      body = { action: "join_entry", profileId: targetId, categoryId: selectedId, entryId: source.entryId };
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { ok: boolean; code?: string };
      if (!response.ok || !result.ok) throw new Error(result.code ?? `HTTP_${response.status}`);
      setTargetId("");
      setMessage(tr(locale, "Vínculo confirmado y publicado.", "Grouping confirmed and published."));
      await fetchModel();
      onChange();
    } catch (e) { setError(e instanceof Error ? e.message : "GROUPING_FAILED"); }
    finally { setBusy(false); }
  };
  if (!list.length) return null;
  const actionLabel: Record<Action, string> = {
    pair_online: tr(locale, "Unir con jugador online libre", "Pair with free online player"),
    pair_manual: tr(locale, "Unir con jugador manual libre", "Pair with free manual player"),
    create_team: tr(locale, "Crear equipo con este jugador como capitán", "Create team with this player as captain"),
    join_team: tr(locale, "Incorporar a equipo existente", "Join existing team"),
    add_online: tr(locale, "Agregar jugador online al equipo", "Add online member to team"),
    add_manual: tr(locale, "Agregar jugador manual al equipo", "Add manual member to team"),
  };
  return <section className="participant-subpanel">
    <button className="ghost small" type="button" onClick={() => setOpen(!open)}>{open ? tr(locale, "Cerrar armado asistido", "Close assisted grouping") : tr(locale, "Parejas / equipos asistidos", "Assisted pairs / teams")}</button>
    {open && <div style={{ display: "grid", gap: 10, paddingTop: 10 }}>
      <p className="muted">{tr(locale, "Vinculación administrativa de inscriptos online y manuales. No crea nuevas inscripciones ni nuevas deudas; confirmá previamente el consentimiento.", "Administrative grouping for online and manual entrants. Does not create registrations or charges; confirm consent first.")}</p>
      <label><span>{tr(locale, "Categoría", "Category")}</span><select value={selectedId} onChange={(e: {target:{value:string}}) => { setCategoryId(e.target.value); setChoice("pair_online"); setTargetId(""); }}>{list.map(r => <option value={r.categoryId} key={r.id}>{r.categoryName}</option>)}</select></label>
      {isPair && source?.entryId ? <p className="muted">{tr(locale, "Esta pareja ya está vinculada.", "This pair is already linked.")} {source.entryName}</p> : <>
        <label><span>{tr(locale, "Acción", "Action")}</span><select value={action} onChange={(e: {target:{value:string}}) => { setChoice(e.target.value as Action); setTargetId(""); }}>{allowed.map(key => <option key={key} value={key}>{actionLabel[key]}</option>)}</select></label>
        {action === "create_team" ? <label><span>{tr(locale, "Nombre del equipo", "Team name")}</span><input value={teamName} onChange={(e: {target:{value:string}}) => setTeamName(e.target.value)} maxLength={90} placeholder={tr(locale, "Nombre del equipo", "Team name")}/></label> : <label><span>{tr(locale, "Seleccionar jugador o equipo", "Select player or team")}</span><select value={targetId} onChange={(e: {target:{value:string}}) => setTargetId(e.target.value)}><option value="">{tr(locale, "Elegí una opción", "Choose an option")}</option>{candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <button type="button" className="light small" disabled={busy || !model || (action === "create_team" ? teamName.trim().length < 2 : !targetId)} onClick={() => void submit()}>{busy ? "…" : tr(locale, "Confirmar armado", "Confirm grouping")}</button>
      </>}
      {error && <p className="registration-alert">{error}</p>}{message && <p className="muted">{message}</p>}
    </div>}
  </section>;
}
