import { describe, expect, it } from "vitest";
import { createMixedFiveRubberTeamFormat } from "./defaults";
import { generateTeamRoundRobinEncounters } from "./groups";
import type { TeamEntry } from "./types";

const team = (id: string): TeamEntry => ({ id, name: id, roster: [] });

describe("Team round-robin rounds", () => {
  it("gives 7 teams one coherent implicit bye per round", () => {
    const format = createMixedFiveRubberTeamFormat();
    const entries = Array.from({ length: 7 }, (_, index) => team(`T${index + 1}`));
    const encounters = generateTeamRoundRobinEncounters({ id: "A", name: "A", entries }, format);
    expect(encounters).toHaveLength(21);
    expect(new Set(encounters.map((encounter) => encounter.roundNumber))).toEqual(new Set([1,2,3,4,5,6,7]));
    for (let round = 1; round <= 7; round += 1) {
      const current = encounters.filter((encounter) => encounter.roundNumber === round);
      expect(current).toHaveLength(3);
      const participants = current.flatMap((encounter) => [encounter.entryAId, encounter.entryBId]);
      expect(new Set(participants).size).toBe(6);
    }
  });
});
