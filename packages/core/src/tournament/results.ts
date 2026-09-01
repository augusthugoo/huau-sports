import { progressEncounterSources } from "./bracket";
import type { Competition, CompetitionEncounter, MatchSet } from "./types";

export type EncounterResultInput =
  | { scoreA: number; scoreB: number; sets?: never }
  | { sets: MatchSet[]; scoreA?: never; scoreB?: never };

function completeSingle(encounter: CompetitionEncounter, scoreA: number, scoreB: number): CompetitionEncounter {
  if (scoreA === scoreB) throw new Error("TIED_RESULT_NOT_ALLOWED");
  const winnerEntryId = scoreA > scoreB ? encounter.entryA?.id : encounter.entryB?.id;
  if (!winnerEntryId) throw new Error("ENCOUNTER_NOT_READY");
  return {
    ...encounter,
    scoreA,
    scoreB,
    sets: [],
    winnerEntryId,
    status: "finished",
  };
}

function completeBestOfThree(encounter: CompetitionEncounter, sets: MatchSet[]): CompetitionEncounter {
  if (!encounter.entryA || !encounter.entryB) throw new Error("ENCOUNTER_NOT_READY");
  if (sets.length < 2 || sets.length > 3) throw new Error("INVALID_SET_COUNT");
  let winsA = 0;
  let winsB = 0;
  for (const set of sets) {
    if (set.scoreA === set.scoreB) throw new Error("TIED_SET_NOT_ALLOWED");
    if (set.scoreA > set.scoreB) winsA += 1;
    else winsB += 1;
  }
  if (winsA !== 2 && winsB !== 2) throw new Error("BEST_OF_THREE_INCOMPLETE");
  if (sets.length === 3 && (winsA === 2 && winsB === 0 || winsB === 2 && winsA === 0)) {
    throw new Error("UNNECESSARY_THIRD_SET");
  }
  return {
    ...encounter,
    scoreA: winsA,
    scoreB: winsB,
    sets: sets.map((set) => ({ ...set })),
    winnerEntryId: winsA > winsB ? encounter.entryA.id : encounter.entryB.id,
    status: "finished",
  };
}

export function withEncounterResult(
  competition: Competition,
  encounterId: string,
  result: EncounterResultInput,
): Competition {
  const encounter = competition.encounters.find((candidate) => candidate.id === encounterId);
  if (!encounter) throw new Error("ENCOUNTER_NOT_FOUND");
  if (!encounter.entryA || !encounter.entryB) throw new Error("ENCOUNTER_NOT_READY");

  const updated =
    encounter.bestOf === 3
      ? completeBestOfThree(encounter, "sets" in result ? result.sets : [])
      : completeSingle(
          encounter,
          "scoreA" in result ? result.scoreA : (result.sets[0]?.scoreA ?? 0),
          "scoreB" in result ? result.scoreB : (result.sets[0]?.scoreB ?? 0),
        );

  return progressEncounterSources({
    ...competition,
    encounters: competition.encounters.map((candidate) => (candidate.id === encounterId ? updated : candidate)),
  });
}
