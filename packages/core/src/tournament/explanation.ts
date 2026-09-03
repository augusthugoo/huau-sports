import { normalizeStandardFormat } from "./defaults";
import type {
  CrossGroupMethod,
  FinalDrawMethod,
  PlayoffMode,
  StandardCompetitionFormat,
} from "./types";
import type {
  TeamCompetitionGender,
  TeamFormat,
  TeamRosterComposition,
  TeamStandingCriterion,
} from "../team/types";

export type ExplanationLocale = "es" | "en";
export type ExplanationKind = "standard" | "team";

export type FormatExplanationSection = {
  id: string;
  title: string;
  paragraphs: string[];
  items: string[];
};

export type FormatExplanation = {
  schemaVersion: 1;
  official: true;
  kind: ExplanationKind;
  locale: ExplanationLocale;
  summary: string[];
  sections: FormatExplanationSection[];
};

export type StandardSeedingMethod = "snake" | "manual" | "random" | "live";

export type StandardFormatExplanationInput = {
  format: StandardCompetitionFormat;
  groupCount: number | null;
  groupSizes: number[];
  seedingMethod: StandardSeedingMethod | null;
  bracketSize: number | null;
  byes: number | null;
};

const tr = (locale: ExplanationLocale, es: string, en: string) => (locale === "es" ? es : en);

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integer(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function numbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((candidate) => Number(candidate))
    .filter((candidate) => Number.isFinite(candidate) && candidate > 0)
    .map((candidate) => Math.trunc(candidate));
}

function listWithAnd(values: string[], locale: ExplanationLocale): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} ${tr(locale, "y", "and")} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} ${tr(locale, "y", "and")} ${values.at(-1)}`;
}

function plural(locale: ExplanationLocale, value: number, singularEs: string, pluralEs: string, singularEn: string, pluralEn: string) {
  if (locale === "es") return value === 1 ? singularEs : pluralEs;
  return value === 1 ? singularEn : pluralEn;
}

function roundRobinCopy(locale: ExplanationLocale, rounds: 1 | 2) {
  return rounds === 2
    ? tr(locale, "a dos vueltas", "as a double round robin")
    : tr(locale, "a una vuelta", "as a single round robin");
}

function groupStructureSummary(input: StandardFormatExplanationInput, locale: ExplanationLocale): string {
  const rounds = roundRobinCopy(locale, input.format.groupRounds);
  if (input.groupSizes.length) {
    const count = input.groupCount ?? input.groupSizes.length;
    const sizes = listWithAnd(input.groupSizes.map(String), locale);
    return tr(
      locale,
      `La fase de grupos se organiza en ${count} ${plural(locale, count, "grupo", "grupos", "group", "groups")} de ${sizes} participantes/parejas, ${rounds}.`,
      `The group stage uses ${count} ${plural(locale, count, "grupo", "grupos", "group", "groups")} with ${sizes} entries, played ${rounds}.`,
    );
  }
  if (input.groupCount) {
    return tr(
      locale,
      `La fase de grupos se organiza en ${input.groupCount} ${plural(locale, input.groupCount, "grupo", "grupos", "group", "groups")}, ${rounds}.`,
      `The group stage uses ${input.groupCount} ${plural(locale, input.groupCount, "grupo", "grupos", "group", "groups")}, played ${rounds}.`,
    );
  }
  return tr(locale, `La fase de grupos se juega ${rounds}.`, `The group stage is played ${rounds}.`);
}

function playoffSummary(format: StandardCompetitionFormat, locale: ExplanationLocale): string {
  switch (format.playoffMode) {
    case "league_only":
      return tr(
        locale,
        "No hay fase eliminatoria: el campeón se define por la tabla de la liga/grupo.",
        "There is no knockout phase: the champion is decided by the league/group table.",
      );
    case "top2_final":
      return tr(locale, "Los puestos 1 y 2 disputan directamente la final.", "First and second place advance directly to the final.");
    case "top3_step":
      return tr(
        locale,
        "El 2.º y el 3.º juegan una ronda preliminar; el ganador enfrenta al 1.º en la final.",
        "Second and third place play a preliminary match; the winner faces first place in the final.",
      );
    case "top4_semis":
      return tr(
        locale,
        "Los cuatro primeros avanzan a semifinales: 1.º vs 4.º y 2.º vs 3.º.",
        "The top four advance to semifinals: 1st vs 4th and 2nd vs 3rd.",
      );
    case "standard":
      return tr(
        locale,
        `Clasifican ${format.qualifiersPerGroup} por grupo${format.wildcardQualifiers ? ` más ${format.wildcardQualifiers} wildcard${format.wildcardQualifiers === 1 ? "" : "s"}` : ""} a un cuadro eliminatorio estándar.`,
        `${format.qualifiersPerGroup} per group qualify${format.wildcardQualifiers ? ` plus ${format.wildcardQualifiers} wildcard${format.wildcardQualifiers === 1 ? "" : "s"}` : ""} for a standard knockout bracket.`,
      );
  }
}

function matchRuleCopy(locale: ExplanationLocale, bestOf: 1 | 3, pointTarget: number, medal = false): string {
  const label = medal ? tr(locale, "Los partidos por medallas", "Medal matches") : tr(locale, "Los partidos de grupos y rondas previas", "Group and preliminary matches");
  if (bestOf === 1) return tr(locale, `${label} se juegan a un partido a ${pointTarget} puntos.`, `${label} are played as one match to ${pointTarget} points.`);
  return tr(locale, `${label} se juegan al mejor de 3, con cada set a ${pointTarget} puntos.`, `${label} are best-of-3, with each set played to ${pointTarget} points.`);
}

function groupRankingItems(locale: ExplanationLocale): string[] {
  return locale === "es"
    ? [
        "Partidos ganados.",
        "Si exactamente dos quedan empatados en victorias, resultado entre ellos (head-to-head).",
        "Si empatan tres o más en victorias, victorias dentro de la mini-tabla de los empatados.",
        "Diferencia de puntos dentro de esa mini-tabla.",
        "Diferencia total de puntos.",
        "Puntos anotados.",
        "Rating y, como último desempate determinista, nombre.",
      ]
    : [
        "Matches won.",
        "If exactly two entries are tied on wins, their head-to-head result.",
        "If three or more are tied on wins, wins inside the tied mini-table.",
        "Point differential inside that mini-table.",
        "Overall point differential.",
        "Points scored.",
        "Rating and, as the final deterministic fallback, name.",
      ];
}

function crossGroupSection(method: CrossGroupMethod, locale: ExplanationLocale): FormatExplanationSection {
  if (method === "equalized") {
    return {
      id: "cross-group",
      title: tr(locale, "Comparación entre grupos · Equiparada", "Cross-group comparison · Equalized"),
      paragraphs: [
        tr(
          locale,
          "Para comparar la misma posición entre grupos de distinto tamaño, HUAU toma como referencia el tamaño del grupo más pequeño. En los grupos grandes excluye sólo de esta comparación los resultados contra los participantes extra peor ubicados y recalcula la base comparable.",
          "To compare the same finishing position across groups of different sizes, HUAU uses the smallest group size as the reference. In larger groups, results against the lowest-ranked extra entries are excluded only from this comparison and the comparable sample is recalculated.",
        ),
        tr(
          locale,
          "No se borra ni se modifica ningún partido de la tabla interna del grupo: únicamente cambia la base usada para la comparación cruzada.",
          "No group-stage match is deleted or changed: only the sample used for cross-group comparison changes.",
        ),
      ],
      items: [
        tr(locale, "Porcentaje de victorias.", "Win percentage."),
        tr(locale, "Diferencia de puntos por partido.", "Point differential per match."),
        tr(locale, "Puntos anotados por partido.", "Points scored per match."),
        tr(locale, "Rating.", "Rating."),
        tr(locale, "Nombre como último fallback determinista.", "Name as the final deterministic fallback."),
      ],
    };
  }
  return {
    id: "cross-group",
    title: tr(locale, "Comparación entre grupos · Normalizada", "Cross-group comparison · Normalized"),
    paragraphs: [
      tr(
        locale,
        "Cuando se comparan participantes de la misma posición entre grupos, HUAU usa promedios para que jugar más partidos no otorgue ventaja por acumulación.",
        "When entries in the same finishing position are compared across groups, HUAU uses per-match rates so playing more matches does not create an accumulation advantage.",
      ),
    ],
    items: [
      tr(locale, "Porcentaje de victorias.", "Win percentage."),
      tr(locale, "Diferencia de puntos por partido.", "Point differential per match."),
      tr(locale, "Puntos anotados por partido.", "Points scored per match."),
      tr(locale, "Rating.", "Rating."),
      tr(locale, "Nombre como último fallback determinista.", "Name as the final deterministic fallback."),
    ],
  };
}

function seedingCopy(method: StandardSeedingMethod | null, locale: ExplanationLocale): string {
  switch (method) {
    case "snake":
      return tr(locale, "La distribución inicial usa serpentina por rating.", "Initial group distribution uses snake seeding by rating.");
    case "manual":
      return tr(locale, "La distribución inicial de grupos fue definida manualmente por el organizador.", "Initial group allocation was set manually by the organizer.");
    case "random":
      return tr(locale, "La distribución inicial de grupos se realiza por sorteo aleatorio.", "Initial group allocation is randomized.");
    case "live":
      return tr(locale, "La distribución inicial se realiza mediante el sorteo en vivo de HUAU.", "Initial allocation uses HUAU's live draw.");
    default:
      return tr(locale, "La distribución inicial respeta la configuración guardada del torneo.", "Initial allocation follows the tournament's saved configuration.");
  }
}

function finalDrawCopy(method: FinalDrawMethod, avoidRematches: boolean, locale: ExplanationLocale): string[] {
  const result = [
    method === "pots"
      ? tr(locale, "El cuadro usa bombos para distribuir los clasificados según la configuración guardada.", "The bracket uses pots to distribute qualifiers according to the saved configuration.")
      : tr(locale, "La siembra del cuadro prioriza el rendimiento obtenido en la fase de grupos.", "Bracket seeding prioritizes performance from the group stage."),
  ];
  result.push(
    avoidRematches
      ? tr(locale, "HUAU intenta evitar una revancha inmediata entre participantes del mismo grupo; si no existe una asignación válida, completa el cuadro de forma determinista.", "HUAU tries to avoid an immediate rematch between entries from the same group; if no valid allocation exists, it completes the bracket deterministically.")
      : tr(locale, "La configuración permite cruces inmediatos entre participantes que ya compartieron grupo.", "The configuration allows immediate rematches between entries from the same group."),
  );
  return result;
}

export function standardExplanationInputFromConfig(value: unknown): StandardFormatExplanationInput {
  const config = record(value);
  const preliminary = record(config.preliminary);
  const medal = record(config.medal);
  const playoffMode = enumValue<PlayoffMode>(config.playoffMode, ["standard", "top2_final", "top3_step", "top4_semis", "league_only"], "standard");
  const crossGroupMethod = enumValue<CrossGroupMethod>(config.crossGroupMethod, ["normalized", "equalized"], "normalized");
  const finalDrawMethod = enumValue<FinalDrawMethod>(config.finalDrawMethod, ["performance", "pots"], "performance");
  const format = normalizeStandardFormat({
    groupRounds: integer(config.groupRounds, 1) === 2 ? 2 : 1,
    qualifiersPerGroup: Math.max(1, integer(config.qualifiersPerGroup, 2)),
    wildcardQualifiers: Math.max(0, integer(config.wildcardQualifiers, 0)),
    crossGroupMethod,
    playoffMode,
    consolationMode: enumValue(config.consolationMode, ["none", "knockout"] as const, "none"),
    avoidGroupRematches: boolean(config.avoidGroupRematches, true),
    bronzeMatch: boolean(config.bronzeMatch, false),
    medalSchedule: enumValue(config.medalSchedule, ["sequential", "simultaneous"] as const, "sequential"),
    finalDrawMethod,
    preliminary: {
      bestOf: integer(preliminary.bestOf ?? config.preliminaryBestOf, 1) === 3 ? 3 : 1,
      pointTarget: Math.max(1, integer(preliminary.pointTarget ?? config.standardPointTarget ?? config.preliminaryPointTarget, 15)),
    },
    medal: {
      bestOf: integer(medal.bestOf ?? config.medalBestOf, 1) === 3 ? 3 : 1,
      pointTarget: Math.max(1, integer(medal.pointTarget ?? config.medalPointTarget, 11)),
    },
    preferredRestSlots: Math.max(0, integer(config.preferredRestSlots, 1)),
  });
  const groupSizes = numbers(config.groupSizes).length ? numbers(config.groupSizes) : numbers(config.sizes);
  const rawSeeding = typeof config.seedingMethod === "string" ? config.seedingMethod : null;
  const seedingMethod = rawSeeding && ["snake", "manual", "random", "live"].includes(rawSeeding)
    ? (rawSeeding as StandardSeedingMethod)
    : null;
  return {
    format,
    groupCount: positiveIntegerOrNull(config.groupCount ?? config.groups) ?? (groupSizes.length || null),
    groupSizes,
    seedingMethod,
    bracketSize: positiveIntegerOrNull(config.bracketSize),
    byes: config.byes === undefined ? null : Math.max(0, integer(config.byes, 0)),
  };
}

export function explainStandardFormat(input: StandardFormatExplanationInput, locale: ExplanationLocale): FormatExplanation {
  const { format } = input;
  const summary = [groupStructureSummary(input, locale), playoffSummary(format, locale)];
  if (format.playoffMode !== "league_only") summary.push(matchRuleCopy(locale, format.medal.bestOf, format.medal.pointTarget, true));

  const sections: FormatExplanationSection[] = [
    {
      id: "group-ranking",
      title: tr(locale, "Clasificación dentro del grupo", "Ranking inside each group"),
      paragraphs: [
        tr(
          locale,
          "La tabla interna usa todos los partidos válidos del grupo y aplica los desempates en este orden:",
          "The group table uses every valid group match and applies tiebreakers in this order:",
        ),
      ],
      items: groupRankingItems(locale),
    },
  ];

  if (format.playoffMode === "standard" || format.wildcardQualifiers > 0) sections.push(crossGroupSection(format.crossGroupMethod, locale));

  sections.push({
    id: "qualification",
    title: tr(locale, "Clasificación y wildcards", "Qualification and wildcards"),
    paragraphs: [playoffSummary(format, locale)],
    items: format.playoffMode === "standard"
      ? [
          tr(locale, `${format.qualifiersPerGroup} ${plural(locale, format.qualifiersPerGroup, "clasificado fijo", "clasificados fijos", "fixed qualifier", "fixed qualifiers")} por grupo.`, `${format.qualifiersPerGroup} fixed qualifier${format.qualifiersPerGroup === 1 ? "" : "s"} per group.`),
          format.wildcardQualifiers > 0
            ? tr(locale, `${format.wildcardQualifiers} ${plural(locale, format.wildcardQualifiers, "wildcard adicional", "wildcards adicionales", "additional wildcard", "additional wildcards")} por rendimiento cruzado.`, `${format.wildcardQualifiers} additional wildcard${format.wildcardQualifiers === 1 ? "" : "s"} based on cross-group performance.`)
            : tr(locale, "No hay wildcards adicionales.", "There are no additional wildcards."),
        ]
      : [],
  });

  sections.push({
    id: "seeding",
    title: tr(locale, "Siembra y armado", "Seeding and allocation"),
    paragraphs: [seedingCopy(input.seedingMethod, locale)],
    items: format.playoffMode === "standard" ? finalDrawCopy(format.finalDrawMethod, format.avoidGroupRematches, locale) : [],
  });

  const finalItems: string[] = [];
  if (input.bracketSize && format.playoffMode === "standard") {
    finalItems.push(tr(locale, `El cuadro guardado tiene capacidad para ${input.bracketSize} posiciones.`, `The saved bracket has ${input.bracketSize} slots.`));
  }
  if (input.byes !== null && input.byes > 0) {
    finalItems.push(tr(locale, `${input.byes} ${plural(locale, input.byes, "bye permite", "byes permiten", "bye allows", "byes allow")} avanzar automáticamente en la primera ronda.`, `${input.byes} bye${input.byes === 1 ? "" : "s"} allow automatic advancement through the first round.`));
  }
  if (format.consolationMode === "knockout" && format.playoffMode !== "league_only") {
    finalItems.push(tr(locale, "Los no clasificados disputan un cuadro de consuelo eliminatorio.", "Non-qualifiers play a knockout consolation bracket."));
  }
  if (format.bronzeMatch && format.playoffMode !== "league_only") {
    finalItems.push(tr(locale, "Hay partido por el tercer puesto.", "A third-place match is played."));
  } else if (format.playoffMode !== "league_only") {
    finalItems.push(tr(locale, "No hay partido por el tercer puesto.", "There is no third-place match."));
  }
  if (format.bronzeMatch && format.playoffMode !== "league_only") {
    finalItems.push(
      format.medalSchedule === "simultaneous"
        ? tr(locale, "Bronce y final pueden programarse en paralelo.", "Third-place match and final may be scheduled in parallel.")
        : tr(locale, "Bronce y final se programan de forma secuencial.", "Third-place match and final are scheduled sequentially."),
    );
  }
  sections.push({
    id: "final-phase",
    title: tr(locale, "Fase posterior", "Post-group phase"),
    paragraphs: [playoffSummary(format, locale)],
    items: finalItems,
  });

  sections.push({
    id: "match-rules",
    title: tr(locale, "Partidos y puntuación", "Matches and scoring"),
    paragraphs: [
      matchRuleCopy(locale, format.preliminary.bestOf, format.preliminary.pointTarget),
      ...(format.playoffMode === "league_only" ? [] : [matchRuleCopy(locale, format.medal.bestOf, format.medal.pointTarget, true)]),
    ],
    items: format.preferredRestSlots > 0
      ? [tr(locale, `El cronograma intenta dejar ${format.preferredRestSlots} ${plural(locale, format.preferredRestSlots, "bloque", "bloques", "slot", "slots")} de descanso preferido cuando las restricciones lo permiten.`, `The scheduler aims for ${format.preferredRestSlots} preferred rest ${plural(locale, format.preferredRestSlots, "bloque", "bloques", "slot", "slots")} when constraints allow it.`)]
      : [tr(locale, "No se exige un bloque de descanso preferido entre partidos; la no simultaneidad sigue siendo obligatoria.", "No preferred rest slot is required between matches; non-overlap remains mandatory.")],
  });

  return { schemaVersion: 1, official: true, kind: "standard", locale, summary: summary.slice(0, 3), sections };
}

export function explainStandardFormatConfig(value: unknown, locale: ExplanationLocale): FormatExplanation {
  return explainStandardFormat(standardExplanationInputFromConfig(value), locale);
}

function teamCompositionCopy(composition: TeamRosterComposition, locale: ExplanationLocale): string {
  switch (composition) {
    case "male": return tr(locale, "masculina", "male-only");
    case "female": return tr(locale, "femenina", "female-only");
    case "mixed": return tr(locale, "mixta", "mixed");
    case "open": return tr(locale, "abierta", "open");
  }
}

function teamGenderCopy(gender: TeamCompetitionGender, locale: ExplanationLocale): string {
  switch (gender) {
    case "male": return tr(locale, "masculino", "men's");
    case "female": return tr(locale, "femenino", "women's");
    case "mixed": return tr(locale, "mixto", "mixed");
    case "open": return tr(locale, "abierto", "open");
  }
}

function teamStandingCriterionCopy(criterion: TeamStandingCriterion, locale: ExplanationLocale): string {
  switch (criterion) {
    case "encounter_wins": return tr(locale, "Series ganadas.", "Encounters won.");
    case "encounter_win_rate": return tr(locale, "Porcentaje de series ganadas si hay distinta cantidad jugada.", "Encounter win percentage when teams have played different totals.");
    case "rubber_diff": return tr(locale, "Diferencia de rubbers ganados/perdidos.", "Rubber win/loss differential.");
    case "point_diff": return tr(locale, "Diferencia de puntos.", "Point differential.");
    case "points_for": return tr(locale, "Puntos anotados.", "Points scored.");
  }
}

export function explainTeamFormat(format: TeamFormat, locale: ExplanationLocale): FormatExplanation {
  const rubbers = [...format.encounter.rubbers].sort((a, b) => a.order - b.order);
  const conditional = rubbers.filter((rubber) => rubber.play === "if_tied");
  const summary = [
    tr(
      locale,
      `Cada equipo usa un roster de ${format.roster.min} a ${format.roster.max} integrantes, con composición ${teamCompositionCopy(format.roster.composition, locale)}.`,
      `Each team uses a roster of ${format.roster.min} to ${format.roster.max} members with a ${teamCompositionCopy(format.roster.composition, locale)} composition.`,
    ),
    tr(
      locale,
      `Cada serie contiene ${rubbers.length} ${plural(locale, rubbers.length, "rubber", "rubbers", "rubber", "rubbers")}${conditional.length ? `; ${conditional.length} se juega${conditional.length === 1 ? "" : "n"} sólo si la serie llega empatada a ese punto` : ""}.`,
      `Each encounter contains ${rubbers.length} rubber${rubbers.length === 1 ? "" : "s"}${conditional.length ? `; ${conditional.length} ${conditional.length === 1 ? "is" : "are"} played only if the encounter is tied when reached` : ""}.`,
    ),
    format.encounter.winnerRule === "first_to"
      ? tr(locale, `Gana la serie el primer equipo que alcanza ${format.encounter.targetWins ?? 1} victorias ponderadas.`, `The first team to reach ${format.encounter.targetWins ?? 1} weighted wins takes the encounter.`)
      : tr(locale, "Gana la serie el equipo con mayoría de victorias ponderadas en los rubbers que correspondan.", "The encounter is won by the team with the majority of weighted rubber wins that apply."),
  ];

  const rosterItems = [
    tr(locale, `Mínimo ${format.roster.min} y máximo ${format.roster.max} integrantes.`, `Minimum ${format.roster.min} and maximum ${format.roster.max} members.`),
    ...(format.roster.rules.maleMin > 0 ? [tr(locale, `Al menos ${format.roster.rules.maleMin} hombres.`, `At least ${format.roster.rules.maleMin} male members.`)] : []),
    ...(format.roster.rules.femaleMin > 0 ? [tr(locale, `Al menos ${format.roster.rules.femaleMin} mujeres.`, `At least ${format.roster.rules.femaleMin} female members.`)] : []),
    ...(format.roster.rules.maleMax !== null ? [tr(locale, `Máximo ${format.roster.rules.maleMax} hombres.`, `At most ${format.roster.rules.maleMax} male members.`)] : []),
    ...(format.roster.rules.femaleMax !== null ? [tr(locale, `Máximo ${format.roster.rules.femaleMax} mujeres.`, `At most ${format.roster.rules.femaleMax} female members.`)] : []),
    format.roster.substitutesAllowed ? tr(locale, "Se permiten suplentes.", "Substitutes are allowed.") : tr(locale, "No se permiten suplentes.", "Substitutes are not allowed."),
    format.roster.captainRequired ? tr(locale, "El roster exige exactamente un capitán.", "The roster requires exactly one captain.") : tr(locale, "El capitán no es obligatorio por formato.", "A captain is not required by format."),
  ];

  const rubberItems = rubbers.map((rubber) => {
    const mode = rubber.mode === "singles" ? tr(locale, "singles", "singles") : tr(locale, "dobles", "doubles");
    const play = rubber.play === "if_tied" ? tr(locale, "sólo si la serie está empatada", "only if the encounter is tied") : tr(locale, "siempre", "always");
    const scoring = rubber.bestOf === 3 ? tr(locale, `BO3 a ${rubber.pointTarget} puntos`, `best-of-3 to ${rubber.pointTarget} points`) : tr(locale, `un partido a ${rubber.pointTarget} puntos`, `one match to ${rubber.pointTarget} points`);
    const weight = rubber.weight === 1 ? "" : tr(locale, ` · peso ${rubber.weight}`, ` · weight ${rubber.weight}`);
    const tiebreaker = rubber.isTiebreaker ? tr(locale, " · tiebreaker", " · tiebreaker") : "";
    return `${rubber.order}. ${rubber.label}: ${mode} ${teamGenderCopy(rubber.gender, locale)} · ${scoring} · ${play}${tiebreaker}${weight}.`;
  });

  const encounterItems = [
    format.encounter.winnerRule === "first_to"
      ? tr(locale, `Regla de ganador: primero en alcanzar ${format.encounter.targetWins ?? 1}.`, `Winner rule: first to reach ${format.encounter.targetWins ?? 1}.`)
      : tr(locale, "Regla de ganador: mayoría de victorias ponderadas.", "Winner rule: majority of weighted wins."),
    format.encounter.playRemainingAfterClinched
      ? tr(locale, "Los rubbers restantes se juegan aunque la serie ya esté definida, salvo los condicionales que no correspondan.", "Remaining rubbers are played after the encounter is clinched, except conditional rubbers that no longer apply.")
      : tr(locale, "Cuando la serie queda matemáticamente definida, los rubbers restantes pueden omitirse.", "Once the encounter is mathematically clinched, remaining rubbers may be skipped."),
  ];

  const competitionItems = [
    format.competition.groupRounds === 2 ? tr(locale, "La fase de grupos se disputa a dos vueltas.", "The group stage is a double round robin.") : tr(locale, "La fase de grupos se disputa a una vuelta.", "The group stage is a single round robin."),
    tr(locale, "La explicación oficial de Team describe únicamente reglas que el motor actual ejecuta; una fase posterior no se anuncia hasta estar generada por el motor.", "The official Team explanation describes only rules the current engine executes; a post-group phase is not announced until the engine can generate it."),
  ];

  return {
    schemaVersion: 1,
    official: true,
    kind: "team",
    locale,
    summary,
    sections: [
      { id: "team-roster", title: tr(locale, "Roster", "Roster"), paragraphs: [tr(locale, `Composición ${teamCompositionCopy(format.roster.composition, locale)}.`, `${teamCompositionCopy(format.roster.composition, locale)} composition.`)], items: rosterItems },
      { id: "team-encounter", title: tr(locale, "Serie y rubbers", "Encounter and rubbers"), paragraphs: [], items: [...encounterItems, ...rubberItems] },
      { id: "team-standings", title: tr(locale, "Criterios de tabla", "Standings criteria"), paragraphs: [tr(locale, "Los criterios se aplican en el orden configurado:", "Criteria are applied in the configured order:")], items: format.standings.criteria.map((criterion) => teamStandingCriterionCopy(criterion, locale)) },
      { id: "team-competition", title: tr(locale, "Fase competitiva", "Competition stage"), paragraphs: [], items: competitionItems },
    ],
  };
}
