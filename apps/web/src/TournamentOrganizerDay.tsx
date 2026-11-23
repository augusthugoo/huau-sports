/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "./i18n";
import type { TournamentDaySnapshot } from "./TournamentDayEngine";
import { cloneDay } from "./TournamentDayEngine";
import { applyOrganizerResultOperations, organizerResultKey, type OrganizerResultOperation } from "./TournamentOrganizerDayOps";
import { IntegralResultsPanel } from "./TournamentDayIntegralPanels";
import "./TournamentDayIntegral.css";
import { initializeReformSnapshot, type TournamentDayReformSnapshot } from "./TournamentDayReformEngine";
import { loadTournamentDaySession, saveTournamentDaySession, type TournamentDaySession } from "./TournamentDayStorage";
import { EpicTournamentDayTV } from "./TournamentDayEpicPanels";
import "./TournamentDay.css";
import "./TournamentDayEpic.css";
import "./TournamentOrganizerDay.css";

type Tab = "participants" | "groups" | "schedule" | "results" | "tv";
type OrganizerSession = TournamentDaySession<TournamentDaySnapshot> & { baseSnapshot?: TournamentDaySnapshot; pendingOps?: OrganizerResultOperation[] };
type PublishResponse = { ok: true; revision: number; publishedAt: number };
type DayState = { ok: true; userId: string; publishedRevision: number; hasPublishedSnapshot: boolean; publishedAt: number | null };
type DayBootstrap = { ok: true; snapshot: TournamentDaySnapshot; publishedRevision: number; finalizedAt: number | null; syncStatus: "idle" | "syncing" | "synced" | "failed"; syncError: string | null };
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
const text = (x: unknown, fallback = "") => x === null || x === undefined ? fallback : String(x);
const num = (x: unknown) => Number(x ?? 0) || 0;
const rows = (x: unknown) => Array.isArray(x) ? x as any[] : [];
const hour = (value: number, locale: Locale) => value ? new Date(value * 1000).toLocaleTimeString(locale === "es" ? "es-UY" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const localDayKey = (value: number) => { const d = new Date(value * 1000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const payload = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

/** Scoped organizer console; each result is local until an explicit publish. */
export function TournamentOrganizerDay({ locale, tournamentId }: { locale: Locale; tournamentId: string }) {
  const tvOnly = new URLSearchParams(window.location.search).get("view") === "tv";
  const [tab, setTab] = useState<Tab>(tvOnly ? "tv" : "participants");
  const [session, setSession] = useState<OrganizerSession | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [empty, setEmpty] = useState(false);
  const [mode, setMode] = useState<"grid" | "list">("grid");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let active = true;
    setBusy(true); setError(""); setEmpty(false); setSession(null);
    const run = async () => {
      // Recheck scoped permission before reading cached data. Revoked assignments fail closed.
      const prefix = `/api/organizer/tournaments/${encodeURIComponent(tournamentId)}`;
      const state = await api<DayState>(`${prefix}/day-state`);
      if (!active) return;
      if (!state.hasPublishedSnapshot) { setEmpty(true); return; }
      const storageKey = `organizer:${state.userId}:${tournamentId}`;
      const cached = await loadTournamentDaySession<TournamentDaySnapshot>(storageKey);
      if (!active) return;
      if (cached && cached.publishedRevision === state.publishedRevision) {
        setSession(cached as OrganizerSession);
        return;
      }
      if (cached?.dirty) throw new Error("ORGANIZER_DAY_REMOTE_REVISION_CHANGED");
      const remote = await api<DayBootstrap>(`${prefix}/day-bootstrap`);
      if (!active) return;
      const next: OrganizerSession = {
        schemaVersion: 1,
        storageKey,
        tournamentId,
        source: "organizer",
        dirty: false,
        updatedAt: Date.now(),
        publishedRevision: remote.publishedRevision,
        finalizedAt: remote.finalizedAt,
        syncStatus: remote.syncStatus,
        syncError: remote.syncError,
        snapshot: remote.snapshot,
        baseSnapshot: remote.snapshot,
        pendingOps: [],
      };
      await saveTournamentDaySession(next);
      if (active) setSession(next);
    };
    void run().catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : "ORGANIZER_DAY_LOAD_FAILED");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [tournamentId, refreshIndex]);

  const prefix = `/api/organizer/tournaments/${encodeURIComponent(tournamentId)}`;
  const persist = async (next: OrganizerSession) => {
    await saveTournamentDaySession(next);
    setSession(next);
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(`organizer-day:${next.storageKey}`);
      channel.postMessage({ type: "update", storageKey: next.storageKey });
      channel.close();
    }
  };
  // TV in another tab follows local result changes, without D1 reads per result.
  useEffect(() => {
    if (!session?.storageKey || typeof BroadcastChannel === "undefined") return;
    const key = session.storageKey;
    const channel = new BroadcastChannel(`organizer-day:${key}`);
    channel.onmessage = () => {
      void loadTournamentDaySession<TournamentDaySnapshot>(key).then((local) => {
        if (local && local.updatedAt >= (session.updatedAt ?? 0)) setSession(local as OrganizerSession);
      });
    };
    return () => channel.close();
  }, [session?.storageKey, session?.updatedAt]);

  const submitResult = async (op: OrganizerResultOperation) => {
    if (!session || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const ops = [...(session.pendingOps ?? [])];
      const index = ops.findIndex((o) => organizerResultKey(o) === organizerResultKey(op));
      if (index >= 0) ops[index] = op;
      else ops.push(op);
      // Ordinary new results are O(1) replay; editing an unpublished result rebuilds from the base.
      const nextSnapshot = index >= 0
        ? applyOrganizerResultOperations(session.baseSnapshot ?? session.snapshot, ops)
        : applyOrganizerResultOperations(session.snapshot, [op]);
      await persist({ ...session, snapshot: nextSnapshot, pendingOps: ops,
        baseSnapshot: session.baseSnapshot ?? cloneDay(session.snapshot), dirty: true, updatedAt: Date.now() });
      setNotice(tr(locale, "Resultado guardado en esta computadora. Falta publicar checkpoint.", "Result saved locally. Checkpoint still needs publishing."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ORGANIZER_DAY_RESULT_FAILED"); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const checkpoint = async (current: OrganizerSession): Promise<{ revision: number; next: OrganizerSession }> => {
    if (!current.dirty || !(current.pendingOps ?? []).length) return { revision: current.publishedRevision, next: current };
    const result = await api<PublishResponse>(`${prefix}/day-publish`, {
      method: "PUT", body: JSON.stringify({ basePublishedRevision: current.publishedRevision, operations: current.pendingOps }),
    });
    // Fetch the server's canonical result (including deterministic bracket generation).
    const remote = await api<DayBootstrap>(`${prefix}/day-bootstrap`);
    if (remote.publishedRevision !== result.revision) throw new Error("ORGANIZER_DAY_POST_PUBLISH_REVISION_CHANGED");
    const next: OrganizerSession = { ...current, snapshot: remote.snapshot, baseSnapshot: remote.snapshot,
      pendingOps: [], dirty: false, updatedAt: Date.now(), publishedRevision: result.revision,
      finalizedAt: remote.finalizedAt, syncStatus: remote.syncStatus, syncError: remote.syncError };
    await persist(next);
    return { revision: result.revision, next };
  };
  const publish = async (withPublic: boolean) => {
    if (!session || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const published = await checkpoint(session);
      if (withPublic) {
        await api(`${prefix}/day-public`, { method: "PUT", body: JSON.stringify({ basePublishedRevision: published.revision }) });
      }
      setNotice(withPublic
        ? tr(locale,"Checkpoint respaldado y resultados publicados en la web.","Checkpoint backed up and public results published.")
        : tr(locale,"Checkpoint publicado y disponible para recuperar desde otra computadora.","Checkpoint published and recoverable from another computer."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ORGANIZER_DAY_PUBLISH_FAILED"); }
    finally { setBusy(false); busyRef.current = false; }
  };
  const recover = async () => {
    if (!window.confirm(tr(locale,"Se descartarán los resultados LOCALES no publicados para cargar el último checkpoint. ¿Continuar?","Discard unpublished LOCAL results and load the latest checkpoint?"))) return;
    setBusy(true); setError("");
    try {
      const state = await api<DayState>(`${prefix}/day-state`);
      const remote = await api<DayBootstrap>(`${prefix}/day-bootstrap`);
      const next: OrganizerSession = { schemaVersion: 1, storageKey: `organizer:${state.userId}:${tournamentId}`,
        tournamentId, source: "organizer", dirty: false, updatedAt: Date.now(), publishedRevision: remote.publishedRevision,
        finalizedAt: remote.finalizedAt, syncStatus: remote.syncStatus, syncError: remote.syncError,
        snapshot: remote.snapshot, baseSnapshot: remote.snapshot, pendingOps: [] };
      await persist(next);
      setNotice(tr(locale,"Último checkpoint recuperado.","Latest checkpoint recovered."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ORGANIZER_DAY_RECOVER_FAILED"); }
    finally { setBusy(false); }
  };

  const snapshot = useMemo(() => session ? initializeReformSnapshot(structuredClone(session.snapshot) as TournamentDayReformSnapshot) : null, [session]);
  const categories = rows(snapshot?.workspace.core.categories);
  const standardEntries = rows(snapshot?.workspace.standard.entries);
  const standardMatches = rows(snapshot?.workspace.standard.matches);
  const standardStandings = rows(snapshot?.workspace.standard.standings);
  const teamCategories = rows(snapshot?.team.categories);
  const scheduled = rows(snapshot?.workspace.schedule.schedule).filter((r) => num(r.startAt) > 0).sort((a,b) => num(a.startAt) - num(b.startAt) || text(a.courtLabel).localeCompare(text(b.courtLabel)));
  const selectedCategories = categories.filter((c) => !categoryFilter || text(c.id) === categoryFilter);
  const searchMatch = (value: unknown) => text(value).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of scheduled) { const key = localDayKey(num(r.startAt)); const list = map.get(key) ?? []; list.push(r); map.set(key,list); }
    return [...map.entries()];
  }, [snapshot]);

  if (busy) return <section className="panel"><p>{tr(locale,"Comprobando acceso y recuperando jornada local…","Checking access and recovering local event…")}</p></section>;
  if (error && !session) return <section className="panel"><p role="alert" className="h3-error">{error === "FORBIDDEN" ? tr(locale,"No tenés permiso para operar esta jornada.","You don't have day permissions for this event.") : error}</p><p className="muted">{tr(locale,"No se muestra una copia local sin verificar el permiso de esta cuenta.","Cached data is not displayed without verifying this account's permission.")}</p><button className="ghost" onClick={() => setRefreshIndex((n)=>n+1)}>{tr(locale,"Reintentar","Retry")}</button>{error==="ORGANIZER_DAY_REMOTE_REVISION_CHANGED" && <button className="light" onClick={() => void recover()}>{tr(locale,"Descartar cambios locales y recuperar checkpoint nuevo","Discard local changes and recover new checkpoint")}</button>}</section>;
  if (empty) return <section className="panel"><h3>{tr(locale,"Aún no hay checkpoint","No checkpoint published yet")}</h3><p>{tr(locale,"El administrador debe publicar el primer checkpoint desde Tournament Day para habilitar la consulta deportiva local.","An administrator must publish the first Tournament Day checkpoint to enable local sporting views.")}</p><button className="ghost" onClick={() => setRefreshIndex((n)=>n+1)}>{tr(locale,"Volver a comprobar","Check again")}</button></section>;
  if (!snapshot || !session) return <section className="panel">{tr(locale,"Sin datos de jornada.","No event data.")}</section>;

  if (tvOnly) return <EpicTournamentDayTV snapshot={snapshot} locale={locale} />;

  const openTv = () => { const url = new URL(window.location.href); url.searchParams.set("view", "tv"); window.open(url.toString(), "_blank", "noopener,noreferrer"); };
  return <section className="organizer-day">
    <header className="organizer-day-header">
      <div><div className="eyebrow">TOURNAMENT DAY · LOCAL FIRST</div><h2>{tr(locale,"Operación deportiva","Sport operations")}</h2><p className="muted">{tr(locale,"Resultados locales, publicación manual y estructura solo lectura.","Local results, manual publishing and read-only structure.")}</p></div>
      <div className="organizer-day-header-actions"><span className="pill">{tr(locale,"Local · revisión","Local · revision")} {session.publishedRevision}</span><button className="ghost small" type="button" onClick={() => setRefreshIndex((n)=>n+1)}>{tr(locale,"Buscar checkpoint nuevo","Check for updates")}</button><button className="light small" type="button" onClick={openTv}>{tr(locale,"Abrir TV","Open TV")}</button></div>
    </header>
    {error && <p className="h3-error" role="alert">{error}</p>}
    {notice && <p className="notice-box" role="status">{notice}</p>}
    <div className="organizer-day-publish-actions">
      <span className="pill">{session.dirty ? tr(locale,"Cambios locales sin publicar","Local changes unpublished") : tr(locale,"Sin resultados locales pendientes","No pending local results")}</span>
      <button className="light small" disabled={busy} onClick={() => void publish(false)}>{tr(locale,"Publicar checkpoint","Publish checkpoint")}</button>
      <button className="light small" disabled={busy} onClick={() => void publish(true)}>{tr(locale,"Publicar resultados en la web","Publish public results")}</button>
      <button className="ghost small" disabled={busy} onClick={() => void recover()}>{tr(locale,"Recuperar último checkpoint","Recover last checkpoint")}</button>
    </div>
    <div className="admin-module-strip" role="tablist" aria-label={tr(locale,"Vistas deportivas","Sport views")}>
      {(["participants","groups","schedule","results","tv"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={tab===key} className={tab===key?"active":""} onClick={() => setTab(key)}>{key==="participants"?tr(locale,"Participantes","Participants"):key==="groups"?tr(locale,"Grupos y cuadros","Groups & brackets"):key==="schedule"?tr(locale,"Cronograma","Schedule"):key==="results"?tr(locale,"Resultados","Results"):"TV"}</button>)}
    </div>
    {tab === "participants" && <div className="organizer-day-stack">
      <div className="organizer-day-tools"><label>{tr(locale,"Buscar nombre","Search name")}<input type="search" value={search} onChange={(e)=>setSearch(e.target.value)}/></label><label>{tr(locale,"Categoría","Category")}<select value={categoryFilter} onChange={(e)=>setCategoryFilter(e.target.value)}><option value="">{tr(locale,"Todas","All")}</option>{categories.map((c)=><option key={text(c.id)} value={text(c.id)}>{text(c.name)}</option>)}</select></label></div>
      {selectedCategories.map((cat) => { const entries = standardEntries.filter((e)=>text(e.categoryId)===text(cat.id) && searchMatch(e.displayName ?? e.members)); const team = teamCategories.find((t)=>text(t.id)===text(cat.id) || text(t.categoryId)===text(cat.id)); const teams = rows(team?.entries ?? team?.teams).filter((e)=>searchMatch(e.displayName ?? e.name)); return <article className="panel" key={text(cat.id)}><div className="panel-title"><h3>{text(cat.name)}</h3><span>{entries.length + teams.length}</span></div><div className="organizer-day-entry-list">{entries.map((e)=><div key={text(e.id)}><strong>{text(e.displayName, text(e.members))}</strong>{e.members && e.members !== e.displayName && <small>{text(e.members)}</small>}</div>)}{teams.map((e)=><div key={text(e.id)}><strong>{text(e.displayName ?? e.name)}</strong></div>)}{!entries.length && !teams.length && <p className="muted">{tr(locale,"Sin entradas registradas para este filtro.","No entries for this filter.")}</p>}</div></article>; })}
    </div>}
    {tab === "groups" && <div className="organizer-day-stack">
      {categories.map((cat) => { const standing = standardStandings.filter((r)=>text(r.categoryId)===text(cat.id)); const matches = standardMatches.filter((m)=>text(m.categoryId)===text(cat.id) && text(m.stage)!=="group"); const team = teamCategories.find((t)=>text(t.categoryId ?? t.id)===text(cat.id)); const teamStandings=rows(team?.standings); const teamMatches=rows(team?.encounters).filter((m)=>text(m.stage)!=="group"); return <article className="panel" key={text(cat.id)}><h3>{text(cat.name)}</h3>
        {!standing.length && !matches.length && !teamStandings.length && !teamMatches.length && <p className="muted">{tr(locale,"Aún no hay grupos ni cuadros generados.","No groups or brackets yet.")}</p>}
        <div className="organizer-day-standing-grid">{[...standing,...teamStandings].map((s,index)=><div className="organizer-day-standing" key={text(s.groupId,index.toString())+":"+index}><h4>{text(s.groupName,"Grupo")}</h4><div className="organizer-day-standing-head"><span>#</span><span>{tr(locale,"Jugador / pareja","Player / pair")}</span><span>PG</span><span>PP</span><span>Dif</span></div>{rows(s.rows).map((r,j)=><div className="organizer-day-standing-row" key={text(r.entryId ?? r.id,j.toString())}><span>{num(r.position)||j+1}</span><span>{text(r.name ?? r.entryName)}</span><span>{num(r.wins)}</span><span>{num(r.losses)}</span><span>{num(r.diff ?? r.pointDiff)}</span></div>)}</div>)}</div>
        {!!(matches.length+teamMatches.length) && <div className="organizer-day-bracket"><h4>{tr(locale,"Fase final","Final stage")}</h4>{[...matches,...teamMatches].map((m,i)=><div key={text(m.matchId ?? m.encounterId ?? m.id,i.toString())}><small>{text(m.roundLabel ?? m.stage)} · {text(m.status)}</small><strong>{text(m.sideA)} {m.scoreA!==undefined&&m.scoreA!==null?text(m.scoreA):""} — {m.scoreB!==undefined&&m.scoreB!==null?text(m.scoreB):""} {text(m.sideB)}</strong></div>)}</div>}
      </article>; })}
    </div>}
    {tab === "schedule" && <div className="organizer-day-stack">
      <div className="organizer-day-tools"><h3>{tr(locale,"Cronograma por cancha y hora","Court-by-time schedule")}</h3><div className="td-segmented"><button type="button" className={mode==="grid"?"active":""} onClick={()=>setMode("grid")}>{tr(locale,"Grilla","Grid")}</button><button type="button" className={mode==="list"?"active":""} onClick={()=>setMode("list")}>{tr(locale,"Por horario","By time")}</button></div></div>
      {!scheduled.length && <article className="panel"><p>{tr(locale,"Todavía no se publicó un cronograma.","No schedule has been published yet.")}</p></article>}
      {byDay.map(([day, dayRows]) => { const courts = [...new Set(dayRows.map((r)=>text(r.courtLabel)).filter(Boolean))].sort((a,b)=>{ const na=Number(a.match(/\d+/)?.[0]??0),nb=Number(b.match(/\d+/)?.[0]??0); return na-nb||a.localeCompare(b); }); const times=[...new Set(dayRows.map((r)=>num(r.startAt)))].sort((a,b)=>a-b);return <article className="panel" key={day}><h3>{new Date(`${day}T12:00:00`).toLocaleDateString(locale==="es"?"es-UY":"en-US",{weekday:"long",day:"numeric",month:"long"})}</h3>
        {mode==="grid" && <div className="organizer-day-grid"><div className="organizer-day-grid-row" style={{gridTemplateColumns:`70px repeat(${courts.length}, minmax(0, 1fr))`}}><b>{tr(locale,"Hora","Time")}</b>{courts.map((c)=><b key={c}>{c}</b>)}</div>{times.map((time)=><div className="organizer-day-grid-row" key={time} style={{gridTemplateColumns:`70px repeat(${courts.length}, minmax(0, 1fr))`}}><time>{hour(time,locale)}</time>{courts.map((court)=><div className="organizer-day-grid-cell" key={court}>{dayRows.filter((r)=>num(r.startAt)===time&&text(r.courtLabel)===court).map((r,i)=><div className="organizer-day-match" key={text(r.id,i.toString())}><strong>{text(r.sideA, text(r.roundLabel ?? r.categoryName))} {r.sideB?` vs ${text(r.sideB)}`:""}</strong><small>{text(r.categoryName)} · {text(r.roundLabel)} · {text(r.status)}</small></div>)}</div>)}</div>)}</div>}
        <div className={mode==="grid"?"organizer-day-mobile-list":"organizer-day-list"}>{dayRows.map((r,i)=><div className="organizer-day-list-row" key={text(r.id,i.toString())}><time>{hour(num(r.startAt),locale)} · {text(r.courtLabel)}</time><strong>{text(r.sideA,text(r.roundLabel ?? r.categoryName))} {r.sideB?` vs ${text(r.sideB)}`:""}</strong><small>{text(r.categoryName)} · {text(r.roundLabel)}</small></div>)}</div>
      </article>; })}
    </div>}
    {tab === "results" && <div className="organizer-day-stack">
      <article className="panel"><h3>{tr(locale,"Carga local de resultados","Local result entry")}</h3><p className="muted">{tr(locale,"Los marcadores se guardan en este navegador. Para compartirlos, publicá checkpoint; para mostrarlos a jugadores, publicá resultados.","Scores stay in this browser. Publish checkpoint to share them; publish results to update the public page.")}</p></article>
      <IntegralResultsPanel locale={locale} snapshot={snapshot}
        renderStandard={(match) => <OrganizerStandardForm key={text(match.matchId ?? match.encounterId)} match={match} locale={locale} disabled={busy} onSave={submitResult} />}
        renderTeamRubber={(category, encounter, match) => <OrganizerTeamForm key={text(match.id)} category={category} encounter={encounter} match={match} locale={locale} disabled={busy} onSave={submitResult} />}
      />
    </div>}
    {tab === "tv" && <EpicTournamentDayTV snapshot={snapshot} locale={locale} embedded />}
    <p className="muted organizer-day-footer">{tr(locale,"Checkpoint compartido","Shared checkpoint")}: {session.publishedRevision} · {tr(locale,"Guardado en este navegador","Saved in this browser")}: {new Date(session.updatedAt).toLocaleString(locale==="es"?"es-UY":"en-US")}. {tr(locale,"Los resultados se guardan localmente. La estructura no se puede editar.","Results are local until published. Structure cannot be edited.")}</p>
  </section>;
}

function scoreInput(form: FormData, prefix: string, number: number): Array<{ scoreA: number; scoreB: number }> {
  const list: Array<{ scoreA: number; scoreB: number }> = [];
  for (let i = 0; i < number; i++) {
    const a = String(form.get(`${prefix}-a-${i}`) ?? "");
    const b = String(form.get(`${prefix}-b-${i}`) ?? "");
    if (a === "" && b === "") continue;
    if (a === "" || b === "") throw new Error("RESULT_INCOMPLETE_SET");
    const scoreA = Number(a); const scoreB = Number(b);
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0 || scoreA === scoreB) throw new Error("RESULT_INVALID_SET");
    list.push({ scoreA, scoreB });
  }
  if (!list.length) throw new Error("RESULT_MISSING_SETS");
  return list;
}
function OrganizerScoreFields({ bestOf, sets, single }: { bestOf: number; sets?: any[]; single?: { scoreA: number | null; scoreB: number | null } }) {
  const count = bestOf === 3 ? 3 : 1;
  return <div className="organizer-day-score-fields">{Array.from({length: count}, (_,i) => {
    const set = sets?.[i] ?? (i===0 && single ? single : null);
    return <label key={i}>Set {i+1}<input aria-label={`A ${i+1}`} name={`score-a-${i}`} type="number" min="0" max="999" defaultValue={set?.scoreA ?? ""} /><span>—</span><input aria-label={`B ${i+1}`} name={`score-b-${i}`} type="number" min="0" max="999" defaultValue={set?.scoreB ?? ""} /></label>;
  })}</div>;
}
function OrganizerStandardForm({ match, locale, disabled, onSave }: { match: any; locale: Locale; disabled: boolean; onSave: (op: OrganizerResultOperation) => Promise<void> }) {
  const [error, setError] = useState("");
  const bestOf = Number(match.bestOf) === 3 ? 3 : 1;
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    try {
      const sets = scoreInput(new FormData(event.currentTarget),"score",bestOf);
      const result = bestOf === 3 ? { sets } : sets.length === 1 ? { scoreA: sets[0]!.scoreA, scoreB: sets[0]!.scoreB } : null;
      if (!result) throw new Error("RESULT_INVALID_SET");
      void onSave({ kind:"standard", categoryId: String(match.categoryId), encounterId: String(match.encounterId), result });
    } catch (e) { setError(e instanceof Error ? e.message : "RESULT_INVALID_SET"); }
  };
  return <form className="panel organizer-day-result-form" onSubmit={save}>
    <div><small>{text(match.categoryName)} · {text(match.roundLabel ?? match.stage)} · {text(match.courtLabel)} · {match.scheduleStart ? hour(num(match.scheduleStart),locale) : "—"}</small><strong>{text(match.sideA)} <em>vs</em> {text(match.sideB)}</strong></div>
    <OrganizerScoreFields key={`${text(match.encounterId)}:${text(match.scoreA)}:${text(match.scoreB)}:${JSON.stringify(rows(match.sets))}`} bestOf={bestOf} {...(bestOf === 3 ? { sets: rows(match.sets) } : { single: { scoreA: match.scoreA ?? null, scoreB: match.scoreB ?? null } })}/>
    {error && <p className="h3-error">{error}</p>}
    <button disabled={disabled} className="light small">{match.status==="finished"?tr(locale,"Corregir local","Correct locally"):tr(locale,"Guardar local","Save locally")}</button>
  </form>;
}
function OrganizerTeamForm({ category, encounter, match, locale, disabled, onSave }: { category:any; encounter:any; match:any; locale:Locale; disabled:boolean; onSave:(op:OrganizerResultOperation)=>Promise<void> }) {
  const [error,setError]=useState("");
  const bestOf=Number(match.bestOf)===3?3:1;
  const locked = new Set(rows(encounter.lineups).filter((row)=>row.status==="locked").map((row)=>text(row.entryId)));
  const ready = locked.has(text(encounter.entryAId)) && locked.has(text(encounter.entryBId)) && !["pending","skipped"].includes(text(match.status));
  const save=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();setError("");
    try { const sets=scoreInput(new FormData(event.currentTarget),"score",bestOf);
      void onSave({kind:"team",categoryId:text(category.id),encounterId:text(encounter.id),matchId:text(match.id),sets});
    } catch(e){setError(e instanceof Error?e.message:"RESULT_INVALID_SET");}
  };
  return <form className="panel organizer-day-result-form" onSubmit={save}>
    <div><small>{text(category.name)} · {text(encounter.roundLabel ?? encounter.stage)} · {text(match.rubberKey)}</small><strong>{text(encounter.sideA)} <em>vs</em> {text(encounter.sideB)}</strong></div>
    <OrganizerScoreFields key={`${text(match.id)}:${text(match.scoreA)}:${text(match.scoreB)}:${JSON.stringify(rows(match.sets))}`} bestOf={bestOf} sets={rows(match.sets)}/>
    {error && <p className="h3-error">{error}</p>}
    <button disabled={disabled || !ready} className="light small">{match.resultStatus?tr(locale,"Corregir local","Correct locally"):tr(locale,"Guardar local","Save locally")}</button>
    {!ready && <small className="muted">{tr(locale,"Las alineaciones deben estar bloqueadas por el administrador.","Lineups must be locked by the administrator.")}</small>}
  </form>;
}
