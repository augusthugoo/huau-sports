import type {
  TeamEncounterScore,
  TeamFormat,
  TeamRubberDefinition,
  TeamRubberResult,
  TeamRubberState,
  TeamSide,
} from "./types";

function sortedRubbers(format: TeamFormat): TeamRubberDefinition[] {
  return [...format.encounter.rubbers].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

function validPoints(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function potentialWeight(rubbers: TeamRubberDefinition[]): number {
  return rubbers.reduce((sum, rubber) => sum + rubber.weight, 0);
}

function clinchedSide(
  format: TeamFormat,
  weightedWinsA: number,
  weightedWinsB: number,
  remainingRubbers: TeamRubberDefinition[],
): TeamSide | null {
  if (format.encounter.winnerRule === "first_to") {
    const target = format.encounter.targetWins;
    if (target === null) return null;
    if (weightedWinsA >= target) return "A";
    if (weightedWinsB >= target) return "B";
    return null;
  }

  const remaining = potentialWeight(remainingRubbers);
  if (weightedWinsA > weightedWinsB + remaining) return "A";
  if (weightedWinsB > weightedWinsA + remaining) return "B";
  return null;
}

function finalWinner(format: TeamFormat, weightedWinsA: number, weightedWinsB: number): TeamSide | null {
  if (format.encounter.winnerRule === "first_to") {
    const target = format.encounter.targetWins;
    if (target === null) return null;
    if (weightedWinsA >= target && weightedWinsA > weightedWinsB) return "A";
    if (weightedWinsB >= target && weightedWinsB > weightedWinsA) return "B";
    return null;
  }
  if (weightedWinsA > weightedWinsB) return "A";
  if (weightedWinsB > weightedWinsA) return "B";
  return null;
}

function resultMap(results: TeamRubberResult[]): Map<string, TeamRubberResult> {
  const mapped = new Map<string, TeamRubberResult>();
  results.forEach((result) => {
    if (mapped.has(result.rubberKey)) throw new Error(`DUPLICATE_RUBBER_RESULT:${result.rubberKey}`);
    if (!validPoints(result.pointsA) || !validPoints(result.pointsB)) throw new Error(`INVALID_RUBBER_POINTS:${result.rubberKey}`);
    mapped.set(result.rubberKey, result);
  });
  return mapped;
}

export function scoreTeamEncounter(input: {
  format: TeamFormat;
  entryAId: string;
  entryBId: string;
  results: TeamRubberResult[];
}): TeamEncounterScore {
  const rubbers = sortedRubbers(input.format);
  const supplied = resultMap(input.results);
  const knownKeys = new Set(rubbers.map((rubber) => rubber.key));
  for (const key of supplied.keys()) {
    if (!knownKeys.has(key)) throw new Error(`UNKNOWN_RUBBER_RESULT:${key}`);
  }

  let weightedWinsA = 0;
  let weightedWinsB = 0;
  let rubbersWonA = 0;
  let rubbersWonB = 0;
  let pointsA = 0;
  let pointsB = 0;
  let blockedByMissingResult = false;
  let nextRubberKey: string | null = null;
  const states: TeamRubberState[] = [];

  rubbers.forEach((rubber, index) => {
    const result = supplied.get(rubber.key) ?? null;
    const remainingIncludingCurrent = rubbers.slice(index);
    const alreadyClinched = clinchedSide(input.format, weightedWinsA, weightedWinsB, remainingIncludingCurrent);

    if (alreadyClinched !== null && !input.format.encounter.playRemainingAfterClinched) {
      if (result !== null) throw new Error(`RESULT_AFTER_ENCOUNTER_CLINCHED:${rubber.key}`);
      states.push({ definition: rubber, status: "skipped", result: null });
      return;
    }

    if (blockedByMissingResult) {
      if (result !== null) throw new Error(`OUT_OF_ORDER_RUBBER_RESULT:${rubber.key}`);
      states.push({ definition: rubber, status: "pending", result: null });
      return;
    }

    if (rubber.play === "if_tied" && weightedWinsA !== weightedWinsB) {
      if (result !== null) throw new Error(`RESULT_FOR_SKIPPED_RUBBER:${rubber.key}`);
      states.push({ definition: rubber, status: "skipped", result: null });
      return;
    }

    if (result === null) {
      states.push({ definition: rubber, status: "ready", result: null });
      nextRubberKey ??= rubber.key;
      blockedByMissingResult = true;
      return;
    }

    if (result.winnerSide === "A") {
      weightedWinsA += rubber.weight;
      rubbersWonA += 1;
    } else {
      weightedWinsB += rubber.weight;
      rubbersWonB += 1;
    }
    pointsA += result.pointsA;
    pointsB += result.pointsB;
    states.push({ definition: rubber, status: "finished", result: { ...result } });
  });

  const complete = states.every((state) => state.status === "finished" || state.status === "skipped");
  const winnerSide = complete ? finalWinner(input.format, weightedWinsA, weightedWinsB) : null;

  return {
    entryAId: input.entryAId,
    entryBId: input.entryBId,
    weightedWinsA,
    weightedWinsB,
    standingPointsA: weightedWinsA,
    standingPointsB: weightedWinsB,
    rubbersWonA,
    rubbersWonB,
    pointsA,
    pointsB,
    winnerEntryId: winnerSide === "A" ? input.entryAId : winnerSide === "B" ? input.entryBId : null,
    complete,
    nextRubberKey,
    rubbers: states,
  };
}
