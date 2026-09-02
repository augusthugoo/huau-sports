import { describe, expect, it } from "vitest";
import {
  calculateTeamStandings,
  createMixedFiveRubberTeamFormat,
  generateTeamRoundRobinEncounters,
  parseTeamFormatJson,
  scoreTeamEncounter,
  validateTeamFormat,
  validateTeamLineup,
  validateTeamLineupMutation,
  validateTeamRoster,
  type TeamEntry,
  type TeamFormat,
  type TeamLineupAssignment,
  type TeamRosterMember,
  type TeamRubberResult,
} from "./index";

function member(personId: string, sportGender: "male" | "female", role: "player" | "captain" | "substitute" = "player"): TeamRosterMember {
  return { personId, name: personId, sportGender, role };
}

function mixedRoster(prefix = "p"): TeamRosterMember[] {
  return [
    member(`${prefix}-m1`, "male", "captain"),
    member(`${prefix}-m2`, "male"),
    member(`${prefix}-f1`, "female"),
    member(`${prefix}-f2`, "female"),
  ];
}

function lineup(prefix = "p"): TeamLineupAssignment[] {
  return [
    { rubberKey: "md", personIds: [`${prefix}-m1`, `${prefix}-m2`] },
    { rubberKey: "wd", personIds: [`${prefix}-f1`, `${prefix}-f2`] },
    { rubberKey: "ms", personIds: [`${prefix}-m1`] },
    { rubberKey: "ws", personIds: [`${prefix}-f1`] },
    { rubberKey: "xd", personIds: [`${prefix}-m2`, `${prefix}-f2`] },
  ];
}

function result(rubberKey: string, winnerSide: "A" | "B", pointsA = 15, pointsB = 8): TeamRubberResult {
  return { rubberKey, winnerSide, pointsA, pointsB };
}

function team(id: string): TeamEntry {
  return { id, name: id, roster: mixedRoster(id) };
}

function cloneFormat(format: TeamFormat): TeamFormat {
  return {
    ...format,
    roster: { ...format.roster, rules: { ...format.roster.rules } },
    encounter: { ...format.encounter, rubbers: format.encounter.rubbers.map((rubber) => ({ ...rubber })) },
    competition: { ...format.competition },
    standings: { criteria: [...format.standings.criteria] },
  };
}

describe("Phase 5 Team Competition Engine", () => {

  it("validates persisted TeamFormat JSON before it reaches the engine", () => {
    const format = createMixedFiveRubberTeamFormat();
    expect(parseTeamFormatJson(JSON.stringify(format))).toEqual(format);
    expect(() => parseTeamFormatJson(JSON.stringify({ ...format, schemaVersion: 99 }))).toThrow();
  });

  it("TEAM-AT-001 validates configurable 4-6 mixed rosters with 2M/2F minimum", () => {
    const format = createMixedFiveRubberTeamFormat();
    expect(validateTeamFormat(format)).toEqual({ valid: true, issues: [] });
    expect(validateTeamRoster(format, mixedRoster())).toEqual({ valid: true, issues: [] });

    const tooSmall = validateTeamRoster(format, mixedRoster().slice(0, 3));
    expect(tooSmall.valid).toBe(false);
    expect(tooSmall.issues.some((issue) => issue.code === "ROSTER_TOO_SMALL")).toBe(true);

    const wrongQuota = validateTeamRoster(format, [member("m1", "male"), member("m2", "male"), member("m3", "male"), member("f1", "female")]);
    expect(wrongQuota.valid).toBe(false);
    expect(wrongQuota.issues.some((issue) => issue.code === "ROSTER_FEMALE_MIN")).toBe(true);
  });

  it("validates complete lineups and rejects outsiders or invalid mixed doubles", () => {
    const format = createMixedFiveRubberTeamFormat();
    const roster = mixedRoster();
    expect(validateTeamLineup(format, roster, lineup())).toEqual({ valid: true, issues: [] });

    const outsider = lineup();
    outsider[2] = { rubberKey: "ms", personIds: ["not-on-roster"] };
    const outsiderResult = validateTeamLineup(format, roster, outsider);
    expect(outsiderResult.issues.some((issue) => issue.code === "LINEUP_PERSON_OUTSIDE_ROSTER")).toBe(true);

    const invalidMixed = lineup();
    invalidMixed[4] = { rubberKey: "xd", personIds: ["p-m1", "p-m2"] };
    const mixedResult = validateTeamLineup(format, roster, invalidMixed);
    expect(mixedResult.issues.some((issue) => issue.code === "LINEUP_GENDER_MIXED")).toBe(true);
  });

  it("TEAM-AT-002 preserves configured rubber order without event-specific branching", () => {
    const format = createMixedFiveRubberTeamFormat();
    const group = { id: "A", name: "A", entries: [team("T1"), team("T2"), team("T3")] };
    const encounters = generateTeamRoundRobinEncounters(group, format);
    expect(encounters).toHaveLength(3);
    expect(encounters[0]?.rubbers.map((rubber) => rubber.key)).toEqual(["md", "wd", "ms", "ws", "xd"]);
  });

  it("TEAM-AT-003 expresses the five-rubber mixed fixture entirely from config", () => {
    const format = createMixedFiveRubberTeamFormat("always");
    const scored = scoreTeamEncounter({
      format,
      entryAId: "A",
      entryBId: "B",
      results: [result("md", "A"), result("wd", "B", 8, 15), result("ms", "A"), result("ws", "B", 8, 15), result("xd", "A")],
    });
    expect(scored.complete).toBe(true);
    expect(scored.rubbers.map((rubber) => [rubber.definition.key, rubber.status])).toEqual([
      ["md", "finished"],
      ["wd", "finished"],
      ["ms", "finished"],
      ["ws", "finished"],
      ["xd", "finished"],
    ]);
    expect(scored.winnerEntryId).toBe("A");
    expect(scored.rubbersWonA).toBe(3);
    expect(scored.rubbersWonB).toBe(2);
  });

  it("TEAM-AT-004 activates an if_tied fifth rubber at 2-2", () => {
    const format = createMixedFiveRubberTeamFormat("if_tied");
    const beforeTiebreak = scoreTeamEncounter({
      format,
      entryAId: "A",
      entryBId: "B",
      results: [result("md", "A"), result("wd", "B", 8, 15), result("ms", "A"), result("ws", "B", 8, 15)],
    });
    expect(beforeTiebreak.complete).toBe(false);
    expect(beforeTiebreak.nextRubberKey).toBe("xd");
    expect(beforeTiebreak.rubbers.find((rubber) => rubber.definition.key === "xd")?.status).toBe("ready");

    const complete = scoreTeamEncounter({
      format,
      entryAId: "A",
      entryBId: "B",
      results: [
        result("md", "A"),
        result("wd", "B", 8, 15),
        result("ms", "A"),
        result("ws", "B", 8, 15),
        result("xd", "B", 9, 15),
      ],
    });
    expect(complete.complete).toBe(true);
    expect(complete.winnerEntryId).toBe("B");
  });

  it("TEAM-AT-004 skips an if_tied rubber when the regular series is not tied", () => {
    const format = createMixedFiveRubberTeamFormat("if_tied");
    const scored = scoreTeamEncounter({
      format,
      entryAId: "A",
      entryBId: "B",
      results: [result("md", "A"), result("wd", "A"), result("ms", "A"), result("ws", "B", 8, 15)],
    });
    expect(scored.complete).toBe(true);
    expect(scored.rubbers.find((rubber) => rubber.definition.key === "xd")?.status).toBe("skipped");
    expect(scored.winnerEntryId).toBe("A");
  });

  it("supports an alternative even-rubber format with a generic conditional tiebreaker", () => {
    const format = cloneFormat(createMixedFiveRubberTeamFormat("if_tied"));
    const tiebreaker = format.encounter.rubbers.find((rubber) => rubber.key === "xd");
    if (!tiebreaker) throw new Error("fixture rubber missing");
    tiebreaker.key = "tb";
    tiebreaker.label = "Tiebreak";

    const scored = scoreTeamEncounter({
      format,
      entryAId: "A",
      entryBId: "B",
      results: [result("md", "A"), result("wd", "B", 8, 15), result("ms", "A"), result("ws", "B", 8, 15)],
    });
    expect(scored.nextRubberKey).toBe("tb");
  });

  it("TEAM-AT-005 derives first-to winner from config and skips later rubbers after clinch", () => {
    const format = cloneFormat(createMixedFiveRubberTeamFormat());
    format.encounter.winnerRule = "first_to";
    format.encounter.targetWins = 2;
    format.encounter.playRemainingAfterClinched = false;

    const scored = scoreTeamEncounter({
      format,
      entryAId: "A",
      entryBId: "B",
      results: [result("md", "A"), result("wd", "A")],
    });
    expect(scored.complete).toBe(true);
    expect(scored.winnerEntryId).toBe("A");
    expect(scored.rubbers.slice(2).every((rubber) => rubber.status === "skipped")).toBe(true);
  });

  it("TEAM-AT-006 produces deterministic team standings and exposes applied criteria", () => {
    const entries = [team("A"), team("B"), team("C")];
    const standings = calculateTeamStandings({
      entries,
      encounters: [
        { id: "AB", entryAId: "A", entryBId: "B", winnerEntryId: "A", rubbersWonA: 3, rubbersWonB: 2, pointsA: 65, pointsB: 59 },
        { id: "AC", entryAId: "A", entryBId: "C", winnerEntryId: "C", rubbersWonA: 2, rubbersWonB: 3, pointsA: 58, pointsB: 62 },
        { id: "BC", entryAId: "B", entryBId: "C", winnerEntryId: "B", rubbersWonA: 4, rubbersWonB: 1, pointsA: 70, pointsB: 44 },
      ],
    });
    expect(standings.rows.map((row) => row.entryId)).toEqual(["B", "A", "C"]);
    expect(standings.explanation.criteria).toEqual([
      "encounter_wins",
      "encounter_win_rate",
      "rubber_diff",
      "point_diff",
      "points_for",
    ]);
    expect(standings.explanation.fallback).toBe("entry_id");
  });

  it("TEAM-AT-007 reuses round-robin group semantics for team entries and two legs", () => {
    const format = cloneFormat(createMixedFiveRubberTeamFormat());
    format.competition.groupRounds = 2;
    const group = { id: "A", name: "A", entries: [team("T1"), team("T2"), team("T3"), team("T4")] };
    const encounters = generateTeamRoundRobinEncounters(group, format);
    expect(encounters).toHaveLength(12);
    expect(encounters.slice(0, 6).every((encounter) => encounter.legNumber === 1)).toBe(true);
    expect(encounters.slice(6).every((encounter) => encounter.legNumber === 2)).toBe(true);
  });

  it("TEAM-AT-008 protects locked/started lineups and only allows pre-result administrative override", () => {
    expect(validateTeamLineupMutation({
      lineupStatus: "locked",
      encounterStatus: "ready",
      hasResults: false,
      administrativeOverride: false,
    }).valid).toBe(false);

    expect(validateTeamLineupMutation({
      lineupStatus: "locked",
      encounterStatus: "ready",
      hasResults: false,
      administrativeOverride: true,
    })).toEqual({ valid: true, issues: [] });

    const afterResult = validateTeamLineupMutation({
      lineupStatus: "locked",
      encounterStatus: "in_progress",
      hasResults: true,
      administrativeOverride: true,
    });
    expect(afterResult.valid).toBe(false);
    expect(afterResult.issues.some((issue) => issue.code === "LINEUP_OVERRIDE_AFTER_RESULT")).toBe(true);
  });
});
