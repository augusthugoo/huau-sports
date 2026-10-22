/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Locale } from "./i18n";
import {
  advanceLocalLiveDraw,
  applyLocalTeamPreset,
  cloneDay,
  generateLocalStandardStructure,
  generateLocalTeamStructure,
  saveLocalStandardFormat,
  saveLocalTeamLineup,
  setLocalTeamFormat,
  startLocalLiveDraw,
} from "./TournamentDayEngine";
import type {
  StandardStandingCriterion,
  TeamFormat,
  TeamLineupAssignment,
} from "@huau/core";
import {
  ensureDayLocalMeta,
  markStructureDirty,
  moveLocalStandardEntryToGroup,
  moveLocalTeamEntryToGroup,
  swapDayStandardFirstRoundEntry,
  teamEntryRating,
  type TournamentDayReformSnapshot,
} from "./TournamentDayReformEngine";
import { FormatExplanationPanel, explanationForPersistedFormat } from "./FormatExplanationPanel";

export type EpicDayMutate = (
  fn: (snapshot: TournamentDayReformSnapshot) => void,
  message?: string,
  kind?: "structure" | "live" | "neutral",
) => Promise<void>;

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);
const round2 = (value: number) => Math.round(value * 100) / 100;

const STANDARD_STANDING_CRITERIA: Array<{
  id: StandardStandingCriterion;
  es: string;
  en: string;
}> = [
  { id: "head_to_head", es: "Enfrentamiento directo", en: "Head-to-head" },
  { id: "mini_wins", es: "Victorias mini-tabla (3+)", en: "Mini-table wins (3+)" },
  { id: "mini_diff", es: "Diferencia mini-tabla (3+)", en: "Mini-table differential (3+)" },
  { id: "point_diff", es: "Diferencia total de puntos", en: "Overall point differential" },
  { id: "points_for", es: "Puntos anotados", en: "Points scored" },
  { id: "rating", es: "Rating", en: "Rating" },
];

const DEFAULT_STANDARD_CRITERIA =
  STANDARD_STANDING_CRITERIA.map((criterion) => criterion.id);

function standardCriterionLabel(
  locale: Locale,
  id: StandardStandingCriterion,
) {
  const row = STANDARD_STANDING_CRITERIA.find(
    (criterion) => criterion.id === id,
  );
  return row ? tr(locale, row.es, row.en) : id;
}

function standardCriteriaSummary(locale: Locale, format: any) {
  const criteria = Array.isArray(format?.standingsCriteria) &&
    format.standingsCriteria.length
    ? format.standingsCriteria as StandardStandingCriterion[]
    : DEFAULT_STANDARD_CRITERIA;

  return [
    tr(locale, "Victorias", "Wins"),
    ...criteria.map((criterion) =>
      standardCriterionLabel(locale, criterion),
    ),
  ].join(" → ");
}


function rubberDisplayCode(rubber: any) {
  const candidate = String(rubber?.displayCode ?? rubber?.rubberCode ?? rubber?.key ?? "").trim();
  if (candidate && !/^custom[-_:]/i.test(candidate) && !/^r?\d{8,}$/i.test(candidate)) return candidate;
  const order = Math.max(1, Number(rubber?.order ?? rubber?.rubberOrder ?? 1) || 1);
  return `R${order}`;
}

function lineupPersonIds(lineup: any, rubberKey: string) {
  const rows = Array.isArray(lineup?.assignments) ? lineup.assignments : [];
  const nested = rows.find(
    (row: any) => String(row?.rubberKey) === rubberKey && Array.isArray(row?.personIds),
  );
  if (nested) return nested.personIds.map((personId: unknown) => String(personId));
  return rows
    .filter((row: any) => String(row?.rubberKey) === rubberKey && row?.personId)
    .sort((a: any, b: any) => Number(a?.position ?? 0) - Number(b?.position ?? 0))
    .map((row: any) => String(row.personId));
}

function seedingMethodFor(snapshot: TournamentDayReformSnapshot, category: any) {
  const source = category?.entryType === "team"
    ? (snapshot.team.categories as any[]).find((row) => String(row.id) === String(category?.id))
    : category;
  const value = String(source?.seedingMethod ?? source?.daySeedingMethod ?? "snake");
  return ["snake", "random", "manual", "live"].includes(value) ? value : "snake";
}

function seedingMethodLabel(locale: Locale, method: string) {
  if (method === "random") return tr(locale, "Aleatorio", "Random");
  if (method === "manual") return tr(locale, "Manual", "Manual");
  if (method === "live") return tr(locale, "Sorteo en vivo", "Live draw");
  return tr(locale, "DUPR / serpentina", "DUPR / snake");
}

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
  const storedSeeding = category ? seedingMethodFor(snapshot, category) : "snake";
  const [seeding, setSeeding] = useState<"snake" | "random">(storedSeeding === "random" ? "random" : "snake");
  const formRef = useRef<HTMLFormElement | null>(null);
  const [simulation, setSimulation] = useState<any>(null);

  useEffect(() => {
    if (!category) return;
    const current = activeGroupCount(snapshot, String(category.id), category.entryType === "team");
    const count = categoryEntryCount(snapshot, category);
    setGroups(current || suggestedGroups(count, preferred, Math.max(1, Math.floor(count / 2))));
    const method = seedingMethodFor(snapshot, category);
    setSeeding(method === "random" ? "random" : "snake");
    setSimulation(null);
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
  const calculated = simulation ?? { rounds, qualifiers, wildcards, playoffMode, bronze, courts, availableMinutes, matchMinutes, rubberSlots: isTeam ? rubbers.length : 1 };
  const calculateOptions = () => {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    const dailyStart = String(data.get("dailyStart") ?? settings.dailyStart ?? "09:00");
    const dailyEnd = String(data.get("dailyEnd") ?? settings.dailyEnd ?? "20:00");
    setSimulation({
      rounds: Number(data.get("groupRounds")) === 2 ? 2 : 1,
      qualifiers: Math.max(1, Number(data.get("qualifiers") ?? qualifiers)),
      wildcards: Math.max(0, Number(data.get("wildcards") ?? wildcards)),
      playoffMode: String(data.get("playoffMode") ?? playoffMode),
      bronze: data.get("bronze") === "on",
      courts: Math.max(1, Number(data.get("courts") ?? courts)),
      availableMinutes: dayMinutes(dailyStart, dailyEnd),
      matchMinutes: Math.max(5, Number(data.get("matchMinutes") ?? matchMinutes)),
      rubberSlots: isTeam ? rubbers.length : 1,
    });
  };

  const apply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextRounds = Number(data.get("groupRounds")) === 2 ? 2 : 1;
    const nextQualifiers = Math.max(1, Number(data.get("qualifiers") ?? qualifiers));
    const nextWildcards = Math.max(0, Number(data.get("wildcards") ?? wildcards));
    const nextPlayoff = String(data.get("playoffMode") ?? playoffMode);
    const nextBronze = data.get("bronze") === "on";
    if (!isTeam) {
      const selectedOrders = STANDARD_STANDING_CRITERIA
        .map((criterion) => Number(data.get(`standardCriterionOrder:${criterion.id}`) ?? 0))
        .filter((value) => value > 0);
      if (new Set(selectedOrders).size !== selectedOrders.length) {
        window.alert(
          tr(
            locale,
            "Cada posición de desempate puede usarse una sola vez. Corregí los números repetidos.",
            "Each tiebreak position can only be used once. Fix the duplicated numbers.",
          ),
        );
        return;
      }
    }
    await mutate(
      (next) => {
        // Los inputs de tiempo/canchas de Formato sirven sólo para simular
        // capacidad. La verdad operativa vive en Cronograma → Plan Operativo.
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
            displayCode: String(data.get(`rubber:${rubber.key}:code`) ?? rubber.displayCode ?? rubber.key).trim() || String(rubber.key).toUpperCase(),
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
          nextCategory.seedingMethod = seeding;

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
          const standingCriteria = STANDARD_STANDING_CRITERIA
            .map((criterion, fallbackIndex) => ({
              id: criterion.id,
              order: Math.max(
                0,
                Number(
                  data.get(
                    `standardCriterionOrder:${criterion.id}`,
                  ) ?? 0,
                ),
              ),
              fallbackIndex,
            }))
            .filter((criterion) => criterion.order > 0)
            .sort(
              (a, b) =>
                a.order - b.order ||
                a.fallbackIndex - b.fallbackIndex,
            )
            .map((criterion) => criterion.id);

          saveLocalStandardFormat(next, String(category.id), {
            groupRounds: nextRounds,
            qualifiersPerGroup: nextQualifiers,
            wildcardQualifiers: nextWildcards,
            playoffMode: nextPlayoff as any,
            crossGroupMethod: String(data.get("crossGroupMethod") ?? format?.crossGroupMethod ?? "normalized") as any,
            standingsCriteria: standingCriteria.length
              ? standingCriteria
              : DEFAULT_STANDARD_CRITERIA,
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
          const coreCategory = (next.workspace.core.categories as any[]).find((row) => String(row.id) === String(category.id));
          if (coreCategory) coreCategory.daySeedingMethod = seeding;
          generateLocalStandardStructure(next, String(category.id), groups, seeding);
        }
        next.workspace.schedule.schedule = (
          next.workspace.schedule.schedule as any[]
        ).filter(
          (row) => String(row.categoryId) !== String(category.id),
        );
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
        nextFormat.encounter.rubbers.push({ key: `custom-${Date.now()}-${order}`, displayCode: `R${order}`, label: `${tr(locale,"Partido","Rubber")} ${order}`, order, mode: "doubles", gender: "open", play: "always", isTiebreaker: false, weight: 1, bestOf: 1, pointTarget: 15, scoringMode: null });
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

      <form ref={formRef} className="td-stack" onSubmit={apply} key={String(category.id)}>
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
            <label className="check epic-check">
              <input name="bronze" type="checkbox" defaultChecked={bronze} />
              <span>{tr(locale, "Partido por 3.º puesto", "Bronze match")}</span>
            </label>
          </div>

          {!isTeam ? (
            <details className="epic-advanced">
              <summary>{tr(locale, "Reglas deportivas avanzadas", "Advanced sport rules")}</summary>
              <p className="muted">{tr(locale,"Normalizada compara porcentajes/promedios. Equiparar tamaño de grupos recorta el grupo más grande al mismo volumen competitivo para que un partido extra no distorsione el ranking. Consolación crea un cuadro secundario para quienes no clasifican.","Normalized compares percentages/averages. Equalize group sizes trims the larger group to the same competitive volume so an extra match does not distort ranking. Consolation creates a secondary bracket for non-qualifiers.")}</p>
              <div className="epic-format-controls">
                <label><span>{tr(locale,"Comparación entre grupos","Cross-group comparison")}</span><select name="crossGroupMethod" defaultValue={String(format?.crossGroupMethod ?? "normalized")}><option value="normalized">{tr(locale,"Normalizada · porcentajes/promedios","Normalized · percentages/averages")}</option><option value="equalized">{tr(locale,"Equiparar tamaño de grupos","Equalize group sizes")}</option></select></label>
                <label><span>{tr(locale,"Armado fase final","Final draw")}</span><select name="finalDrawMethod" defaultValue={String(format?.finalDrawMethod ?? "performance")}><option value="performance">{tr(locale,"Rendimiento cruzado","Cross-group performance")}</option><option value="pots">{tr(locale,"Bombos","Pots")}</option></select></label>
                <label><span>{tr(locale,"Consolación","Consolation")}</span><select name="consolationMode" defaultValue={String(format?.consolationMode ?? "none")}><option value="none">{tr(locale,"No","No")}</option><option value="knockout">{tr(locale,"Sí · cuadro para no clasificados","Yes · bracket for non-qualifiers")}</option></select></label>
                <label><span>{tr(locale,"Medallas","Medal scheduling")}</span><select name="medalSchedule" defaultValue={String(format?.medalSchedule ?? "simultaneous")}><option value="simultaneous">{tr(locale,"Final y bronce simultáneos","Final & bronze simultaneous")}</option><option value="sequential">{tr(locale,"Secuenciales","Sequential")}</option></select></label>
                <label><span>{tr(locale,"Grupos","Groups")}</span><select name="preBestOf" defaultValue={String(format?.preliminary?.bestOf ?? 1)}><option value="1">1 set</option><option value="3">Mejor de 3</option></select></label>
                <label><span>{tr(locale,"Puntos grupos","Group target")}</span><input name="preTarget" type="number" min="1" defaultValue={Number(format?.preliminary?.pointTarget ?? 15)} /></label>
                <label><span>{tr(locale,"Final / bronce","Final / bronze")}</span><select name="medalBestOf" defaultValue={String(format?.medal?.bestOf ?? 3)}><option value="1">1 set</option><option value="3">Mejor de 3</option></select></label>
                <label><span>{tr(locale,"Puntos final","Final target")}</span><input name="medalTarget" type="number" min="1" defaultValue={Number(format?.medal?.pointTarget ?? 11)} /></label>
                <label className="check epic-check"><input name="avoidGroupRematches" type="checkbox" defaultChecked={Boolean(format?.avoidGroupRematches ?? true)} /><span>{tr(locale,"Evitar revancha inmediata de grupo","Avoid immediate group rematch")}</span></label>
              </div>

              <div className="epic-team-advanced-block">
                <h4>{tr(locale,"Desempates de grupo","Group tiebreaks")}</h4>
                <p className="muted">
                  {tr(
                    locale,
                    "Victorias siempre es el primer criterio. Elegí el orden de los siguientes; 0 desactiva. No repitas números. H2H se usa para empates de 2; mini-tabla para 3 o más.",
                    "Wins are always first. Order the next criteria; 0 disables. Do not repeat numbers. H2H is for 2-way ties; mini-table for 3+.",
                  )}
                </p>
                <div className="epic-format-controls">
                  {STANDARD_STANDING_CRITERIA.map((criterion) => {
                    const currentCriteria =
                      Array.isArray(format?.standingsCriteria) &&
                      format.standingsCriteria.length
                        ? format.standingsCriteria
                        : DEFAULT_STANDARD_CRITERIA;
                    const index = currentCriteria.indexOf(criterion.id);

                    return (
                      <label key={criterion.id}>
                        <span>{standardCriterionLabel(locale, criterion.id)}</span>
                        <select
                          name={`standardCriterionOrder:${criterion.id}`}
                          defaultValue={String(index >= 0 ? index + 1 : 0)}
                        >
                          <option value="0">{tr(locale,"No usar","Off")}</option>
                          {Array.from({ length: 6 }, (_, optionIndex) => (
                            <option
                              key={optionIndex + 1}
                              value={optionIndex + 1}
                            >
                              {optionIndex + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>
            </details>
          ) : (
            <>
              <div className="epic-team-format-summary">
                <div><span>{tr(locale,"Roster","Roster")}</span><strong>{format?.roster?.min ?? "—"}–{format?.roster?.max ?? "—"}</strong><small>{format?.roster?.composition ?? "—"}</small></div>
                <div><span>{tr(locale,"Serie","Encounter")}</span><strong>{rubbers.length} rubbers</strong><small>{rubbers.map((rubber: any) => rubberDisplayCode(rubber)).join(" → ")}</small></div>
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
                    {rubbers.map((rubber: any, index: number) => <div key={rubber.key} className="epic-team-rubber-edit"><header><b>{index+1}</b><div><strong>{rubberDisplayCode(rubber)}</strong><small>{rubber.label}</small></div><div><button type="button" className="ghost small" disabled={index===0} onClick={()=>void mutateTeamRubber("up",index)}>↑</button><button type="button" className="ghost small" disabled={index===rubbers.length-1} onClick={()=>void mutateTeamRubber("down",index)}>↓</button><button type="button" className="danger small" disabled={rubbers.length<=1} onClick={()=>void mutateTeamRubber("remove",index)}>×</button></div></header><label><span>{tr(locale,"Código visible","Display code")}</span><input name={`rubber:${rubber.key}:code`} maxLength={12} defaultValue={rubberDisplayCode(rubber)} /></label><label><span>{tr(locale,"Nombre","Label")}</span><input name={`rubber:${rubber.key}:label`} defaultValue={rubber.label} /></label><label><span>{tr(locale,"Modo","Mode")}</span><select name={`rubber:${rubber.key}:mode`} defaultValue={rubber.mode}><option value="singles">Singles</option><option value="doubles">Doubles</option></select></label><label><span>{tr(locale,"Género","Gender")}</span><select name={`rubber:${rubber.key}:gender`} defaultValue={rubber.gender}><option value="male">Male</option><option value="female">Female</option><option value="mixed">Mixed</option><option value="open">Open</option></select></label><label><span>{tr(locale,"Cuándo juega","Play condition")}</span><select name={`rubber:${rubber.key}:play`} defaultValue={rubber.play}><option value="always">Always</option><option value="if_tied">If tied</option></select></label><label><span>{tr(locale,"Peso","Weight")}</span><input name={`rubber:${rubber.key}:weight`} type="number" min="0" step="1" defaultValue={rubber.weight} /></label><label><span>Best of</span><select name={`rubber:${rubber.key}:bestOf`} defaultValue={String(rubber.bestOf)}><option value="1">1</option><option value="3">3</option></select></label><label><span>{tr(locale,"Puntos","Target")}</span><input name={`rubber:${rubber.key}:target`} type="number" min="1" defaultValue={rubber.pointTarget} /></label><label><span>{tr(locale,"Scoring","Scoring")}</span><input name={`rubber:${rubber.key}:scoringMode`} defaultValue={rubber.scoringMode ?? ""} /></label><label className="check epic-check"><input name={`rubber:${rubber.key}:tiebreaker`} type="checkbox" defaultChecked={Boolean(rubber.isTiebreaker)} /><span>{tr(locale,"Desempate","Tiebreaker")}</span></label></div>)}
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
              <small className="muted">{simulation ? tr(locale,"Cálculo actualizado con los valores del formulario.","Calculation updated with current form values.") : tr(locale,"Mostrando la última configuración guardada. Tocá Calcular opciones después de cambiar reglas.","Showing the last saved configuration. Use Calculate options after changing rules.")}</small>
            </div>
            <div className="epic-simulation-actions"><span>{entries} · {calculated.courts} {tr(locale,"canchas","courts")} · {calculated.matchMinutes} min</span><button type="button" className="ghost small" onClick={calculateOptions}>{tr(locale,"Calcular opciones","Calculate options")}</button></div>
          </div>
          <div className="epic-option-grid">
            {optionCounts.map((count) => {
              const estimate = capacityEstimate({ entries, groups: count, rounds: calculated.rounds, qualifiers: calculated.qualifiers, wildcards: calculated.wildcards, playoffMode: calculated.playoffMode, bronze: calculated.bronze, courts: calculated.courts, availableMinutes: calculated.availableMinutes, matchMinutes: calculated.matchMinutes, isTeam, rubberSlots: calculated.rubberSlots });
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
                  <small>{calculated.rounds} {tr(locale,"vuelta(s) · fase de grupos","round(s) · group phase")} {estimate.groupSeries} · {tr(locale,"fase posterior","post-group")} {estimate.finals}</small>
                </button>
              );
            })}
          </div>
        </article>

        <article className="panel epic-format-apply">
          <div className="epic-operational-strip">
            <span className="muted">
              {tr(
                locale,
                "SIMULACIÓN · estos valores sólo estiman capacidad; no cambian el cronograma real.",
                "SIMULATION · these values only estimate capacity; they do not change the real schedule.",
              )}
            </span>
            <label><span>{tr(locale,"Inicio simulado","Simulated start")}</span><input name="dailyStart" type="time" defaultValue={String(settings.dailyStart ?? "09:00")} /></label>
            <label><span>{tr(locale,"Fin simulado","Simulated end")}</span><input name="dailyEnd" type="time" defaultValue={String(settings.dailyEnd ?? "20:00")} /></label>
            <label><span>{tr(locale,"Canchas simuladas","Simulated courts")}</span><input name="courts" type="number" min="1" defaultValue={courts} /></label>
            <label><span>{tr(locale,"Min/partido simulados","Simulated min/match")}</span><input name="matchMinutes" type="number" min="5" defaultValue={matchMinutes} /></label>
          </div>
          <div className="panel-title">
            <p className="muted">{tr(locale,"Aplicar reconstruye solamente esta categoría y limpia su cronograma local para regenerarlo después.","Apply rebuilds only this category and clears its local schedule so it can be regenerated afterwards.")}</p>
            <button className="light epic-primary" disabled={entries < 2}>{tr(locale,"Usar este formato y generar","Use this format & generate")}</button>
          </div>
        </article>
      </form>

      {format ? (() => { const explanation = explanationForPersistedFormat(isTeam ? "team" : "standard", format, locale); return explanation ? <FormatExplanationPanel explanation={explanation} locale={locale} compact title={tr(locale,"Explicación del formato activo","Active format explanation")} /> : null; })() : null}

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
    (category.format?.encounter?.rubbers ?? []).flatMap((rubber: any) =>
      lineupPersonIds(suggested, String(rubber.key)).map((personId: string) => `${rubber.key}:${personId}`),
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
    <form className="epic-lineup-side" onSubmit={save} key={`${encounter.id}:${entryId}:${existing?.lockedAt ?? suggested?.lockedAt ?? "base"}`}>
      <header>
        <div><strong>{entry.displayName}</strong><small>{entry.roster?.length ?? 0} {tr(locale,"jugadores","players")}</small></div>
        {existing?.status === "locked" ? <span className="epic-status-ok">✓ {tr(locale,"Bloqueada","Locked")}</span> : fromBase ? <span className="epic-badge">{tr(locale,"Base sugerida","Suggested base")}</span> : <span className="epic-status-muted">{tr(locale,"Sin bloquear","Unlocked")}</span>}
      </header>
      {(category.format?.encounter?.rubbers ?? []).map((rubber: any) => (
        <div className="epic-lineup-rubber" key={rubber.key}>
          <div className="epic-rubber-title"><strong>{rubberDisplayCode(rubber)}</strong><span>{rubber.label}</span><em>{rubber.gender}</em></div>
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
          <span key={row.entryId}><b>{index + 1}</b><strong>{row.entryName}</strong>{String(category.seedingMethod??"snake")==="manual" ? <select value={groupId} aria-label={tr(locale,"Mover equipo de grupo","Move team between groups")} onChange={(event)=>void mutate(next=>moveLocalTeamEntryToGroup(next,String(category.id),String(row.entryId),event.target.value),tr(locale,"Equipo movido y cruces Team recalculados.","Team moved and Team encounters rebuilt."),"structure")}>{[...new Map<string,string>((category.groups??[]).map((groupRow:any)=>[String(groupRow.id),String(groupRow.name)] as [string,string])).entries()].map(([id,name])=><option key={id} value={id}>{tr(locale,"Grupo","Group")} {name}</option>)}</select> : null}</span>
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


function EpicStandardDrawControls({ locale, snapshot, category, competition, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; category: any; competition: any; mutate: EpicDayMutate }) {
  const entries = (snapshot.workspace.standard.entries as any[]).filter(
    (row) => String(row.categoryId) === String(category.id),
  );
  const groups = Math.max(1, competition?.groups?.length ?? 1);
  const [heads, setHeads] = useState(Boolean(category?.daySeedHeads));
  useEffect(() => {
    setHeads(Boolean(category?.daySeedHeads));
  }, [category?.id, category?.daySeedHeads]);
  const session = (snapshot.workspace.standard.drawSessions as any[]).find(
    (row) => String(row.categoryId) === String(category.id),
  );
  let drawState: any = null;
  try { drawState = session?.stateJson ? JSON.parse(String(session.stateJson)) : null; } catch { drawState = null; }
  const entryName = (id: string) => entries.find((entry) => String(entry.id) === String(id))?.displayName ?? id;

  const generate = async (method: "snake" | "random" | "manual") => {
    if (method === "manual") setHeads(false);
    await mutate((next) => {
      const core = (next.workspace.core.categories as any[]).find(
        (row) => String(row.id) === String(category.id),
      );
      if (core) {
        core.daySeedingMethod = method;
        core.daySeedHeads = method === "manual" ? false : heads;
      }
      generateLocalStandardStructure(
        next,
        String(category.id),
        groups,
        method === "random" ? "random" : "snake",
      );
    }, method === "manual"
      ? tr(locale,"Modo manual activo. Mové participantes entre grupos debajo.","Manual mode enabled. Move entries between groups below.")
      : tr(locale,"Grupos regenerados localmente.","Groups regenerated locally."), "structure");
  };

  const prepareLive = async () => mutate((next) => {
    const core = (next.workspace.core.categories as any[]).find(
      (row) => String(row.id) === String(category.id),
    );
    if (core) {
      core.daySeedingMethod = "live";
      core.daySeedHeads = heads;
    }
    startLocalLiveDraw(next, String(category.id), groups);
  }, tr(locale,"Sorteo en vivo preparado localmente.","Live draw prepared locally."), "structure");

  const reveal = async () => mutate(
    (next) => advanceLocalLiveDraw(next, String(category.id)),
    tr(locale,"Siguiente entrada sorteada.","Next entry drawn."),
    "structure",
  );
  const activeMethod = seedingMethodFor(snapshot, category);

  return <article className="panel epic-draw-panel">
    <div className="panel-title">
      <div>
        <div className="eyebrow">{tr(locale,"SIEMBRA Y SORTEO","SEEDING & DRAW")}</div>
        <h3>{seedingMethodLabel(locale,activeMethod)}</h3>
        <p className="muted">
          {tr(
            locale,
            `Formato fijó ${groups} grupo(s). Acá sólo decidís cómo repartir los participantes.`,
            `Format fixed ${groups} group(s). Here you only decide how entries are distributed.`,
          )}
        </p>
      </div>
      <span className="epic-draw-groups"><b>{groups}</b> {tr(locale,"grupo(s)","group(s)")}</span>
    </div>
    {category.entryType==="pair"?<p className="muted">{tr(locale,"DUPR pareja = suma de DUPR Doubles de ambos integrantes. La suma conserva el mismo orden que el promedio, pero muestra la fuerza total de la pareja.","Pair DUPR = the sum of both players' Doubles DUPR. The sum preserves the same ranking as the average while showing total pair strength.")}</p>:null}
    <div className="epic-draw-methods">
      <button type="button" className={activeMethod==="snake"?"light":"ghost"} onClick={()=>void generate("snake")}>DUPR</button>
      <button type="button" className={activeMethod==="random"?"light":"ghost"} onClick={()=>void generate("random")}>{tr(locale,"Aleatorio","Random")}</button>
      <button type="button" className={activeMethod==="manual"?"light":"ghost"} onClick={()=>void generate("manual")}>{tr(locale,"Editar distribución","Edit distribution")}</button>
      <button type="button" className={activeMethod==="live"?"light":"ghost"} onClick={()=>void prepareLive()}>{tr(locale,drawState&&drawState.status!=="complete"?"Reiniciar sorteo en vivo":"Sorteo en vivo",drawState&&drawState.status!=="complete"?"Restart live draw":"Live draw")}</button>
      {activeMethod!=="manual" ? <label className="check epic-check">
        <input type="checkbox" checked={heads} onChange={(event)=>setHeads(event.target.checked)} />
        <span>{tr(locale,"Fijar 1 cabeza DUPR por grupo","Pin 1 DUPR head per group")}</span>
      </label> : null}
    </div>
    {drawState ? <div className="epic-live-draw-panel">
      <div className="epic-live-draw-reveal">
        <small>{drawState.status==="complete"?tr(locale,"SORTEO COMPLETO","DRAW COMPLETE"):tr(locale,"ÚLTIMO SORTEO","LAST DRAW")}</small>
        <strong>{drawState.lastEntryId?entryName(String(drawState.lastEntryId)):"HUAU"}</strong>
        <span>{drawState.lastGroup?`${tr(locale,"Grupo","Group")} ${drawState.lastGroup}`:"—"}</span>
        <em>{Number(drawState.revealIndex??0)+Number(drawState.seededHeadIds?.length??0)}/{entries.length}</em>
      </div>
      {Array.isArray(drawState.seededHeadIds)&&drawState.seededHeadIds.length ? <p className="muted">{tr(locale,"Cabezas DUPR ya fijadas; el sorteo completa los lugares restantes.","DUPR heads are already pinned; the draw fills the remaining slots.")}</p> : null}
      <div className="epic-live-draw-groups">
        {(Object.entries(drawState.assignments??{}) as Array<[string,string[]]>).map(([label,ids])=><section key={label}><b>{tr(locale,"Grupo","Group")} {label}</b>{(ids as string[]).map((id)=><span key={id}>{entryName(id)}</span>)}</section>)}
      </div>
      {drawState.status!=="complete"?<button type="button" className="light" onClick={()=>void reveal()}>{tr(locale,"Sacar siguiente","Draw next")}</button>:null}
    </div> : null}
  </article>;
}

function EpicTeamDrawControls({ locale, category, mutate }: { locale: Locale; category: any; mutate: EpicDayMutate }) {
  const groupCount = Math.max(1, new Set((category.groups??[]).map((row:any)=>String(row.id))).size || 1);
  const activeMethod = String(category.seedingMethod ?? "snake");
  const generate = async (method: "snake" | "random" | "manual") => mutate((next) => {
    const nextCategory = (next.team.categories as any[]).find((row)=>String(row.id)===String(category.id));
    if (!nextCategory) throw new Error("TEAM_CATEGORY_NOT_FOUND");
    nextCategory.seedingMethod = method;
    if (method !== "manual") {
      const ordered = [...nextCategory.entries];
      if (method === "snake") ordered.sort((a:any,b:any)=>teamEntryRating(next,String(category.id),String(b.id))-teamEntryRating(next,String(category.id),String(a.id))||String(a.displayName).localeCompare(String(b.displayName)));
      else ordered.sort(()=>Math.random()-0.5);
      ordered.forEach((entry:any,index:number)=>{ entry.seedOrder=index+1; entry.seedRating=teamEntryRating(next,String(category.id),String(entry.id)); });
      generateLocalTeamStructure(next,String(category.id),groupCount);
    }
    markStructureDirty(next);
  }, method==="manual"?tr(locale,"Modo manual activo. Mové equipos entre grupos debajo.","Manual mode enabled. Move teams between groups below."):tr(locale,"Siembra Team regenerada.","Team seeding regenerated."), "structure");
  return <article className="panel epic-draw-panel"><div className="panel-title"><div><div className="eyebrow">{tr(locale,"SIEMBRA TEAM","TEAM SEEDING")}</div><h3>{seedingMethodLabel(locale,activeMethod)}</h3><p className="muted">{tr(locale,"DUPR y Aleatorio regeneran la distribución. Manual conserva la estructura y habilita mover equipos desde cada grupo.","DUPR and Random regenerate distribution. Manual keeps the structure and lets you move teams from each group.")}</p></div></div><div className="epic-draw-methods"><button type="button" className={activeMethod==="snake"?"light":"ghost"} onClick={()=>void generate("snake")}>DUPR</button><button type="button" className={activeMethod==="random"?"light":"ghost"} onClick={()=>void generate("random")}>{tr(locale,"Aleatorio","Random")}</button><button type="button" className={activeMethod==="manual"?"light":"ghost"} onClick={()=>void generate("manual")}>{tr(locale,"Manual","Manual")}</button></div></article>;
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
  const standardStandings = !isTeam && competition
    ? (snapshot.workspace.standard.standings as any[]).filter(
        (standing) => String(standing.categoryId) === String(core.id),
      )
    : [];

  const standardFirstRound = !isTeam && competition
    ? (competition.encounters ?? []).filter(
        (encounter: any) =>
          encounter.stage !== "group" &&
          encounter.stage !== "consolation" &&
          Number(encounter.roundNumber) === 1,
      )
    : [];

  const standardPostGroupStarted = !isTeam && competition
    ? (competition.encounters ?? []).some(
        (encounter: any) =>
          encounter.stage !== "group" &&
          ["finished", "in_progress"].includes(
            String(encounter.status),
          ),
      )
    : false;

  const standardFirstRoundEntryMap = new Map<string, any>();
  for (const encounter of standardFirstRound) {
    if (encounter.entryA) {
      standardFirstRoundEntryMap.set(
        String(encounter.entryA.id),
        encounter.entryA,
      );
    }
    if (encounter.entryB) {
      standardFirstRoundEntryMap.set(
        String(encounter.entryB.id),
        encounter.entryB,
      );
    }
  }
  const standardFirstRoundEntries = [
    ...standardFirstRoundEntryMap.values(),
  ];

  const canEditStandardFirstRound = Boolean(
    !isTeam &&
    competition?.format?.playoffMode === "standard" &&
    competition?.finalGenerated &&
    !standardPostGroupStarted &&
    standardFirstRoundEntries.length >= 2,
  );

  const groupByStandardEntry = new Map<string, string>();
  if (competition) {
    for (const group of competition.groups ?? []) {
      for (const entry of group.entries ?? []) {
        groupByStandardEntry.set(
          String(entry.id),
          String(group.id),
        );
      }
    }
  }

  const immediateRematches = standardFirstRound.filter(
    (encounter: any) =>
      encounter.entryA &&
      encounter.entryB &&
      groupByStandardEntry.get(String(encounter.entryA.id)) ===
        groupByStandardEntry.get(String(encounter.entryB.id)),
  );

  return (
    <section className="td-stack epic-competition-studio">
      <article className="panel epic-competition-hero">
        <div><div className="eyebrow">{tr(locale,"COMPETENCIA MATERIALIZADA","LIVE COMPETITION")}</div><h2>{tr(locale,"Grupos, rondas y fase final", "Groups, rounds & finals")}</h2><p className="muted">{tr(locale,"Acá ves exactamente lo que se va a jugar. La siembra define quién cae en cada grupo; esta pantalla muestra el resultado deportivo real.","This is exactly what will be played. Seeding decides group placement; this screen shows the actual sporting structure.")}</p></div>
        <div className="epic-format-context"><strong>{entries}</strong><span>{isTeam?tr(locale,"equipos","teams"):tr(locale,"participantes","entries")}</span><b>{groupCount} {tr(locale,"grupos","groups")}</b></div>
      </article>
      <article className="panel"><div className="td-category-tabs epic-category-tabs">{available.map((row) => <button key={row.id} className={String(row.id)===String(core.id)?"light small":"ghost small"} onClick={() => setCategoryId(String(row.id))}>{row.name}</button>)}</div></article>

      <article className="panel epic-sport-criteria">
        <div>
          <strong>{tr(locale,"Criterio deportivo","Sport logic")}</strong>
          <p>{stageDescription(locale, format)}</p>
          {!isTeam ? (
            <small>
              {tr(locale,"Desempate","Tiebreak")}:{" "}
              {standardCriteriaSummary(locale, format)}
            </small>
          ) : null}
        </div>
        <span>{seedingMethodLabel(locale,seedingMethodFor(snapshot,core))} · {formatModeLabel(locale, String(format?.competition?.playoffMode ?? format?.playoffMode ?? "standard"))}</span>
      </article>

      {!isTeam && competition ? <EpicStandardDrawControls locale={locale} snapshot={snapshot} category={core} competition={competition} mutate={mutate} /> : null}
      {isTeam && teamCategory ? <EpicTeamDrawControls locale={locale} category={teamCategory} mutate={mutate} /> : null}

      {!isTeam && competition ? (
        <>
          <div className="epic-standard-groups">
            {competition.groups.map((group: any) => (
              <article className="panel epic-standard-group" key={group.id}>
                <div className="panel-title"><div><span className="eyebrow">{tr(locale,"GRUPO","GROUP")} {group.name}</span><h3>{group.entries.length} {tr(locale,"participantes","entries")}</h3></div></div>
                {group.entries.map((entry: any, index: number) => (
                  <div className="epic-group-entry" key={entry.id}>
                    <b>{index+1}</b>
                    <strong>{entry.name}</strong>
                    <em>{core.entryType==="pair"?tr(locale,"DUPR pareja","Pair DUPR"):"DUPR"} {round2(Number(entry.rating ?? 0)).toFixed(3)}</em>
                    {seedingMethodFor(snapshot,core)==="manual" ? (
                      <select value={group.id} onChange={(event)=>void mutate(next=>moveLocalStandardEntryToGroup(next,String(competition.categoryId),String(entry.id),event.target.value),tr(locale,"Participante movido y grupos recalculados.","Entry moved and groups rebuilt."),"structure")}>
                        {competition.groups.map((target:any)=><option key={target.id} value={target.id}>{tr(locale,"Grupo","Group")} {target.name}</option>)}
                      </select>
                    ) : null}
                  </div>
                ))}
              </article>
            ))}
          </div>
          {(competition.encounters ?? []).some((row: any) => row.stage !== "group") ? (
            <article className="panel">
              <div className="panel-title">
                <div>
                  <div className="eyebrow">{tr(locale,"FASE POSTERIOR","POST-GROUP PHASE")}</div>
                  <h3>{tr(locale,"Cuadro eliminatorio","Knockout bracket")}</h3>
                </div>
              </div>

              {canEditStandardFirstRound ? (
                <p className="muted">
                  {tr(
                    locale,
                    "Antes de cargar resultados podés corregir manualmente cualquier participante de la primera ronda. HUAU intercambia posiciones: nadie se duplica ni desaparece del cuadro.",
                    "Before entering results you may manually correct any first-round participant. HUAU swaps positions so nobody is duplicated or removed from the bracket.",
                  )}
                </p>
              ) : null}

              {immediateRematches.length > 0 &&
              Boolean(competition.format?.avoidGroupRematches) ? (
                <p className="warning-line">
                  ⚠{" "}
                  {tr(
                    locale,
                    `${immediateRematches.length} cruce(s) de la primera ronda repiten grupo. La asignación automática no pudo evitarlos o el cuadro fue editado manualmente.`,
                    `${immediateRematches.length} first-round matchup(s) repeat a group. Automatic allocation could not avoid them or the bracket was edited manually.`,
                  )}
                </p>
              ) : null}

              <div className="epic-bracket-grid">
                {(competition.encounters ?? [])
                  .filter((row:any)=>row.stage!=="group")
                  .map((row:any)=>{
                    const editable =
                      canEditStandardFirstRound &&
                      row.stage !== "consolation" &&
                      Number(row.roundNumber) === 1;

                    return (
                      <div key={row.id}>
                        <span>{row.roundLabel ?? row.stage}</span>

                        {editable && row.entryA ? (
                          <select
                            value={String(row.entryA.id)}
                            onChange={(event) =>
                              void mutate(
                                (next) => {
                                  swapDayStandardFirstRoundEntry(
                                    next,
                                    String(competition.categoryId),
                                    String(row.id),
                                    "A",
                                    event.target.value,
                                  );
                                },
                                tr(
                                  locale,
                                  "Cuadro Standard corregido manualmente.",
                                  "Standard bracket corrected manually.",
                                ),
                                "structure",
                              )
                            }
                          >
                            {standardFirstRoundEntries.map((entry:any) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <strong>{row.entryA?.name ?? (row.status==="bye" ? "BYE" : "TBD")}</strong>
                        )}

                        <em>vs</em>

                        {editable && row.entryB ? (
                          <select
                            value={String(row.entryB.id)}
                            onChange={(event) =>
                              void mutate(
                                (next) => {
                                  swapDayStandardFirstRoundEntry(
                                    next,
                                    String(competition.categoryId),
                                    String(row.id),
                                    "B",
                                    event.target.value,
                                  );
                                },
                                tr(
                                  locale,
                                  "Cuadro Standard corregido manualmente.",
                                  "Standard bracket corrected manually.",
                                ),
                                "structure",
                              )
                            }
                          >
                            {standardFirstRoundEntries.map((entry:any) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <strong>{row.entryB?.name ?? (row.status==="bye" ? "BYE" : "TBD")}</strong>
                        )}

                        <small>{row.status}</small>
                      </div>
                    );
                  })}
              </div>
            </article>
          ) : null}

          {standardStandings.length ? (
            <article className="panel">
              <div className="eyebrow">STANDINGS</div>
              <div className="td-standing-grid">
                {standardStandings.map((standing:any)=>
                  <div className="td-standing-card" key={standing.groupId}>
                    <strong>{tr(locale,"Grupo","Group")} {standing.groupName}</strong>
                    {(standing.rows??[]).map((row:any,index:number)=>
                      <span key={row.entryId}>
                        {row.position ?? index+1}. {row.name} · <b>{row.wins}-{row.losses}</b> · {row.played} PJ · {Number(row.diff??0)>=0?"+":""}{row.diff??0}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </article>
          ) : null}
        </>
      ) : null}

      {isTeam && teamCategory ? (
        <>
          <article className="panel epic-seed-overview"><div className="panel-title"><div><div className="eyebrow">{tr(locale,"SIEMBRA ACTUAL","CURRENT SEEDING")}</div><h3>{seedingMethodLabel(locale,String(teamCategory.seedingMethod??"snake"))}</h3></div></div><div className="td-seed-list">{[...(teamCategory.entries??[])].sort((a:any,b:any)=>Number(a.seedOrder??999)-Number(b.seedOrder??999)).map((entry:any,index:number)=><span key={entry.id}><b>{index+1}</b>{entry.displayName}<em>{round2(teamEntryRating(snapshot,String(teamCategory.id),String(entry.id))).toFixed(3)}</em></span>)}</div></article>
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

function scheduleClockMinutes(value: string) {
  const [h = Number.NaN, m = Number.NaN] = value.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function categoryParticipantIds(snapshot: TournamentDayReformSnapshot, categoryId: string) {
  const ids = new Set<string>();
  for (const row of snapshot.workspace.participants.playerCategories as any[]) {
    if (String(row.categoryId) !== categoryId) continue;
    for (const value of [row.playerProfileId, row.partnerProfileId]) if (value) ids.add(String(value));
  }
  for (const entry of snapshot.workspace.standard.entries as any[]) {
    if (String(entry.categoryId) !== categoryId) continue;
    for (const value of entry.localProfileIds ?? []) ids.add(String(value));
  }
  return ids;
}

function sharedParticipantCount(snapshot: TournamentDayReformSnapshot, a: string | null, b: string) {
  if (!a) return 0;
  const left = categoryParticipantIds(snapshot, a);
  const right = categoryParticipantIds(snapshot, b);
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function preventScheduleWheelMutation(event: any) {
  const target = event.target;
  if (
    target instanceof HTMLInputElement &&
    (target.type === "number" || target.type === "time") &&
    document.activeElement === target
  ) {
    target.blur();
  }
}

export function EpicSchedulePolicyPanel({ locale, snapshot, mutate }: { locale: Locale; snapshot: TournamentDayReformSnapshot; mutate: EpicDayMutate }) {
  const settings = snapshot.workspace.core.settings as any;
  const categories = snapshot.workspace.core.categories as any[];
  const existing = settings.schedulePolicy ?? { mode: "manual_flow", categories: {} };

  const fallbackDate = (category: any) => {
    const local = ensureDayLocalMeta(snapshot).schedule.categoryDates?.[String(category.id)];
    if (local) return String(local);
    if (category?.scheduledDate) return String(category.scheduledDate);
    const raw = Number(snapshot.workspace.core.tournament.startAt ?? Date.now());
    return new Date(raw < 10_000_000_000 ? raw * 1000 : raw).toISOString().slice(0, 10);
  };

  const sortedIds = (phase: "group" | "final") =>
    [...categories]
      .sort((a, b) => {
        const ar = existing.categories?.[String(a.id)] ?? {};
        const br = existing.categories?.[String(b.id)] ?? {};
        const ak = phase === "group" ? ar.groupOrder ?? ar.order : ar.finalOrder ?? ar.order;
        const bk = phase === "group" ? br.groupOrder ?? br.order : br.finalOrder ?? br.order;
        return Number(ak ?? 999) - Number(bk ?? 999);
      })
      .map((category) => String(category.id));

  const [groupOrder, setGroupOrder] = useState<string[]>(() => sortedIds("group"));
  const [finalOrder, setFinalOrder] = useState<string[]>(() => sortedIds("final"));

  useEffect(() => {
    const ids = new Set(categories.map((category) => String(category.id)));
    setGroupOrder((current) => [
      ...current.filter((id) => ids.has(id)),
      ...categories.map((category) => String(category.id)).filter((id) => !current.includes(id)),
    ]);
    setFinalOrder((current) => [
      ...current.filter((id) => ids.has(id)),
      ...categories.map((category) => String(category.id)).filter((id) => !current.includes(id)),
    ]);
  }, [categories.length]);

  const move = (list: string[], setList: (value: string[]) => void, dragged: string, target: string) => {
    if (!dragged || dragged === target) return;
    const next = list.filter((id) => id !== dragged);
    const targetIndex = next.indexOf(target);
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, dragged);
    setList(next);
  };

  const realGroupMatches = (categoryId: string) =>
    (snapshot.workspace.standard.matches as any[]).filter(
      (row) =>
        String(row.categoryId) === categoryId &&
        String(row.stage ?? "group") === "group" &&
        !["bye", "skipped", "finished"].includes(String(row.status)),
    ).length +
    (snapshot.team.categories as any[])
      .filter((category) => String(category.id) === categoryId)
      .reduce(
        (sum, category) =>
          sum +
          (category.encounters ?? []).filter(
            (encounter: any) =>
              String(encounter.stage ?? "group") === "group" &&
              !["bye", "finished"].includes(String(encounter.status)),
          ).length,
        0,
      );

  const categoryById = new Map(categories.map((category) => [String(category.id), category] as const));

  const phaseEffectiveStarts = (
    phase: "group" | "final",
    order: string[],
  ) => {
    const result = new Map<string, string>();
    const anchorByDate = new Map<string, string>();

    for (const id of order) {
      const category = categoryById.get(id);
      if (!category) continue;
      const rule = existing.categories?.[id] ?? {};
      const day = String(
        phase === "group"
          ? rule.groupDate ?? fallbackDate(category)
          : rule.finalDate ?? rule.groupDate ?? fallbackDate(category),
      );
      const explicit = String(
        phase === "group"
          ? rule.groupNotBefore ?? ""
          : rule.finalNotBefore ?? "",
      ).trim();

      if (/^\d{2}:\d{2}$/.test(explicit)) {
        anchorByDate.set(day, explicit);
        result.set(id, explicit);
        continue;
      }

      result.set(
        id,
        anchorByDate.get(day) ??
          String(settings.dailyStart ?? "09:00"),
      );
    }

    return result;
  };

  const groupEffectiveStarts =
    phaseEffectiveStarts("group", groupOrder);
  const finalEffectiveStarts =
    phaseEffectiveStarts("final", finalOrder);

  const capacityRows = (() => {
    const byDay = new Map<string, { minutes: number; matches: number; earliest: number }>();
    for (const id of groupOrder) {
      const category = categoryById.get(id);
      if (!category) continue;
      const rule = existing.categories?.[id] ?? {};
      const day = String(rule.groupDate ?? fallbackDate(category));
      const minutes = Math.max(5, Number(rule.groupMatchMinutes ?? settings.defaultMatchMinutes ?? 30));
      const matches = realGroupMatches(id);
      const startMinute =
        scheduleClockMinutes(
          String(
            groupEffectiveStarts.get(id) ??
              settings.dailyStart ??
              "09:00",
          ),
        ) ?? 540;
      const row = byDay.get(day) ?? { minutes: 0, matches: 0, earliest: startMinute };
      row.minutes += matches * minutes;
      row.matches += matches;
      row.earliest = Math.min(row.earliest, startMinute);
      byDay.set(day, row);
    }
    const endMinute = scheduleClockMinutes(String(settings.dailyEnd ?? "20:00")) ?? 1200;
    const courts = Math.max(1, Number(snapshot.workspace.core.tournament.courtCount ?? 1));
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, row]) => {
      const capacity = Math.max(0, endMinute - row.earliest) * courts;
      const occupancy = capacity > 0 ? Math.round((row.minutes / capacity) * 100) : 999;
      return { day, ...row, capacity, occupancy };
    });
  })();

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    for (const category of categories) {
      const id = String(category.id);
      const groupDate = String(data.get(`groupDate:${id}`) ?? "");
      const finalDate = String(data.get(`finalDate:${id}`) ?? "");
      if (groupDate && finalDate && finalDate < groupDate) {
        window.alert(tr(locale,`La fase final de ${category.name} no puede quedar antes que sus grupos.`,`The final phase for ${category.name} cannot be before its groups.`));
        return;
      }
      for (const [label, startKey, endKey] of [
        [tr(locale,"grupos","groups"), `groupStart:${id}`, `groupEnd:${id}`],
        [tr(locale,"fase final","final phase"), `finalStart:${id}`, `finalEnd:${id}`],
      ] as const) {
        const startValue = String(data.get(startKey) ?? "");
        const endValue = String(data.get(endKey) ?? "");
        const startMinutes = startValue ? scheduleClockMinutes(startValue) : null;
        const endMinutes = endValue ? scheduleClockMinutes(endValue) : null;
        if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
          window.alert(tr(locale,`En ${category.name}, el fin de ${label} debe ser posterior al inicio.`,`For ${category.name}, the ${label} end must be after the start.`));
          return;
        }
      }
      for (const phase of ["group", "final"] as const) {
        const minimum = Math.max(0, Number(data.get(`${phase}MinRest:${id}`) ?? 0));
        const preferred = Math.max(0, Number(data.get(`${phase}PreferredRest:${id}`) ?? minimum));
        if (preferred < minimum) {
          window.alert(tr(locale,`En ${category.name}, el descanso objetivo no puede ser menor al mínimo.`,`For ${category.name}, target rest cannot be lower than minimum rest.`));
          return;
        }
      }
    }

    await mutate((next) => {
      const targetSettings = next.workspace.core.settings as any;
      const previous = targetSettings.schedulePolicy?.categories ?? {};
      const categoryRules: Record<string, any> = {};

      for (const category of categories) {
        const id = String(category.id);
        const old = previous[id] ?? {};
        const groupIndex = Math.max(0, groupOrder.indexOf(id));
        const finalIndex = Math.max(0, finalOrder.indexOf(id));
        const groupMinimumRestMinutes = Math.max(0, Number(data.get(`groupMinRest:${id}`) ?? 0));
        const finalMinimumRestMinutes = Math.max(0, Number(data.get(`finalMinRest:${id}`) ?? 0));

        categoryRules[id] = {
          ...old,
          order: groupIndex + 1,
          groupOrder: groupIndex + 1,
          finalOrder: finalIndex + 1,
          phase: 1,
          groupDate: String(data.get(`groupDate:${id}`) ?? "").trim() || null,
          finalDate: String(data.get(`finalDate:${id}`) ?? "").trim() || null,
          groupNotBefore: String(data.get(`groupStart:${id}`) ?? "").trim() || null,
          groupNotAfter: String(data.get(`groupEnd:${id}`) ?? "").trim() || null,
          finalNotBefore: String(data.get(`finalStart:${id}`) ?? "").trim() || null,
          finalNotAfter: String(data.get(`finalEnd:${id}`) ?? "").trim() || null,
          groupMatchMinutes: Math.max(5, Number(data.get(`groupMinutes:${id}`) ?? settings.defaultMatchMinutes ?? 30)),
          finalMatchMinutes: Math.max(5, Number(data.get(`finalMinutes:${id}`) ?? data.get(`groupMinutes:${id}`) ?? settings.defaultMatchMinutes ?? 30)),
          groupMinimumRestMinutes,
          groupPreferredRestMinutes: Math.max(groupMinimumRestMinutes, Number(data.get(`groupPreferredRest:${id}`) ?? groupMinimumRestMinutes)),
          finalMinimumRestMinutes,
          finalPreferredRestMinutes: Math.max(finalMinimumRestMinutes, Number(data.get(`finalPreferredRest:${id}`) ?? finalMinimumRestMinutes)),
          groupMaxConcurrentCourts: String(data.get(`groupMax:${id}`) ?? "").trim()
            ? Math.max(1, Number(data.get(`groupMax:${id}`)))
            : null,
          finalMaxConcurrentCourts: String(data.get(`finalMax:${id}`) ?? "").trim()
            ? Math.max(1, Number(data.get(`finalMax:${id}`)))
            : null,
          groupSequence: String(data.get(`groupSequence:${id}`) ?? old.groupSequence ?? old.sequence ?? "rounds"),
          finalSequence: String(data.get(`finalSequence:${id}`) ?? old.finalSequence ?? old.sequence ?? "rounds"),
          allowedCourts: parseCourtList(String(data.get(`allowed:${id}`) ?? "")),
          preferredCourts: parseCourtList(String(data.get(`preferred:${id}`) ?? "")),
          exclusiveCourts: parseCourtList(String(data.get(`exclusive:${id}`) ?? "")),
        };
      }

      targetSettings.schedulePolicy = { mode: "manual_flow", categories: categoryRules };
      targetSettings.schedulePlanRevision = Number(targetSettings.schedulePlanRevision ?? 0) + 1;
      markStructureDirty(next);
    }, tr(locale,"Plan operativo guardado. El cronograma quedó pendiente de regenerar.","Operational plan saved. Schedule regeneration is pending."),"structure");
  };

  const renderPhaseRows = (
    phase: "group" | "final",
    order: string[],
    setOrder: (value: string[]) => void,
  ) => order.map((id, index) => {
    const category = categoryById.get(id);
    if (!category) return null;
    const rule = existing.categories?.[id] ?? {};
    const previousId = index > 0 ? order[index - 1] ?? null : null;
    const shared = sharedParticipantCount(snapshot, previousId, id);
    const isGroup = phase === "group";
    const baseDate = fallbackDate(category);
    const date = String(isGroup ? rule.groupDate ?? baseDate : rule.finalDate ?? rule.groupDate ?? baseDate);
    const startValue = String(isGroup ? rule.groupNotBefore ?? "" : rule.finalNotBefore ?? "");
    const effectiveStart = String(
      (isGroup ? groupEffectiveStarts : finalEffectiveStarts).get(id) ??
        settings.dailyStart ??
        "09:00",
    );
    const endValue = String(isGroup ? rule.groupNotAfter ?? "" : rule.finalNotAfter ?? "");
    const minutes = Number(
      isGroup
        ? rule.groupMatchMinutes ?? settings.defaultMatchMinutes ?? 30
        : rule.finalMatchMinutes ?? rule.groupMatchMinutes ?? settings.defaultMatchMinutes ?? 30,
    );
    const minRest = Number(
      isGroup
        ? rule.groupMinimumRestMinutes ?? settings.scheduleMinimumRestMinutes ?? 0
        : rule.finalMinimumRestMinutes ?? settings.scheduleMinimumRestMinutes ?? 0,
    );
    const preferredRest = Number(
      isGroup
        ? rule.groupPreferredRestMinutes ?? settings.schedulePreferredRestMinutes ?? Math.max(minRest, 25)
        : rule.finalPreferredRestMinutes ?? settings.schedulePreferredRestMinutes ?? Math.max(minRest, 25),
    );
    const maxCourts = isGroup
      ? rule.groupMaxConcurrentCourts ?? rule.maxConcurrentCourts ?? ""
      : rule.finalMaxConcurrentCourts ?? rule.maxConcurrentCourts ?? "";

    return <div
      className="epic-flow-row"
      key={`${phase}:${id}`}
      onDragOver={(event)=>event.preventDefault()}
      onDrop={(event)=>{event.preventDefault();move(order,setOrder,event.dataTransfer.getData("text/plain"),id)}}
    >
      <span
        className="epic-flow-handle"
        title={tr(locale,"Arrastrá para ordenar","Drag to reorder")}
        draggable
        onDragStart={(event)=>{
          event.dataTransfer.effectAllowed="move";
          event.dataTransfer.setData("text/plain",id);
        }}
      >☰</span>
      <div className="epic-flow-category">
        <strong>{index + 1}. {category.name}</strong>
        <small>
          {isGroup
            ? `${realGroupMatches(id)} ${tr(locale,"partidos/series de grupos","group matches/series")}`
            : tr(locale,"fase final · orden independiente","final phase · independent order")}
          {shared > 0 ? ` · ${shared} ${tr(locale,"jug. compartidos con anterior","players shared with previous")}` : ""}
        </small>
        {!isGroup ? <button
          type="button"
          className="epic-flow-same-day"
          onClick={(event)=>{
            const form=event.currentTarget.closest("form");
            const groupDate=form?.elements.namedItem(`groupDate:${id}`);
            const finalDate=form?.elements.namedItem(`finalDate:${id}`);
            if(groupDate instanceof HTMLInputElement && finalDate instanceof HTMLInputElement){
              finalDate.value=groupDate.value;
            }
          }}
        >{tr(locale,"Mismo día que grupos","Same day as groups")}</button> : null}
      </div>
      <label><span>{tr(locale,"Día","Day")}</span><input name={`${phase}Date:${id}`} type="date" defaultValue={date}/></label>
      <label className="epic-flow-start-field"><span>{tr(locale,"No antes de","Not before")}</span><input name={`${phase}Start:${id}`} type="time" defaultValue={startValue}/><small>{startValue ? tr(locale,"ancla manual","manual anchor") : tr(locale,`vacío = continúa la cola desde ${effectiveStart}`,`blank = continue queue from ${effectiveStart}`)}</small></label>
      <label><span>{tr(locale,"Hasta","Until")}</span><input name={`${phase}End:${id}`} type="time" defaultValue={endValue}/></label>
      <label><span>{tr(locale,"Min/partido","Min/match")}</span><input name={`${phase}Minutes:${id}`} type="number" min="5" defaultValue={minutes}/></label>
      <label><span>{tr(locale,"Desc. mín.","Min rest")}</span><input name={`${phase}MinRest:${id}`} type="number" min="0" defaultValue={minRest}/></label>
      <label><span>{tr(locale,"Desc. objetivo","Target rest")}</span><input name={`${phase}PreferredRest:${id}`} type="number" min="0" defaultValue={preferredRest}/></label>
      <label><span>{tr(locale,"Máx. canchas","Max courts")}</span><input name={`${phase}Max:${id}`} type="number" min="1" placeholder="—" defaultValue={maxCourts}/></label>
    </div>;
  });

  return <article className="panel epic-policy-panel">
    <div className="panel-title"><div>
      <div className="eyebrow">{tr(locale,"PLAN OPERATIVO · CONTROL MANUAL","OPERATIONAL PLAN · MANUAL CONTROL")}</div>
      <h2>{tr(locale,"Vos definís el torneo; HUAU resuelve las canchas","You define the tournament; HUAU resolves the courts")}</h2>
      <p className="muted">{tr(locale,"El orden no es una barrera: una categoría posterior puede entrar apenas haya cancha y jugadores legales. Para forzar una espera, usá “No antes de”. Dos categorías con la misma hora y máximo 2 canchas pueden arrancar 2+2.","Order is not a barrier: a later category may enter as soon as a court and eligible players are available. To force a wait, use “Not before”. Two categories at the same time with max 2 courts may start 2+2.")}</p>
    </div></div>

    <div className="epic-policy-legend">
      <span><b>{tr(locale,"DURO","HARD")}</b>{tr(locale,"día · no antes de · hasta · descanso mínimo · máximo de canchas","day · not before · until · minimum rest · max courts")}</span>
      <span><b>{tr(locale,"PREFERENCIA","PREFERENCE")}</b>{tr(locale,"orden visual · continuidad · descanso objetivo; nunca inventa otro día","visual order · continuity · target rest; never invents another day")}</span>
    </div>

    <div className="epic-capacity-grid">
      {capacityRows.map((row)=><span key={row.day} className={row.occupancy > 100 ? "over" : row.occupancy >= 85 ? "tight" : ""}>
        <b>{row.day}</b>
        <strong>{row.matches} {tr(locale,"partidos/series de grupos","group matches/series")} · {Math.floor(row.minutes/60)}h {row.minutes%60}m</strong>
        <small>{tr(locale,"Capacidad teórica","Theoretical capacity")}: {Math.floor(row.capacity/60)}h {row.capacity%60}m · {row.occupancy}%</small>
      </span>)}
    </div>

    <form onSubmit={save} onWheelCapture={preventScheduleWheelMutation} className="td-stack">
      <section className="epic-flow-phase">
        <header><div><span>1</span><div><strong>{tr(locale,"Grupos","Groups")}</strong><small>{tr(locale,"Arrastrá para definir la cola de entrada del día.","Drag to define the day's entry queue.")}</small></div></div></header>
        <div className="epic-flow-table">{renderPhaseRows("group",groupOrder,setGroupOrder)}</div>
      </section>

      <section className="epic-flow-phase">
        <header><div><span>2</span><div><strong>{tr(locale,"Fases finales","Final phases")}</strong><small>{tr(locale,"Orden totalmente independiente de los grupos.","Order fully independent from groups.")}</small></div></div></header>
        <div className="epic-flow-table">{renderPhaseRows("final",finalOrder,setFinalOrder)}</div>
      </section>

      <details className="epic-advanced">
        <summary>{tr(locale,"Opciones avanzadas de canchas y ritmo interno","Advanced court and internal-rhythm options")}</summary>
        <div className="epic-flow-advanced-grid">
          {categories.map((category)=>{
            const id=String(category.id);
            const rule=existing.categories?.[id]??{};
            return <section key={`advanced:${id}`}>
              <strong>{category.name}</strong>
              <label><span>{tr(locale,"Ritmo grupos","Group rhythm")}</span><select name={`groupSequence:${id}`} defaultValue={String(rule.groupSequence??rule.sequence??"rounds")}>
                <option value="rounds">{tr(locale,"Rondas compactas","Compact rounds")}</option>
                <option value="free">{tr(locale,"Libre","Free")}</option>
                <option value="groups">{tr(locale,"Grupo por grupo","Group by group")}</option>
                <option value="group_pairs">{tr(locale,"Grupos de a 2","Groups in pairs")}</option>
              </select></label>
              <label><span>{tr(locale,"Ritmo finales","Final rhythm")}</span><select name={`finalSequence:${id}`} defaultValue={String(rule.finalSequence??rule.sequence??"rounds")}>
                <option value="rounds">{tr(locale,"Rondas compactas","Compact rounds")}</option>
                <option value="free">{tr(locale,"Libre","Free")}</option>
              </select></label>
              <label><span>{tr(locale,"Canchas permitidas","Allowed courts")}</span><input name={`allowed:${id}`} placeholder={tr(locale,"vacío = todas","empty = all")} defaultValue={(rule.allowedCourts??[]).join(",")}/></label>
              <label><span>{tr(locale,"Canchas preferidas","Preferred courts")}</span><input name={`preferred:${id}`} placeholder="1,2" defaultValue={(rule.preferredCourts??[]).join(",")}/></label>
              <label><span>{tr(locale,"Canchas exclusivas","Exclusive courts")}</span><input name={`exclusive:${id}`} placeholder="—" defaultValue={(rule.exclusiveCourts??[]).join(",")}/></label>
            </section>;
          })}
        </div>
      </details>

      <button className="light epic-primary">{tr(locale,"Guardar plan operativo","Save operational plan")}</button>
    </form>
  </article>;
}

function teamTvLineupNames(category: any, encounter: any, entryId: string, rubberKey: string) {
  const lineup = (encounter.lineups ?? []).find((row: any) => String(row.entryId) === String(entryId));
  const entry = (category.entries ?? []).find((row: any) => String(row.id) === String(entryId));
  const knownRoster = [...(entry?.roster ?? []), ...(entry?.rosterHistory ?? [])];
  const names = lineupPersonIds(lineup, String(rubberKey)).map((personId: string) =>
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
    {active ? <div className="epic-tv-rubber"><span>{rubberDisplayCode(definition ?? active)} · {definition?.label ?? active.rubberKey}</span><div><strong>{teamTvLineupNames(category,encounter,String(encounter.entryAId),String(active.rubberKey))}</strong><em>vs</em><strong>{teamTvLineupNames(category,encounter,String(encounter.entryBId),String(active.rubberKey))}</strong></div>{active.resultStatus ? <b>{active.scoreA ?? "—"} — {active.scoreB ?? "—"}</b> : <small>{tr(locale,"Rubber actual / próximo","Current / next rubber")}</small>}</div> : null}
    <div className="epic-tv-progress">{ordered.map((match:any)=>{const def=defs.find((row:any)=>String(row.key)===String(match.rubberKey));return <span className={match.status==="finished"?"done":match.status==="skipped"?"skip":["ready","in_progress"].includes(String(match.status))?"live":""} key={match.id}>{rubberDisplayCode(def ?? match)}{def?.play==="if_tied"?"*":""}</span>})}</div>
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
  for(const row of schedule){
    const key=String(row.scheduleUnitId??row.encounterId??row.id);
    const list=blockMap.get(key)??[];
    list.push(row);
    blockMap.set(key,list);
  }

  let blocks=[...blockMap.entries()].map(([id,rows])=>({
    id,
    rows,
    first:[...rows].sort((a,b)=>Number(a.startAt)-Number(b.startAt))[0],
  }));

  if(mode==="category"&&categoryId){
    blocks=blocks.filter((block)=>String(block.first.categoryId)===categoryId);
  }

  if(mode==="courts"&&court){
    blocks=blocks.filter(
      (block)=>String(block.first.courtLabel).match(/\d+/)?.[0]===court,
    );
  }

  const activeBlocks=blocks.filter((block)=>
    block.rows.some((row)=>row.status!=="completed"&&row.status!=="cancelled")
  );

  const orderedActive=[...activeBlocks].sort(
    (a,b)=>Math.min(...a.rows.map((r)=>Number(r.startAt)))-Math.min(...b.rows.map((r)=>Number(r.startAt))),
  );
  const firstWaveStart=orderedActive.length
    ? Math.min(...orderedActive[0]!.rows.map((r)=>Number(r.startAt)))
    : null;
  const firstWaveStarted=firstWaveStart!==null&&firstWaveStart<=now;
  const current=firstWaveStarted
    ? orderedActive.filter(
        (block)=>Math.min(...block.rows.map((r)=>Number(r.startAt)))===firstWaveStart,
      )
    : [];
  const future=firstWaveStart===null
    ? []
    : orderedActive.filter(
        (block)=>Math.min(...block.rows.map((r)=>Number(r.startAt)))>(firstWaveStarted?firstWaveStart:0),
      );

  const display=mode==="auto"
    ? (current.length?current:future.slice(0,6))
    : orderedActive.slice(0,12);

  const standardStandings=(snapshot.workspace.standard.standings as any[]).map((standing:any)=>({
    kind:"standard",
    categoryId:String(standing.categoryId),
    categoryName:String(
      categories.find((category:any)=>String(category.id)===String(standing.categoryId))?.name??""
    ),
    ...standing,
  }));

  const teamStandings=teamCategories.flatMap((category:any)=>
    (category.standings??[]).map((standing:any)=>({
      kind:"team",
      categoryId:String(category.id),
      categoryName:category.name,
      ...standing,
    }))
  );

  const visibleStandings=[...standardStandings,...teamStandings].filter(
    (standing:any)=>{
      const categoryMatches =
        mode!=="category" ||
        !categoryId ||
        String(standing.categoryId)===categoryId;
      const started=(standing.rows??[]).some(
        (row:any)=>Number(row.played??0)>0
      );
      return categoryMatches && started;
    }
  );

  const standardFinished=(snapshot.workspace.standard.matches as any[])
    .filter((match:any)=>
      String(match.status)==="finished" &&
      match.entryAId &&
      match.entryBId
    )
    .map((match:any)=>{
      const sets=(Array.isArray(match.sets)?match.sets:[]).filter(
        (set:any)=>
          set?.scoreA!==null &&
          set?.scoreA!==undefined &&
          set?.scoreB!==null &&
          set?.scoreB!==undefined
      );

      return {
        id:`standard:${match.categoryId}:${match.encounterId}`,
        categoryId:String(match.categoryId),
        categoryName:String(
          match.categoryName ??
          categories.find((category:any)=>String(category.id)===String(match.categoryId))?.name ??
          ""
        ),
        roundLabel:String(match.roundLabel??match.stage??""),
        sideA:String(match.sideA??""),
        sideB:String(match.sideB??""),
        score:sets.length
          ? sets.map((set:any)=>`${set.scoreA}-${set.scoreB}`).join(" · ")
          : `${match.scoreA??"—"} — ${match.scoreB??"—"}`,
        startAt:Number(match.scheduleStart??0),
        courtLabel:String(match.courtLabel??""),
      };
    });

  const teamFinished=teamCategories.flatMap((category:any)=>
    (category.encounters??[])
      .filter((encounter:any)=>String(encounter.status)==="finished")
      .map((encounter:any)=>{
        const score=teamEncounterScore(category,encounter);
        const scheduled=(encounter.matches??[]).filter(
          (match:any)=>Number(match.scheduleStart??0)>0
        );

        return {
          id:`team:${category.id}:${encounter.id}`,
          categoryId:String(category.id),
          categoryName:String(category.name??""),
          roundLabel:String(encounter.roundLabel??encounter.stage??""),
          sideA:String(encounter.sideA??""),
          sideB:String(encounter.sideB??""),
          score:`${score.a} — ${score.b}`,
          startAt:scheduled.length
            ? Math.max(...scheduled.map((match:any)=>Number(match.scheduleStart)))
            : 0,
          courtLabel:String(scheduled[0]?.courtLabel??""),
        };
      })
  );

  let finishedResults=[...standardFinished,...teamFinished];

  if(mode==="category"&&categoryId){
    finishedResults=finishedResults.filter(
      (result)=>String(result.categoryId)===categoryId
    );
  }

  if(mode==="courts"&&court){
    finishedResults=finishedResults.filter(
      (result)=>String(result.courtLabel).match(/\d+/)?.[0]===court
    );
  }

  finishedResults=finishedResults
    .sort((a,b)=>Number(b.startAt)-Number(a.startAt))
    .slice(0,6);

  const standardBrackets=(snapshot.workspace.standard.competitions as any[])
    .map((competition:any)=>{
      const category=categories.find(
        (row:any)=>String(row.id)===String(competition.categoryId)
      );
      const encounters=(competition.encounters??[])
        .filter((encounter:any)=>String(encounter.stage)!=="group")
        .map((encounter:any)=>{
          const scheduled=schedule.find(
            (row:any)=>
              String(row.categoryId)===String(competition.categoryId) &&
              String(row.encounterId)===String(encounter.id)
          );
          const sets=(encounter.sets??[]).filter(
            (set:any)=>
              set?.scoreA!==null &&
              set?.scoreA!==undefined &&
              set?.scoreB!==null &&
              set?.scoreB!==undefined
          );
          return {
            id:String(encounter.id),
            roundNumber:Math.max(1,Number(encounter.roundNumber??1)),
            roundLabel:String(encounter.roundLabel??encounter.stage??""),
            sideA:String(encounter.entryA?.name??(encounter.status==="bye"?"BYE":"TBD")),
            sideB:String(encounter.entryB?.name??(encounter.status==="bye"?"BYE":"TBD")),
            status:String(encounter.status??"pending"),
            score:String(encounter.status)==="finished"
              ? (
                  sets.length
                    ? sets.map((set:any)=>`${set.scoreA}-${set.scoreB}`).join(" · ")
                    : `${encounter.scoreA??"—"} — ${encounter.scoreB??"—"}`
                )
              : null,
            schedule:scheduled??null,
          };
        });
      return {
        kind:"standard",
        categoryId:String(competition.categoryId),
        categoryName:String(category?.name??""),
        encounters,
      };
    });

  const teamBrackets=teamCategories.map((category:any)=>{
    const encounters=(category.encounters??[])
      .filter((encounter:any)=>String(encounter.stage)!=="group")
      .map((encounter:any)=>{
        const score=teamEncounterScore(category,encounter);
        const scheduled=schedule.find(
          (row:any)=>
            String(row.categoryId)===String(category.id) &&
            String(row.encounterId)===String(encounter.id)
        );
        return {
          id:String(encounter.id),
          roundNumber:Math.max(1,Number(encounter.roundNumber??1)),
          roundLabel:String(encounter.roundLabel??encounter.stage??""),
          sideA:String(encounter.sideA??"TBD"),
          sideB:String(encounter.sideB??"TBD"),
          status:String(encounter.status??"pending"),
          score:String(encounter.status)==="finished"
            ? `${score.a} — ${score.b}`
            : null,
          schedule:scheduled??null,
        };
      });
    return {
      kind:"team",
      categoryId:String(category.id),
      categoryName:String(category.name??""),
      encounters,
    };
  });

  let finalBrackets=[...standardBrackets,...teamBrackets]
    .filter((bracket:any)=>bracket.encounters.length>0);

  if(mode==="category"&&categoryId){
    finalBrackets=finalBrackets.filter(
      (bracket:any)=>String(bracket.categoryId)===categoryId
    );
  }

  return (
    <section className={`epic-tv ${embedded?"embedded":""}`}>
      <header className="epic-tv-header">
        <div className="epic-tv-brand">
          <img src="/huau-logo.png" alt="HUAU"/>
          <div>
            <span className="eyebrow">HUAU LIVE · LOCAL · 0 D1</span>
            <h1>{snapshot.workspace.core.tournament.name}</h1>
          </div>
        </div>
        <span className="epic-live-dot">● LIVE</span>
      </header>

      <div className="epic-tv-controls">
        <button className={mode==="auto"?"active":""} onClick={()=>setMode("auto")}>auto</button>
        <button className={mode==="general"?"active":""} onClick={()=>setMode("general")}>general</button>
        <button className={mode==="category"?"active":""} onClick={()=>setMode("category")}>category</button>
        <button className={mode==="courts"?"active":""} onClick={()=>setMode("courts")}>courts</button>

        {mode==="category"?(
          <select value={categoryId} onChange={(e)=>setCategoryId(e.target.value)}>
            <option value="">{tr(locale,"Todas","All")}</option>
            {categories.map((category)=>
              <option key={category.id} value={category.id}>{category.name}</option>
            )}
          </select>
        ):null}

        {mode==="courts"?(
          <select value={court} onChange={(e)=>setCourt(e.target.value)}>
            <option value="">{tr(locale,"Todas","All")}</option>
            {Array.from(
              {length:Math.max(1,Number(snapshot.workspace.core.tournament.courtCount??1))},
              (_,index)=>
                <option key={index+1} value={String(index+1)}>Cancha {index+1}</option>
            )}
          </select>
        ):null}
      </div>

      <div className="epic-tv-layout">
        <main>
          <div className="epic-tv-section-title">
            <span>
              {current.length
                ? tr(locale,"AHORA","NOW")
                : tr(locale,"AHORA / PRÓXIMOS","NOW / NEXT")}
            </span>
            <b>{display.length}</b>
          </div>

          <div className="epic-tv-cards">
            {display.map((block)=>{
              const first=block.first;

              if(first.categoryEntryType==="team"){
                const category=teamCategories.find(
                  (row)=>String(row.id)===String(first.categoryId)
                );
                const encounter=category?.encounters?.find(
                  (row:any)=>String(row.id)===String(first.encounterId)
                );

                if(category&&encounter){
                  return (
                    <EpicTvTeamCard
                      key={block.id}
                      locale={locale}
                      category={category}
                      encounter={encounter}
                      scheduleRows={block.rows}
                    />
                  );
                }
              }

              return (
                <article className="epic-tv-standard-card" key={block.id}>
                  <header>
                    <span>{first.categoryName}</span>
                    <b>{first.courtLabel}</b>
                  </header>
                  <div>
                    <strong>{first.sideA||first.roundLabel||first.categoryName}</strong>
                    {first.sideB
                      ? <><em>vs</em><strong>{first.sideB}</strong></>
                      : null}
                  </div>
                  <small>
                    {new Date(toMs(Number(first.startAt))).toLocaleTimeString(
                      [],
                      {hour:"2-digit",minute:"2-digit"}
                    )} · {first.roundLabel??first.stage}
                  </small>
                </article>
              );
            })}
          </div>

          {finalBrackets.length ? (
            <section className="epic-tv-brackets">
              <div className="epic-tv-section-title">
                <span>{tr(locale,"FASE FINAL","FINAL BRACKET")}</span>
                <b>{finalBrackets.length}</b>
              </div>

              {finalBrackets.map((bracket:any)=>{
                const rounds=[
                  ...new Set<number>(
                    bracket.encounters.map(
                      (encounter:any)=>Number(encounter.roundNumber??1)
                    )
                  )
                ].sort((a,b)=>a-b);

                return (
                  <article
                    className="epic-tv-bracket-category"
                    key={`${bracket.kind}:${bracket.categoryId}`}
                  >
                    <header>
                      <strong>{bracket.categoryName}</strong>
                      <span>
                        {bracket.kind==="team"
                          ? "TEAM"
                          : tr(locale,"CUADRO","BRACKET")}
                      </span>
                    </header>

                    <div className="epic-tv-bracket-grid">
                      {rounds.map((round:number)=>{
                        const matches=bracket.encounters.filter(
                          (encounter:any)=>
                            Number(encounter.roundNumber??1)===round
                        );

                        return (
                          <section
                            className="epic-tv-bracket-round"
                            key={`${bracket.categoryId}:round:${round}`}
                          >
                            <h4>
                              {matches.length===1
                                ? matches[0]?.roundLabel
                                : `${tr(locale,"Ronda","Round")} ${round}`}
                            </h4>

                            <div>
                              {matches.map((encounter:any)=>(
                                <article
                                  className={`epic-tv-bracket-match status-${encounter.status}`}
                                  key={encounter.id}
                                >
                                  <small>{encounter.roundLabel}</small>

                                  <div className="epic-tv-bracket-player">
                                    <strong>{encounter.sideA}</strong>
                                  </div>

                                  <div className="epic-tv-bracket-player">
                                    <strong>{encounter.sideB}</strong>
                                  </div>

                                  {encounter.score ? (
                                    <b className="epic-tv-bracket-score">
                                      {encounter.score}
                                    </b>
                                  ) : null}

                                  <span>
                                    {encounter.schedule
                                      ? `${new Date(
                                          toMs(Number(encounter.schedule.startAt))
                                        ).toLocaleTimeString(
                                          [],
                                          {hour:"2-digit",minute:"2-digit"}
                                        )} · ${encounter.schedule.courtLabel??""}`
                                      : tr(locale,"Sin horario","Unscheduled")}
                                  </span>
                                </article>
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </section>
          ):null}

          {finishedResults.length ? (
            <section className="epic-tv-history">
              <div className="epic-tv-section-title">
                <span>{tr(locale,"ÚLTIMOS RESULTADOS","LATEST RESULTS")}</span>
                <b>{finishedResults.length}</b>
              </div>

              <div className="epic-tv-cards epic-tv-history-cards">
                {finishedResults.map((result)=>(
                  <article className="epic-tv-standard-card" key={result.id}>
                    <header>
                      <span>{result.categoryName} · {result.roundLabel}</span>
                      <b>{result.courtLabel}</b>
                    </header>

                    <div>
                      <strong>{result.sideA}</strong>
                      <em>{result.score}</em>
                      <strong>{result.sideB}</strong>
                    </div>

                    <small>
                      {result.startAt
                        ? new Date(toMs(Number(result.startAt))).toLocaleTimeString(
                            [],
                            {hour:"2-digit",minute:"2-digit"}
                          )
                        : "—"}
                    </small>
                  </article>
                ))}
              </div>
            </section>
          ):null}
        </main>

        <aside>
          <div className="epic-tv-section-title">
            <span>{tr(locale,"TABLAS","STANDINGS")}</span>
          </div>

          {visibleStandings.length ? (
            <div className="epic-tv-standings">
              {visibleStandings.map((standing:any)=>(
                <section key={`${standing.kind}:${standing.categoryId}:${standing.groupId}`}>
                  <h3>{standing.categoryName} · {standing.groupName}</h3>

                  {(standing.rows??[]).slice(0,8).map((row:any,index:number)=>(
                    <div key={row.entryId}>
                      <b>{row.position??index+1}</b>

                      <strong>
                        {standing.kind==="team"
                          ? row.entryName
                          : row.name}
                      </strong>

                      <span>
                        {standing.kind==="team"
                          ? `${row.played} PJ · ${row.wins} PG · ${row.losses} PP · ${row.standingPoints} PTS`
                          : `${row.played} PJ · ${row.wins} PG · ${row.losses} PP · ${Number(row.diff??0)>=0?"+":""}${row.diff??0}`}
                      </span>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ):(
            <p className="epic-tv-empty">
              {tr(
                locale,
                "Las tablas aparecerán cuando exista una competencia de grupos.",
                "Standings will appear when a group competition exists."
              )}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
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
  if (text.includes("DAY_CATEGORY_REMOVE_HAS_RESULTS")||text.includes("DAY_CATEGORY_ASSIGN_HAS_RESULTS")||text.includes("DAY_TEAM_DELETE_HAS_RESULTS")||text.includes("STANDARD_FIRST_ROUND_EDIT_AFTER_RESULTS")) return {title:tr(locale,"Cambio protegido","Protected change"),lines:[tr(locale,"Ese cambio afectaría una competencia que ya tiene resultados y HUAU no los reescribe ni los borra silenciosamente.","That change would affect a competition with existing results and HUAU never silently rewrites or deletes them.")]};
  if (text.includes("QA_FIXTURE_PUBLISH_BLOCKED")) return {title:tr(locale,"QA protegido","Protected QA"),lines:[tr(locale,"Esta fecha ficticia vive únicamente en la copia local y no puede publicarse ni sincronizarse con el torneo real. Restaurá una copia real cuando termines el QA.","This simulated event lives only in the local copy and cannot be published or synced with the real tournament. Restore a real copy when QA is complete.")]};
  if (text.includes("PUBLIC_MODEL")) return {title:tr(locale,"No se pudo publicar","Could not publish"),lines:[tr(locale,"La información pública no pasó la validación de seguridad. La copia local sigue intacta.","Public information failed the safety validation. The local copy remains intact.")]};
  return {title:tr(locale,"No se pudo completar la acción","Action could not be completed"),lines:[text.replaceAll("_"," ").toLowerCase().replace(/^./,(letter)=>letter.toUpperCase())]};
}

export function EpicErrorModal({ locale, error, onClose }: { locale: Locale; error: string; onClose: () => void }) {
  if (!error) return null;
  const message = humanError(locale,error);
  return <div className="epic-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}><section className="epic-error-modal" role="dialog" aria-modal="true" aria-labelledby="epic-error-title"><button className="epic-modal-close" onClick={onClose} aria-label={tr(locale,"Cerrar","Close")}>×</button><div className="epic-error-icon">×</div><h2 id="epic-error-title">{message.title}</h2><div className="epic-error-lines">{message.lines.map((line,index)=><p key={`${line}-${index}`}>{line}</p>)}</div><button className="light" onClick={onClose}>{tr(locale,"Corregir","Fix it")}</button></section></div>;
}

export function EpicPublicLinkCard({
  locale,
  snapshot,
  busy = false,
  onToggleLanding,
}: {
  locale: Locale;
  snapshot: TournamentDayReformSnapshot;
  busy?: boolean;
  onToggleLanding?: (enabled: boolean) => Promise<void>;
}) {
  const [copied,setCopied]=useState(false);
  const tournament=snapshot.workspace.core.tournament as any;
  const slug=String(tournament.slug??"").trim();
  const dirty=ensureDayLocalMeta(snapshot).publicDirty;
  const promoted=Boolean(tournament.publicLive);
  if(!slug)return null;
  const url=`${window.location.origin}/tournaments/${encodeURIComponent(slug)}/live`;
  const copy=async()=>{await navigator.clipboard.writeText(url);setCopied(true);window.setTimeout(()=>setCopied(false),1800)};
  return <article className="panel epic-public-link">
    <div>
      <div className="eyebrow">{tr(locale,"PÁGINA PÚBLICA","PUBLIC PAGE")}</div>
      <h2>{tr(locale,"Compartir torneo","Share tournament")}</h2>
      <p className="muted">{tr(locale,"Publicar el seguimiento Live y promocionarlo en la portada son decisiones separadas.","Publishing Live tracking and promoting it on the home page are separate decisions.")}</p>
    </div>
    <div className="epic-public-url">
      <code>{url}</code>
      <div>
        <button className="ghost" onClick={()=>void copy()}>{copied?tr(locale,"Copiado ✓","Copied ✓"):tr(locale,"Copiar enlace","Copy link")}</button>
        <button className="light" onClick={()=>window.open(url,"_blank","noopener")}>{tr(locale,"Abrir página pública","Open public page")} ↗</button>
      </div>
    </div>
    <div className="toggle-row">
      <span>{tr(locale,"Mostrar Live en portada","Show Live on home")}</span>
      <button
        type="button"
        className={promoted?"light small":"ghost small"}
        disabled={busy || !onToggleLanding}
        onClick={()=>void onToggleLanding?.(!promoted)}
      >{busy?"…":promoted?"ON":"OFF"}</button>
    </div>
    <small>{promoted
      ? tr(locale,"La franja Live de huau.app puede mostrar este torneo cuando haya información pública publicada.","The huau.app Live ticker may show this tournament when public information is published.")
      : tr(locale,"Este torneo NO aparece en la franja Live de la portada.","This tournament does NOT appear in the home-page Live ticker.")
    }</small>
    <small>{dirty.lastStructurePublishedAt?tr(locale,"Estructura pública disponible.","Public structure available."):tr(locale,"Publicá información para habilitar la página.","Publish structure to enable the page.")}</small>
    {!onToggleLanding ? <small>{tr(locale,"La promoción en portada se controla desde Administración.","Home-page promotion is controlled from Administration.")}</small> : null}
  </article>;
}
