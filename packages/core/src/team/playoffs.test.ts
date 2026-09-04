import { describe, expect, it } from "vitest";
import { createMixedFiveRubberTeamFormat } from "./defaults";
import { generateTeamFinalPhasePlan, teamKnockoutRoundLabel, type TeamGroupStandingSnapshot } from "./playoffs";
import type { TeamStandingRow } from "./types";

function row(id: string, wins: number, rubberDiff: number, pointDiff: number): TeamStandingRow {
  return {
    entryId: id,
    entryName: id.toUpperCase(),
    played: 3,
    wins,
    losses: 3 - wins,
    winRate: wins / 3,
    standingPoints: wins,
    rubbersFor: 8 + rubberDiff,
    rubbersAgainst: 8,
    rubberDiff,
    pointsFor: 100 + pointDiff,
    pointsAgainst: 100,
    pointDiff,
  };
}

const groups: TeamGroupStandingSnapshot[] = [
  { groupId: "ga", groupName: "A", rows: [row("a1", 3, 5, 20), row("a2", 2, 2, 8), row("a3", 1, -2, -8), row("a4", 0, -5, -20)] },
  { groupId: "gb", groupName: "B", rows: [row("b1", 3, 6, 24), row("b2", 2, 1, 5), row("b3", 1, -1, -5), row("b4", 0, -6, -24)] },
];

describe("Team final phase", () => {
  it("names deep knockout rounds explicitly", () => {
    expect(teamKnockoutRoundLabel(6, 0)).toBe("Round of 64");
    expect(teamKnockoutRoundLabel(5, 0)).toBe("Round of 32");
    expect(teamKnockoutRoundLabel(4, 0)).toBe("Round of 16");
    expect(teamKnockoutRoundLabel(3, 0)).toBe("Quarterfinal");
  });

  it("builds a standard multi-group bracket and bronze from standings", () => {
    const format = createMixedFiveRubberTeamFormat();
    format.competition.playoffMode = "standard";
    format.competition.qualifiersPerGroup = 2;
    format.competition.bronzeMatch = true;
    const plan = generateTeamFinalPhasePlan({ format, standings: groups });
    expect(plan.qualifiers).toHaveLength(4);
    expect(plan.encounters.filter((encounter) => encounter.roundLabel === "Semifinal")).toHaveLength(2);
    expect(plan.encounters.some((encounter) => encounter.stage === "final")).toBe(true);
    expect(plan.encounters.some((encounter) => encounter.stage === "bronze")).toBe(true);
  });

  it("supports top-3 ladder and top-2 final for a single league group", () => {
    const standings = [groups[0]!];
    const format = createMixedFiveRubberTeamFormat();
    format.competition.playoffMode = "top3_step";
    let plan = generateTeamFinalPhasePlan({ format, standings });
    expect(plan.encounters.map((encounter) => encounter.roundLabel)).toEqual(["Preliminary round", "Final"]);
    format.competition.playoffMode = "top2_final";
    plan = generateTeamFinalPhasePlan({ format, standings });
    expect(plan.encounters).toHaveLength(1);
    expect(plan.encounters[0]?.entryAId).toBe("a1");
    expect(plan.encounters[0]?.entryBId).toBe("a2");

    format.competition.bronzeMatch = true;
    plan = generateTeamFinalPhasePlan({ format, standings });
    expect(plan.encounters.some((encounter) => encounter.stage === "bronze")).toBe(true);
  });

  it("rejects alternative playoff modes across multiple groups", () => {
    const format = createMixedFiveRubberTeamFormat();
    format.competition.playoffMode = "top4_semis";
    expect(() => generateTeamFinalPhasePlan({ format, standings: groups })).toThrow("TEAM_PLAYOFF_MODE_REQUIRES_SINGLE_GROUP");
  });
});
