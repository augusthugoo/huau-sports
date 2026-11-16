import { useEffect, useMemo, useState } from "react";
import type { Locale } from "./i18n";
import "./HuauBroadcastTV.css";

export type BroadcastMode = "auto" | "general" | "category" | "courts";
export type BroadcastMatch = {
  id: string;
  categoryId: string;
  categoryName: string;
  courtLabel: string;
  startAt: number;
  roundLabel: string;
  sideA: string;
  sideB: string;
  score?: string | null;
  teamDetail?: { label: string; lineupA: string; lineupB: string; score?: string | null } | null;
};
export type BroadcastStanding = {
  kind: string;
  categoryId: string;
  categoryName: string;
  groupId?: string;
  groupName?: string;
  rows?: Array<{
    entryId?: string;
    position?: number;
    name?: string;
    entryName?: string;
    played?: number;
    wins?: number;
    losses?: number;
    diff?: number;
    standingPoints?: number;
  }>;
};
export type BroadcastBracket = {
  kind: string;
  categoryId: string;
  categoryName: string;
  encounters: Array<{
    id: string;
    roundNumber: number;
    roundLabel: string;
    sideA: string;
    sideB: string;
    status: string;
    score: string | null;
    schedule?: { startAt?: number; courtLabel?: string } | null;
  }>;
};
export type BroadcastResult = {
  id: string;
  categoryId: string;
  categoryName: string;
  roundLabel: string;
  sideA: string;
  sideB: string;
  score: string;
  startAt: number;
  courtLabel: string;
};

type BracketRound = { roundNumber: number; label: string; matches: BroadcastBracket["encounters"] };
export type BroadcastScene =
  | { key: string; kind: "matches"; matches: BroadcastMatch[]; sidebar: BroadcastStanding[] }
  | { key: string; kind: "bracket"; bracket: BroadcastBracket; rounds: BracketRound[]; sidebar: BroadcastStanding[]; part: number; parts: number }
  | { key: string; kind: "tables"; groups: BroadcastStanding[]; results: BroadcastResult[] };

export const BROADCAST_ROTATION_MS = 14000;
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
const asText = (s?: string | null) => s?.trim() || "—";

function groupsOf<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += Math.max(1, size)) out.push(list.slice(i, i + Math.max(1, size)));
  return out;
}
function clock(value: number, locale: Locale) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Date(value < 1e12 ? value * 1000 : value).toLocaleTimeString(locale === "es" ? "es-UY" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function courtNumber(label: string) {
  const n = label.match(/\d+/)?.[0];
  return n ? n.padStart(2, "0") : "—";
}
function signed(n?: number) {
  const value = Number(n ?? 0);
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Does not change competition data. A scene is deliberately bounded, so adding
 * new groups/results never grows the document height and the television never
 * needs a mouse to scroll. All eligible bracket matches appear across pages.
 */
export function planBroadcastScenes(input: {
  mode: BroadcastMode;
  blocks: BroadcastMatch[];
  standings: BroadcastStanding[];
  brackets: BroadcastBracket[];
  results: BroadcastResult[];
  matchesPerScene: number;
  sideGroupsPerScene: number;
  tableGroupsPerScene: number;
  standingRowsPerCard: number;
  bracketMatchesPerRound: number;
  selectedCategoryId?: string;
}): BroadcastScene[] {
  const { mode, blocks, standings, brackets, results } = input;
  const matchesPerScene = Math.max(1, input.matchesPerScene);
  const sideGroupsPerScene = Math.max(1, input.sideGroupsPerScene);
  const tableGroupsPerScene = Math.max(1, input.tableGroupsPerScene);
  const bracketMatchesPerRound = Math.max(1, input.bracketMatchesPerRound);
  const standingRowsPerCard = Math.max(1, input.standingRowsPerCard);
  const expandedStandings = standings.flatMap((standing) => {
    const chunks = groupsOf(standing.rows ?? [], standingRowsPerCard);
    if (chunks.length <= 1) return [standing];
    return chunks.map((rows, index) => ({
      ...standing,
      groupName: `${standing.groupName ?? "Grupo"} · ${index + 1}/${chunks.length}`,
      rows,
    }));
  });
  const focusId = mode === "category"
    ? input.selectedCategoryId ?? ""
    : blocks[0]?.categoryId ?? results[0]?.categoryId ?? "";
  const focusStandings = expandedStandings.filter((s) => s.categoryId === focusId);
  const sidebarPool = focusStandings.length ? focusStandings : expandedStandings;
  const sidebarPages = groupsOf(sidebarPool, sideGroupsPerScene);
  const sidebarFor = (index: number) => sidebarPages[index % Math.max(1, sidebarPages.length)] ?? [];

  const scenes: BroadcastScene[] = [];
  for (const [index, chunk] of groupsOf(blocks, matchesPerScene).entries()) {
    scenes.push({ key: `matches:${index}`, kind: "matches", matches: chunk, sidebar: sidebarFor(index) });
  }
  if (!blocks.length) scenes.push({ key: "matches:empty", kind: "matches", matches: [], sidebar: sidebarFor(0) });

  // A giant competition must not cause 30 minutes of unattended bracket rotation.
  // Category mode displays its full bracket; Auto highlights the active category;
  // General shows up to four relevant brackets, preserving the other data.
  const relevantBrackets = mode === "courts" ? [] : mode === "category"
    ? focusId ? brackets.filter((b) => b.categoryId === focusId) : brackets
    : mode === "auto"
      ? brackets.filter((b) => b.categoryId === focusId).slice(0, 1)
      : [...brackets].sort((a, b) => Number(b.categoryId === focusId) - Number(a.categoryId === focusId));

  for (const bracket of relevantBrackets) {
    const rounds = [...new Set(bracket.encounters.map((m) => m.roundNumber))].sort((a, b) => a - b);
    const pieces: BracketRound[][] = [];
    for (const roundBatch of groupsOf(rounds, 3)) {
      const roundPieces = roundBatch.map((roundNumber) => {
        const matches = bracket.encounters.filter((m) => m.roundNumber === roundNumber);
        const label = matches[0]?.roundLabel ?? "";
        return groupsOf(matches, bracketMatchesPerRound).map((chunk): BracketRound => ({ roundNumber, label, matches: chunk }));
      });
      const count = Math.max(0, ...roundPieces.map((parts) => parts.length));
      for (let part = 0; part < count; part += 1) {
        const shown = roundPieces.map((parts) => parts[part]).filter((row): row is BracketRound => Boolean(row));
        if (shown.length) pieces.push(shown);
      }
    }
    for (const [index, shown] of pieces.entries()) {
      scenes.push({ key: `bracket:${bracket.categoryId}:${index}`, kind: "bracket", bracket, rounds: shown, sidebar: sidebarFor(index), part: index + 1, parts: pieces.length });
    }
  }

  if (mode !== "courts") {
    const tablePool = mode === "auto" && focusStandings.length ? focusStandings : expandedStandings;
    for (const [index, group] of groupsOf(tablePool, tableGroupsPerScene).entries()) {
      scenes.push({ key: `tables:${index}`, kind: "tables", groups: group, results: results.slice(0, 4) });
    }
    if (!tablePool.length && results.length) {
      scenes.push({ key: "tables:results", kind: "tables", groups: [], results: results.slice(0, 4) });
    }
  }
  return scenes;
}

function StandingCard({ standing, locale }: { standing: BroadcastStanding; locale: Locale }) {
  const rows = standing.rows ?? [];
  return <section className="hb-standing">
    <header><strong title={standing.categoryName}>{standing.categoryName}</strong><span>{standing.groupName || tr(locale, "GRUPO", "GROUP")}</span></header>
    <div className="hb-table-head"><span>{tr(locale, "PARTICIPANTE", "PARTICIPANT")}</span><span>PJ</span><span>PG</span><span>{standing.kind === "team" ? "PTS" : "+/−"}</span></div>
    <div className="hb-standing-rows">
      {rows.length ? rows.map((row, index) => <div className="hb-table-person" key={row.entryId || `${index}:${row.name ?? row.entryName}`}>
        <div className="hb-person"><b>{row.position ?? index + 1}</b><strong title={row.entryName || row.name}>{asText(row.entryName || row.name)}</strong></div>
        <span>{row.played ?? 0}</span><span>{row.wins ?? 0}</span>
        <span>{standing.kind === "team" ? row.standingPoints ?? 0 : signed(row.diff)}</span>
      </div>) : <p className="hb-empty-small">{tr(locale, "Aún sin clasificación", "Standings pending")}</p>}
    </div>
  </section>;
}

function ResultList({ results, locale }: { results: BroadcastResult[]; locale: Locale }) {
  return <div className="hb-recent-results">
    {results.length ? results.map((r) => <div className="hb-result-row" key={r.id}>
      <div><span>{r.categoryName} · {r.roundLabel}</span><strong title={`${r.sideA} — ${r.sideB}`}>{asText(r.sideA)} <i>vs</i> {asText(r.sideB)}</strong></div>
      <b>{r.score}</b>
    </div>) : <p className="hb-empty-small">{tr(locale, "Todavía no hay resultados", "No results yet")}</p>}
  </div>;
}

export function HuauBroadcastTV({ locale, title, mode, onModeChange, categoryId, onCategoryChange, court, onCourtChange, categories, courtCount, blocks, standings, brackets, results }: {
  locale: Locale;
  title: string;
  mode: BroadcastMode;
  onModeChange: (mode: BroadcastMode) => void;
  categoryId: string;
  onCategoryChange: (id: string) => void;
  court: string;
  onCourtChange: (value: string) => void;
  categories: Array<{ id: string; name: string }>;
  courtCount: number;
  blocks: BroadcastMatch[];
  standings: BroadcastStanding[];
  brackets: BroadcastBracket[];
  results: BroadcastResult[];
}) {
  const [viewport, setViewport] = useState(() => ({ width: typeof window === "undefined" ? 1280 : window.innerWidth, height: typeof window === "undefined" ? 720 : window.innerHeight }));
  const [pageIndex, setPageIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const full = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", full);
    return () => { window.removeEventListener("resize", resize); document.removeEventListener("fullscreenchange", full); };
  }, []);

  const compact = viewport.width < 1020 || viewport.height < 690;
  const tiny = viewport.width < 750 || viewport.height < 530;
  const matchesPerScene = tiny ? 2 : compact ? 3 : 4;
  const sideGroupsPerScene = tiny ? 1 : 2;
  const tableGroupsPerScene = tiny ? 2 : compact ? 3 : 4;
  const bracketMatchesPerRound = tiny ? 2 : compact ? 3 : 4;
  const standingRowsPerCard = tiny ? 3 : compact ? 4 : 5;

  const scenes = useMemo(() => planBroadcastScenes({ mode, blocks, standings, brackets, results, selectedCategoryId: categoryId, matchesPerScene, sideGroupsPerScene, tableGroupsPerScene, standingRowsPerCard, bracketMatchesPerRound }), [mode, blocks, standings, brackets, results, categoryId, matchesPerScene, sideGroupsPerScene, tableGroupsPerScene, standingRowsPerCard, bracketMatchesPerRound]);

  const currentIndex = pageIndex % scenes.length;
  const scene = scenes[currentIndex]!;
  const navigate = (step: number) => setPageIndex((n) => (n + step + scenes.length) % scenes.length);

  useEffect(() => {
    if (!playing || scenes.length < 2) return;
    const interval = window.setInterval(() => setPageIndex((n) => (n + 1) % scenes.length), BROADCAST_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [playing, scenes.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
      if (event.key === "ArrowRight") { event.preventDefault(); setPageIndex((n) => (n + 1) % scenes.length); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setPageIndex((n) => (n - 1 + scenes.length) % scenes.length); }
      if (event.key === " ") { event.preventDefault(); setPlaying((v) => !v); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scenes.length]);

  const switchMode = (next: BroadcastMode) => { onModeChange(next); setPageIndex(0); };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (document.fullscreenEnabled) void document.documentElement.requestFullscreen().catch(() => undefined);
  };
  const sceneTag = scene.kind === "matches" ? "01 / EN CANCHA" : scene.kind === "bracket" ? "02 / FASE FINAL" : "03 / CLASIFICACIÓN";

  return <section className="hb-tv" aria-label={tr(locale, "Pantalla HUAU Broadcast", "HUAU Broadcast display")}>
    <header className="hb-top">
      <div className="hb-identity">
        <img className="hb-logo" src="/huau-logo.png" alt="HUAU" />
        <div className="hb-tournament"><small>HUAU / BROADCAST</small><strong title={title}>{title}</strong></div>
      </div>
      <div className="hb-status"><span className="hb-status-copy">{tr(locale, "TRANSMISIÓN DEL TORNEO", "TOURNAMENT BROADCAST")}</span><strong><i/> LIVE</strong></div>
    </header>

    <div className="hb-scene" key={scene.key}>
      <main className="hb-main">
        <div className="hb-eyebrow"><strong>{sceneTag}</strong><span>{scene.kind === "bracket" ? scene.bracket.categoryName : tr(locale, "RESULTADOS EN VIVO", "LIVE RESULTS")}</span></div>
        {scene.kind === "matches" ? <>
          <h1 className="hb-title">{tr(locale, "Ahora", "Now")} <span>/ {tr(locale, "Próximos", "Next")}</span></h1>
          <div className="hb-match-rows">
            {scene.matches.length ? scene.matches.map((m) => <article className="hb-match-row" key={m.id}>
              <div className="hb-court"><small>{tr(locale, "CANCHA", "COURT")}</small><strong>{courtNumber(m.courtLabel)}</strong></div>
              <div className="hb-match-participants"><div className="hb-match-meta" title={`${m.categoryName} · ${m.roundLabel}`}>{m.categoryName} · {m.roundLabel}</div><div className="hb-match-pair"><strong title={m.sideA}>{asText(m.sideA)}</strong><em>VS</em><strong title={m.sideB}>{asText(m.sideB)}</strong></div>{m.teamDetail ? <div className="hb-team-detail" title={`${m.teamDetail.lineupA} vs ${m.teamDetail.lineupB}`}>
                  <b>{m.teamDetail.label}</b> · {m.teamDetail.lineupA} vs {m.teamDetail.lineupB}
                </div> : null}{m.score ? <div className="hb-match-score">{m.score}</div> : null}</div>
              <div className="hb-match-clock"><small>{tr(locale, "COMIENZA", "STARTS")}</small><strong>{clock(m.startAt, locale)}</strong></div>
            </article>) : <div className="hb-empty-large">{tr(locale, "No hay partidos próximos", "No upcoming matches")}</div>}
          </div>
        </> : null}

        {scene.kind === "bracket" ? <>
          <h1 className="hb-title">{tr(locale, "Camino", "Road")} <span>{tr(locale, "a la final", "to the final")}</span></h1>
          <div className="hb-bracket-board" style={{ gridTemplateColumns: `repeat(${scene.rounds.length}, minmax(0, 1fr))` }}>
            {scene.rounds.map((round) => <div className="hb-round" key={round.roundNumber}>
              <div className="hb-round-label" title={round.label}>{round.label || `${tr(locale, "Ronda", "Round")} ${round.roundNumber}`} · {round.matches.length}</div>
              <div className="hb-round-matches">
                {round.matches.map((m) => <article className={`hb-round-match ${m.status === "finished" ? "hb-finished" : ""}`} key={m.id}>
                  <small>{m.schedule?.courtLabel || tr(locale, "SIN CANCHA", "NO COURT")} · {clock(Number(m.schedule?.startAt ?? 0), locale)}</small>
                  <div title={m.sideA}>{asText(m.sideA)}</div><div title={m.sideB}>{asText(m.sideB)}</div>
                  {m.score ? <b title={m.score}>{m.score}</b> : null}
                </article>)}
              </div>
            </div>)}
          </div>
          <div className="hb-bracket-note">{scene.parts > 1 ? `${tr(locale, "Parte", "Part")} ${scene.part} / ${scene.parts} · ` : ""}{tr(locale, "Clasificados y resultados actualizados con el torneo", "Bracket follows tournament results")}</div>
        </> : null}

        {scene.kind === "tables" ? <>
          <h1 className="hb-title">{tr(locale, "Clasificación", "Standings")} <span>{tr(locale, "por grupos", "by groups")}</span></h1>
          <div className="hb-tables-grid">{scene.groups.length ? scene.groups.map((standing, index) => <StandingCard key={`${standing.categoryId}:${standing.groupId ?? index}`} standing={standing} locale={locale} />) : <div className="hb-empty-large">{tr(locale, "Las tablas aparecerán al cargar resultados", "Standings will appear after results")}</div>}</div>
        </> : null}
      </main>

      <aside className="hb-aside">
        <div className="hb-eyebrow"><strong>{scene.kind === "tables" ? "04 / RESULTADOS" : "05 / POSICIONES"}</strong><span>{tr(locale, "ACTUALIZADO", "UPDATED")}</span></div>
        {scene.kind === "tables" ? <ResultList results={scene.results} locale={locale} /> : <>
          {scene.sidebar.length ? scene.sidebar.map((standing, index) => <StandingCard key={`${standing.categoryId}:${standing.groupId ?? index}`} standing={standing} locale={locale} />) : <p className="hb-empty-small">{tr(locale, "Las tablas aparecerán al cargar resultados", "Standings pending")}</p>}
          {results[0] ? <div className="hb-side-last"><small>{tr(locale, "ÚLTIMO RESULTADO", "LATEST RESULT")}</small><div><span title={`${results[0].sideA} vs ${results[0].sideB}`}>{results[0].sideA} <i>vs</i> {results[0].sideB}</span><b>{results[0].score}</b></div></div> : null}
        </>}
      </aside>
    </div>

    <footer className="hb-bottom">
      <div className="hb-bottom-ident"><strong>HUAU / TV</strong><span>{tr(locale, "TORNEO EN VIVO · DATOS DEL DÍA", "LIVE TOURNAMENT · DAY DATA")}</span></div>
      <div className="hb-bottom-actions">
        <button type="button" className="hb-toggle-config" onClick={() => setControlsOpen((v) => !v)} aria-label={tr(locale, "Configurar pantalla", "Configure display")}>{tr(locale, "VISTAS", "VIEWS")}</button>
        <div className="hb-dots" aria-label={tr(locale, "Progreso de vistas", "Display progress")}>
          {scenes.length <= 9 ? scenes.map((s, idx) => <button key={s.key} type="button" onClick={() => setPageIndex(idx)} aria-label={`${tr(locale, "Vista", "View")} ${idx + 1}`} className={idx === currentIndex ? "active" : ""} />) : <span>{String(currentIndex + 1).padStart(2, "0")}</span>}
        </div>
        <span className="hb-page-count">{String(currentIndex + 1).padStart(2, "0")} / {String(scenes.length).padStart(2, "0")}</span>
        <button type="button" onClick={() => navigate(-1)} aria-label={tr(locale, "Anterior", "Previous")}>‹</button>
        <button type="button" onClick={() => setPlaying((v) => !v)} aria-label={playing ? tr(locale, "Pausar rotación", "Pause rotation") : tr(locale, "Reanudar rotación", "Resume rotation")}>{playing ? "Ⅱ" : "▶"}</button>
        <button type="button" onClick={() => navigate(1)} aria-label={tr(locale, "Siguiente", "Next")}>›</button>
        <button type="button" onClick={toggleFullscreen} aria-label={tr(locale, "Pantalla completa", "Fullscreen")}>{fullscreen ? "⊡" : "⛶"}</button>
      </div>
    </footer>

    {controlsOpen ? <div className="hb-config" role="group" aria-label={tr(locale, "Opciones de HUAU TV", "HUAU TV options")}>
      <strong>{tr(locale, "MODO DE TRANSMISIÓN", "BROADCAST MODE")}</strong>
      <div className="hb-config-modes">{(["auto", "general", "category", "courts"] as const).map((choice) => <button type="button" key={choice} className={mode === choice ? "active" : ""} onClick={() => switchMode(choice)}>{choice === "auto" ? tr(locale, "Auto", "Auto") : choice === "general" ? tr(locale, "General", "General") : choice === "category" ? tr(locale, "Categoría", "Category") : tr(locale, "Canchas", "Courts")}</button>)}</div>
      {mode === "category" ? <select value={categoryId} aria-label={tr(locale, "Categoría", "Category")} onChange={(event: { target: { value: string } }) => { onCategoryChange(event.target.value); setPageIndex(0); }}><option value="">{tr(locale, "Todas las categorías", "All categories")}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select> : null}
      {mode === "courts" ? <select value={court} aria-label={tr(locale, "Cancha", "Court")} onChange={(event: { target: { value: string } }) => { onCourtChange(event.target.value); setPageIndex(0); }}><option value="">{tr(locale, "Todas las canchas", "All courts")}</option>{Array.from({ length: Math.max(1, courtCount) }, (_, i) => <option key={i} value={String(i + 1)}>{tr(locale, "Cancha", "Court")} {i + 1}</option>)}</select> : null}
      <small>{tr(locale, "Se adapta al zoom y avanza automáticamente. Teclas ← → y espacio.", "Zoom responsive; auto rotation. Keys ← → and space.")}</small>
      <button type="button" className="hb-config-close" onClick={() => setControlsOpen(false)}>{tr(locale, "Cerrar", "Close")}</button>
    </div> : null}
  </section>;
}
