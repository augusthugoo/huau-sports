import type {
  Competition,
  CompetitionEncounter,
  StandardCompetitionFormat,
  TournamentEntry,
  TournamentGroup,
} from "./types";
import { normalizeStandardFormat } from "./defaults";

function cloneEntry(entry: TournamentEntry): TournamentEntry {
  return { ...entry, participantIds: [...entry.participantIds] };
}

function encounterBase(
  id: string,
  group: TournamentGroup,
  legNumber: number,
  entryA: TournamentEntry,
  entryB: TournamentEntry,
  format: StandardCompetitionFormat,
): CompetitionEncounter {
  return {
    id,
    stage: "group",
    groupId: group.id,
    groupName: group.name,
    roundLabel: format.groupRounds === 2 ? `Group stage · Leg ${legNumber}` : "Group stage",
    roundNumber: null,
    legNumber,
    entryA: cloneEntry(entryA),
    entryB: cloneEntry(entryB),
    sourceEncounterAId: null,
    sourceEncounterBId: null,
    sourceLoserAId: null,
    sourceLoserBId: null,
    status: "pending",
    winnerEntryId: null,
    scoreA: null,
    scoreB: null,
    sets: [],
    bestOf: 1,
    pointTarget: format.preliminary.pointTarget,
  };
}

export function generateRoundRobinEncounters(
  group: TournamentGroup,
  formatInput: Partial<StandardCompetitionFormat> = {},
): CompetitionEncounter[] {
  const format = normalizeStandardFormat(formatInput);
  const legs: CompetitionEncounter[][] = Array.from({ length: format.groupRounds }, () => []);

  for (let a = 0; a < group.entries.length; a += 1) {
    for (let b = a + 1; b < group.entries.length; b += 1) {
      const entryA = group.entries[a];
      const entryB = group.entries[b];
      if (!entryA || !entryB) continue;

      legs[0]?.push(encounterBase(`group:${group.id}:leg:1:${a + 1}-${b + 1}`, group, 1, entryA, entryB, format));
      if (format.groupRounds === 2) {
        legs[1]?.push(encounterBase(`group:${group.id}:leg:2:${a + 1}-${b + 1}`, group, 2, entryB, entryA, format));
      }
    }
  }

  return legs.flat();
}

export function buildCompetitionFromGroups(input: {
  id: string;
  categoryId: string;
  groups: TournamentGroup[];
  format?: Partial<StandardCompetitionFormat>;
}): Competition {
  const format = normalizeStandardFormat(input.format);
  const groups = input.groups.map((group) => ({
    ...group,
    entries: group.entries.map(cloneEntry),
  }));

  return {
    id: input.id,
    categoryId: input.categoryId,
    format,
    groups,
    encounters: groups.flatMap((group) => generateRoundRobinEncounters(group, format)),
    finalGenerated: false,
  };
}
