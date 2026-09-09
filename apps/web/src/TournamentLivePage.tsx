/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import type { Locale } from "./i18n";
import "./TournamentLivePage.css";

type Go = (path: string) => void;
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
const toMs = (value: number) => value < 10_000_000_000 ? value * 1000 : value;
const dateTime = (value: number, locale: Locale) => new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(toMs(value)));
const time = (value: number) => new Date(toMs(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function publicApi<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const payload = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

type Bundle = { ok: true; manifest: any; structure: any; live: any | null };
type View = "overview" | "schedule" | "groups" | "results";

function teamFormatText(locale: Locale, category: any) {
  const format = category?.format;
  if (!format) return "—";
  const rubbers = format.encounter?.rubbers ?? [];
  const groups = format.competition?.groupRounds ?? 1;
  const qualifiers = format.competition?.qualifiersPerGroup ?? 2;
  return tr(
    locale,
    `${groups} vuelta(s) · clasifican ${qualifiers}/grupo · ${rubbers.length} rubbers · ${rubbers.map((r:any)=>String(r.key).toUpperCase()).join(" → ")}`,
    `${groups} round(s) · ${qualifiers}/group qualify · ${rubbers.length} rubbers · ${rubbers.map((r:any)=>String(r.key).toUpperCase()).join(" → ")}`,
  );
}

function standardFormatText(locale: Locale, category: any) {
  const format = category?.format;
  if (!format) return "—";
  const mode = String(format.playoffMode ?? "standard");
  const modeText: Record<string,string> = {
    standard: tr(locale,"cuadro estándar","standard bracket"),
    top2_final: tr(locale,"Top 2 → final","Top 2 → final"),
    top4_semis: tr(locale,"Top 4 → semifinales","Top 4 → semifinals"),
    top3_step: tr(locale,"escalera Top 3","Top 3 ladder"),
    league_only: tr(locale,"liga solamente","league only"),
  };
  return tr(locale,`${format.groupRounds ?? 1} vuelta(s) · clasifican ${format.qualifiersPerGroup ?? 2}/grupo · ${modeText[mode] ?? mode}`,`${format.groupRounds ?? 1} round(s) · ${format.qualifiersPerGroup ?? 2}/group qualify · ${modeText[mode] ?? mode}`);
}

function teamGroupRows(team: any) {
  const groups = new Map<string,{ id:string; name:string; entries:any[] }>();
  for (const row of team?.groups ?? []) {
    const id = String(row.id);
    const target = groups.get(id) ?? { id, name: String(row.name ?? id), entries: [] };
    target.entries.push({ id: String(row.entryId), name: String(row.entryName ?? "") });
    groups.set(id,target);
  }
  return [...groups.values()];
}

function scheduleMatchesNeedle(row: any, needle: string, structure: any) {
  if (!needle) return true;
  const text = `${row.sideA ?? ""} ${row.sideB ?? ""} ${row.categoryName ?? ""}`.toLowerCase();
  if (text.includes(needle)) return true;
  const teams = structure?.teams ?? [];
  const matchingTeams = new Set(teams.filter((team:any)=>(team.roster??[]).some((member:any)=>String(member.name??"").toLowerCase().includes(needle))).map((team:any)=>String(team.id)));
  return [row.entryAId,row.entryBId].some((id)=>id&&matchingTeams.has(String(id)));
}

export function TournamentLivePage({ slug, locale, go }: { slug: string; locale: Locale; go: Go }) {
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [view,setView]=useState<View>("overview");
  const [categoryId,setCategoryId]=useState("");
  const [teamId,setTeamId]=useState("");
  const [player,setPlayer]=useState("");
  const [court,setCourt]=useState("");

  useEffect(() => {
    let active = true;
    const load = () => void publicApi<Bundle>(`/api/public/tournaments/${encodeURIComponent(slug)}/day-live`)
      .then((bundle) => { if (active) { setData(bundle); setError(""); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "LIVE_LOAD_FAILED"); });
    load();
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [slug]);

  const schedule = useMemo(() => {
    const source = data?.live?.schedule ?? data?.structure?.schedule ?? [];
    const needle = player.trim().toLowerCase();
    return [...source].filter((row:any)=>{
      if(categoryId&&String(row.categoryId)!==categoryId)return false;
      if(court&&String(row.court).match(/\d+/)?.[0]!==court)return false;
      if(teamId&&![row.entryAId,row.entryBId].map(String).includes(teamId))return false;
      if(needle&&!scheduleMatchesNeedle(row,needle,data?.structure))return false;
      return true;
    }).sort((a:any,b:any)=>Number(a.startAt)-Number(b.startAt));
  },[data,categoryId,teamId,player,court]);

  if (!data) return <main className="live-page"><header className="live-top"><button onClick={() => go("/")}>←</button><img src="/huau-logo.png" alt="HUAU" /></header><div className="live-empty">{error || tr(locale, "Cargando torneo…", "Loading tournament…")}</div></main>;

  const structure=data.structure;
  const live=data.live;
  const manifest=data.manifest;
  const categories=structure.categories??[];
  const teams=structure.teams??[];
  const standardByCategory=new Map<string, any>((structure.standard??[]).map((row:any)=>[String(row.categoryId),row] as const));
  const teamByCategory=new Map<string, any>((structure.team??[]).map((row:any)=>[String(row.categoryId),row] as const));
  const courts=[...new Set((structure.schedule??[]).map((row:any)=>String(row.court).match(/\d+/)?.[0]).filter(Boolean))];
  const now=Math.floor(Date.now()/1000);
  const current=schedule.filter((row:any)=>Number(row.startAt)<=now&&now<=Number(row.endAt)&&!["completed","cancelled"].includes(String(row.status)));
  const next=schedule.filter((row:any)=>Number(row.startAt)>now&&!["completed","cancelled"].includes(String(row.status))).slice(0,8);
  const standardResults=live?.results?.standard??[];
  const teamResults=live?.results?.team??[];
  const updatedAt=live?.generatedAt??structure.generatedAt??manifest.updatedAt;
  const playerNeedle=player.trim().toLowerCase();
  const myTeams=playerNeedle?teams.filter((team:any)=>(team.roster??[]).some((member:any)=>String(member.name??"").toLowerCase().includes(playerNeedle))):[];
  const mySchedule=playerNeedle?schedule.filter((row:any)=>scheduleMatchesNeedle(row,playerNeedle,structure)).slice(0,12):[];

  return <main className="live-page">
    <header className="live-top"><button onClick={() => go("/")}>← HUAU</button><img src="/huau-logo.png" alt="HUAU" /></header>
    <section className="live-hero">
      <div className="live-hero-main"><span className={`live-status ${manifest.status}`}>● {manifest.status === "live" ? "LIVE" : manifest.status === "finished" ? tr(locale,"FINALIZADO","FINISHED") : tr(locale,"PROGRAMADO","SCHEDULED")}</span><h1>{structure.tournament.name}</h1><p>{dateTime(structure.tournament.startAt,locale)} · {structure.tournament.courtCount} {tr(locale,"canchas","courts")}{structure.tournament.venue?` · ${structure.tournament.venue}`:""}</p></div>
      <div className="live-hero-meta"><span>{tr(locale,"Actualizado","Updated")}</span><strong>{dateTime(updatedAt,locale)}</strong><small>{live?tr(locale,"Resultados publicados por dirección de torneo","Results published by tournament direction"):tr(locale,"Estructura publicada · resultados aún no publicados","Structure published · results not yet published")}</small></div>
    </section>

    <nav className="live-nav">{(["overview","schedule","groups","results"] as View[]).map((key)=><button className={view===key?"active":""} key={key} onClick={()=>setView(key)}>{key==="overview"?tr(locale,"Resumen","Overview"):key==="schedule"?tr(locale,"Cronograma","Schedule"):key==="groups"?tr(locale,"Grupos y formato","Groups & format"):tr(locale,"Resultados","Results")}</button>)}</nav>

    <section className="live-filters"><select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)}><option value="">{tr(locale,"Todas las categorías","All categories")}</option>{categories.map((category:any)=><option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={teamId} onChange={(e)=>setTeamId(e.target.value)}><option value="">{tr(locale,"Todos los equipos","All teams")}</option>{teams.map((team:any)=><option key={team.id} value={team.id}>{team.name}</option>)}</select><input value={player} onChange={(e)=>setPlayer(e.target.value)} placeholder={tr(locale,"Buscar mi nombre…","Find my name…")} /><select value={court} onChange={(e)=>setCourt(e.target.value)}><option value="">{tr(locale,"Todas las canchas","All courts")}</option>{courts.map((value)=><option key={String(value)} value={String(value)}>Cancha {String(value)}</option>)}</select></section>

    {playerNeedle?<section className="live-card live-my"><header><span>{tr(locale,"MI TORNEO","MY TOURNAMENT")}</span><b>{mySchedule.length}</b></header>{myTeams.length?<div className="live-my-teams">{myTeams.map((team:any)=><div key={team.id}><strong>{team.name}</strong><span>{categories.find((category:any)=>String(category.id)===String(team.categoryId))?.name??""}</span><small>{(team.roster??[]).map((member:any)=>member.name).join(" · ")}</small></div>)}</div>:null}{mySchedule.length?<div className="live-my-schedule">{mySchedule.map((row:any)=><MatchRow key={row.id} row={row}/>)}</div>:<p>{tr(locale,"No encontramos partidos con ese nombre. Probá con apellido o equipo.","No matches found for that name. Try a surname or team.")}</p>}</section>:null}

    {view==="overview"?<>
      <section className="live-grid"><article className="live-card live-now"><header><span>{tr(locale,"AHORA","NOW")}</span><b>{current.length}</b></header>{current.length?current.map((row:any)=><MatchRow key={row.id} row={row}/>):<p>{tr(locale,"No hay partidos activos.","No active matches.")}</p>}</article><article className="live-card"><header><span>{tr(locale,"PRÓXIMOS","NEXT")}</span><b>{next.length}</b></header>{next.length?next.map((row:any)=><MatchRow key={row.id} row={row}/>):<p>{tr(locale,"El cronograma todavía no tiene próximos partidos.","No upcoming matches are scheduled yet.")}</p>}</article></section>
      <section className="live-card"><header><span>{tr(locale,"CATEGORÍAS Y FORMATO","CATEGORIES & FORMAT")}</span><b>{categories.length}</b></header><div className="live-category-grid">{categories.map((category:any)=>{const team=teamByCategory.get(String(category.id));const standard=standardByCategory.get(String(category.id));const groupCount=team?teamGroupRows(team).length:standard?.groups?.length??0;return <div key={category.id}><span>{category.entryType==="team"?"TEAM":"STANDARD"}</span><h3>{category.name}</h3><strong>{groupCount} {tr(locale,"grupo(s)","group(s)")}</strong><p>{team?teamFormatText(locale,team):standardFormatText(locale,standard)}</p></div>})}</div></section>
      {live?<><Results locale={locale} categories={categories} standardResults={standardResults} teamResults={teamResults}/><Standings locale={locale} live={live}/></>:<section className="live-card live-pending"><h2>{tr(locale,"Estructura publicada","Structure published")}</h2><p>{tr(locale,"La dirección del torneo todavía no publicó resultados. El cronograma, los grupos y el formato ya están disponibles.","Tournament direction has not published results yet. Schedule, groups and format are already available.")}</p></section>}
    </>:null}

    {view==="schedule"?<section className="live-card"><header><span>{tr(locale,"CRONOGRAMA COMPLETO","FULL SCHEDULE")}</span><b>{schedule.length}</b></header><div className="live-schedule-list">{schedule.map((row:any)=><MatchRow key={row.id} row={row}/>)}</div></section>:null}

    {view==="groups"?<section className="live-groups-view">{categories.map((category:any)=>{const standard=standardByCategory.get(String(category.id));const team=teamByCategory.get(String(category.id));if(!standard&&!team)return null;const groups=team?teamGroupRows(team):standard.groups??[];return <article className="live-card" key={category.id}><header><div><span>{category.entryType==="team"?"TEAM":"STANDARD"}</span><h2>{category.name}</h2></div><b>{groups.length} {tr(locale,"grupos","groups")}</b></header><p className="live-format-copy">{team?teamFormatText(locale,team):standardFormatText(locale,standard)}</p>{team?.format?.encounter?.rubbers?.length?<div className="live-rubber-sequence">{team.format.encounter.rubbers.map((rubber:any)=><span key={rubber.key}><b>{String(rubber.key).toUpperCase()}</b>{rubber.label}{rubber.play==="if_tied"?<em>{tr(locale,"si empate","if tied")}</em>:null}</span>)}</div>:null}<div className="live-group-grid">{groups.map((group:any)=><div key={group.id}><h3>{tr(locale,"Grupo","Group")} {group.name}</h3>{(group.entries??[]).map((entry:any,index:number)=><span key={entry.id}><b>{index+1}</b><strong>{entry.name}</strong></span>)}</div>)}</div></article>})}</section>:null}

    {view==="results"?<>{live?<><Results locale={locale} categories={categories} standardResults={standardResults} teamResults={teamResults}/><Standings locale={locale} live={live}/><Bracket locale={locale} live={live}/></>:<section className="live-card live-pending"><h2>{tr(locale,"Resultados todavía no publicados","Results not published yet")}</h2><p>{tr(locale,"La dirección del torneo los habilitará desde Tournament Day.","Tournament direction will publish them from Tournament Day.")}</p></section>}</>:null}
  </main>;
}

function MatchRow({row}:{row:any}){return <div className="live-match"><span>{time(Number(row.startAt))}<small>{row.court}</small></span><strong>{row.sideA||row.roundLabel||row.categoryName}{row.sideB?` vs ${row.sideB}`:""}</strong><em>{row.categoryName}{row.groupName?` · G${row.groupName}`:""}{row.roundNumber?` · R${row.roundNumber}`:""}{row.rubberKey?` · ${String(row.rubberKey).toUpperCase()}`:""}</em></div>}

function Results({locale,categories,standardResults,teamResults}:{locale:Locale;categories:any[];standardResults:any[];teamResults:any[]}){const teamVisible=teamResults.filter((enc:any)=>enc.status==="finished"||enc.status==="in_progress");return <section className="live-card"><header><span>{tr(locale,"RESULTADOS","RESULTS")}</span><b>{standardResults.length+teamVisible.length}</b></header><div className="live-results-grid">{standardResults.slice().reverse().slice(0,16).map((result:any)=><div key={result.id}><small>{categories.find((c:any)=>String(c.id)===String(result.categoryId))?.name??""}</small><strong>{result.sideA} <b>{result.scoreA??"—"}</b> — <b>{result.scoreB??"—"}</b> {result.sideB}</strong></div>)}{teamVisible.slice().reverse().slice(0,12).map((enc:any)=><TeamResult key={enc.encounterId} locale={locale} encounter={enc} categories={categories}/>)}</div></section>}

function TeamResult({locale,encounter,categories}:{locale:Locale;encounter:any;categories:any[]}){let a=0,b=0;for(const rubber of encounter.rubbers??[]){if(!rubber.winnerSide||rubber.status==="skipped")continue;const weight=Number(rubber.weight??1);if(rubber.winnerSide==="A")a+=weight;else if(rubber.winnerSide==="B")b+=weight}return <details className="live-team-result"><summary><small>{categories.find((c:any)=>String(c.id)===String(encounter.categoryId))?.name??"TEAM"}</small><strong>{encounter.sideA} <b>{a}</b> — <b>{b}</b> {encounter.sideB}</strong><span>{encounter.status}</span></summary><div className="live-team-rubbers">{[...(encounter.rubbers??[])].sort((x:any,y:any)=>Number(x.order)-Number(y.order)).map((rubber:any)=><div key={rubber.id}><span><b>{String(rubber.key).toUpperCase()}</b>{rubber.label??rubber.key}</span><strong>{rubber.lineupA?.join(" / ")||"—"}<em>vs</em>{rubber.lineupB?.join(" / ")||"—"}</strong><b>{rubber.status==="skipped"?tr(locale,"No necesario","Not needed"):rubber.scoreA!=null?`${rubber.scoreA} — ${rubber.scoreB}`:rubber.status}</b></div>)}</div></details>}

function Standings({locale,live}:{locale:Locale;live:any}){const tables=[...(live.standings?.standard??[]).map((s:any)=>({title:s.groupName,rows:s.rows,name:(r:any)=>r.name,value:(r:any)=>`${r.wins}-${r.losses}`})),...(live.standings?.team??[]).map((s:any)=>({title:`${s.categoryName} · ${s.groupName}`,rows:s.rows,name:(r:any)=>r.entryName,value:(r:any)=>`${r.standingPoints} PTS`}))];if(!tables.length)return null;return <section className="live-card"><header><span>{tr(locale,"TABLAS","STANDINGS")}</span></header><div className="live-standing-grid">{tables.map((table:any,index:number)=><div key={`${table.title}-${index}`}><h3>{table.title}</h3>{table.rows.map((row:any,pos:number)=><span key={row.entryId}><b>{pos+1}</b><strong>{table.name(row)}</strong><em>{table.value(row)}</em></span>)}</div>)}</div></section>}

function Bracket({locale,live}:{locale:Locale;live:any}){const rows=[...(live.bracket?.standard??[]),...(live.bracket?.team??[])];if(!rows.length)return null;return <section className="live-card"><header><span>{tr(locale,"FASE FINAL","FINAL BRACKET")}</span></header><div className="live-bracket">{rows.map((row:any)=><div key={`${row.categoryId}-${row.id}`}><small>{row.roundLabel??row.stage}</small><strong>{row.sideA??"TBD"}<span>vs</span>{row.sideB??"TBD"}</strong><em>{row.status}</em></div>)}</div></section>}
