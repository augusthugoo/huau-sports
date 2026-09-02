import type { TeamEncounterPlan, TeamFormat, TeamGroup, TeamRubberDefinition } from "./types";

function sortedRubbers(format: TeamFormat): TeamRubberDefinition[] {
  return [...format.encounter.rubbers]
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    .map((rubber) => ({ ...rubber }));
}

export function generateTeamRoundRobinEncounters(group: TeamGroup, format: TeamFormat): TeamEncounterPlan[] {
  const legs: TeamEncounterPlan[][] = Array.from({ length: format.competition.groupRounds }, () => []);

  for (let a = 0; a < group.entries.length; a += 1) {
    for (let b = a + 1; b < group.entries.length; b += 1) {
      const entryA = group.entries[a];
      const entryB = group.entries[b];
      if (!entryA || !entryB) continue;

      legs[0]?.push({
        id: `team:group:${group.id}:leg:1:${a + 1}-${b + 1}`,
        groupId: group.id,
        groupName: group.name,
        legNumber: 1,
        entryAId: entryA.id,
        entryBId: entryB.id,
        rubbers: sortedRubbers(format),
      });

      if (format.competition.groupRounds === 2) {
        legs[1]?.push({
          id: `team:group:${group.id}:leg:2:${a + 1}-${b + 1}`,
          groupId: group.id,
          groupName: group.name,
          legNumber: 2,
          entryAId: entryB.id,
          entryBId: entryA.id,
          rubbers: sortedRubbers(format),
        });
      }
    }
  }

  return legs.flat();
}
