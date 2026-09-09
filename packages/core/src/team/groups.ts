import type { TeamEncounterPlan, TeamFormat, TeamGroup, TeamRubberDefinition } from "./types";

function sortedRubbers(format: TeamFormat): TeamRubberDefinition[] {
  return [...format.encounter.rubbers]
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    .map((rubber) => ({ ...rubber }));
}

type RoundPair = { a: number; b: number };

/** Circle-method rounds. A synthetic -1 slot represents the bye for odd groups. */
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
      pairs.push(round % 2 === 0 ? { a: left, b: right } : { a: right, b: left });
    }
    rounds.push(pairs);
    rotating = [rotating[rotating.length - 1]!, ...rotating.slice(0, -1)];
  }
  return rounds;
}

export function generateTeamRoundRobinEncounters(group: TeamGroup, format: TeamFormat): TeamEncounterPlan[] {
  const perLeg = roundRobinRounds(group.entries.length);
  const legs: TeamEncounterPlan[][] = Array.from({ length: format.competition.groupRounds }, () => []);

  for (let legIndex = 0; legIndex < format.competition.groupRounds; legIndex += 1) {
    for (let roundIndex = 0; roundIndex < perLeg.length; roundIndex += 1) {
      for (const pair of perLeg[roundIndex] ?? []) {
        const originalA = group.entries[pair.a];
        const originalB = group.entries[pair.b];
        if (!originalA || !originalB) continue;
        const entryA = legIndex === 0 ? originalA : originalB;
        const entryB = legIndex === 0 ? originalB : originalA;
        legs[legIndex]?.push({
          id: `team:group:${group.id}:leg:${legIndex + 1}:round:${roundIndex + 1}:${pair.a + 1}-${pair.b + 1}`,
          groupId: group.id,
          groupName: group.name,
          legNumber: legIndex + 1,
          roundNumber: roundIndex + 1,
          entryAId: entryA.id,
          entryBId: entryB.id,
          rubbers: sortedRubbers(format),
        });
      }
    }
  }

  return legs.flat();
}
