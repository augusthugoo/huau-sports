/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "./i18n";
import {
  applyLocalTeamPreset,
  cloneDay,
  generateLocalStandardStructure,
  generateLocalTeamStructure,
  saveLocalStandardFormat,
  saveLocalTeamLineup,
  setLocalTeamFormat,
} from "./TournamentDayEngine";
import type { TeamFormat, TeamLineupAssignment } from "@huau/core";
import {
  ensureDayLocalMeta,
  markStructureDirty,
  moveLocalStandardEntryToGroup,
  teamEntryRating,
  type TournamentDayReformSnapshot,
} from "./TournamentDayReformEngine";

export type EpicDayMutate = (
  fn: (snapshot: TournamentDayReformSnapshot) => void,
  message?: string,
  kind?: "structure" | "live" | "neutral",
) => Promise<void>;

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);
const round2 = (value: number) => Math.round(value * 100) / 100;

function toMs(value: number) {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function dayMinutes(start: string, end: string) {
  const parse = (value: string) => {
    const [h = 0, m = 0] = value.split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  return Math.max(0, parse(end) - parse(start));
}

function balancedSizes(entries: number, groups: number) {
  const count = Math.max(1, Math.min(groups, Math.max(1, entries)));
  return Array.from({ length: count }, (_, index) =>
    Math.floor(entries / count) + (index < entries % count ? 1 : 0),
  );
}

function roundRobinMatches(sizes: number[], rounds = 1) {
  return sizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0) * Math.max(1, rounds);
}

function playoffMatches(
  groups: number,
  qualifiersPerGroup: number,
  wildcards: number,
  mode: string,
  bronze: boolean,
) {
  if (mode === "league_only") return 0;
  if (mode === "top2_final") return 1;
  if (mode === "top3_step") return 2 + (bronze ? 1 : 0);
  if (mode === "top4_semis") return 3 + (bronze ? 1 : 0);
  const qualified = Math.max(2, groups * Math.max(1, qualifiersPerGroup) + Math.max(0, wildcards));
  return Math.max(1, qualified - 1) + (bronze && qualified >= 4 ? 1 : 0);
}

function suggestedGroups(entries: number, preferred: number, maxGroups: number) {
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let groups = 1; groups <= Math.max(1, maxGroups); groups += 1) {
    const sizes = balancedSizes(entries, groups);
    if (sizes.some((size) => size < 2)) continue;
    const score = sizes.reduce((sum, size) => sum + Math.abs(size - preferred), 0);
    if (score < bestScore) {
      best = groups;
      bestScore = score;
    }
  }
  return best;
}

function activeGroupCount(snapshot: TournamentDayReformSnapshot, categoryId: string, isTeam: boolean) {
  if (isTeam) {
    const category = (snapshot.team.categories as any[]).find((row) => String(row.id) === categoryId);
    return new Set((category?.groups ?? []).map((row: any) => String(row.id))).size;
  }
  const competition = (snapshot.workspace.standard.competitions as any[]).find(
    (row) => String(row.categoryId) === categoryId,
  );
  return competition?.groups?.length ?? 0;
}

function categoryEntryCount(snapshot: TournamentDayReformSnapshot, category: any) {
  if (category.entryType === "team") {
    return (
      (snapshot.team.categories as any[]).find((row) => String(row.id) === String(category.id))?.entries?.length ?? 0
    );
  }
  return (snapshot.workspace.standard.entries as any[]).filter(
    (row) => String(row.categoryId) === String(category.id),
  ).length;
}

function categoryFormat(snapshot: TournamentDayReformSnapshot, category: any) {
  if (category.entryType === "team") {
    return (snapshot.team.categories as any[]).find((row) => String(row.id) === String(category.id))?.format ?? null;
  }
  const competition = (snapshot.workspace.standard.competitions as any[]).find(
    (row) => String(row.categoryId) === String(category.id),
  );
  if (competition?.format) return competition.format;
  try {
    return category.configJson ? JSON.parse(category.configJson) : null;
  } catch {
    return null;
  }
}

function formatModeLabel(locale: Locale, value: string) {
  const labels: Record<string, [string, string]> = {
    standard: ["Cuadro estándar", "Standard bracket"],
    top2_final: ["Top 2 → final", "Top 2 → final"],
    top4_semis: ["Top 4 → semifinales", "Top 4 → semifinals"],
    top3_step: ["Escalera Top 3", "Top 3 ladder"],
    league_only: ["Liga / grupos solamente", "League / groups only"],
  };
  const pair = labels[value] ?? [value, value];
  return tr(locale, pair[0], pair[1]);
}

function capacityEstimate(input: {
  entries: number;
  groups: number;
  rounds: number;
  qualifiers: number;
  wildcards: number;
  playoffMode: string;
  bronze: boolean;
  courts: number;
  availableMinutes: number;
  matchMinutes: number;
  isTeam: boolean;
  rubberSlots: number;
}) {
  const sizes = balancedSizes(input.entries, input.groups);
  const groupSeries = roundRobinMatches(sizes, input.rounds);
  const finals = playoffMatches(input.groups, input.qualifiers, input.wildcards, input.playoffMode, input.bronze);
  const totalSeries = Math.round(groupSeries + finals);
  const unitMultiplier = input.isTeam ? Math.max(1, input.rubberSlots) : 1;
  const courtMinutes = totalSeries * input.matchMinutes * unitMultiplier;
  const elapsed = Math.ceil(courtMinutes / Math.max(1, input.courts));
  const minimumSeries = Math.max(0, Math.min(...sizes) - 1) * Math.max(1, input.rounds);
  return {
    sizes,
    groupSeries: Math.round(groupSeries),
    finals,
    totalSeries,
    courtMinutes,
    elapsed,
    minimumSeries,
    fits: elapsed <= input.availableMinutes,
  };
}

export function EpicFormatStudio({
  locale,
  snapshot,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDayReformSnapshot;
  mutate: EpicDayMutate;
}) {
  const categories = snapshot.workspace.core.categories as any[];
  const settings = snapshot.workspace.core.settings as any;
  const tournament = snapshot.workspace.core.tournament as any;
  const [categoryId, setCategoryId] = useState(String(categories[0]?.id ?? ""));
  const category = categories.find((row) => String(row.id) === categoryId) ?? categories[0];
  const isTeam = category?.entryType === "team";
  const entries = category ? categoryEntryCount(snapshot, category) : 0;
  const format = category ? categoryFormat(snapshot, category) : null;
  const activeGroups = category ? activeGroupCount(snapshot, String(category.id), isTeam) : 0;
  const maxGroups = Math.max(1, Math.floor(entries / 2));
  const preferred = Math.max(2, Number(settings.preferredGroup ?? 4));
  const recommended = suggestedGroups(entries, preferred, maxGroups);
  const [groups, setGroups] = useState(activeGroups || recommended);
  const [seeding, setSeeding] = useState<"snake" | "random">("snake");

  useEffect(() => {
    if (!category) return;
    const current = activeGroupCount(snapshot, String(category.id), category.entryType === "team");
    const count = categoryEntryCount(snapshot, category);
    setGroups(current || suggestedGroups(count, preferred, Math.max(1, Math.floor(count / 2))));
  }, [categoryId]);

  if (!category) return <div className="empty-state">{tr(locale, "No hay categorías.", "No categories.")}</div>;

  const rounds = Number(format?.competition?.groupRounds ?? format?.groupRounds ?? 1) === 2 ? 2 : 1;
  const qualifiers = Math.max(1, Number(format?.competition?.qualifiersPerGroup ?? format?.qualifiersPerGroup ?? 2));
  const wildcards = Math.max(0, Number(format?.competition?.wildcardQualifiers ?? format?.wildcardQualifiers ?? 0));
  const playoffMode = String(format?.competition?.playoffMode ?? format?.playoffMode ?? "standard");
  const bronze = Boolean(format?.competition?.bronzeMatch ?? format?.bronzeMatch ?? true);
  const rubbers = isTeam ? (format?.encounter?.rubbers ?? []) : [];
  const matchMinutes = Math.max(5, Number(settings.defaultMatchMinutes ?? 30));
  const courts = Math.max(1, Number(tournament.courtCount ?? 1));
  const availableMinutes = dayMinutes(String(settings.dailyStart ?? "09:00"), String(settings.dailyEnd ?? "20:00"));
  const optionCounts = Array.from({ length: maxGroups }, (_, index) => index + 1).filter((count) => {
    const sizes = balancedSizes(entries, count);
    return sizes.every((size) => size >= 2);
  });

  const apply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextRounds = Number(data.get("groupRounds")) === 2 ? 2 : 1;
    const nextQualifiers = Math.max(1, Number(data.get("qualifiers") ?? qualifiers));
    const nextWildcards = Math.max(0, Number(data.get("wildcards") ?? wildcards));
    const nextPlayoff = String(data.get("playoffMode") ?? playoffMode);
    const nextBronze = data.get("bronze") === "on";
    await mutate(
      (next) => {
        const nextSettings = next.workspace.core.settings as any;
        nextSettings.dailyStart = String(data.get("dailyStart") ?? settings.dailyStart ?? "09:00");
        nextSettings.dailyEnd = String(data.get("dailyEnd") ?? settings.dailyEnd ?? "20:00");
        nextSettings.defaultMatchMinutes = Math.max(5, Number(data.get("matchMinutes") ?? matchMinutes));
        (next.workspace.core.tournament as any).courtCount = Math.max(1, Number(data.get("courts") ?? courts));

        if (isTeam) {
          const nextCategory = (next.team.categories as any[]).find(
            (row) => String(row.id) === String(category.id),
          );
          if (!nextCategory?.format) throw new Error("TEAM_FORMAT_NOT_FOUND");
          const nextFormat = cloneDay(nextCategory.format) as TeamFormat;
          nextFormat.competition.groupRounds = nextRounds;
          nextFormat.competition.qualifiersPerGroup = nextQualifiers;
          nextFormat.competition.wildcardQualifiers = nextWildcards;
          nextFormat.competition.playoffMode = nextPlayoff as any;
          nextFormat.competition.bronzeMatch = nextBronze;
          nextFormat.roster.min = Math.max(1, Number(data.get("rosterMin") ?? nextFormat.roster.min));
          nextFormat.roster.max = Math.max(nextFormat.roster.min, Number(data.get("rosterMax") ?? nextFormat.roster.max));
          nextFormat.roster.composition = String(data.get("rosterComposition") ?? nextFormat.roster.composition) as any;
          nextFormat.roster.rules.maleMin = Math.max(0, Number(data.get("maleMin") ?? nextFormat.roster.rules.maleMin));
          nextFormat.roster.rules.femaleMin = Math.max(0, Number(data.get("femaleMin") ?? nextFormat.roster.rules.femaleMin));
          nextFormat.roster.rules.maleMax = String(data.get("maleMax") ?? "").trim() ? Math.max(0, Number(data.get("maleMax"))) : null;
          nextFormat.roster.rules.femaleMax = String(data.get("femaleMax") ?? "").trim() ? Math.max(0, Number(data.get("femaleMax"))) : null;
          nextFormat.roster.substitutesAllowed = data.get("substitutesAllowed") === "on";
          nextFormat.roster.captainRequired = data.get("captainRequired") === "on";
          nextFormat.encounter.winnerRule = String(data.get("winnerRule") ?? nextFormat.encounter.winnerRule) as any;
          nextFormat.encounter.targetWins = String(data.get("targetWins") ?? "").trim() ? Math.max(1, Number(data.get("targetWins"))) : null;
          nextFormat.encounter.playRemainingAfterClinched = data.get("playRemainingAfterClinched") === "on";
          const criteria = ["standing_points", "encounter_wins", "encounter_win_rate", "head_to_head", "rubber_diff", "point_diff", "points_for"]
            .filter((criterion) => data.get(`criterion:${criterion}`) === "on");
          nextFormat.standings.criteria = (criteria.length ? criteria : ["standing_points", "head_to_head", "rubber_diff", "point_diff"]) as any;
          nextFormat.encounter.rubbers = nextFormat.encounter.rubbers.map((rubber, index) => ({
            ...rubber,
            label: String(data.get(`rubber:${rubber.key}:label`) ?? rubber.label).trim() || rubber.label,
            order: index + 1,
            mode: String(data.get(`rubber:${rubber.key}:mode`) ?? rubber.mode) as any,
            gender: String(data.get(`rubber:${rubber.key}:gender`) ?? rubber.gender) as any,
            play: String(data.get(`rubber:${rubber.key}:play`) ?? rubber.play) as any,
            isTiebreaker: data.get(`rubber:${rubber.key}:tiebreaker`) === "on",
            weight: Math.max(0, Number(data.get(`rubber:${rubber.key}:weight`) ?? rubber.weight)),
            bestOf: Number(data.get(`rubber:${rubber.key}:bestOf`)) === 3 ? 3 : 1,
            pointTarget: Math.max(1, Number(data.get(`rubber:${rubber.key}:target`) ?? rubber.pointTarget)),
            scoringMode: String(data.get(`rubber:${rubber.key}:scoringMode`) ?? "").trim() || null,
          }));
          setLocalTeamFormat(next, String(category.id), nextFormat);

          const ordered = [...nextCategory.entries];
          if (seeding === "snake") {
            ordered.sort(
              (a: any, b: any) =>
                teamEntryRating(next, String(category.id), String(b.id)) -
                  teamEntryRating(next, String(category.id), String(a.id)) ||
                String(a.displayName).localeCompare(String(b.displayName)),
            );
          } else {
            ordered.sort(() => Math.random() - 0.5);
          }
          ordered.forEach((entry: any, index: number) => {
            entry.seedOrder = index + 1;
            entry.seedRating = teamEntryRating(next, String(category.id), String(entry.id));
          });
          generateLocalTeamStructure(next, String(category.id), groups);
        } else {
          saveLocalStandardFormat(next, String(category.id), {
            groupRounds: nextRounds,
            qualifiersPerGroup: nextQualifiers,
            wildcardQualifiers: nextWildcards,
            playoffMode: nextPlayoff as any,
            crossGroupMethod: String(data.get("crossGroupMethod") ?? format?.crossGroupMethod ?? "normalized") as any,
            consolationMode: String(data.get("consolationMode") ?? format?.consolationMode ?? "none") as any,
            avoidGroupRematches: data.get("avoidGroupRematches") === "on",
            bronzeMatch: nextBronze,
            finalDrawMethod: String(data.get("finalDrawMethod") ?? format?.finalDrawMethod ?? "performance") as any,
            medalSchedule: String(data.get("medalSchedule") ?? format?.medalSchedule ?? "simultaneous") as any,
            preferredRestSlots: Math.max(0, Number(data.get("preferredRestSlots") ?? format?.preferredRestSlots ?? 1)),
            preliminary: {
              bestOf: Number(data.get("preBestOf")) === 3 ? 3 : 1,
              pointTarget: Math.max(1, Number(data.get("preTarget") ?? format?.preliminary?.pointTarget ?? 15)),
            },
            medal: {
              bestOf: Number(data.get("medalBestOf")) === 1 ? 1 : 3,
              pointTarget: Math.max(1, Number(data.get("medalTarget") ?? format?.medal?.pointTarget ?? 11)),
            },
          });
          generateLocalStandardStructure(next, String(category.id), groups, seeding);
        }
        next.workspace.schedule.schedule = [];
        markStructureDirty(next);
      },
      tr(
        locale,
        `Formato aplicado a ${category.name}: ${groups} grupo(s).`,
        `Format applied to ${category.name}: ${groups} group(s).`,
      ),
      "structure",
    );
  };

  const mutateTeamRubber = async (action: "add" | "up" | "down" | "remove", index = -1) => {
    if (!isTeam) return;
    await mutate((next) => {
      const nextCategory = (next.team.categories as any[]).find((row) => String(row.id) === String(category.id));
      if (!nextCategory?.format) throw new Error("TEAM_FORMAT_NOT_FOUND");
      const nextFormat = cloneDay(nextCategory.format) as TeamFormat;
      if (action === "add") {
        const order = nextFormat.encounter.rubbers.length + 1;
        nextFormat.encounter.rubbers.push({ key: `r${Date.now()}`, label: `${tr(locale,"Partido","Rubber")} ${order}`, order, mode: "doubles", gender: "open", play: "always", isTiebreaker: false, weight: 1, bestOf: 1, pointTarget: 15, scoringMode: null });
      } else if (index >= 0 && index < nextFormat.encounter.rubbers.length) {
        if (action === "remove") {
          if (nextFormat.encounter.rubbers.length <= 1) throw new Error("TEAM_RUBBER_REQUIRED");
          nextFormat.encounter.rubbers.splice(index, 1);
        } else {
          const target = action === "up" ? index - 1 : index + 1;
          if (target < 0 || target >= nextFormat.encounter.rubbers.length) return;
          [nextFormat.encounter.rubbers[index], nextFormat.encounter.rubbers[target]] = [nextFormat.encounter.rubbers[target]!, nextFormat.encounter.rubbers[index]!];
        }
      }
      nextFormat.encounter.rubbers = nextFormat.encounter.rubbers.map((rubber, rubberIndex) => ({ ...rubber, order: rubberIndex + 1 }));
      setLocalTeamFormat(next, String(category.id), nextFormat);
      markStructureDirty(next);
    }, tr(locale,"Reglas Team actualizadas. Revisá la simulación antes de generar.","Team rules updated. Review the simulation before generating."),"structure");
  };

  return (
    <section className="td-stack epic-format-studio">
      <article className="panel epic-format-hero">
        <div>
          <div className="eyebrow">{tr(locale, "DISEÑO DE COMPETENCIA", "COMPETITION DESIGN")}</div>
          <h2>{tr(locale, "Formato por categoría", "Category format")}</h2>
          <p className="muted">
            {tr(
              locale,
              "Elegí cómo querés jugar esta categoría. HUAU traduce la decisión a grupos, partidos, clasificación y tiempo estimado antes de generar nada.",
              "Choose how this category should be played. HUAU translates the decision into groups, matches, qualification and estimated time before generating anything.",
            )}
          </p>
        </div>
        <div className="epic-format-context">
          <strong>{entries}</strong>
          <span>{isTeam ? tr(locale, "equipos", "teams") : tr(locale, "participantes", "entries")}</span>
          <b>{courts} {tr(locale, "canchas", "courts")}</b>
        </div>
      </article>

      <article className="panel">
        <div className="td-category-tabs epic-category-tabs">
          {categories.map((row) => (
            <button
              type="button"
              key={row.id}
              className={String(row.id) === String(category.id) ? "light small" : "ghost small"}
              onClick={() => setCategoryId(String(row.id))}
            >
              {row.name}
            </button>
          ))}
        </div>
      </article>

      <form className="td-stack" onSubmit={apply} key={String(category.id)}>
        <article className="panel epic-format-category">
          <div className="panel-title">
            <div>
              <span className="eyebrow">{isTeam ? "TEAM" : "STANDARD"}</span>
              <h2>{category.name}</h2>
              <p className="muted">
                {activeGroups
                  ? tr(locale, `Estructura activa: ${activeGroups} grupo(s).`, `Active structure: ${activeGroups} group(s).`)
                  : tr(locale, "Todavía no hay estructura generada.", "No structure has been generated yet.")}
              </p>
            </div>
            {isTeam && String(format?.presetId ?? "").includes("senior") ? (
              <span className="epic-badge">Senior Cup 2026</span>
            ) : null}
          </div>

          <div className="epic-format-controls">
            <label>
              <span>{tr(locale, "Vueltas en grupos", "Group rounds")}</span>
              <select name="groupRounds" defaultValue={String(rounds)}>
                <option value="1">1 · {tr(locale, "todos contra todos", "round robin")}</option>
                <option value="2">2 · {tr(locale, "ida y vuelta", "double round robin")}</option>
              </select>
            </label>
            <label>
              <span>{tr(locale, "Clasifican por grupo", "Qualifiers per group")}</span>
              <input name="qualifiers" type="number" min="1" defaultValue={qualifiers} />
            </label>
            <label>
              <span>{tr(locale, "Cupos extra por rendimiento", "Extra performance spots")}</span>
              <input name="wildcards" type="number" min="0" defaultValue={wildcards} />
            </label>
            <label>
              <span>{tr(locale, "Fase posterior", "Post-group phase")}</span>
              <select name="playoffMode" defaultValue={playoffMode}>
                <option value="standard">{formatModeLabel(locale, "standard")}</option>
                <option value="top2_final">{formatModeLabel(locale, "top2_final")}</option>
                <option value="top4_semis">{formatModeLabel(locale, "top4_semis")}</option>
                <option value="top3_step">{formatModeLabel(locale, "top3_step")}</option>
                <option value="league_only">{formatModeLabel(locale, "league_only")}</option>
              </select>
            </label>
            <label>
              <span>{tr(locale, "Siembra", "Seeding")}</span>
              <select value={seeding} onChange={(event) => setSeeding(event.target.value as "snake" | "random") }>
                <option value="snake">DUPR / snake</option>
                <option value="random">{tr(locale, "Aleatorio", "Random")}</option>
              </select>
            </label>
            <label className="check epic-check">
              <input name="bronze" type="checkbox" defaultChecked={bronze} />
              <span>{tr(locale, "Partido por 3.º puesto", "Bronze match")}</span>
            </label>
          </div>

          {!isTeam ? (
            <details className="epic-advanced">
              <summary>{tr(locale, "Criterios deportivos y puntuación", "Sport criteria & scoring")}</summary>
              <div className="epic-format-controls">
                <label><span>{tr(locale,"Comparación entre grupos","Cross-group comparison")}</span><select name="crossGroupMethod" defaultValue={String(format?.crossGroupMethod ?? "normalized")}><option value="normalized">{tr(locale,"Normalizada · porcentajes/promedios","Normalized · percentages/averages")}</option><option value="equalized">{tr(locale,"Equiparada · rivales comunes","Equalized · common opponents")}</option></select></label>
                <label><span>{tr(locale,"Armado fase final","Final draw")}</span><select name="finalDrawMethod" defaultValue={String(format?.finalDrawMethod ?? "performance")}><option value="performance">{tr(locale,"Rendimiento cruzado","Cross-group performance")}</option><option value="pots">{tr(locale,"Bombos","Pots")}</option></select></label>
                <label><span>{tr(locale,"Consolación","Consolation")}</span><select name="consolationMode" defaultValue={String(format?.consolationMode ?? "none")}><option value="none">{tr(locale,"No","No")}</option><option value="knockout">Knockout</option></select></label>
                <label><span>{tr(locale,"Medallas","Medal scheduling")}</span><select name="medalSchedule" defaultValue={String(format?.medalSchedule ?? "simultaneous")}><option value="simultaneous">{tr(locale,"Final y bronce simultáneos","Final & bronze simultaneous")}</option><option value="sequential">{tr(locale,"Secuenciales","Sequential")}</option></select></label>
                <label><span>{tr(locale,"Grupos","Groups")}</span><select name="preBestOf" defaultValue={String(format?.preliminary?.bestOf ?? 1)}><option value="1">1 set</option><option value="3">Mejor de 3</option></select></label>
                <label><span>{tr(locale,"Puntos grupos","Group target")}</span><input name="preTarget" type="number" min="1" defaultValue={Number(format?.preliminary?.pointTarget ?? 15)} /></label>
                <label><span>{tr(locale,"Final / bronce","Final / bronze")}</span><select name="medalBestOf" defaultValue={String(format?.medal?.bestOf ?? 3)}><option value="1">1 set</option><option value="3">Mejor de 3</option></select></label>
                <label><span>{tr(locale,"Puntos final","Final target")}</span><input name="medalTarget" type="number" min="1" defaultValue={Number(format?.medal?.pointTarget ?? 11)} /></label>
                <label><span>{tr(locale,"Descanso preferido","Preferred rest")}</span><input name="preferredRestSlots" type="number" min="0" defaultValue={Number(format?.preferredRestSlots ?? settings.preferredRestSlots ?? 1)} /></label>
                <label className="check epic-check"><input name="avoidGroupRematches" type="checkbox" defaultChecked={Boolean(format?.avoidGroupRematches ?? true)} /><span>{tr(locale,"Evitar revancha inmediata de grupo","Avoid immediate group rematch")}</span></label>
              </div>
            </details>
          ) : (
            <>
              <div className="epic-team-format-summary">
                <div><span>{tr(locale,"Roster","Roster")}</span><strong>{format?.roster?.min ?? "—"}–{format?.roster?.max ?? "—"}</strong><small>{format?.roster?.composition ?? "—"}</small></div>
                <div><span>{tr(locale,"Serie","Encounter")}</span><strong>{rubbers.length} rubbers</strong><small>{rubbers.map((rubber: any) => String(rubber.key).toUpperCase()).join(" → ")}</small></div>
                <div><span>{tr(locale,"Desempate","Tiebreak")}</span><strong>{rubbers.find((rubber: any) => rubber.play === "if_tied" || rubber.isTiebreaker)?.label ?? tr(locale,"No","No")}</strong><small>{tr(locale,"misma cancha durante la serie","same court for the full encounter")}</small></div>
              </div>
              <details className="epic-advanced">
                <summary>{tr(locale, "Reglas Team avanzadas", "Advanced Team rules")}</summary>
                <div className="epic-team-advanced-block">
                  <h4>{tr(locale,"Roster","Roster")}</h4>
                  <div className="epic-format-controls">
                    <label><span>{tr(locale,"Mínimo","Minimum")}</span><input name="rosterMin" type="number" min="1" defaultValue={Number(format?.roster?.min ?? 1)} /></label>
                    <label><span>{tr(locale,"Máximo","Maximum")}</span><input name="rosterMax" type="number" min="1" defaultValue={Number(format?.roster?.max ?? 6)} /></label>
                    <label><span>{tr(locale,"Composición","Composition")}</span><select name="rosterComposition" defaultValue={String(format?.roster?.composition ?? "open")}><option value="open">Open</option><option value="mixed">Mixed</option><option value="male">Male</option><option value="female">Female</option></select></label>
                    <label><span>{tr(locale,"Hombres mín.","Men min.")}</span><input name="maleMin" type="number" min="0" defaultValue={Number(format?.roster?.rules?.maleMin ?? 0)} /></label>
                    <label><span>{tr(locale,"Hombres máx.","Men max.")}</span><input name="maleMax" type="number" min="0" defaultValue={format?.roster?.rules?.maleMax ?? ""} /></label>
                    <label><span>{tr(locale,"Mujeres mín.","Women min.")}</span><input name="femaleMin" type="number" min="0" defaultValue={Number(format?.roster?.rules?.femaleMin ?? 0)} /></label>
                    <label><span>{tr(locale,"Mujeres máx.","Women max.")}</span><input name="femaleMax" type="number" min="0" defaultValue={format?.roster?.rules?.femaleMax ?? ""} /></label>
                    <label className="check epic-check"><input name="captainRequired" type="checkbox" defaultChecked={Boolean(format?.roster?.captainRequired)} /><span>{tr(locale,"Capitán obligatorio","Captain required")}</span></label>
                    <label className="check epic-check"><input name="substitutesAllowed" type="checkbox" defaultChecked={Boolean(format?.roster?.substitutesAllowed)} /><span>{tr(locale,"Permitir suplentes y cambios futuros","Allow substitutes and future roster changes")}</span></label>
                  </div>
                </div>
                <div className="epic-team-advanced-block">
                  <h4>{tr(locale,"Serie","Encounter")}</h4>
                  <div className="epic-format-controls">
                    <label><span>{tr(locale,"Regla ganador","Winner rule")}</span><select name="winnerRule" defaultValue={String(format?.encounter?.winnerRule ?? "majority")}><option value="majority">Majority</option><option value="first_to">First to</option></select></label>
                    <label><span>{tr(locale,"Objetivo victorias","Target wins")}</span><input name="targetWins" type="number" min="1" defaultValue={format?.encounter?.targetWins ?? ""} /></label>
                    <label className="check epic-check"><input name="playRemainingAfterClinched" type="checkbox" defaultChecked={Boolean(format?.encounter?.playRemainingAfterClinched)} /><span>{tr(locale,"Jugar restantes tras definir","Play remaining after clinched")}</span></label>
                  </div>
                </div>
                <div className="epic-team-advanced-block">
                  <div className="panel-title"><h4>Rubbers</h4><button type="button" className="ghost small" onClick={()=>void mutateTeamRubber("add")}>{tr(locale,"Agregar rubber","Add rubber")}</button></div>
                  <div className="epic-team-rubber-editor">
                    {rubbers.map((rubber: any, index: number) => <div key={rubber.key} className="epic-team-rubber-edit"><header><b>{index+1}</b><strong>{String(rubber.key).toUpperCase()}</strong><div><button type="button" className="ghost small" disabled={index===0} onClick={()=>void mutateTeamRubber("up",index)}>↑</button><button type="button" className="ghost small" disabled={index===rubbers.length-1} onClick={()=>void mutateTeamRubber("down",index)}>↓</button><button type="button" className="danger small" disabled={rubbers.length<=1} onClick={()=>void mutateTeamRubber("remove",index)}>×</button></div></header><label><span>{tr(locale,"Nombre","Label")}</span><input name={`rubber:${rubber.key}:label`} defaultValue={rubber.label} /></label><label><span>{tr(locale,"Modo","Mode")}</span><select name={`rubber:${rubber.key}:mode`} defaultValue={rubber.mode}><option value="singles">Singles</option><option value="doubles">Doubles</option></select></label><label><span>{tr(locale,"Género","Gender")}</span><select name={`rubber:${rubber.key}:gender`} defaultValue={rubber.gender}><option value="male">Male</option><option value="female">Female</option><option value="mixed">Mixed</option><option value="open">Open</option></select></label><label><span>{tr(locale,"Cuándo juega","Play condition")}</span><select name={`rubber:${rubber.key}:play`} defaultValue={rubber.play}><option value="always">Always</option><option value="if_tied">If tied</option></select></label><label><span>{tr(locale,"Peso","Weight")}</span><input name={`rubber:${rubber.key}:weight`} type="number" min="0" step="1" defaultValue={rubber.weight} /></label><label><span>Best of</span><select name={`rubber:${rubber.key}:bestOf`} defaultValue={String(rubber.bestOf)}><option value="1">1</option><option value="3">3</option></select></label><label><span>{tr(locale,"Puntos","Target")}</span><input name={`rubber:${rubber.key}:target`} type="number" min="1" defaultValue={rubber.pointTarget} /></label><label><span>{tr(locale,"Scoring","Scoring")}</span><input name={`rubber:${rubber.key}:scoringMode`} defaultValue={rubber.scoringMode ?? ""} /></label><label className="check epic-check"><input name={`rubber:${rubber.key}:tiebreaker`} type="checkbox" defaultChecked={Boolean(rubber.isTiebreaker)} /><span>{tr(locale,"Desempate","Tiebreaker")}</span></label></div>)}
                  </div>
                </div>
                <div className="epic-team-advanced-block"><h4>{tr(locale,"Desempates de tabla","Standings tie-breaks")}</h4><div className="epic-criteria-grid">{["standing_points","encounter_wins","encounter_win_rate","head_to_head","rubber_diff","point_diff","points_for"].map((criterion)=><label className="check epic-check" key={criterion}><input name={`criterion:${criterion}`} type="checkbox" defaultChecked={(format?.standings?.criteria??[]).includes(criterion)} /><span>{criterion.replaceAll("_"," ")}</span></label>)}</div></div>
              </details>
            </>
          )}
        </article>

        <article className="panel epic-options-panel">
          <div className="panel-title">
            <div>
              <div className="eyebrow">{tr(locale,"SIMULACIÓN","SIMULATION")}</div>
              <h2>{tr(locale,"Elegí la estructura", "Choose the structure")}</h2>
            </div>
            <span>{entries} · {courts} {tr(locale,"canchas","courts")} · {matchMinutes} min</span>
          </div>
          <div className="epic-option-grid">
            {optionCounts.map((count) => {
              const estimate = capacityEstimate({ entries, groups: count, rounds, qualifiers, wildcards, playoffMode, bronze, courts, availableMinutes, matchMinutes, isTeam, rubberSlots: isTeam ? rubbers.length : 1 });
              const recommendedOption = count === recommended;
              const selected = count === groups;
              return (
                <button type="button" key={count} className={`epic-option-card ${selected ? "selected" : ""}`} onClick={() => setGroups(count)}>
                  <header><span>{recommendedOption ? tr(locale,"RECOMENDADA","RECOMMENDED") : tr(locale,"OPCIÓN","OPTION")}</span><b className={estimate.fits ? "fits" : "over"}>{estimate.fits ? tr(locale,"Entra en horario","Fits") : tr(locale,"Excede estimación","Over estimate")}</b></header>
                  <h3>{count} {count === 1 ? tr(locale,"grupo","group") : tr(locale,"grupos","groups")}</h3>
                  <p>{estimate.sizes.map((size, index) => `${String.fromCharCode(65 + index)}: ${size}`).join(" · ")}</p>
                  <div className="epic-option-kpis">
                    <span><strong>{estimate.minimumSeries}</strong>{tr(locale,isTeam?"series mín./equipo":"partidos mínimos","min. encounters/matches")}</span>
                    <span><strong>{estimate.totalSeries}</strong>{tr(locale,isTeam?"series totales":"partidos totales","total encounters/matches")}</span>
                    <span><strong>{Math.floor(estimate.elapsed / 60)}h {estimate.elapsed % 60}m</strong>{tr(locale,"duración estimada","estimated duration")}</span>
                    <span><strong>{Math.min(entries, count * qualifiers + wildcards)}</strong>{tr(locale,"clasificación","qualifying")}</span>
                  </div>
                  <small>{rounds} {tr(locale,"vuelta(s) · fase de grupos","round(s) · group phase")} {estimate.groupSeries} · {tr(locale,"fase posterior","post-group")} {estimate.finals}</small>
                </button>
              );
            })}
          </div>
        </article>

        <article className="panel epic-format-apply">
          <div className="epic-operational-strip">
            <label><span>{tr(locale,"Inicio jornada","Day start")}</span><input name="dailyStart" type="time" defaultValue={String(settings.dailyStart ?? "09:00")} /></label>
            <label><span>{tr(locale,"Fin duro","Hard end")}</span><input name="dailyEnd" type="time" defaultValue={String(settings.dailyEnd ?? "20:00")} /></label>
            <label><span>{tr(locale,"Canchas","Courts")}</span><input name="courts" type="number" min="1" defaultValue={courts} /></label>
            <label><span>{tr(locale,"Min/partido","Min/match")}</span><input name="matchMinutes" type="number" min="5" defaultValue={matchMinutes} /></label>
          </div>
          <div className="panel-title">
            <p className="muted">{tr(locale,"Aplicar reconstruye solamente esta categoría y limpia su cronograma local para regenerarlo después.","Apply rebuilds only this category and clears its local schedule so it can be regenerated afterwards.")}</p>
            <button className="light epic-primary" disabled={entries < 2}>{tr(locale,"Usar este formato y generar","Use this format & generate")}</button>
          </div>
        </article>
      </form>

      {isTeam ? (
        <article className="panel epic-preset-strip">
          <div><strong>{tr(locale,"Preset rápido","Quick preset")}</strong><span>{tr(locale,"Senior Cup 2026 restaura roster, rubbers, pesos y XD condicional.","Senior Cup 2026 restores roster, rubbers, weights and conditional XD.")}</span></div>
          <button type="button" className="ghost" onClick={() => void mutate((next) => applyLocalTeamPreset(next, String(category.id), "senior_cup_2026"), tr(locale,"Senior Cup 2026 aplicado.","Senior Cup 2026 applied."), "structure")}>Senior Cup 2026</button>
        </article>
      ) : null}
    </section>
  );
}

function stageDescription(locale: Locale, format: any) {
  const q = Math.max(1, Number(format?.competition?.qualifiersPerGroup ?? format?.qualifiersPerGroup ?? 2));
  const wild = Math.max(0, Number(format?.competition?.wildcardQualifiers ?? format?.wildcardQualifiers ?? 0));
  const mode = String(format?.competition?.playoffMode ?? format?.playoffMode ?? "standard");
  if (mode === "league_only") return tr(locale, "La clasificación se define en la liga/grupos; no hay cuadro posterior.", "Standings are decided in league/groups; there is no post-group bracket.");
  return tr(
    locale,
    `Clasifican ${q} por grupo${wild ? ` + ${wild} cupo(s) por rendimiento` : ""}. ${formatModeLabel(locale, mode)}.`,
    `${q} qualify per group${wild ? ` + ${wild} performance spot(s)` : ""}. ${formatModeLabel(locale, mode)}.`,
  );
}

function teamEncounterScore(category: any, encounter: any) {
  let a = 0;
  let b = 0;
  for (const match of encounter.matches ?? []) {
    if (!match.resultStatus) continue;
    const definition = (category.format?.encounter?.rubbers ?? []).find(
      (rubber: any) => String(rubber.key) === String(match.rubberKey),
    );
    const weight = Number(definition?.weight ?? 1);
    if (match.winnerSide === "A") a += weight;
    if (match.winnerSide === "B") b += weight;
  }
  return { a, b };
}

function latestLockedLineup(category: any, encounter: any, entryId: string) {
  const currentIndex = (category.encounters ?? []).findIndex((row: any) => String(row.id) === String(encounter.id));
  const before = currentIndex >= 0 ? (category.encounters ?? []).slice(0, currentIndex) : category.encounters ?? [];
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const lineup = (before[index]?.lineups ?? []).find(
      (row: any) => String(row.entryId) === String(entryId) && String(row.status) === "locked",
    );
    if (lineup) return lineup;
  }
  return null;
}

function rubberEligible(rubber: any, member: any) {
  const gender = String(rubber.gender ?? "open");
  if (gender === "male") return member.sportGender === "male";
  if (gender === "female") return member.sportGender === "female";
  return true;
}

function genderBadge(locale: Locale, gender: string) {
  if (gender === "male") return tr(locale, "M", "M");
  if (gender === "female") return tr(locale, "F", "F");
  return "—";
}

function EpicLineupSide({
  locale,
  category,
  encounter,
  entryId,
  mutate,
}: {
  locale: Locale;
  category: any;
  encounter: any;
  entryId: string;
  mutate: EpicDayMutate;
}) {
  const entry = category.entries.find((row: any) => String(row.id) === String(entryId));
  const existing = (encounter.lineups ?? []).find((row: any) => String(row.entryId) === String(entryId));
  const suggested = existing ?? latestLockedLineup(category, encounter, entryId);
  const checked = new Set(
    (suggested?.assignments ?? []).flatMap((assignment: any) =>
      (assignment.personIds ?? []).map((personId: string) => `${assignment.rubberKey}:${personId}`),
    ),
  );
  const fromBase = !existing && Boolean(suggested);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const assignments: TeamLineupAssignment[] = (category.format?.encounter?.rubbers ?? []).map((rubber: any) => ({
      rubberKey: String(rubber.key),
      personIds: (entry?.roster ?? [])
        .filter((member: any) => data.get(`${rubber.key}:${member.personId}`) === "on")
        .map((member: any) => String(member.personId)),
    }));
    await mutate(
      (next) => saveLocalTeamLineup(next, String(category.id), String(encounter.id), String(entryId), assignments),
      tr(locale, "Alineación bloqueada. Queda sugerida para las próximas series.", "Lineup locked. It will be suggested for future encounters."),
      "structure",
    );
  };

  if (!entry) return null;
  return (
    <form className="epic-lineup-side" onSubmit={save} key={`${encounter.id}:${entryId}:${suggested?.updatedAt ?? "base"}`}>
      <header>
        <div><strong>{entry.displayName}</strong><small>{entry.roster?.length ?? 0} {tr(locale,"jugadores","players")}</small></div>
        {existing?.status === "locked" ? <span className="epic-status-ok">✓ {tr(locale,"Bloqueada","Locked")}</span> : fromBase ? <span className="epic-badge">{tr(locale,"Base sugerida","Suggested base")}</span> : <span className="epic-status-muted">{tr(locale,"Sin bloquear","Unlocked")}</span>}
      </header>
      {(category.format?.encounter?.rubbers ?? []).map((rubber: any) => (
        <div className="epic-lineup-rubber" key={rubber.key}>
          <div className="epic-rubber-title"><strong>{String(rubber.key).toUpperCase()}</strong><span>{rubber.label}</span><em>{rubber.gender}</em></div>
          <div className="epic-player-choice-grid">
            {(entry.roster ?? []).map((member: any) => {
              const eligible = rubberEligible(rubber, member);
              return (
                <label className={`epic-player-choice ${eligible ? "" : "disabled"}`} key={member.personId} title={!eligible ? tr(locale,"No elegible para este rubber","Not eligible for this rubber") : ""}>
                  <input
                    type="checkbox"
                    name={`${rubber.key}:${member.personId}`}
                    defaultChecked={eligible && checked.has(`${rubber.key}:${member.personId}`)}
                    disabled={!eligible}
                  />
                  <span className={`epic-gender ${member.sportGender}`}>{genderBadge(locale, member.sportGender)}</span>
                  <strong>{member.name}</strong>
                  {member.role === "captain" ? <small>C</small> : null}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <button className="light full">{existing ? tr(locale,"Rebloquear alineación","Relock lineup") : tr(locale,"Bloquear alineación","Lock lineup")}</button>
    </form>
  );
}

function TeamRoundView({ locale, category, groupId, mutate }: { locale: Locale; category: any; groupId: string; mutate: EpicDayMutate }) {
  const groupRows = (category.groups ?? []).filter((row: any) => String(row.id) === groupId);
  const encounters = (category.encounters ?? []).filter((row: any) => String(row.groupId) === groupId && row.stage === "group");
  const rounds = new Map<number, any[]>();
  for (const encounter of encounters) {
    const round = Math.max(1, Number(encounter.roundNumber ?? 1));
    const list = rounds.get(round) ?? [];
    list.push(encounter);
    rounds.set(round, list);
  }
  return (
    <div className="epic-group-competition">
      <header><div><span className="eyebrow">{tr(locale,"GRUPO","GROUP")} {groupRows[0]?.name}</span><h3>{groupRows.length} {tr(locale,"equipos","teams")}</h3></div></header>
      <div className="epic-group-members">
        {groupRows.map((row: any, index: number) => (
          <span key={row.entryId}><b>{index + 1}</b><strong>{row.entryName}</strong></span>
        ))}
      </div>
      <div className="epic-rounds">
        {[...rounds.entries()].sort(([a], [b]) => a - b).map(([round, rows]) => {
          const used = new Set(rows.flatMap((encounter: any) => [String(encounter.entryAId), String(encounter.entryBId)]));
          const bye = groupRows.filter((row: any) => !used.has(String(row.entryId)));
          return (
            <section key={round}>
              <div className="epic-round-heading"><strong>{tr(locale,"Ronda","Round")} {round}</strong>{bye.length ? <span>{tr(locale,"Libre","Bye")}: {bye.map((row: any) => row.entryName).join(", ")}</span> : null}</div>
              {rows.map((encounter: any) => {
                const score = teamEncounterScore(category, encounter);
                return (
                  <details className="epic-encounter" key={encounter.id} open={encounter.status === "in_progress"}>
                    <summary>
                      <div><strong>{encounter.sideA}</strong><span>vs</span><strong>{encounter.sideB}</strong></div>
                      <div className="epic-encounter-score"><b>{score.a} — {score.b}</b><span>{encounter.status}</span></div>
                    </summary>
                    <div className="epic-lineup-sides">
                      {encounter.entryAId ? <EpicLineupSide locale={locale} category={category} encounter={encounter} entryId={String(encounter.entryAId)} mutate={mutate} /> : null}
                      {encounter.entryBId ? <EpicLineupSide locale={locale} category={category} encounter={encounter} entryId={String(encounter.entryBId)} mutate={mutate} /> : null}
                    </div>
                  </details>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function EpicCompetitionStudio({
  locale,
  snapshot,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDayReformSnapshot;
  mutate: EpicDayMutate;
}) {
  const coreCategories = snapshot.workspace.core.categories as any[];
  const available = coreCategories.filter((category) => {
    if (category.entryType === "team") {
      const team = (snapshot.team.categories as any[]).find((row) => String(row.id) === String(category.id));
      return Boolean(team?.groups?.length || team?.encounters?.length);
    }
    const competition = (snapshot.workspace.standard.competitions as any[]).find((row) => String(row.categoryId) === String(category.id));
    return Boolean(competition?.groups?.length || competition?.encounters?.length);
  });
  const [categoryId, setCategoryId] = useState(String(available[0]?.id ?? ""));
  useEffect(() => {
    if (available.length && !available.some((row) => String(row.id) === categoryId)) setCategoryId(String(available[0].id));
  }, [available.length, categoryId]);
  const core = available.find((row) => String(row.id) === categoryId) ?? available[0];

  if (!core) {
    return <section className="td-stack"><article className="panel"><h2>{tr(locale,"Todavía no hay competencia generada.","No competition generated yet.")}</h2><p className="muted">{tr(locale,"Definí el formato de una categoría y generala desde Formato.","Define a category format and generate it from Format.")}</p></article></section>;
  }

  const isTeam = core.entryType === "team";
  const teamCategory = isTeam ? (snapshot.team.categories as any[]).find((row) => String(row.id) === String(core.id)) : null;
  const competition = !isTeam ? (snapshot.workspace.standard.competitions as any[]).find((row) => String(row.categoryId) === String(core.id)) : null;
  const format = isTeam ? teamCategory?.format : competition?.format;
  const groupCount = isTeam ? new Set((teamCategory?.groups ?? []).map((row: any) => String(row.id))).size : competition?.groups?.length ?? 0;
  const entries = isTeam ? teamCategory?.entries?.length ?? 0 : competition?.groups?.reduce((sum: number, group: any) => sum + (group.entries?.length ?? 0), 0) ?? 0;

  return (
    <section className="td-stack epic-competition-studio">
      <article className="panel epic-competition-hero">
        <div><div className="eyebrow">{tr(locale,"COMPETENCIA MATERIALIZADA","LIVE COMPETITION")}</div><h2>{tr(locale,"Grupos, rondas y fase final", "Groups, rounds & finals")}</h2><p className="muted">{tr(locale,"Acá ves exactamente lo que se va a jugar. La siembra define quién cae en cada grupo; esta pantalla muestra el resultado deportivo real.","This is exactly what will be played. Seeding decides group placement; this screen shows the actual sporting structure.")}</p></div>
        <div className="epic-format-context"><strong>{entries}</strong><span>{isTeam?tr(locale,"equipos","teams"):tr(locale,"participantes","entries")}</span><b>{groupCount} {tr(locale,"grupos","groups")}</b></div>
      </article>
      <article className="panel"><div className="td-category-tabs epic-category-tabs">{available.map((row) => <button key={row.id} className={String(row.id)===String(core.id)?"light small":"ghost small"} onClick={() => setCategoryId(String(row.id))}>{row.name}</button>)}</div></article>

      <article className="panel epic-sport-criteria">
        <div><strong>{tr(locale,"Criterio deportivo","Sport logic")}</strong><p>{stageDescription(locale, format)}</p></div>
        <span>{formatModeLabel(locale, String(format?.competition?.playoffMode ?? format?.playoffMode ?? "standard"))}</span>
      </article>

      {!isTeam && competition ? (
        <>
          <div className="epic-standard-groups">
            {competition.groups.map((group: any) => (
              <article className="panel epic-standard-group" key={group.id}>
                <div className="panel-title"><div><span className="eyebrow">{tr(locale,"GRUPO","GROUP")} {group.name}</span><h3>{group.entries.length} {tr(locale,"participantes","entries")}</h3></div></div>
                {group.entries.map((entry: any, index: number) => (
                  <div className="epic-group-entry" key={entry.id}><b>{index+1}</b><strong>{entry.name}</strong><select value={group.id} onChange={(event)=>void mutate(next=>moveLocalStandardEntryToGroup(next,String(competition.categoryId),String(entry.id),event.target.value),tr(locale,"Participante movido y grupos recalculados.","Entry moved and groups rebuilt."),"structure")}>{competition.groups.map((target:any)=><option key={target.id} value={target.id}>{tr(locale,"Grupo","Group")} {target.name}</option>)}</select></div>
                ))}
              </article>
            ))}
          </div>
          {(competition.encounters ?? []).some((row: any) => row.stage !== "group") ? (
            <article className="panel"><div className="eyebrow">{tr(locale,"FASE POSTERIOR","POST-GROUP PHASE")}</div><div className="epic-bracket-grid">{(competition.encounters ?? []).filter((row:any)=>row.stage!=="group").map((row:any)=><div key={row.id}><span>{row.roundLabel ?? row.stage}</span><strong>{row.entryA?.name ?? "TBD"}</strong><em>vs</em><strong>{row.entryB?.name ?? "TBD"}</strong><small>{row.status}</small></div>)}</div></article>
          ) : null}
        </>
      ) : null}

      {isTeam && teamCategory ? (
        <>
          <article className="panel epic-seed-overview"><div className="panel-title"><div><div className="eyebrow">{tr(locale,"SIEMBRA ACTUAL","CURRENT SEEDING")}</div><h3>DUPR / seedOrder</h3></div></div><div className="td-seed-list">{[...(teamCategory.entries??[])].sort((a:any,b:any)=>Number(a.seedOrder??999)-Number(b.seedOrder??999)).map((entry:any,index:number)=><span key={entry.id}><b>{index+1}</b>{entry.displayName}<em>{round2(teamEntryRating(snapshot,String(teamCategory.id),String(entry.id))).toFixed(3)}</em></span>)}</div></article>
          <div className="epic-team-groups">{[...new Set<string>((teamCategory.groups??[]).map((row:any)=>String(row.id)))].map((groupId)=><TeamRoundView key={groupId} locale={locale} category={teamCategory} groupId={groupId} mutate={mutate}/>)}</div>
          {(teamCategory.encounters ?? []).some((row:any)=>row.stage!=="group") ? <article className="panel"><div className="eyebrow">{tr(locale,"FASE POSTERIOR","POST-GROUP PHASE")}</div><div className="epic-bracket-grid">{(teamCategory.encounters??[]).filter((row:any)=>row.stage!=="group").map((row:any)=>{const score=teamEncounterScore(teamCategory,row);return <div key={row.id}><span>{row.roundLabel??row.stage}</span><strong>{row.sideA??"TBD"}</strong><em>{score.a} — {score.b}</em><strong>{row.sideB??"TBD"}</strong><small>{row.status}</small></div>})}</div></article> : null}
          {teamCategory.standings?.length ? <article className="panel"><div className="eyebrow">STANDINGS</div><div className="td-standing-grid">{teamCategory.standings.map((standing:any)=><div className="td-standing-card" key={standing.groupId}><strong>{tr(locale,"Grupo","Group")} {standing.groupName}</strong>{standing.rows.map((row:any,index:number)=><span key={row.entryId}>{index+1}. {row.entryName} · <b>{row.standingPoints} PTS</b> · {row.wins}-{row.losses}</span>)}</div>)}</div></article> : null}
        </>
      ) : null}
    </section>
  );
}

function parseCourtList(value: string) {
  return [...new Set(value.split(/[,;\s]+/).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
}

function policySummary(locale: Locale, policy: any, categories: any[]) {
  const mode = String(policy?.mode ?? "efficiency");
  if (mode === "efficiency") return tr(locale,"Máxima eficiencia: todas las categorías pueden compartir canchas y horarios.","Maximum efficiency: every category may share courts and time slots.");
  const ordered = [...categories].sort((a,b)=>Number(policy?.categories?.[String(a.id)]?.order??999)-Number(policy?.categories?.[String(b.id)]?.order??999));
  if (mode === "categories") return tr(locale,`Por categorías: ${ordered.map((row)=>row.name).join(" → ")}.`,`By category: ${ordered.map((row)=>row.name).join(" → ")}.`);
  if (mode === "blocks") {
    const phases = new Map<number,string[]>();
    for (const category of categories) {
      const phase = Number(policy?.categories?.[String(category.id)]?.phase ?? 1);
      const list = phases.get(phase) ?? [];
      list.push(category.name);
      phases.set(phase,list);
    }
    return [...phases.entries()].sort(([a],[b])=>a-b).map(([phase,names])=>`${tr(locale,"Bloque","Block")} ${phase}: ${names.join(" + ")}`).join(" · ");
  }
  return tr(locale,`Prioridad manual: ${ordered.map((row)=>row.name).join(" → ")}.`,`Manual priority: ${ordered.map((row)=>row.name).join(" → ")}.`);
}

export function EpicSchedulePolicyPanel({ locale, snapshot, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; mutate: EpicDayMutate }) {
  const settings = snapshot.workspace.core.settings as any;
  const categories = snapshot.workspace.core.categories as any[];
  const existing = settings.schedulePolicy ?? { mode: "efficiency", categories: {} };
  const [mode, setMode] = useState(String(existing.mode ?? "efficiency"));
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      const categoryRules: Record<string, any> = {};
      for (const category of categories) {
        const id = String(category.id);
        categoryRules[id] = {
          order: Math.max(1, Number(data.get(`order:${id}`) ?? categories.indexOf(category) + 1)),
          phase: Math.max(1, Number(data.get(`phase:${id}`) ?? 1)),
          sequence: String(data.get(`sequence:${id}`) ?? "free"),
          allowedCourts: parseCourtList(String(data.get(`allowed:${id}`) ?? "")),
          preferredCourts: parseCourtList(String(data.get(`preferred:${id}`) ?? "")),
          exclusiveCourts: parseCourtList(String(data.get(`exclusive:${id}`) ?? "")),
          maxConcurrentCourts: String(data.get(`max:${id}`) ?? "").trim() ? Math.max(1, Number(data.get(`max:${id}`))) : null,
        };
      }
      (next.workspace.core.settings as any).schedulePolicy = { mode, categories: categoryRules };
      markStructureDirty(next);
    }, tr(locale,"Política de cronograma guardada. Regenerá para aplicarla.","Schedule policy saved. Regenerate to apply it."),"structure");
  };
  return <article className="panel epic-policy-panel">
    <div className="panel-title"><div><div className="eyebrow">{tr(locale,"POLÍTICA DEL SCHEDULER","SCHEDULER POLICY")}</div><h2>{tr(locale,"Cómo querés usar las canchas", "How courts should be used")}</h2><p className="muted">{tr(locale,"Las restricciones duras nunca se negocian. Esta política controla prioridades, bloques y preferencias.","Hard constraints are never negotiated. This policy controls priorities, blocks and preferences.")}</p></div></div>
    <div className="epic-policy-legend"><span><b>{tr(locale,"DURO","HARD")}</b>{tr(locale,"fin de jornada · descanso mínimo · misma cancha Team · canchas cerradas","daily end · minimum rest · Team same-court · closed courts")}</span><span><b>{tr(locale,"PREFERENCIA","PREFERENCE")}</b>{tr(locale,"orden · canchas preferidas · descanso preferido","order · preferred courts · preferred rest")}</span></div>
    <form onSubmit={save} className="td-stack">
      <label className="epic-policy-mode"><span>{tr(locale,"Modo general","Global mode")}</span><select value={mode} onChange={(event)=>setMode(event.target.value)}><option value="efficiency">{tr(locale,"Máxima eficiencia · mezclar categorías","Maximum efficiency · mix categories")}</option><option value="categories">{tr(locale,"Por categorías · terminar una antes de la siguiente","By category · finish one before the next")}</option><option value="blocks">{tr(locale,"Categorías en bloques · algunas simultáneas","Category blocks · some simultaneous")}</option><option value="priority">{tr(locale,"Prioridad manual · preferir un orden","Manual priority · prefer an order")}</option></select></label>
      <div className="epic-policy-summary"><strong>{tr(locale,"Política actual","Current policy")}</strong><span>{policySummary(locale,{...existing,mode},categories)}</span></div>
      <div className="epic-policy-table">
        {categories.map((category,index)=>{const rule=existing.categories?.[String(category.id)]??{};return <div className="epic-policy-row" key={category.id}><header><strong>{category.name}</strong><span>{category.entryType === "team" ? "TEAM" : "STANDARD"}</span></header><label><span>{tr(locale,"Orden","Order")}</span><input name={`order:${category.id}`} type="number" min="1" defaultValue={Number(rule.order??index+1)} /></label>{mode==="blocks"?<label><span>{tr(locale,"Bloque","Block")}</span><input name={`phase:${category.id}`} type="number" min="1" defaultValue={Number(rule.phase??1)} /></label>:<input type="hidden" name={`phase:${category.id}`} value={mode==="categories"?Number(rule.order??index+1):1} />}<label><span>{tr(locale,"Dentro de categoría","Within category")}</span><select name={`sequence:${category.id}`} defaultValue={String(rule.sequence??"free")}><option value="free">{tr(locale,"Libre / optimizado","Free / optimized")}</option><option value="rounds">{tr(locale,"Por rondas","By rounds")}</option><option value="groups">{tr(locale,"Grupo por grupo","Group by group")}</option><option value="group_pairs">{tr(locale,"Grupos de a 2","Groups in pairs")}</option></select></label><label><span>{tr(locale,"Canchas permitidas","Allowed courts")}</span><input name={`allowed:${category.id}`} placeholder="1,2,3" defaultValue={(rule.allowedCourts??[]).join(",")} /></label><label><span>{tr(locale,"Canchas preferidas","Preferred courts")}</span><input name={`preferred:${category.id}`} placeholder="1,2" defaultValue={(rule.preferredCourts??[]).join(",")} /></label><label><span>{tr(locale,"Canchas exclusivas","Exclusive courts")}</span><input name={`exclusive:${category.id}`} placeholder="—" defaultValue={(rule.exclusiveCourts??[]).join(",")} /></label><label><span>{tr(locale,"Máx. canchas simultáneas","Max concurrent courts")}</span><input name={`max:${category.id}`} type="number" min="1" placeholder="—" defaultValue={rule.maxConcurrentCourts??""} /></label></div>})}
      </div>
      <button className="light">{tr(locale,"Guardar política","Save policy")}</button>
    </form>
  </article>;
}

function teamTvLineupNames(category: any, encounter: any, entryId: string, rubberKey: string) {
  const lineup = (encounter.lineups ?? []).find((row: any) => String(row.entryId) === String(entryId));
  const assignment = lineup?.assignments?.find((row: any) => String(row.rubberKey) === String(rubberKey));
  const entry = (category.entries ?? []).find((row: any) => String(row.id) === String(entryId));
  const knownRoster = [...(entry?.roster ?? []), ...(entry?.rosterHistory ?? [])];
  const names = (assignment?.personIds ?? []).map((personId: string) =>
    knownRoster.find((member: any) => String(member.personId) === String(personId))?.name ?? personId,
  );
  return names.join(" / ") || "—";
}

function EpicTvTeamCard({ locale, category, encounter, scheduleRows }: { locale: Locale; category: any; encounter: any; scheduleRows: any[] }) {
  const score = teamEncounterScore(category, encounter);
  const defs = category.format?.encounter?.rubbers ?? [];
  const ordered = [...(encounter.matches ?? [])].sort((a:any,b:any)=>Number(a.rubberOrder)-Number(b.rubberOrder));
  const active = ordered.find((row:any)=>["ready","in_progress"].includes(String(row.status))) ?? ordered.find((row:any)=>!["finished","skipped"].includes(String(row.status))) ?? ordered[ordered.length-1];
  const definition = defs.find((row:any)=>String(row.key)===String(active?.rubberKey));
  const first = [...scheduleRows].sort((a,b)=>Number(a.startAt)-Number(b.startAt))[0];
  return <article className="epic-tv-team-card">
    <header><span>{category.name} · {encounter.groupName ? `${tr(locale,"Grupo","Group")} ${encounter.groupName}` : encounter.roundLabel ?? encounter.stage}</span><b>{first?.courtLabel ?? active?.courtLabel ?? ""}</b></header>
    <div className="epic-tv-score"><strong>{encounter.sideA}</strong><b>{score.a}</b><em>—</em><b>{score.b}</b><strong>{encounter.sideB}</strong></div>
    {active ? <div className="epic-tv-rubber"><span>{String(active.rubberKey).toUpperCase()} · {definition?.label ?? active.rubberKey}</span><div><strong>{teamTvLineupNames(category,encounter,String(encounter.entryAId),String(active.rubberKey))}</strong><em>vs</em><strong>{teamTvLineupNames(category,encounter,String(encounter.entryBId),String(active.rubberKey))}</strong></div>{active.resultStatus ? <b>{active.scoreA ?? "—"} — {active.scoreB ?? "—"}</b> : <small>{tr(locale,"Rubber actual / próximo","Current / next rubber")}</small>}</div> : null}
    <div className="epic-tv-progress">{ordered.map((match:any)=>{const def=defs.find((row:any)=>String(row.key)===String(match.rubberKey));return <span className={match.status==="finished"?"done":match.status==="skipped"?"skip":["ready","in_progress"].includes(String(match.status))?"live":""} key={match.id}>{String(match.rubberKey).toUpperCase()}{def?.play==="if_tied"?"*":""}</span>})}</div>
  </article>;
}

export function EpicTournamentDayTV({ snapshot, locale, embedded = false }: { snapshot: TournamentDayReformSnapshot; locale: Locale; embedded?: boolean }) {
  const [mode,setMode]=useState<"auto"|"general"|"category"|"courts">("auto");
  const [categoryId,setCategoryId]=useState("");
  const [court,setCourt]=useState("");
  const schedule=[...(snapshot.workspace.schedule.schedule as any[])].sort((a,b)=>Number(a.startAt)-Number(b.startAt));
  const categories=snapshot.workspace.core.categories as any[];
  const teamCategories=snapshot.team.categories as any[];
  const now=Math.floor(Date.now()/1000);
  const blockMap=new Map<string,any[]>();
  for(const row of schedule){const key=String(row.scheduleUnitId??row.encounterId??row.id);const list=blockMap.get(key)??[];list.push(row);blockMap.set(key,list)}
  let blocks=[...blockMap.entries()].map(([id,rows])=>({id,rows,first:[...rows].sort((a,b)=>Number(a.startAt)-Number(b.startAt))[0]}));
  if(mode==="category"&&categoryId)blocks=blocks.filter((block)=>String(block.first.categoryId)===categoryId);
  if(mode==="courts"&&court)blocks=blocks.filter((block)=>String(block.first.courtLabel).match(/\d+/)?.[0]===court);
  const current=blocks.filter((block)=>Math.min(...block.rows.map((r)=>Number(r.startAt)))<=now&&now<=Math.max(...block.rows.map((r)=>Number(r.endAt))));
  const future=blocks.filter((block)=>Math.min(...block.rows.map((r)=>Number(r.startAt)))>now);
  const display=(mode==="auto"?(current.length?current:future.slice(0,6)):blocks.filter((block)=>block.rows.some((r)=>r.status!=="completed"&&r.status!=="cancelled")).slice(0,12));
  const teamStandings=teamCategories.flatMap((category)=>(category.standings??[]).map((standing:any)=>({categoryName:category.name,...standing})));
  return <section className={`epic-tv ${embedded?"embedded":""}`}>
    <header className="epic-tv-header"><div><span className="eyebrow">HUAU LIVE · LOCAL · 0 D1</span><h1>{snapshot.workspace.core.tournament.name}</h1></div><span className="epic-live-dot">● LIVE</span></header>
    <div className="epic-tv-controls"><button className={mode==="auto"?"active":""} onClick={()=>setMode("auto")}>auto</button><button className={mode==="general"?"active":""} onClick={()=>setMode("general")}>general</button><button className={mode==="category"?"active":""} onClick={()=>setMode("category")}>category</button><button className={mode==="courts"?"active":""} onClick={()=>setMode("courts")}>courts</button>{mode==="category"?<select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)}><option value="">{tr(locale,"Todas","All")}</option>{categories.map((category)=><option key={category.id} value={category.id}>{category.name}</option>)}</select>:null}{mode==="courts"?<select value={court} onChange={(e)=>setCourt(e.target.value)}><option value="">{tr(locale,"Todas","All")}</option>{Array.from({length:Math.max(1,Number(snapshot.workspace.core.tournament.courtCount??1))},(_,index)=><option key={index+1} value={String(index+1)}>Cancha {index+1}</option>)}</select>:null}</div>
    <div className="epic-tv-layout"><main><div className="epic-tv-section-title"><span>{current.length?tr(locale,"AHORA","NOW"):tr(locale,"AHORA / PRÓXIMOS","NOW / NEXT")}</span><b>{display.length}</b></div><div className="epic-tv-cards">{display.map((block)=>{const first=block.first;if(first.categoryEntryType==="team"){const category=teamCategories.find((row)=>String(row.id)===String(first.categoryId));const encounter=category?.encounters?.find((row:any)=>String(row.id)===String(first.encounterId));if(category&&encounter)return <EpicTvTeamCard key={block.id} locale={locale} category={category} encounter={encounter} scheduleRows={block.rows}/>;}return <article className="epic-tv-standard-card" key={block.id}><header><span>{first.categoryName}</span><b>{first.courtLabel}</b></header><div><strong>{first.sideA||first.roundLabel||first.categoryName}</strong>{first.sideB?<><em>vs</em><strong>{first.sideB}</strong></>:null}</div><small>{new Date(toMs(Number(first.startAt))).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} · {first.roundLabel??first.stage}</small></article>})}</div></main><aside><div className="epic-tv-section-title"><span>{tr(locale,"TABLAS","STANDINGS")}</span></div>{teamStandings.length?<div className="epic-tv-standings">{teamStandings.map((standing:any)=><section key={`${standing.categoryName}:${standing.groupId}`}><h3>{standing.categoryName} · {standing.groupName}</h3>{(standing.rows??[]).slice(0,8).map((row:any,index:number)=><div key={row.entryId}><b>{index+1}</b><strong>{row.entryName}</strong><span>{row.standingPoints} PTS</span></div>)}</section>)}</div>:<p className="epic-tv-empty">{tr(locale,"Las tablas aparecerán con los primeros resultados.","Standings will appear after the first results.")}</p>}</aside></div>
  </section>;
}

type HumanError = { title: string; lines: string[] };

function humanError(locale: Locale, raw: string): HumanError {
  const text = String(raw || "").trim();
  const codes = text.split(",").map((item)=>item.trim()).filter(Boolean);
  const lineupMap: Record<string,[string,string]> = {
    LINEUP_GENDER_MALE:["Dobles/Singles masculino debe usar únicamente jugadores M.","Male doubles/singles must use M players only."],
    LINEUP_GENDER_FEMALE:["Dobles/Singles femenino debe usar únicamente jugadoras F.","Female doubles/singles must use F players only."],
    LINEUP_GENDER_MIXED:["El dobles mixto necesita una persona M y una F.","Mixed doubles requires one M and one F player."],
    LINEUP_SIZE_INVALID:["Revisá la cantidad de jugadores seleccionados en cada rubber.","Check the number of selected players in each rubber."],
    LINEUP_PLAYER_NOT_IN_ROSTER:["Hay un jugador seleccionado que ya no pertenece al roster.","A selected player is no longer on the roster."],
  };
  if (codes.some((code)=>lineupMap[code])) {
    return { title: tr(locale,"No se puede bloquear la alineación","Lineup cannot be locked"), lines:[...new Set(codes.map((code)=>lineupMap[code]?tr(locale,lineupMap[code][0],lineupMap[code][1]):tr(locale,"Revisá la alineación seleccionada.","Review the selected lineup.")))] };
  }
  if (text.includes("TEAM_ROSTER_PERSON_ALREADY_ASSIGNED")) return {title:tr(locale,"Jugador ya asignado","Player already assigned"),lines:[tr(locale,"Ese jugador ya pertenece a otro equipo de la misma categoría.","That player already belongs to another team in this category.")]};
  if (text.includes("TEAM_ROSTER_AFTER_RESULTS")) return {title:tr(locale,"Roster protegido","Roster protected"),lines:[tr(locale,"La categoría ya comenzó. Solo se permiten cambios futuros cuando el formato habilita suplentes; los resultados históricos nunca se reescriben.","The category has started. Future-only roster changes require substitutes to be enabled; historical results are never rewritten.")]};
  if (text.includes("TEAM_ROSTER_INVALID")) return {title:tr(locale,"Roster inválido","Invalid roster"),lines:[tr(locale,"Revisá cantidad de jugadores, composición M/F y capitán requerido.","Check roster size, M/F composition and required captain.")]};
  if (text.includes("SCHEDULE_MANUAL_MOVE_CONFLICT")||text.includes("SCHEDULE_LOCK_CONFLICT")) return {title:tr(locale,"Ese movimiento genera un conflicto","That move creates a conflict"),lines:[tr(locale,"Revisá cancha, horario, descanso mínimo o una restricción bloqueada.","Check court, time, minimum rest or a locked restriction.")]};
  if (text.includes("STANDARD_FORMAT_AFTER_RESULTS")||text.includes("TEAM_FORMAT_AFTER_RESULTS")||text.includes("STRUCTURE_AFTER_RESULTS")) return {title:tr(locale,"La competencia ya comenzó","Competition already started"),lines:[tr(locale,"El formato estructural no se puede reconstruir después de cargar resultados. Corregí resultados o usá recuperación si realmente necesitás volver atrás.","The structural format cannot be rebuilt after results have been entered. Correct results or use recovery if you truly need to roll back.")]};
  if (text.includes("DAY_CATEGORY_REMOVE_HAS_RESULTS")||text.includes("DAY_TEAM_DELETE_HAS_RESULTS")) return {title:tr(locale,"Cambio protegido","Protected change"),lines:[tr(locale,"Ese cambio afectaría resultados existentes y HUAU no los borra silenciosamente.","That change would affect existing results and HUAU never deletes them silently.")]};
  if (text.includes("PUBLIC_MODEL")) return {title:tr(locale,"No se pudo publicar","Could not publish"),lines:[tr(locale,"La información pública no pasó la validación de seguridad. La copia local sigue intacta.","Public information failed the safety validation. The local copy remains intact.")]};
  return {title:tr(locale,"No se pudo completar la acción","Action could not be completed"),lines:[text.replaceAll("_"," ").toLowerCase().replace(/^./,(letter)=>letter.toUpperCase())]};
}

export function EpicErrorModal({ locale, error, onClose }: { locale: Locale; error: string; onClose: () => void }) {
  if (!error) return null;
  const message = humanError(locale,error);
  return <div className="epic-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}><section className="epic-error-modal" role="dialog" aria-modal="true" aria-labelledby="epic-error-title"><button className="epic-modal-close" onClick={onClose} aria-label={tr(locale,"Cerrar","Close")}>×</button><div className="epic-error-icon">×</div><h2 id="epic-error-title">{message.title}</h2><div className="epic-error-lines">{message.lines.map((line,index)=><p key={`${line}-${index}`}>{line}</p>)}</div><button className="light" onClick={onClose}>{tr(locale,"Corregir","Fix it")}</button></section></div>;
}

export function EpicPublicLinkCard({ locale, snapshot }: { locale: Locale; snapshot: TournamentDayReformSnapshot }) {
  const [copied,setCopied]=useState(false);
  const tournament=snapshot.workspace.core.tournament as any;
  const slug=String(tournament.slug??"").trim();
  const dirty=ensureDayLocalMeta(snapshot).publicDirty;
  if(!slug)return null;
  const url=`${window.location.origin}/tournaments/${encodeURIComponent(slug)}/live`;
  const copy=async()=>{await navigator.clipboard.writeText(url);setCopied(true);window.setTimeout(()=>setCopied(false),1800)};
  return <article className="panel epic-public-link"><div><div className="eyebrow">{tr(locale,"PÁGINA PÚBLICA","PUBLIC PAGE")}</div><h2>{tr(locale,"Compartir torneo","Share tournament")}</h2><p className="muted">{tr(locale,"El seguimiento público es independiente de si la inscripción es abierta o por invitación.","Public tournament tracking is independent from open or invite-only registration.")}</p></div><div className="epic-public-url"><code>{url}</code><div><button className="ghost" onClick={()=>void copy()}>{copied?tr(locale,"Copiado ✓","Copied ✓"):tr(locale,"Copiar enlace","Copy link")}</button><button className="light" onClick={()=>window.open(url,"_blank","noopener")}>{tr(locale,"Abrir página pública","Open public page")} ↗</button></div></div><small>{dirty.lastStructurePublishedAt?tr(locale,"Estructura pública disponible.","Public structure available."):tr(locale,"Publicá información para habilitar la página.","Publish structure to enable the page.")}</small></article>;
}
