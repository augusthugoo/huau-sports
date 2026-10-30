
/* HUAU_TOURNAMENT_LIVE_V4_20261029 — public, read-only. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import type { Locale } from "./i18n";
import { PlayerPublicHeader } from "./PlayerPublicChrome";
import "./TournamentLivePage.css";

type Go = (path: string) => void;
type View = "overview" | "schedule" | "groups" | "results";
type Bundle = { ok: true; manifest: any; structure: any; live: any | null };
type MatchBlock = { id: string; first: any; rows: any[]; startAt: number; endAt: number; team: boolean };
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
const asList = (value: any): any[] => Array.isArray(value) ? value : [];
const toMs = (value: number) => value < 10_000_000_000 ? value * 1000 : value;
const localeCode = (locale: Locale) => locale === "es" ? "es-UY" : "en-US";
const localDate = (time: number, locale: Locale) => new Intl.DateTimeFormat(localeCode(locale), { weekday: "short", day: "numeric", month: "short" }).format(new Date(toMs(time)));
const localTime = (time: number, locale: Locale) => new Intl.DateTimeFormat(localeCode(locale), { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(toMs(time)));
const dateKey = (time: number) => { const d = new Date(toMs(time)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const text = (value: unknown, fallback = "—") => value == null || String(value).trim() === "" ? fallback : String(value);
const number = (value: any) => value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : String(value);
const count = (value: any) => Number.isFinite(Number(value)) ? Number(value) : 0;
const same = (a: any, b: any) => String(a ?? "") === String(b ?? "");

function blockSchedule(rows: any[]): MatchBlock[] {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const team = String(row.kind ?? "") === "team" || Boolean(row.rubberKey || row.rubberCode);
    // Each ordinary match is independent; team rubbers are displayed as one encounter.
    const id = team ? String(row.scheduleUnitId || `team:${row.categoryId}:${row.encounterId || row.id}`) : String(row.scheduleUnitId || row.id);
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return [...groups.entries()].map(([id, raw]) => {
    const ordered = [...raw].sort((a,b) => count(a.rubberOrder) - count(b.rubberOrder) || count(a.startAt) - count(b.startAt));
    const chrono = [...raw].sort((a,b) => count(a.startAt) - count(b.startAt));
    return { id, first: chrono[0], rows: ordered, startAt: Math.min(...raw.map(x => count(x.startAt))), endAt: Math.max(...raw.map(x => count(x.endAt))), team: raw.some(x => String(x.kind) === "team" || x.rubberKey || x.rubberCode) };
  }).sort((a,b) => a.startAt-b.startAt || String(a.first?.court ?? "").localeCompare(String(b.first?.court ?? "")));
}

function teamGroupRows(team: any) {
  const groups = new Map<string, { id: string; name: string; entries: any[] }>();
  for (const row of asList(team?.groups)) {
    const id = String(row.id);
    const group = groups.get(id) ?? { id, name: String(row.name ?? id), entries: [] };
    if (!group.entries.some(x => same(x.id, row.entryId))) group.entries.push({ id: String(row.entryId), name: String(row.entryName ?? "") });
    groups.set(id, group);
  }
  return [...groups.values()];
}
function formatName(category: any, data: any, locale: Locale) {
  const format = data?.format;
  if (!format) return "";
  if (category.entryType === "team") return tr(locale, "Encuentros por equipos", "Team encounters");
  const modes: Record<string,string> = {
    standard: tr(locale,"Fase de grupos y eliminación","Groups and knockout"),
    top2_final: tr(locale,"Top 2 · final","Top 2 · final"),
    top4_semis: tr(locale,"Top 4 · semifinales","Top 4 · semifinals"),
    top3_step: tr(locale,"Escalera Top 3","Top 3 ladder"),
    league_only: tr(locale,"Liga","League"),
  };
  return modes[String(format.playoffMode ?? "standard")] ?? "";
}
function resultPhase(locale: Locale, row: any) {
  return row.groupName ? `${tr(locale,"Grupo","Group")} ${row.groupName}` : text(row.roundLabel ?? row.stage, tr(locale,"Fase final","Final stage"));
}
async function getBundle(slug: string): Promise<Bundle> {
  const response = await fetch(`/api/public/tournaments/${encodeURIComponent(slug)}/day-live`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return await response.json() as Bundle;
}
function scoreParts(result: any): string {
  if (result?.scoreA != null && result?.scoreB != null) return `${result.scoreA} – ${result.scoreB}`;
  return "—";
}
function scoreSets(result: any) {
  return asList(result?.sets).filter(set => set && set.scoreA != null && set.scoreB != null).map((set:any) => `${set.scoreA}-${set.scoreB}`);
}
function ScheduleRow({ block, locale }: { block: MatchBlock; locale: Locale }) {
  const first = block.first;
  const label = first.sideA && first.sideB ? `${first.sideA}  vs  ${first.sideB}` : text(first.sideA ?? first.roundLabel ?? first.categoryName);
  return <div className="tl4-schedule-row">
    <div className="tl4-time"><strong>{localTime(block.startAt,locale)}</strong><span>{text(first.court)}</span></div>
    <div className="tl4-schedule-main"><strong>{label}</strong><span>{text(first.categoryName)}{first.groupName ? ` · ${tr(locale,"Grupo","Group")} ${first.groupName}` : first.roundLabel ? ` · ${first.roundLabel}` : ""}</span>
      {block.team && block.rows.length > 1 ? <small>{block.rows.length} {tr(locale,"partidos del encuentro","matches in encounter")}</small> : null}
    </div>
    <span className={`tl4-status ${String(first.status ?? "")}`}>{String(first.status) === "completed" ? tr(locale,"Finalizado","Final") : String(first.status) === "cancelled" ? tr(locale,"Cancelado","Cancelled") : ""}</span>
  </div>;
}
function TeamScore({result,locale}:{result:any;locale:Locale}) {
  let a=0,b=0;
  for (const r of asList(result.rubbers)) {
    if (!r.winnerSide || r.status === "skipped") continue;
    const points = Number(r.weight ?? 1);
    if (r.winnerSide === "A") a+=points; else if (r.winnerSide === "B") b+=points;
  }
  return <details className="tl4-team-result"><summary><span className="tl4-score-sides"><strong>{text(result.sideA)}</strong><b>{a} – {b}</b><strong>{text(result.sideB)}</strong></span><small>{tr(locale,"Ver partidos del encuentro","View encounter matches")}</small></summary>
    <div className="tl4-team-rubbers">{asList(result.rubbers).sort((x:any,y:any) => count(x.order)-count(y.order)).map((r:any,i:number) => <div key={String(r.id ?? i)}><span>{text(r.label ?? r.key)}</span><span>{asList(r.lineupA).join(" / ") || "—"} · {asList(r.lineupB).join(" / ") || "—"}</span><strong>{r.status === "skipped" ? tr(locale,"No jugado","Not played") : scoreParts(r)}</strong></div>)}</div>
  </details>;
}
function ResultRow({result,locale,team=false}:{result:any;locale:Locale;team?:boolean}) {
  return <div className="tl4-result-row">
    <div className="tl4-result-top"><span>{resultPhase(locale,result)}</span><small>{result.status === "in_progress" ? tr(locale,"En juego","In progress") : ""}</small></div>
    {team ? <TeamScore result={result} locale={locale}/> : <div className="tl4-score-sides"><strong>{text(result.sideA)}</strong><b>{scoreParts(result)}</b><strong>{text(result.sideB)}</strong></div>}
    {!team && scoreSets(result).length > 0 ? <div className="tl4-set-line">{scoreSets(result).map((s,i)=><span key={`${s}-${i}`}>{s}</span>)}</div> : null}
  </div>;
}

type GroupRecord = { categoryId: string; groupId: string; groupName: string; rows: any[] };
function GroupTable({ group, record, locale }: { group: any; record?: GroupRecord; locale: Locale }) {
  const rows = asList(record?.rows);
  const entries = asList(group.entries);
  const records = rows.length ? rows : entries.map((entry:any,i:number)=>({ entryId: entry.id, name: entry.name, position: i+1 }));
  const hasStandings = rows.length > 0;
  return <div className="tl4-group"><div className="tl4-group-header"><strong>{tr(locale,"Grupo","Group")} {text(group.name)}</strong><span>{entries.length || records.length} {tr(locale,"participantes","entries")}</span></div>
    <div className="tl4-table-scroll"><table className="tl4-table"><thead><tr><th title={tr(locale,"Posición","Position")}>#</th><th>{tr(locale,"Jugador / pareja / equipo","Player / pair / team")}</th><th title={tr(locale,"Partidos jugados","Played")}>PJ</th><th title={tr(locale,"Ganados","Won")}>G</th><th title={tr(locale,"Perdidos","Lost")}>P</th><th title={tr(locale,"Puntos a favor","Points for")}>PF</th><th title={tr(locale,"Puntos en contra","Points against")}>PC</th><th title={tr(locale,"Diferencia","Difference")}>+/-</th></tr></thead>
    <tbody>{records.map((r:any,i:number)=>{
      // Respect official published order and statistics. No invented standings or scores.
      const pf = r.scored ?? r.pointsFor ?? r.pointsScored;
      const pc = r.conceded ?? r.pointsAgainst ?? r.pointsConceded;
      const diff = r.diff ?? (pf != null && pc != null ? Number(pf)-Number(pc) : null);
      return <tr key={String(r.entryId ?? i)}><td>{hasStandings ? number(r.position ?? i+1) : "—"}</td><td className="tl4-entry-name">{text(r.name ?? r.entryName ?? entries.find((e:any)=>same(e.id,r.entryId))?.name)}</td><td>{number(r.played ?? r.matchesPlayed)}</td><td>{number(r.wins ?? r.won)}</td><td>{number(r.losses ?? r.lost)}</td><td>{number(pf)}</td><td>{number(pc)}</td><td>{number(diff)}</td></tr>;
    })}</tbody></table></div>
    {!hasStandings ? <p className="tl4-hint">{tr(locale,"Posiciones y estadísticas pendientes de publicación.","Standings and statistics have not been published yet.")}</p> : null}
  </div>;
}

function phaseRank(label: string): number {
  const s=label.toLowerCase();
  if (/round.of.32|dieciseis|16avos|1\/16/.test(s)) return 10;
  if (/round.of.16|octavos|1\/8/.test(s)) return 20;
  if (/quarter|cuarto|1\/4/.test(s)) return 30;
  if (/semifinal|semi.final/.test(s)) return 40;
  if (/third|tercer|bronze/.test(s)) return 45;
  if (/final/.test(s)) return 50;
  return 25;
}
function BracketBoard({category,rows,standardResults,teamResults,locale}:{category:any;rows:any[];standardResults:any[];teamResults:any[];locale:Locale}) {
  const rounds=new Map<string,any[]>();
  for(const row of rows){const label=text(row.roundLabel ?? row.stage,tr(locale,"Ronda","Round"));rounds.set(label,[...(rounds.get(label)??[]),row]);}
  const phases=[...rounds.entries()].sort((a,b)=>phaseRank(a[0])-phaseRank(b[0]));
  if(!phases.length)return <p className="tl4-hint">{tr(locale,"El cuadro final todavía no está publicado.","The final bracket has not been published yet.")}</p>;
  const resultRows=[...standardResults,...teamResults];
  return <div className="tl4-bracket-scroll" tabIndex={0} aria-label={tr(locale,"Cuadro final; desplazamiento horizontal","Final bracket; horizontal scrolling")}><div className="tl4-bracket-board">{phases.map(([label,matches],phaseIndex)=><div className="tl4-bracket-round" key={label}><h4>{label}</h4><div className="tl4-bracket-matches">{matches.map((row:any,i:number)=>{
    const result=resultRows.find(r=>same(r.categoryId,category.id) && (same(r.encounterId,row.id) || same(r.id,row.id)));
    const score=result ? (result.rubbers ? (()=>{let a=0,b=0;for(const x of asList(result.rubbers)){if(!x.winnerSide||x.status==="skipped")continue; if(x.winnerSide==="A")a+=count(x.weight??1);else if(x.winnerSide==="B")b+=count(x.weight??1);}return `${a}–${b}`;})() : scoreParts(result)) : "";
    return <div className="tl4-bracket-match" key={String(row.id??i)}><div className="tl4-bracket-side"><span>{text(row.sideA, tr(locale,"Por definir","TBD"))}</span></div><div className="tl4-bracket-side"><span>{text(row.sideB, row.status==="bye"?"BYE":tr(locale,"Por definir","TBD"))}</span></div>{score ? <small>{score}</small> : null}</div>;
  })}</div>{phaseIndex < phases.length-1 ? <span className="tl4-bracket-link" aria-hidden="true"/>:null}</div>)}</div></div>;
}

export function TournamentLivePage({ slug, locale, go, authenticated = false, onSignOut }: { slug: string; locale: Locale; go: Go; authenticated?: boolean; onSignOut?: (() => void | Promise<void>) | undefined }) {
  const [data,setData]=useState<Bundle|null>(null);
  const [error,setError]=useState("");
  const [view,setView]=useState<View|null>(null);
  const [categoryId,setCategoryId]=useState("");
  const [teamId,setTeamId]=useState("");
  const [player,setPlayer]=useState("");
  const [court,setCourt]=useState("");
  const [activeDay,setActiveDay]=useState("");
  const [showAllSchedule,setShowAllSchedule]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let active=true;
    const load=()=>{void getBundle(slug).then(payload=>{if(active){setData(payload);setError("");}}).catch(e=>{if(active)setError(e instanceof Error?e.message:"LIVE_LOAD_FAILED");});};
    load();const timer=window.setInterval(load,15000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[slug,refresh]);
  useEffect(()=>{setShowAllSchedule(false);},[categoryId,teamId,player,court,activeDay]);

  const structure=data?.structure;
  const live=data?.live;
  const categories=asList(structure?.categories);
  const teams=asList(structure?.teams);
  const standardResults=asList(live?.results?.standard);
  const teamResults=asList(live?.results?.team).filter(x=>x.status==="finished"||x.status==="in_progress"||asList(x.rubbers).some(r=>r.winnerSide||r.status==="finished"));
  const scheduleSource=asList(live?.schedule ?? structure?.schedule);
  const standardByCategory = useMemo(()=>new Map<string,any>(asList(structure?.standard).map((s:any)=>[String(s.categoryId),s] as const)),[structure]);
  const teamByCategory = useMemo(()=>new Map<string,any>(asList(structure?.team).map((s:any)=>[String(s.categoryId),s] as const)),[structure]);
  const filteredSchedule=useMemo(()=>{
    const needle=player.trim().toLowerCase();
    const matchingTeams=new Set(teams.filter(t=>asList(t.roster).some((m:any)=>String(m.name??"").toLowerCase().includes(needle))).map(t=>String(t.id)));
    return scheduleSource.filter(row=>{
      if(categoryId&&!same(row.categoryId,categoryId))return false;
      if(teamId&&![row.entryAId,row.entryBId].some(id=>same(id,teamId)))return false;
      if(court&&String(row.court??"").match(/\d+/)?.[0]!==court)return false;
      if(needle&&!`${row.sideA??""} ${row.sideB??""} ${row.categoryName??""}`.toLowerCase().includes(needle)&&![row.entryAId,row.entryBId].some(id=>matchingTeams.has(String(id))))return false;
      return true;
    });
  },[scheduleSource,categoryId,teamId,player,court,teams]);
  const scheduleBlocks=useMemo(()=>blockSchedule(filteredSchedule),[filteredSchedule]);
  const scheduleDays=useMemo(()=>{
    const days=new Map<string,MatchBlock[]>();
    for(const b of scheduleBlocks){const key=dateKey(b.startAt);days.set(key,[...(days.get(key)??[]),b]);}
    return [...days.entries()];
  },[scheduleBlocks]);
  const selectedDay=scheduleDays.some(([day])=>day===activeDay)?activeDay:scheduleDays[0]?.[0]??"";
  const dayBlocks=scheduleDays.find(([day])=>day===selectedDay)?.[1]??[];
  const visibleDayBlocks=showAllSchedule?dayBlocks:dayBlocks.slice(0,16);
  const filteredCategories=categoryId?categories.filter(c=>same(c.id,categoryId)):categories;
  const filteredResults=standardResults.filter(r=>!categoryId||same(r.categoryId,categoryId));
  const filteredTeamResults=teamResults.filter(r=>!categoryId||same(r.categoryId,categoryId));
  const filteredBrackets=[...asList(live?.bracket?.standard),...asList(live?.bracket?.team)].filter(r=>!categoryId||same(r.categoryId,categoryId));
  const filteredStandings=[...asList(live?.standings?.standard),...asList(live?.standings?.team)];
  const totalPublished=standardResults.length+teamResults.length;
  const defaultView:View=data?.manifest?.status==="finished"?"results":data?.manifest?.status==="scheduled"?"schedule":"overview";
  const activeView=view??defaultView;
  const courts=[...new Set(scheduleSource.map(row=>String(row.court??"").match(/\d+/)?.[0]).filter(Boolean))];
  const unfinished=scheduleBlocks.filter(b=>!b.rows.every(r=>["finished","completed","cancelled"].includes(String(r.status??""))));
  const current=unfinished.filter(b=>b.startAt<=Date.now()/1000).slice(0,3);
  const upcoming=unfinished.filter(b=>b.startAt>Date.now()/1000).slice(0,4);
  const status=String(data?.manifest?.status??"scheduled");
  const hero=String(structure?.tournament?.heroImageUrl??"");
  const title=text(structure?.tournament?.name,tr(locale,"Torneo","Tournament"));
  const updatedAt=count(live?.generatedAt??structure?.generatedAt??data?.manifest?.updatedAt);

  return <main className="tl4-page"><PlayerPublicHeader locale={locale} go={go} authenticated={authenticated} onSignOut={onSignOut}/>
    {!data ? <div className="tl4-loading">{error ? <><p>{tr(locale,"No se pudo cargar el torneo.","Could not load the tournament.")} ({error})</p><button onClick={()=>setRefresh(n=>n+1)}>{tr(locale,"Reintentar","Retry")}</button></> : tr(locale,"Cargando torneo…","Loading tournament…")}</div> : <>
    <section className={`tl4-hero ${hero?"has-cover":""}`} style={hero?{backgroundImage:`linear-gradient(90deg,rgba(3,3,3,.85),rgba(3,3,3,.40)),url("${hero}")`}:undefined}>
      <div className="tl4-hero-inner"><span className={`tl4-eyebrow tl4-state-${status}`}>● {status==="finished"?tr(locale,"FINALIZADO","FINISHED"):status==="live"?tr(locale,"EN JUEGO","LIVE"):tr(locale,"PROGRAMADO","SCHEDULED")}</span><h1>{title}</h1><p>{localDate(count(structure.tournament.startAt),locale)} · {count(structure.tournament.courtCount)} {tr(locale,"canchas","courts")}{structure.tournament.venue?` · ${structure.tournament.venue}`:""}</p></div>
    </section>
    <nav className="tl4-nav" aria-label={tr(locale,"Navegación del torneo","Tournament navigation")}>{(["overview","schedule","groups","results"] as View[]).map(key=><button type="button" key={key} aria-current={activeView===key?"page":undefined} className={activeView===key?"is-active":""} onClick={()=>setView(key)}>{key==="overview"?tr(locale,"Resumen","Overview"):key==="schedule"?tr(locale,"Cronograma","Schedule"):key==="groups"?tr(locale,"Grupos","Groups"):tr(locale,"Resultados","Results")}</button>)}</nav>
    {error ? <div className="tl4-warning">{tr(locale,"La actualización falló; se muestran los últimos datos disponibles.","Refresh failed; showing the last available data.")} ({error})</div> : null}
    <div className="tl4-shell">
    <header className="tl4-section-head"><div><span className="tl4-kicker">HUAU · TOURNAMENT LIVE</span><h2>{activeView==="overview"?tr(locale,"El torneo, de un vistazo.","The tournament at a glance."):activeView==="schedule"?tr(locale,"Cronograma.","Schedule."):activeView==="groups"?tr(locale,"Grupos y posiciones.","Groups and standings."):tr(locale,"Resultados y cuadros.","Results and brackets.")}</h2></div>{updatedAt>0?<span className="tl4-updated">{tr(locale,"Actualizado","Updated")}: {localTime(updatedAt,locale)}</span>:null}</header>
    {activeView!=="overview"?<section className="tl4-filters" aria-label={tr(locale,"Filtrar contenido","Filter content")}><label><span>{tr(locale,"Categoría","Category")}</span><select value={categoryId} onChange={(e:any)=>setCategoryId(e.target.value)}><option value="">{tr(locale,"Todas las categorías","All categories")}</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{activeView==="schedule"?<><label><span>{tr(locale,"Jugador o pareja","Player or pair")}</span><input value={player} onChange={(e:any)=>setPlayer(e.target.value)} placeholder={tr(locale,"Buscar nombre…","Search name…")}/></label>{teams.length?<label><span>{tr(locale,"Equipo","Team")}</span><select value={teamId} onChange={(e:any)=>setTeamId(e.target.value)}><option value="">{tr(locale,"Todos los equipos","All teams")}</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>:null}<label><span>{tr(locale,"Cancha","Court")}</span><select value={court} onChange={(e:any)=>setCourt(e.target.value)}><option value="">{tr(locale,"Todas las canchas","All courts")}</option>{courts.map(c=><option key={c} value={c}>{tr(locale,"Cancha","Court")} {c}</option>)}</select></label></>:null}</section>:null}
    {activeView==="overview"?<div className="tl4-overview">
      <div className="tl4-overview-stats"><div><strong>{categories.length}</strong><span>{tr(locale,"Categorías","Categories")}</span></div><div><strong>{blockSchedule(scheduleSource).length}</strong><span>{tr(locale,"Enfrentamientos programados","Scheduled encounters")}</span></div><div><strong>{totalPublished}</strong><span>{tr(locale,"Resultados publicados","Published results")}</span></div></div>
      <div className="tl4-two-col"><section className="tl4-panel"><header><h3>{tr(locale,"En curso o pendientes","In progress or pending")}</h3></header>{current.length?current.map(b=><ScheduleRow block={b} locale={locale} key={b.id}/>):<p className="tl4-hint">{tr(locale,"No hay partidos en curso.","No matches in progress.")}</p>}</section><section className="tl4-panel"><header><h3>{tr(locale,"Próximos partidos","Upcoming matches")}</h3><button type="button" className="tl4-text-action" onClick={()=>setView("schedule")}>{tr(locale,"Ver cronograma","View schedule")}</button></header>{upcoming.length?upcoming.map(b=><ScheduleRow block={b} locale={locale} key={b.id}/>):<p className="tl4-hint">{tr(locale,"No hay próximos partidos programados.","No upcoming matches scheduled.")}</p>}</section></div>
      <div className="tl4-quick-actions"><button type="button" onClick={()=>setView("groups")}>{tr(locale,"Ver posiciones por grupo","View group standings")} <span>↗</span></button><button type="button" onClick={()=>setView("results")}>{tr(locale,"Ver resultados y finales","View results and finals")} <span>↗</span></button></div>
    </div>:null}
    {activeView==="schedule"?<div className="tl4-panel tl4-schedule-panel"><div className="tl4-panel-title"><h3>{tr(locale,"Por jornada","By day")}</h3><span>{scheduleBlocks.length} {tr(locale,"enfrentamientos","encounters")}</span></div>{scheduleDays.length?<><div className="tl4-day-tabs" role="group" aria-label={tr(locale,"Seleccionar jornada","Select day")}>{scheduleDays.map(([day,blocks])=><button type="button" className={day===selectedDay?"is-active":""} key={day} onClick={()=>{setActiveDay(day);setShowAllSchedule(false);}}><strong>{blocks[0] ? localDate(blocks[0].startAt,locale) : day}</strong><small>{blocks.length} {tr(locale,"partidos","matches")}</small></button>)}</div><div className="tl4-schedule-list">{visibleDayBlocks.map((b,i)=><ScheduleRow block={b} locale={locale} key={`${b.id}-${i}`}/>)}</div>{dayBlocks.length>visibleDayBlocks.length?<button className="tl4-more" onClick={()=>setShowAllSchedule(true)}>{tr(locale,`Ver los ${dayBlocks.length-16} restantes`,`Show ${dayBlocks.length-16} more`)} ↓</button>:null}{showAllSchedule&&dayBlocks.length>16?<button className="tl4-more" onClick={()=>setShowAllSchedule(false)}>{tr(locale,"Mostrar menos","Show less")} ↑</button>:null}</>:<p className="tl4-hint">{tr(locale,"No hay enfrentamientos para estos filtros.","No matches for these filters.")}</p>}</div>:null}
    {activeView==="groups"?<div className="tl4-categories">{filteredCategories.map(category=>{
      const id=String(category.id);
      const team=teamByCategory.get(id);
      const standard=standardByCategory.get(id);
      const groups=team?teamGroupRows(team):asList(standard?.groups);
      if(!team&&!standard)return null;
      return <section className="tl4-panel tl4-category-panel" key={id}><header className="tl4-category-head"><div><span className="tl4-kicker">{category.entryType==="team"?tr(locale,"EQUIPOS","TEAMS"):tr(locale,"COMPETENCIA","COMPETITION")}</span><h3>{category.name}</h3><p>{formatName(category,team??standard,locale)}</p></div><span>{groups.length} {tr(locale,"grupos","groups")}</span></header><div className="tl4-groups-grid">{groups.map((g:any)=>{const record=filteredStandings.find((s:any)=>same(s.categoryId,id)&&same(s.groupId,g.id));return <GroupTable key={g.id} group={g} record={record} locale={locale}/>;})}</div>{!groups.length?<p className="tl4-hint">{tr(locale,"Grupos pendientes de publicación.","Groups not yet published.")}</p>:null}</section>;
    })}{!filteredCategories.length?<p className="tl4-hint">{tr(locale,"No se encontraron categorías.","No categories found.")}</p>:null}</div>:null}
    {activeView==="results"?<div className="tl4-results-page"><div className="tl4-overview-stats tl4-results-totals"><div><strong>{filteredResults.length+filteredTeamResults.length}</strong><span>{tr(locale,"Marcadores publicados","Published scores")}</span></div><div><strong>{new Set([...filteredResults,...filteredTeamResults].map(r=>String(r.categoryId))).size}</strong><span>{tr(locale,"Categorías con resultados","Categories with results")}</span></div></div>
      {!live?<div className="tl4-panel"><p className="tl4-hint">{tr(locale,"La dirección del torneo todavía no publicó resultados.","Tournament direction has not published results yet.")}</p></div>:<>
      {filteredCategories.map((category:any,categoryIndex:number)=>{const id=String(category.id);const standards=filteredResults.filter(r=>same(r.categoryId,id));const encounters=filteredTeamResults.filter(r=>same(r.categoryId,id));const br=filteredBrackets.filter(r=>same(r.categoryId,id));const all=[...standards.map(result=>({result,team:false})),...encounters.map(result=>({result,team:true}))];if(!all.length&&!br.length)return null;
        const phases=new Map<string,typeof all>();for(const item of all){const label=resultPhase(locale,item.result);phases.set(label,[...(phases.get(label)??[]),item]);}
        return <details className="tl4-panel tl4-results-category" key={id} open={categoryId===id || (!categoryId && categoryIndex===0) ? true : undefined}><summary><strong>{category.name}</strong><span>{all.length} {tr(locale,"resultados","results")}{br.length?` · ${br.length} ${tr(locale,"cruces finales","final-stage matches")}`:""}</span></summary>
          {br.length?<section className="tl4-bracket-section"><h3>{tr(locale,"Cuadro final","Final bracket")}</h3><BracketBoard category={category} rows={br} standardResults={standards} teamResults={encounters} locale={locale}/></section>:null}
          {phases.size?<section className="tl4-result-phases"><h3>{tr(locale,"Todos los partidos","All matches")}</h3>{[...phases.entries()].map(([label,items])=><details className="tl4-phase" key={label}><summary><strong>{label}</strong><span>{items.length} {tr(locale,"resultados","results")}</span></summary><div className="tl4-results-grid">{items.map((it:any,i:number)=><ResultRow key={String(it.result.encounterId??it.result.id??i)+String(i)} result={it.result} locale={locale} team={it.team}/>)}</div></details>)}</section>:null}
        </details>;
      })}
      {!filteredCategories.some((c:any)=>[...filteredResults,...filteredTeamResults,...filteredBrackets].some(r=>same(r.categoryId,c.id)))?<div className="tl4-panel"><p className="tl4-hint">{tr(locale,"Todavía no hay resultados publicados para este filtro.","No published results for this filter yet.")}</p></div>:null}
      </>}</div>:null}
    </div></>}
  </main>;
}
