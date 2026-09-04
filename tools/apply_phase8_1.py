#!/usr/bin/env python3
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text()


def write(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text)


def replace_once(rel: str, old: str, new: str) -> None:
    text = read(rel)
    if new in text and old not in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Phase 8.1 patch expected exactly one anchor in {rel}, found {count}: {old[:100]!r}")
    write(rel, text.replace(old, new, 1))


def insert_after_once(rel: str, anchor: str, addition: str) -> None:
    text = read(rel)
    if addition.strip() in text:
        return
    count = text.count(anchor)
    if count != 1:
        raise SystemExit(f"Phase 8.1 patch expected exactly one insertion anchor in {rel}, found {count}")
    write(rel, text.replace(anchor, anchor + addition, 1))


def git_head() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return ""


head = git_head()
expected_base = "aade6b1fa1db7972621a53593b17b8b5e2262cd9"
if head and head != expected_base:
    print(f"[phase8.1] note: HEAD is {head[:12]}, package was authored against {expected_base[:12]}. Anchors will verify compatibility.")

# ---------------------------------------------------------------------------
# Team format backward-compatible playoff fields.
# ---------------------------------------------------------------------------
replace_once(
    "packages/core/src/team/validation.ts",
    '  const { roster, encounter, standings } = format;\n',
    '  const { roster, encounter, competition, standings } = format;\n',
)
replace_once(
    "packages/core/src/team/validation.ts",
    '''  if (new Set(standings.criteria).size !== standings.criteria.length) {\n    pushIssue(issues, "STANDINGS_CRITERIA_DUPLICATE", "standings.criteria", "Team standings criteria cannot repeat.");\n  }\n\n  return result(issues);\n''',
    '''  if (new Set(standings.criteria).size !== standings.criteria.length) {\n    pushIssue(issues, "STANDINGS_CRITERIA_DUPLICATE", "standings.criteria", "Team standings criteria cannot repeat.");\n  }\n\n  const qualifiersPerGroup = competition.qualifiersPerGroup ?? 2;\n  const wildcardQualifiers = competition.wildcardQualifiers ?? 0;\n  if (!positiveInteger(qualifiersPerGroup)) {\n    pushIssue(issues, "TEAM_QUALIFIERS_INVALID", "competition.qualifiersPerGroup", "Team qualifiers per group must be a positive integer.");\n  }\n  if (!nonNegativeInteger(wildcardQualifiers)) {\n    pushIssue(issues, "TEAM_WILDCARDS_INVALID", "competition.wildcardQualifiers", "Team wildcard qualifiers must be a non-negative integer.");\n  }\n\n  return result(issues);\n''',
)
replace_once(
    "packages/core/src/team/validation.ts",
    '''    competition: {\n      groupRounds,\n      playoffMode: asEnum(\n        competition.playoffMode,\n        ["standard", "top2_final", "top3_step", "top4_semis", "league_only"] as const,\n        "competition.playoffMode",\n      ),\n    },\n''',
    '''    competition: {\n      groupRounds,\n      playoffMode: asEnum(\n        competition.playoffMode,\n        ["standard", "top2_final", "top3_step", "top4_semis", "league_only"] as const,\n        "competition.playoffMode",\n      ),\n      qualifiersPerGroup:\n        competition.qualifiersPerGroup === undefined\n          ? 2\n          : asNumber(competition.qualifiersPerGroup, "competition.qualifiersPerGroup"),\n      wildcardQualifiers:\n        competition.wildcardQualifiers === undefined\n          ? 0\n          : asNumber(competition.wildcardQualifiers, "competition.wildcardQualifiers"),\n      bronzeMatch:\n        competition.bronzeMatch === undefined\n          ? false\n          : asBoolean(competition.bronzeMatch, "competition.bronzeMatch"),\n    },\n''',
)

# ---------------------------------------------------------------------------
# Standard bracket labels: no artificial round-name ceiling.
# ---------------------------------------------------------------------------
replace_once(
    "packages/core/src/tournament/bracket.ts",
    '''function roundLabel(totalRounds: number, index: number): string {\n  const remaining = totalRounds - index;\n  if (remaining === 1) return "Final";\n  if (remaining === 2) return "Semifinal";\n  if (remaining === 3) return "Quarterfinal";\n  if (remaining === 4) return "Round of 16";\n  return "Preliminary round";\n}\n''',
    '''export function knockoutRoundLabel(totalRounds: number, index: number): string {\n  const remaining = totalRounds - index;\n  if (remaining === 1) return "Final";\n  if (remaining === 2) return "Semifinal";\n  if (remaining === 3) return "Quarterfinal";\n  return `Round of ${2 ** remaining}`;\n}\n''',
)
text = read("packages/core/src/tournament/bracket.ts")
text = text.replace("roundLabel(totalRounds,", "knockoutRoundLabel(totalRounds,")
write("packages/core/src/tournament/bracket.ts", text)

# ---------------------------------------------------------------------------
# Explanation Engine now describes Team post-group rules because they execute.
# ---------------------------------------------------------------------------
replace_once(
    "packages/core/src/tournament/explanation.ts",
    '''  const competitionItems = [\n    format.competition.groupRounds === 2 ? tr(locale, "La fase de grupos se disputa a dos vueltas.", "The group stage is a double round robin.") : tr(locale, "La fase de grupos se disputa a una vuelta.", "The group stage is a single round robin."),\n    tr(locale, "La explicación oficial de Team describe únicamente reglas que el motor actual ejecuta; una fase posterior no se anuncia hasta estar generada por el motor.", "The official Team explanation describes only rules the current engine executes; a post-group phase is not announced until the engine can generate it."),\n  ];\n''',
    '''  const qualifiersPerGroup = Math.max(1, Math.trunc(format.competition.qualifiersPerGroup ?? 2));\n  const wildcardQualifiers = Math.max(0, Math.trunc(format.competition.wildcardQualifiers ?? 0));\n  const playoffCopy = (() => {\n    switch (format.competition.playoffMode) {\n      case "standard": {\n        const wildcardEs = wildcardQualifiers ? ` más ${wildcardQualifiers} wildcard${wildcardQualifiers === 1 ? "" : "s"}` : "";\n        const wildcardEn = wildcardQualifiers ? ` plus ${wildcardQualifiers} wildcard${wildcardQualifiers === 1 ? "" : "s"}` : "";\n        return tr(\n          locale,\n          `Clasifican ${qualifiersPerGroup} por grupo${wildcardEs} a un cuadro eliminatorio Team estándar.`,\n          `${qualifiersPerGroup} per group qualify${wildcardEn} for a standard Team knockout bracket.`,\n        );\n      }\n      case "top2_final":\n        return tr(locale, "En liga de grupo único, 1.º y 2.º disputan directamente la final.", "In a single-group league, 1st and 2nd advance directly to the final.");\n      case "top4_semis":\n        return tr(locale, "En grupo único, los cuatro primeros juegan semifinales: 1.º vs 4.º y 2.º vs 3.º.", "In a single group, the top four play semifinals: 1st vs 4th and 2nd vs 3rd.");\n      case "top3_step":\n        return tr(locale, "En grupo único, 2.º vs 3.º juegan una serie preliminar y el ganador enfrenta al 1.º en la final.", "In a single group, 2nd vs 3rd play a preliminary encounter and the winner faces 1st in the final.");\n      case "league_only":\n        return tr(locale, "La categoría se define por la tabla de un único grupo, sin fase eliminatoria.", "The category is decided by a single-group table with no knockout phase.");\n    }\n  })();\n  const competitionItems = [\n    format.competition.groupRounds === 2 ? tr(locale, "La fase de grupos se disputa a dos vueltas.", "The group stage is a double round robin.") : tr(locale, "La fase de grupos se disputa a una vuelta.", "The group stage is a single round robin."),\n    playoffCopy,\n    ...(format.competition.bronzeMatch && format.competition.playoffMode !== "league_only" && format.competition.playoffMode !== "top3_step"\n      ? [tr(locale, "La fase final incluye una serie por el tercer puesto.", "The final phase includes a third-place encounter.")]\n      : []),\n    tr(locale, "Cada cruce de fase final conserva la misma serie Team y sus rubbers configurados; el ganador avanza automáticamente al siguiente cruce.", "Every post-group matchup keeps the same configured Team encounter and rubbers; the winner automatically advances to the next matchup."),\n  ];\n''',
)

# ---------------------------------------------------------------------------
# Team admin UI: expose qualification/bronz e rules and correctly label finals.
# ---------------------------------------------------------------------------
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '''type TeamEncounter = {\n  id: string;\n  categoryId: string;\n  groupId: string | null;\n''',
    '''type TeamEncounter = {\n  id: string;\n  categoryId: string;\n  stage: "group" | "playoff" | "bronze" | "final";\n  roundLabel: string | null;\n  roundNumber: number | null;\n  groupId: string | null;\n''',
)
replace_once(
    'apps/web/src/TeamTournamentPanel.tsx',
    '  structureLocked: number;\n  formatVersionId: string | null;\n  entryCount: number;\n',
    '  structureLocked: number;\n  formatVersionId: string | null;\n  competitionStatus: string | null;\n  entryCount: number;\n',
)
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '''          <div className="four">\n            <label><span>{tr(locale, "Ganador", "Winner rule")}</span><select value={draft.encounter.winnerRule} onChange={(event) => updateEncounter({ winnerRule: event.target.value as TeamFormat["encounter"]["winnerRule"], targetWins: event.target.value === "majority" ? null : draft.encounter.targetWins ?? 3 })}><option value="majority">Majority</option><option value="first_to">First to X</option></select></label>\n            <label><span>{tr(locale, "Objetivo", "Target")}</span><input type="number" min="1" disabled={draft.encounter.winnerRule !== "first_to"} value={draft.encounter.targetWins ?? ""} onChange={(event) => updateEncounter({ targetWins: Number(event.target.value) || null })} /></label>\n            <label><span>{tr(locale, "Vueltas de grupos", "Group rounds")}</span><select value={draft.competition.groupRounds} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, groupRounds: Number(event.target.value) as 1 | 2 } }))}><option value="1">1</option><option value="2">2</option></select></label>\n            <label><span>Playoff</span><select value={draft.competition.playoffMode} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, playoffMode: event.target.value as TeamFormat["competition"]["playoffMode"] } }))}><option value="standard">Standard</option><option value="top2_final">Top 2 → Final</option><option value="top4_semis">Top 4 → Semis</option><option value="top3_step">Top 3 ladder</option><option value="league_only">League only</option></select></label>\n          </div>\n          <label className="check team-check"><input type="checkbox" checked={draft.encounter.playRemainingAfterClinched} onChange={(event) => updateEncounter({ playRemainingAfterClinched: event.target.checked })} /><span>{tr(locale, "Jugar rubbers restantes aunque la serie ya esté definida", "Play remaining rubbers after the encounter is clinched")}</span></label>\n''',
    '''          <div className="four">\n            <label><span>{tr(locale, "Ganador", "Winner rule")}</span><select value={draft.encounter.winnerRule} onChange={(event) => updateEncounter({ winnerRule: event.target.value as TeamFormat["encounter"]["winnerRule"], targetWins: event.target.value === "majority" ? null : draft.encounter.targetWins ?? 3 })}><option value="majority">Majority</option><option value="first_to">First to X</option></select></label>\n            <label><span>{tr(locale, "Objetivo", "Target")}</span><input type="number" min="1" disabled={draft.encounter.winnerRule !== "first_to"} value={draft.encounter.targetWins ?? ""} onChange={(event) => updateEncounter({ targetWins: Number(event.target.value) || null })} /></label>\n            <label><span>{tr(locale, "Vueltas de grupos", "Group rounds")}</span><select value={draft.competition.groupRounds} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, groupRounds: Number(event.target.value) as 1 | 2 } }))}><option value="1">1</option><option value="2">2</option></select></label>\n            <label><span>Playoff</span><select value={draft.competition.playoffMode} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, playoffMode: event.target.value as TeamFormat["competition"]["playoffMode"] } }))}><option value="standard">Standard</option><option value="top2_final">Top 2 → Final</option><option value="top4_semis">Top 4 → Semis</option><option value="top3_step">Top 3 ladder</option><option value="league_only">League only</option></select></label>\n          </div>\n          <div className="three">\n            <label><span>{tr(locale, "Clasificados/grupo", "Qualifiers/group")}</span><input type="number" min="1" disabled={draft.competition.playoffMode !== "standard"} value={draft.competition.qualifiersPerGroup ?? 2} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, qualifiersPerGroup: Math.max(1, Number(event.target.value) || 1) } }))} /></label>\n            <label><span>Wildcards</span><input type="number" min="0" disabled={draft.competition.playoffMode !== "standard"} value={draft.competition.wildcardQualifiers ?? 0} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, wildcardQualifiers: Math.max(0, Number(event.target.value) || 0) } }))} /></label>\n            <label className="check team-check"><input type="checkbox" disabled={draft.competition.playoffMode === "league_only" || draft.competition.playoffMode === "top3_step"} checked={Boolean(draft.competition.bronzeMatch)} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, bronzeMatch: event.target.checked } }))} /><span>{tr(locale, "Serie por bronce", "Third-place encounter")}</span></label>\n          </div>\n          <label className="check team-check"><input type="checkbox" checked={draft.encounter.playRemainingAfterClinched} onChange={(event) => updateEncounter({ playRemainingAfterClinched: event.target.checked })} /><span>{tr(locale, "Jugar rubbers restantes aunque la serie ya esté definida", "Play remaining rubbers after the encounter is clinched")}</span></label>\n''',
)
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '  const maxGroups = Math.max(1, Math.floor(category.entries.length / 2));\n',
    '  const maxGroups = category.format?.competition.playoffMode === "standard" ? Math.max(1, Math.floor(category.entries.length / 2)) : 1;\n',
)
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '''      <div className="panel-title"><div><div className="eyebrow">COMPETITION</div><h2>{tr(locale, "Grupos y series", "Groups & encounters")}</h2><p>{tr(locale, "La primera versión genera round-robin de grupos. El playoff Team se conecta en el siguiente bloque.", "This first version generates group round-robin. Team playoffs connect in the next block.")}</p></div><span>{category.encounters.length}</span></div>\n''',
    '''      <div className="panel-title"><div><div className="eyebrow">COMPETITION</div><h2>{tr(locale, "Grupos, series y fase final", "Groups, encounters & final phase")}</h2><p>{tr(locale, "Al terminar la última serie de grupos, HUAU genera la fase final configurada y propaga automáticamente cada ganador.", "When the last group encounter finishes, HUAU generates the configured final phase and automatically advances each winner.")}</p></div><span>{category.encounters.length}</span></div>\n''',
)
# Add manual final-phase generation for already-completed Phase 5 structures.
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '''  const grouped = useMemo(() => {\n    const map = new Map<string, { id: string; name: string; entries: string[] }>();\n''',
    '''  const groupEncounters = category.encounters.filter((encounter) => encounter.stage === "group");\n  const groupStageComplete = groupEncounters.length > 0 && groupEncounters.every((encounter) => encounter.status === "finished");\n  const finalPhaseExists = category.encounters.some((encounter) => encounter.stage !== "group") || category.competitionStatus === "completed";\n  const generateFinals = async () => {\n    await mutate(() => api(`/api/admin/team-categories/${category.id}/finals/generate`, { method: "POST", body: JSON.stringify({}) }));\n  };\n  const grouped = useMemo(() => {\n    const map = new Map<string, { id: string; name: string; entries: string[] }>();\n''',
)
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '''      </form>\n      {grouped.length ? <div className="team-group-grid">{grouped.map((group) => <div className="team-group-card" key={group.id}><strong>{tr(locale, "Grupo", "Group")} {group.name}</strong>{group.entries.map((entry, index) => <span key={`${entry}-${index}`}>{index + 1}. {entry}</span>)}</div>)}</div> : null}\n''',
    '''      </form>\n      {groupStageComplete && !finalPhaseExists && <div className="form-actions"><button className="ghost small" type="button" disabled={busy} onClick={() => void generateFinals()}>{category.format?.competition.playoffMode === "league_only" ? tr(locale, "Cerrar liga por tabla", "Close league table") : tr(locale, "Generar fase final", "Generate final phase")}</button></div>}\n      {grouped.length ? <div className="team-group-grid">{grouped.map((group) => <div className="team-group-card" key={group.id}><strong>{tr(locale, "Grupo", "Group")} {group.name}</strong>{group.entries.map((entry, index) => <span key={`${entry}-${index}`}>{index + 1}. {entry}</span>)}</div>)}</div> : null}\n''',
)
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '''  const lineupA = encounter.lineups.find((lineup) => lineup.entryId === entryA.id);\n  const lineupB = encounter.lineups.find((lineup) => lineup.entryId === entryB.id);\n  return (\n''',
    '''  const lineupA = encounter.lineups.find((lineup) => lineup.entryId === entryA.id);\n  const lineupB = encounter.lineups.find((lineup) => lineup.entryId === entryB.id);\n  const stageLabel = encounter.stage === "group"\n    ? `${tr(locale, "Grupo", "Group")} ${encounter.groupName ?? "—"} · V${encounter.legNumber}`\n    : encounter.roundLabel ?? tr(locale, "Fase final", "Final phase");\n  return (\n''',
)
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '''        <div><span>{tr(locale, "Grupo", "Group")} {encounter.groupName ?? "—"} · V{encounter.legNumber}</span><h3>{entryA.displayName} <em>{winsA} — {winsB}</em> {entryB.displayName}</h3></div>\n''',
    '''        <div><span>{stageLabel}</span><h3>{entryA.displayName} <em>{winsA} — {winsB}</em> {entryB.displayName}</h3></div>\n''',
)
replace_once(
    "apps/web/src/TeamTournamentPanel.tsx",
    '''    category.encounters.forEach(encounter => {\n      const lineupsLocked = encounter.lineups.filter(lineup => lineup.status === "locked").length >= 2;\n''',
    '''    category.encounters.forEach(encounter => {\n      if (!encounter.entryAId || !encounter.entryBId || !encounter.sideA || !encounter.sideB) return;\n      const lineupsLocked = encounter.lineups.filter(lineup => lineup.status === "locked").length >= 2;\n''',
)

insert_after_once(
    'apps/web/src/TeamTournamentPanel.tsx',
    'function encounterDisplayScore(category:TeamCategory,encounter:TeamEncounter){const weights=new Map<string,number>(category.format?.encounter.rubbers.map(rubber=>[rubber.key,rubber.weight] as const)??[]);return {a:encounter.matches.filter(match=>match.winnerSide==="A").reduce((sum,match)=>sum+(weights.get(match.rubberKey)??1),0),b:encounter.matches.filter(match=>match.winnerSide==="B").reduce((sum,match)=>sum+(weights.get(match.rubberKey)??1),0)};}\n',
    '\nfunction TeamFinalPhaseSummary({ category, locale }: { category: TeamCategory; locale: Locale }) {\n  const encounters = category.encounters.filter((encounter) => encounter.stage !== "group");\n  if (!encounters.length) {\n    if (category.competitionStatus === "completed" && category.format?.competition.playoffMode === "league_only") {\n      return <div className="team-competition-groups"><div className="team-competition-group"><h3>{tr(locale,"Fase final","Final phase")}</h3><div className="team-competition-series"><span>{tr(locale,"Liga completa","League complete")}</span><strong>{tr(locale,"Campeón por tabla","Table champion")}</strong><small>completed</small></div></div></div>;\n    }\n    return null;\n  }\n  return <div className="team-competition-groups"><div className="team-competition-group"><h3>{tr(locale,"Fase final","Final phase")}</h3>{encounters.map((encounter) => {\n    const score = encounterDisplayScore(category, encounter);\n    return <div className="team-competition-series" key={encounter.id}><span>{encounter.roundLabel ?? encounter.stage}</span><strong>{encounter.sideA || tr(locale,"Por definir","TBD")} {score.a} — {score.b} {encounter.sideB || tr(locale,"Por definir","TBD")}</strong><small>{encounter.status}</small></div>;\n  })}</div></div>;\n}\n',
)
replace_once(
    'apps/web/src/TeamTournamentPanel.tsx',
    '      <TeamStandings category={category} locale={locale}/>\n',
    '      <TeamStandings category={category} locale={locale}/>\n      <TeamFinalPhaseSummary category={category} locale={locale}/>\n',
)

# ---------------------------------------------------------------------------
# Team Worker: standings -> final plan -> persisted encounters -> propagation.
# ---------------------------------------------------------------------------
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''  generateTeamRoundRobinEncounters,\n  parseTeamFormat,\n''',
    '''  generateTeamRoundRobinEncounters,\n  generateTeamFinalPhasePlan,\n  parseTeamFormat,\n''',
)
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''  type TeamFormat,\n  type TeamLineupAssignment,\n''',
    '''  type TeamFormat,\n  type TeamGroupStandingSnapshot,\n  type TeamLineupAssignment,\n''',
)

worker_helpers = r'''

async function teamStandingSnapshots(
  env: Env,
  categoryId: string,
  format: TeamFormat,
): Promise<TeamGroupStandingSnapshot[]> {
  const [groupRows, encounterRows] = await Promise.all([
    env.HUAU_DB.prepare(
      `SELECT g.id as groupId,g.name as groupName,ge.entry_id as entryId,e.display_name as entryName,ge.sort_order as sortOrder
         FROM competition_groups g JOIN competitions c ON c.id=g.competition_id
         JOIN competition_group_entries ge ON ge.group_id=g.id JOIN tournament_entries e ON e.id=ge.entry_id
        WHERE c.category_id=? ORDER BY g.sort_order,ge.sort_order`,
    ).bind(categoryId).all<{ groupId: string; groupName: string; entryId: string; entryName: string; sortOrder: number }>(),
    env.HUAU_DB.prepare(
      `SELECT ce.id,ce.group_id as groupId,ce.entry_a_id as entryAId,ce.entry_b_id as entryBId,ce.winner_entry_id as winnerEntryId,
              SUM(CASE WHEN mr.result_status IN ('final','corrected') AND m.winner_side='A' THEN 1 ELSE 0 END) as rubbersWonA,
              SUM(CASE WHEN mr.result_status IN ('final','corrected') AND m.winner_side='B' THEN 1 ELSE 0 END) as rubbersWonB,
              SUM(CASE WHEN mr.result_status IN ('final','corrected') THEN COALESCE(mr.score_a,0) ELSE 0 END) as pointsA,
              SUM(CASE WHEN mr.result_status IN ('final','corrected') THEN COALESCE(mr.score_b,0) ELSE 0 END) as pointsB
         FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id
         LEFT JOIN matches m ON m.encounter_id=ce.id LEFT JOIN match_results mr ON mr.match_id=m.id
        WHERE c.category_id=? AND ce.stage='group' AND ce.status='finished'
        GROUP BY ce.id,ce.group_id,ce.entry_a_id,ce.entry_b_id,ce.winner_entry_id`,
    ).bind(categoryId).all<{ id: string; groupId: string; entryAId: string; entryBId: string; winnerEntryId: string; rubbersWonA: number; rubbersWonB: number; pointsA: number; pointsB: number }>(),
  ]);
  const snapshots: TeamGroupStandingSnapshot[] = [];
  const groupIds = [...new Set(groupRows.results.map((row) => row.groupId))];
  for (const groupId of groupIds) {
    const rows = groupRows.results.filter((row) => row.groupId === groupId);
    const entries: TeamEntry[] = rows.map((row) => ({ id: row.entryId, name: row.entryName, roster: [] }));
    const results: TeamStandingEncounter[] = encounterRows.results
      .filter((row) => row.groupId === groupId && row.winnerEntryId)
      .map((row) => ({
        id: row.id,
        entryAId: row.entryAId,
        entryBId: row.entryBId,
        winnerEntryId: row.winnerEntryId,
        rubbersWonA: Number(row.rubbersWonA ?? 0),
        rubbersWonB: Number(row.rubbersWonB ?? 0),
        pointsA: Number(row.pointsA ?? 0),
        pointsB: Number(row.pointsB ?? 0),
      }));
    const standing = calculateTeamStandings({ entries, encounters: results, criteria: format.standings.criteria });
    snapshots.push({ groupId, groupName: rows[0]?.groupName ?? "", rows: standing.rows });
  }
  return snapshots;
}

function appendTeamRubberMatches(
  statements: D1PreparedStatement[],
  env: Env,
  encounterId: string,
  format: TeamFormat,
  encounterStatus: "pending" | "ready",
  sideA: string | null,
  sideB: string | null,
  stamp: number,
) {
  [...format.encounter.rubbers].sort((a, b) => a.order - b.order).forEach((rubber, index) => {
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO matches
         (id,encounter_id,rubber_key,rubber_order,mode,competition_gender,best_of,point_target,scoring_mode,status,side_a_label,side_b_label,winner_side,manual_override,created_at,updated_at,version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,?,?,1)`,
      ).bind(
        uuid(), encounterId, rubber.key, rubber.order, rubber.mode, rubber.gender, rubber.bestOf, rubber.pointTarget,
        rubber.scoringMode, encounterStatus === "ready" && index === 0 ? "ready" : "pending", sideA, sideB, stamp, stamp,
      ),
    );
  });
}

type PersistedTeamFinalEncounter = {
  id: string;
  stage: string;
  entryAId: string | null;
  entryBId: string | null;
  sourceEncounterAId: string | null;
  sourceEncounterBId: string | null;
  sourceLoserAId: string | null;
  sourceLoserBId: string | null;
  status: string;
  winnerEntryId: string | null;
};

function sourceEntry(
  source: PersistedTeamFinalEncounter | undefined,
  loser: boolean,
): string | null {
  if (!source || (source.status !== "finished" && source.status !== "bye") || !source.winnerEntryId) return null;
  if (!loser) return source.winnerEntryId;
  if (!source.entryAId || !source.entryBId) return null;
  return source.winnerEntryId === source.entryAId ? source.entryBId : source.entryAId;
}

async function progressTeamFinalPhase(env: Env, competitionId: string, format: TeamFormat) {
  const names = await env.HUAU_DB.prepare(
    `SELECT e.id,e.display_name as displayName FROM tournament_entries e JOIN competitions c ON c.category_id=e.category_id WHERE c.id=?`,
  ).bind(competitionId).all<{ id: string; displayName: string }>();
  const nameById = new Map(names.results.map((entry) => [entry.id, entry.displayName] as const));

  for (let pass = 0; pass < 64; pass += 1) {
    const result = await env.HUAU_DB.prepare(
      `SELECT id,stage,entry_a_id as entryAId,entry_b_id as entryBId,
              source_encounter_a_id as sourceEncounterAId,source_encounter_b_id as sourceEncounterBId,
              source_loser_a_id as sourceLoserAId,source_loser_b_id as sourceLoserBId,status,winner_entry_id as winnerEntryId
         FROM competition_encounters WHERE competition_id=? AND stage<>'group' ORDER BY round_number,created_at`,
    ).bind(competitionId).all<PersistedTeamFinalEncounter>();
    const byId = new Map(result.results.map((encounter) => [encounter.id, encounter] as const));
    const statements: D1PreparedStatement[] = [];
    let changed = false;
    for (const encounter of result.results) {
      if (encounter.status === "finished" || encounter.status === "bye") continue;
      const desiredA = encounter.sourceEncounterAId
        ? sourceEntry(byId.get(encounter.sourceEncounterAId), false)
        : encounter.sourceLoserAId
          ? sourceEntry(byId.get(encounter.sourceLoserAId), true)
          : encounter.entryAId;
      const desiredB = encounter.sourceEncounterBId
        ? sourceEntry(byId.get(encounter.sourceEncounterBId), false)
        : encounter.sourceLoserBId
          ? sourceEntry(byId.get(encounter.sourceLoserBId), true)
          : encounter.entryBId;
      const participantChanged = desiredA !== encounter.entryAId || desiredB !== encounter.entryBId;
      const nextStatus = desiredA && desiredB ? "ready" : "pending";
      if (!participantChanged && encounter.status === nextStatus) continue;
      changed = true;
      if (participantChanged) {
        statements.push(env.HUAU_DB.prepare(`DELETE FROM team_encounter_lineups WHERE encounter_id=?`).bind(encounter.id));
      }
      statements.push(
        env.HUAU_DB.prepare(
          `UPDATE competition_encounters SET entry_a_id=?,entry_b_id=?,status=?,updated_at=?,version=version+1 WHERE id=?`,
        ).bind(desiredA, desiredB, nextStatus, unixNow(), encounter.id),
        env.HUAU_DB.prepare(
          `UPDATE matches SET side_a_label=?,side_b_label=?,
                  status=CASE WHEN ?='ready' AND rubber_order=(SELECT MIN(rubber_order) FROM matches WHERE encounter_id=?) THEN 'ready' ELSE 'pending' END,
                  winner_side=NULL,updated_at=?,version=version+1
            WHERE encounter_id=? AND status NOT IN ('finished','skipped')`,
        ).bind(desiredA ? nameById.get(desiredA) ?? null : null, desiredB ? nameById.get(desiredB) ?? null : null, nextStatus, encounter.id, unixNow(), encounter.id),
      );
    }
    if (statements.length) await runBatches(env.HUAU_DB, statements);
    if (!changed) break;
  }
  const final = await env.HUAU_DB.prepare(
    `SELECT id FROM competition_encounters WHERE competition_id=? AND stage='final' AND status IN ('finished','bye') LIMIT 1`,
  ).bind(competitionId).first();
  const unfinishedMedal = await env.HUAU_DB.prepare(
    `SELECT id FROM competition_encounters WHERE competition_id=? AND stage IN ('final','bronze') AND status NOT IN ('finished','bye') LIMIT 1`,
  ).bind(competitionId).first();
  await env.HUAU_DB.prepare(`UPDATE competitions SET status=?,updated_at=? WHERE id=?`)
    .bind(final && !unfinishedMedal ? "completed" : "final_phase", unixNow(), competitionId)
    .run();
}

async function ensureTeamFinalPhase(
  env: Env,
  tournament: TournamentRow,
  categoryId: string,
  userId: string,
): Promise<boolean> {
  const competition = await env.HUAU_DB.prepare(`SELECT id,status FROM competitions WHERE category_id=?`).bind(categoryId).first<{ id: string; status: string }>();
  if (!competition) return false;
  const existing = await env.HUAU_DB.prepare(`SELECT id FROM competition_encounters WHERE competition_id=? AND stage<>'group' LIMIT 1`).bind(competition.id).first();
  if (existing || competition.status === "completed") return false;
  const counts = await env.HUAU_DB.prepare(
    `SELECT COUNT(*) as total,SUM(CASE WHEN status='finished' THEN 1 ELSE 0 END) as finished
       FROM competition_encounters WHERE competition_id=? AND stage='group'`,
  ).bind(competition.id).first<{ total: number; finished: number }>();
  if (!counts || Number(counts.total) === 0 || Number(counts.finished ?? 0) !== Number(counts.total)) return false;

  const format = await formatForCategory(env, categoryId);
  const standings = await teamStandingSnapshots(env, categoryId, format);
  const plan = generateTeamFinalPhasePlan({ format, standings });
  if (format.competition.playoffMode === "league_only" || !plan.encounters.length) {
    await env.HUAU_DB.prepare(`UPDATE competitions SET status='completed',updated_at=? WHERE id=?`).bind(unixNow(), competition.id).run();
    await audit(env, tournament, userId, "team.final_phase.complete_league", "Completed Team category by standings", "category", categoryId);
    return true;
  }

  const ids = new Map(plan.encounters.map((encounter) => [encounter.id, uuid()] as const));
  const names = await env.HUAU_DB.prepare(`SELECT id,display_name as displayName FROM tournament_entries WHERE category_id=?`).bind(categoryId).all<{ id: string; displayName: string }>();
  const nameById = new Map(names.results.map((entry) => [entry.id, entry.displayName] as const));
  const stamp = unixNow();
  const statements: D1PreparedStatement[] = [];
  for (const encounter of plan.encounters) {
    const encounterId = ids.get(encounter.id)!;
    const sourceA = encounter.sourceEncounterAId ? ids.get(encounter.sourceEncounterAId) ?? null : null;
    const sourceB = encounter.sourceEncounterBId ? ids.get(encounter.sourceEncounterBId) ?? null : null;
    const loserA = encounter.sourceLoserAId ? ids.get(encounter.sourceLoserAId) ?? null : null;
    const loserB = encounter.sourceLoserBId ? ids.get(encounter.sourceLoserBId) ?? null : null;
    statements.push(
      env.HUAU_DB.prepare(
        `INSERT INTO competition_encounters
         (id,competition_id,stage,group_id,round_label,round_number,leg_number,entry_a_id,entry_b_id,source_encounter_a_id,source_encounter_b_id,source_loser_a_id,source_loser_b_id,status,winner_entry_id,created_at,updated_at,version)
         VALUES (?,?,?,NULL,?,?,1,?,?,?,?,?,?,?,?,?,?,1)`,
      ).bind(
        encounterId, competition.id, encounter.stage, encounter.roundLabel, encounter.roundNumber,
        encounter.entryAId, encounter.entryBId, sourceA, sourceB, loserA, loserB, encounter.status, encounter.winnerEntryId, stamp, stamp,
      ),
    );
    if (encounter.status !== "bye") {
      appendTeamRubberMatches(
        statements, env, encounterId, format, encounter.status === "ready" ? "ready" : "pending",
        encounter.entryAId ? nameById.get(encounter.entryAId) ?? null : null,
        encounter.entryBId ? nameById.get(encounter.entryBId) ?? null : null,
        stamp,
      );
    }
  }
  statements.push(env.HUAU_DB.prepare(`UPDATE competitions SET status='final_phase',updated_at=? WHERE id=?`).bind(stamp, competition.id));
  await runBatches(env.HUAU_DB, statements);
  await progressTeamFinalPhase(env, competition.id, format);
  await regenerateTournamentScheduleForAdmin(env, tournament.id, userId);
  await audit(env, tournament, userId, "team.final_phase.generate", `Generated Team final phase (${format.competition.playoffMode})`, "category", categoryId, { qualifiers: plan.qualifiers.length, encounters: plan.encounters.length });
  return true;
}

async function downstreamTeamResultExists(env: Env, encounterId: string): Promise<boolean> {
  const row = await env.HUAU_DB.prepare(
    `WITH RECURSIVE downstream(id) AS (
       SELECT id FROM competition_encounters
        WHERE source_encounter_a_id=? OR source_encounter_b_id=? OR source_loser_a_id=? OR source_loser_b_id=?
       UNION
       SELECT ce.id FROM competition_encounters ce JOIN downstream d
         ON ce.source_encounter_a_id=d.id OR ce.source_encounter_b_id=d.id OR ce.source_loser_a_id=d.id OR ce.source_loser_b_id=d.id
     )
     SELECT mr.match_id as matchId FROM downstream d JOIN matches m ON m.encounter_id=d.id JOIN match_results mr ON mr.match_id=m.id
      WHERE mr.result_status IN ('final','corrected') LIMIT 1`,
  ).bind(encounterId, encounterId, encounterId, encounterId).first();
  return Boolean(row);
}
'''
insert_after_once(
    "apps/web/src/worker/team-admin.ts",
    '''  if (winsA !== needed && winsB !== needed) throw new Error("TEAM_RESULT_INCOMPLETE");\n  return { winnerSide: winsA > winsB ? "A" : "B", pointsA, pointsB };\n}\n''',
    worker_helpers,
)

replace_once(
    "apps/web/src/worker/team-admin.ts",
    '  const maxGroups = Math.max(1, Math.floor(teams.length / 2));\n',
    '  const maxGroups = format.competition.playoffMode === "standard" ? Math.max(1, Math.floor(teams.length / 2)) : 1;\n',
)

# Match result query needs competition/stage for progression.
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''            ce.entry_a_id as entryAId,ce.entry_b_id as entryBId,c.category_id as categoryId,tc.tournament_id as tournamentId\n''',
    '''            ce.entry_a_id as entryAId,ce.entry_b_id as entryBId,ce.stage,c.id as competitionId,c.category_id as categoryId,tc.tournament_id as tournamentId\n''',
)
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''      entryBId: string;\n      categoryId: string;\n      tournamentId: string;\n    }>();\n''',
    '''      entryBId: string;\n      stage: string;\n      competitionId: string;\n      categoryId: string;\n      tournamentId: string;\n    }>();\n''',
)
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''  if (existingResult && laterResult) return json({ ok: false, code: "TEAM_RESULT_CORRECTION_BLOCKED_BY_LATER_RESULT" }, { status: 409 });\n''',
    '''  if (existingResult && (laterResult || await downstreamTeamResultExists(env, match.encounterId))) {\n    return json({ ok: false, code: "TEAM_RESULT_CORRECTION_BLOCKED_BY_LATER_RESULT" }, { status: 409 });\n  }\n''',
)
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''  await runBatches(env.HUAU_DB, stateStatements);\n  await bumpTournament(env, accessResult.tournament.id);\n''',
    '''  await runBatches(env.HUAU_DB, stateStatements);\n  if (score.complete) {\n    if (match.stage === "group") await ensureTeamFinalPhase(env, accessResult.tournament, match.categoryId, accessResult.user.id);\n    else await progressTeamFinalPhase(env, match.competitionId, format);\n  }\n  await bumpTournament(env, accessResult.tournament.id);\n''',
)

# Team detail includes stage/round metadata so UI can distinguish playoff encounters.
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''      `SELECT ce.id,c.category_id as categoryId,ce.group_id as groupId,g.name as groupName,ce.leg_number as legNumber,\n              ce.entry_a_id as entryAId,ea.display_name as sideA,ce.entry_b_id as entryBId,eb.display_name as sideB,\n''',
    '''      `SELECT ce.id,c.category_id as categoryId,ce.stage,ce.round_label as roundLabel,ce.round_number as roundNumber,ce.group_id as groupId,g.name as groupName,ce.leg_number as legNumber,\n              ce.entry_a_id as entryAId,ea.display_name as sideA,ce.entry_b_id as entryBId,eb.display_name as sideB,\n''',
)
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''  const encounterRows = encounters.results as Array<{ id: string; categoryId: string; groupId: string | null; groupName: string | null; legNumber: number; entryAId: string; sideA: string; entryBId: string; sideB: string; status: string; winnerEntryId: string | null }>;\n''',
    '''  const encounterRows = encounters.results as Array<{ id: string; categoryId: string; stage: "group" | "playoff" | "bronze" | "final"; roundLabel: string | null; roundNumber: number | null; groupId: string | null; groupName: string | null; legNumber: number; entryAId: string; sideA: string; entryBId: string; sideB: string; status: string; winnerEntryId: string | null }>;\n''',
)

replace_once(
    'apps/web/src/worker/team-admin.ts',
    '      `SELECT tc.id,tc.name,tc.scheduled_date as scheduledDate,tc.structure_locked as structureLocked,tc.format_version_id as formatVersionId,\n              f.config_json as configJson,\n',
    '      `SELECT tc.id,tc.name,tc.scheduled_date as scheduledDate,tc.structure_locked as structureLocked,tc.format_version_id as formatVersionId,\n              c.status as competitionStatus,f.config_json as configJson,\n',
)
replace_once(
    'apps/web/src/worker/team-admin.ts',
    "         FROM tournament_categories tc LEFT JOIN competition_format_versions f ON f.id=tc.format_version_id\n        WHERE tc.tournament_id=? AND tc.entry_type='team' ORDER BY tc.sort_order,tc.name`,\n",
    "         FROM tournament_categories tc LEFT JOIN competition_format_versions f ON f.id=tc.format_version_id\n         LEFT JOIN competitions c ON c.category_id=tc.id\n        WHERE tc.tournament_id=? AND tc.entry_type='team' ORDER BY tc.sort_order,tc.name`,\n",
)
replace_once(
    'apps/web/src/worker/team-admin.ts',
    '  const categoryRows = categories.results as Array<{ id: string; name: string; scheduledDate: string | null; structureLocked: number; formatVersionId: string | null; configJson: string | null; entryCount: number }>;\n',
    '  const categoryRows = categories.results as Array<{ id: string; name: string; scheduledDate: string | null; structureLocked: number; formatVersionId: string | null; competitionStatus: string | null; configJson: string | null; entryCount: number }>;\n',
)

# Manual endpoint for categories whose group stage was already complete before Phase 8.1.
finals_fn = r'''

async function generateFinalPhaseNow(
  request: Request,
  env: Env,
  categoryId: string,
  access: AccessHelpers,
): Promise<Response> {
  const accessResult = await categoryForAccess(categoryId, request, env, access);
  if (accessResult instanceof Response) return accessResult;
  const generated = await ensureTeamFinalPhase(env, accessResult.tournament, categoryId, accessResult.user.id);
  if (!generated) {
    const pending = await env.HUAU_DB.prepare(
      `SELECT id FROM competition_encounters ce JOIN competitions c ON c.id=ce.competition_id
        WHERE c.category_id=? AND ce.stage='group' AND ce.status<>'finished' LIMIT 1`,
    ).bind(categoryId).first();
    if (pending) return json({ ok: false, code: "TEAM_GROUP_STAGE_INCOMPLETE" }, { status: 409 });
  }
  await bumpTournament(env, accessResult.tournament.id);
  return json({ ok: true, generated });
}
'''
insert_after_once(
    "apps/web/src/worker/team-admin.ts",
    '''  return json({ ok: true, groupCount });\n}\n''',
    finals_fn,
)
replace_once(
    "apps/web/src/worker/team-admin.ts",
    '''  const lineupRoute = url.pathname.match(/^\\/api\\/admin\\/team-encounters\\/([^/]+)\\/lineups\\/([^/]+)$/);\n''',
    '''  const finalsRoute = url.pathname.match(/^\\/api\\/admin\\/team-categories\\/([^/]+)\\/finals\\/generate$/);\n  if (finalsRoute && request.method === "POST") return generateFinalPhaseNow(request, env, decodeURIComponent(finalsRoute[1]!), access);\n\n  const lineupRoute = url.pathname.match(/^\\/api\\/admin\\/team-encounters\\/([^/]+)\\/lineups\\/([^/]+)$/);\n''',
)

# ---------------------------------------------------------------------------
# Team schedule placeholders for unresolved final-phase encounters.
# ---------------------------------------------------------------------------
replace_once(
    'apps/web/src/worker/tournament-admin.ts',
    'type TeamScheduleMatchRow = {\n  matchId: string;\n  encounterId: string;\n  rubberKey: string;\n  rubberOrder: number;\n  bestOf: number;\n  matchStatus: string;\n  stage: string;\n  legNumber: number;\n  groupName: string | null;\n  entryAId: string;\n  sideA: string;\n  entryBId: string;\n  sideB: string;\n};\n',
    'type TeamScheduleMatchRow = {\n  matchId: string;\n  encounterId: string;\n  rubberKey: string;\n  rubberOrder: number;\n  bestOf: number;\n  matchStatus: string;\n  stage: string;\n  legNumber: number;\n  groupName: string | null;\n  entryAId: string | null;\n  sideA: string | null;\n  entryBId: string | null;\n  sideB: string | null;\n  sourceEncounterAId: string | null;\n  sourceEncounterBId: string | null;\n  sourceLoserAId: string | null;\n  sourceLoserBId: string | null;\n};\n',
)
replace_once(
    'apps/web/src/worker/tournament-admin.ts',
    '              m.status as matchStatus,ce.stage,ce.leg_number as legNumber,g.name as groupName,\n              ce.entry_a_id as entryAId,ea.display_name as sideA,ce.entry_b_id as entryBId,eb.display_name as sideB\n         FROM matches m\n         JOIN competition_encounters ce ON ce.id=m.encounter_id\n         JOIN competitions c ON c.id=ce.competition_id\n         LEFT JOIN competition_groups g ON g.id=ce.group_id\n         JOIN tournament_entries ea ON ea.id=ce.entry_a_id\n         JOIN tournament_entries eb ON eb.id=ce.entry_b_id\n',
    '              m.status as matchStatus,ce.stage,ce.leg_number as legNumber,g.name as groupName,\n              ce.entry_a_id as entryAId,ea.display_name as sideA,ce.entry_b_id as entryBId,eb.display_name as sideB,\n              ce.source_encounter_a_id as sourceEncounterAId,ce.source_encounter_b_id as sourceEncounterBId,\n              ce.source_loser_a_id as sourceLoserAId,ce.source_loser_b_id as sourceLoserBId\n         FROM matches m\n         JOIN competition_encounters ce ON ce.id=m.encounter_id\n         JOIN competitions c ON c.id=ce.competition_id\n         LEFT JOIN competition_groups g ON g.id=ce.group_id\n         LEFT JOIN tournament_entries ea ON ea.id=ce.entry_a_id\n         LEFT JOIN tournament_entries eb ON eb.id=ce.entry_b_id\n',
)
replace_once(
    'apps/web/src/worker/tournament-admin.ts',
    '    const nextEncounterAtByTeam = new Map<string, number>();\n\n    for (const encounterId of encounterOrder) {\n',
    '    const nextEncounterAtByTeam = new Map<string, number>();\n    const encounterEndById = new Map<string, number>();\n\n    for (const encounterId of encounterOrder) {\n',
)
replace_once(
    'apps/web/src/worker/tournament-admin.ts',
    '        const earliest = Math.max(\n          courtAvailable[courtIndex] ?? categoryStart,\n          nextEncounterAtByTeam.get(first.entryAId) ?? categoryStart,\n          nextEncounterAtByTeam.get(first.entryBId) ?? categoryStart,\n        );\n',
    '        const sourceIds = [first.sourceEncounterAId, first.sourceEncounterBId, first.sourceLoserAId, first.sourceLoserBId].filter((value): value is string => Boolean(value));\n        const dependencyReady = sourceIds.reduce((latest, sourceId) => Math.max(latest, (encounterEndById.get(sourceId) ?? categoryStart) + restSeconds), categoryStart);\n        const earliest = Math.max(\n          courtAvailable[courtIndex] ?? categoryStart,\n          dependencyReady,\n          first.entryAId ? nextEncounterAtByTeam.get(first.entryAId) ?? categoryStart : categoryStart,\n          first.entryBId ? nextEncounterAtByTeam.get(first.entryBId) ?? categoryStart : categoryStart,\n        );\n',
)
replace_once(
    'apps/web/src/worker/tournament-admin.ts',
    '      courtAvailable[selectedCourt] = cursor;\n      nextEncounterAtByTeam.set(first.entryAId, cursor + restSeconds);\n      nextEncounterAtByTeam.set(first.entryBId, cursor + restSeconds);\n',
    '      courtAvailable[selectedCourt] = cursor;\n      encounterEndById.set(encounterId, cursor);\n      if (first.entryAId) nextEncounterAtByTeam.set(first.entryAId, cursor + restSeconds);\n      if (first.entryBId) nextEncounterAtByTeam.set(first.entryBId, cursor + restSeconds);\n',
)

print("[phase8.1] patches applied successfully")
