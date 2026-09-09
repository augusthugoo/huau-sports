/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import type { Locale } from "./i18n";
import "./TournamentLivePage.css";

type Go = (path: string) => void;
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
const dateTime = (value: number, locale: Locale) => new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(value < 10_000_000_000 ? value * 1000 : value));
const time = (value: number) => new Date(value < 10_000_000_000 ? value * 1000 : value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function publicApi<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const payload = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

type Bundle = { ok: true; manifest: any; structure: any; live: any | null };

export function TournamentLivePage({ slug, locale, go }: { slug: string; locale: Locale; go: Go }) {
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [player, setPlayer] = useState("");
  const [court, setCourt] = useState("");

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
    const playerNeedle = player.trim().toLowerCase();
    const playerTeamIds = new Set(
      (data?.structure?.teams ?? [])
        .filter((team: any) =>
          playerNeedle && (team.roster ?? []).some((member: any) =>
            String(member.name ?? "").toLowerCase().includes(playerNeedle),
          ),
        )
        .map((team: any) => String(team.id)),
    );
    return [...source].filter((row: any) => {
      if (categoryId && String(row.categoryId) !== categoryId) return false;
      if (court && String(row.court) !== court) return false;
      if (teamId && ![row.entryAId, row.entryBId].map(String).includes(teamId)) return false;
      if (playerNeedle) {
        const sideText = `${row.sideA ?? ""} ${row.sideB ?? ""}`.toLowerCase();
        const teamMatch = [row.entryAId, row.entryBId].some((id) => id && playerTeamIds.has(String(id)));
        if (!sideText.includes(playerNeedle) && !teamMatch) return false;
      }
      return true;
    }).sort((a: any, b: any) => Number(a.startAt) - Number(b.startAt));
  }, [data, categoryId, court, teamId, player]);

  if (!data) return <main className="live-page"><header className="live-top"><button onClick={() => go(`/tournaments/${slug}`)}>←</button><img src="/huau-logo.png" alt="HUAU" /></header><div className="live-empty">{error || tr(locale, "Cargando torneo…", "Loading tournament…")}</div></main>;

  const structure = data.structure;
  const live = data.live;
  const manifest = data.manifest;
  const categories = structure.categories ?? [];
  const teams = structure.teams ?? [];
  const courts = [...new Set((structure.schedule ?? []).map((row: any) => String(row.court)).filter(Boolean))];
  const now = Math.floor(Date.now() / 1000);
  const current = schedule.filter((row: any) => Number(row.startAt) <= now && now <= Number(row.endAt) && !["completed", "cancelled"].includes(String(row.status)));
  const next = schedule.filter((row: any) => Number(row.startAt) > now && !["completed", "cancelled"].includes(String(row.status))).slice(0, 8);
  const standardResults = live?.results?.standard ?? [];
  const teamResults = live?.results?.team ?? [];
  const updatedAt = live?.generatedAt ?? structure.generatedAt ?? manifest.updatedAt;

  return <main className="live-page">
    <header className="live-top"><button onClick={() => go(`/tournaments/${slug}`)}>← {tr(locale,"Torneo","Tournament")}</button><img src="/huau-logo.png" alt="HUAU" /></header>
    <section className="live-hero"><div><span className={`live-status ${manifest.status}`}>● {manifest.status === "live" ? "LIVE" : manifest.status === "finished" ? tr(locale,"FINALIZADO","FINISHED") : tr(locale,"PROGRAMADO","SCHEDULED")}</span><h1>{structure.tournament.name}</h1><p>{dateTime(structure.tournament.startAt, locale)} · {structure.tournament.courtCount} {tr(locale,"canchas","courts")}</p></div><small>{tr(locale,"Actualizado","Updated")} {dateTime(updatedAt, locale)}</small></section>
    <section className="live-filters"><select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)}><option value="">{tr(locale,"Todas las categorías","All categories")}</option>{categories.map((category:any)=><option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={teamId} onChange={(e)=>setTeamId(e.target.value)}><option value="">{tr(locale,"Todos los equipos","All teams")}</option>{teams.map((team:any)=><option key={team.id} value={team.id}>{team.name}</option>)}</select><input value={player} onChange={(e)=>setPlayer(e.target.value)} placeholder={tr(locale,"Jugador…","Player…")} /><select value={court} onChange={(e)=>setCourt(e.target.value)}><option value="">{tr(locale,"Todas las canchas","All courts")}</option>{courts.map((value)=><option key={String(value)} value={String(value)}>{String(value)}</option>)}</select></section>
    <section className="live-grid">
      <article className="live-card live-now"><header><span>{tr(locale,"AHORA","NOW")}</span><b>{current.length}</b></header>{current.length ? current.map((row:any)=><MatchRow key={row.id} row={row}/>) : <p>{tr(locale,"No hay partidos activos.","No active matches.")}</p>}</article>
      <article className="live-card"><header><span>{tr(locale,"PRÓXIMOS","NEXT")}</span><b>{next.length}</b></header>{next.map((row:any)=><MatchRow key={row.id} row={row}/>)}</article>
    </section>
    <section className="live-card"><header><span>{tr(locale,"CRONOGRAMA","SCHEDULE")}</span><b>{schedule.length}</b></header><div className="live-schedule-list">{schedule.map((row:any)=><MatchRow key={row.id} row={row}/>)}</div></section>
    {live ? <>
      <section className="live-card"><header><span>{tr(locale,"RESULTADOS","RESULTS")}</span><b>{standardResults.length + teamResults.filter((e:any)=>e.status === "finished").length}</b></header><div className="live-results-grid">{standardResults.slice().reverse().slice(0,12).map((result:any)=><div key={result.id}><small>{categories.find((c:any)=>String(c.id)===String(result.categoryId))?.name ?? ""}</small><strong>{result.sideA} <b>{result.scoreA ?? "—"}</b> — <b>{result.scoreB ?? "—"}</b> {result.sideB}</strong></div>)}{teamResults.filter((enc:any)=>enc.status === "finished" || enc.status === "in_progress").slice().reverse().slice(0,8).map((enc:any)=><TeamResult key={enc.encounterId} encounter={enc} categories={categories}/>)}</div></section>
      <Standings locale={locale} live={live} />
      <Bracket locale={locale} live={live} />
    </> : <section className="live-card"><h2>{tr(locale,"Estructura publicada","Structure published")}</h2><p>{tr(locale,"Los resultados todavía no fueron publicados por la dirección del torneo.","The tournament director has not published results yet.")}</p></section>}
  </main>;
}

function MatchRow({ row }: { row: any }) { return <div className="live-match"><span>{time(Number(row.startAt))}<small>{row.court}</small></span><strong>{row.sideA || row.roundLabel || row.categoryName}{row.sideB ? ` vs ${row.sideB}` : ""}</strong><em>{row.categoryName}{row.rubberKey ? ` · ${String(row.rubberKey).toUpperCase()}` : ""}</em></div>; }
function TeamResult({ encounter, categories }: { encounter: any; categories: any[] }) { let a=0,b=0; for (const rubber of encounter.rubbers ?? []) { if (!rubber.status || rubber.status === "skipped") continue; const weight=Number(rubber.weight??1); if (rubber.winnerSide === "A") a += weight; else if (rubber.winnerSide === "B") b += weight; } return <div><small>{categories.find((c:any)=>String(c.id)===String(encounter.categoryId))?.name ?? "TEAM"}</small><strong>{encounter.sideA} <b>{a}</b> — <b>{b}</b> {encounter.sideB}</strong></div>; }
function Standings({ locale, live }: { locale: Locale; live: any }) { const tables=[...(live.standings?.standard ?? []).map((s:any)=>({title:s.groupName,rows:s.rows,name:(r:any)=>r.name,value:(r:any)=>`${r.wins}-${r.losses}`})),...(live.standings?.team ?? []).map((s:any)=>({title:`${s.categoryName} · ${s.groupName}`,rows:s.rows,name:(r:any)=>r.entryName,value:(r:any)=>`${r.standingPoints} PTS`}))]; if(!tables.length)return null; return <section className="live-card"><header><span>{tr(locale,"TABLAS","STANDINGS")}</span></header><div className="live-standing-grid">{tables.map((table:any,index:number)=><div key={`${table.title}-${index}`}><h3>{table.title}</h3>{table.rows.map((row:any,pos:number)=><span key={row.entryId}><b>{pos+1}</b><strong>{table.name(row)}</strong><em>{table.value(row)}</em></span>)}</div>)}</div></section>; }
function Bracket({ locale, live }: { locale: Locale; live: any }) { const rows=[...(live.bracket?.standard ?? []),...(live.bracket?.team ?? [])]; if(!rows.length)return null; return <section className="live-card"><header><span>{tr(locale,"CUADRO","BRACKET")}</span></header><div className="live-bracket">{rows.map((row:any)=><div key={`${row.categoryId}-${row.id}`}><small>{row.roundLabel ?? row.stage}</small><strong>{row.sideA ?? "TBD"} <span>vs</span> {row.sideB ?? "TBD"}</strong><em>{row.status}</em></div>)}</div></section>; }
