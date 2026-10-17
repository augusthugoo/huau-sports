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
  roundNumber: number,
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
    roundNumber,
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

type RoundPair = { a: number; b: number };

/** Circle method. A synthetic -1 slot is the bye for odd-sized groups. */
function roundRobinRounds(size: number): RoundPair[][] {
  if (size < 2) return [];

  const participants = Array.from({ length: size }, (_, index) => index);
  if (participants.length % 2 === 1) participants.push(-1);

  const fixed = participants[0]!;
  let rotating = participants.slice(1);
  const rounds: RoundPair[][] = [];

  for (let round = 0; round < participants.length - 1; round += 1) {
    const layout = [fixed, ...rotating];
    const pairs: RoundPair[] = [];

    for (let index = 0; index < layout.length / 2; index += 1) {
      const left = layout[index]!;
      const right = layout[layout.length - 1 - index]!;
      if (left < 0 || right < 0) continue;

      pairs.push(
        round % 2 === 0
          ? { a: left, b: right }
          : { a: right, b: left },
      );
    }

    rounds.push(pairs);
    rotating = [
      rotating[rotating.length - 1]!,
      ...rotating.slice(0, -1),
    ];
  }

  return rounds;
}

export function generateRoundRobinEncounters(
  group: TournamentGroup,
  formatInput: Partial<StandardCompetitionFormat> = {},
): CompetitionEncounter[] {
  const format = normalizeStandardFormat(formatInput);
  const perLeg = roundRobinRounds(group.entries.length);
  const legs: CompetitionEncounter[][] = Array.from(
    { length: format.groupRounds },
    () => [],
  );

  for (let legIndex = 0; legIndex < format.groupRounds; legIndex += 1) {
    for (let roundIndex = 0; roundIndex < perLeg.length; roundIndex += 1) {
      for (const pair of perLeg[roundIndex] ?? []) {
        const originalA = group.entries[pair.a];
        const originalB = group.entries[pair.b];
        if (!originalA || !originalB) continue;

        const entryA = legIndex === 0 ? originalA : originalB;
        const entryB = legIndex === 0 ? originalB : originalA;

        // Keep the historical encounter ID stable for the same pair.
        const low = Math.min(pair.a, pair.b);
        const high = Math.max(pair.a, pair.b);

        legs[legIndex]?.push(
          encounterBase(
            `group:${group.id}:leg:${legIndex + 1}:${low + 1}-${high + 1}`,
            group,
            legIndex + 1,
            roundIndex + 1,
            entryA,
            entryB,
            format,
          ),
        );
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
