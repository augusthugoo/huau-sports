import { describe, expect, it } from "vitest";
import { calculateTeamStandings, createSeniorTeamCupFormat, scoreTeamEncounter, validateTeamRoster, type TeamEntry, type TeamRosterMember } from "./index";

const roster = (prefix: string): TeamRosterMember[] => [
  { personId: `${prefix}-m1`, name: "M1", sportGender: "male", role: "captain" },
  { personId: `${prefix}-m2`, name: "M2", sportGender: "male", role: "player" },
  { personId: `${prefix}-f1`, name: "F1", sportGender: "female", role: "player" },
  { personId: `${prefix}-f2`, name: "F2", sportGender: "female", role: "player" },
];
const team = (id: string): TeamEntry => ({ id, name: id, roster: roster(id) });
const result = (rubberKey: string, winnerSide: "A" | "B", pointsA = 15, pointsB = 10) => ({ rubberKey, winnerSide, pointsA, pointsB });

describe("Uruguay Senior Team Pickleball Cup 2026 preset", () => {
  it("requires a captain and configures 2/2/2/2/1 standings weights", () => {
    const format = createSeniorTeamCupFormat();
    expect(format.roster.min).toBe(4);
    expect(format.roster.max).toBe(6);
    expect(format.roster.captainRequired).toBe(true);
    expect(format.encounter.rubbers.map((rubber) => rubber.weight)).toEqual([2, 2, 2, 2, 1]);
    expect(format.encounter.rubbers.at(-1)?.play).toBe("if_tied");
    expect(format.encounter.rubbers.every((rubber) => rubber.scoringMode === "rally-win-by-2-cap-21")).toBe(true);
    expect(validateTeamRoster(format, roster("A")).valid).toBe(true);
    expect(validateTeamRoster(format, roster("A").map((member) => ({ ...member, role: "player" as const }))).valid).toBe(false);
  });

  it("scores a 3-1 mandatory-rubber result as 6-2 standings points", () => {
    const format = createSeniorTeamCupFormat();
    const scored = scoreTeamEncounter({
      format,
      entryAId: "A",
      entryBId: "B",
      results: [result("md", "A"), result("wd", "A"), result("ms", "A"), result("ws", "B", 10, 15)],
    });
    expect(scored.complete).toBe(true);
    expect(scored.rubbersWonA).toBe(3);
    expect(scored.rubbersWonB).toBe(1);
    expect(scored.standingPointsA).toBe(6);
    expect(scored.standingPointsB).toBe(2);
    expect(scored.rubbers.find((rubber) => rubber.definition.key === "xd")?.status).toBe("skipped");
  });

  it("scores a 2-2 plus mixed tiebreak as 5-4 standings points", () => {
    const format = createSeniorTeamCupFormat();
    const scored = scoreTeamEncounter({
      format,
      entryAId: "A",
      entryBId: "B",
      results: [result("md", "A"), result("wd", "B", 10, 15), result("ms", "A"), result("ws", "B", 10, 15), result("xd", "A")],
    });
    expect(scored.complete).toBe(true);
    expect(scored.standingPointsA).toBe(5);
    expect(scored.standingPointsB).toBe(4);
    expect(scored.winnerEntryId).toBe("A");
  });

  it("ranks by standings points then series wins then direct encounter before differentials", () => {
    const format = createSeniorTeamCupFormat();
    const standings = calculateTeamStandings({
      entries: [team("A"), team("B"), team("C")],
      encounters: [
        { id: "AB", entryAId: "A", entryBId: "B", winnerEntryId: "A", standingPointsA: 5, standingPointsB: 4, rubbersWonA: 3, rubbersWonB: 2, pointsA: 70, pointsB: 69 },
        { id: "AC", entryAId: "A", entryBId: "C", winnerEntryId: "C", standingPointsA: 2, standingPointsB: 6, rubbersWonA: 1, rubbersWonB: 3, pointsA: 45, pointsB: 60 },
        { id: "BC", entryAId: "B", entryBId: "C", winnerEntryId: "B", standingPointsA: 3, standingPointsB: 2, rubbersWonA: 3, rubbersWonB: 2, pointsA: 58, pointsB: 57 },
      ],
      criteria: format.standings.criteria,
    });
    expect(standings.rows.map((row) => [row.entryId, row.standingPoints])).toEqual([["C", 8], ["A", 7], ["B", 7]]);
    // A and B finish tied on PTS and series wins; A stays above B because A won their direct encounter.
    expect(standings.explanation.criteria).toEqual(["standing_points", "encounter_wins", "head_to_head", "rubber_diff", "point_diff"]);
  });
});
