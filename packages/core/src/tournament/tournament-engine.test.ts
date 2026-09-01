import { describe, expect, it } from "vitest";
import {
  buildBracketSlots,
  buildCompetitionFromGroups,
  calculateGroupStandings,
  competitionStructureFingerprint,
  crossGroupStatsForEntry,
  generateFinalPhase,
  generateTournamentSchedule,
  qualifiedEntries,
  standardSeedOrder,
  updateEntryCosmetics,
  withEncounterResult,
  type Competition,
  type ScheduleCategory,
  type StandardCompetitionFormat,
  type TournamentEntry,
  type TournamentGroup,
} from "./index";

function entry(id: string, participantId = id, rating = 0): TournamentEntry {
  return { id, name: id, participantIds: [participantId], rating };
}

function group(name: string, ids: string[], participantPrefix = ""): TournamentGroup {
  return {
    id: `group-${name}`,
    name,
    entries: ids.map((id, index) => entry(id, participantPrefix ? `${participantPrefix}-${index}` : id, 10 - index)),
  };
}

function competition(
  groups: TournamentGroup[],
  format: Partial<StandardCompetitionFormat> = {},
  categoryId = "category",
): Competition {
  return buildCompetitionFromGroups({ id: `competition-${categoryId}`, categoryId, groups, format });
}

function finishAllGroups(input: Competition, scorer?: (a: string, b: string, matchIndex: number) => [number, number]): Competition {
  let result = input;
  const groupMatches = input.encounters.filter((match) => match.stage === "group");
  groupMatches.forEach((match, index) => {
    const a = match.entryA?.id ?? "";
    const b = match.entryB?.id ?? "";
    const score = scorer?.(a, b, index) ?? [15, 8];
    result = withEncounterResult(result, match.id, { scoreA: score[0], scoreB: score[1] });
  });
  return result;
}

function scoreByStrength(input: Competition): Competition {
  const strength = new Map<string, number>();
  input.groups.forEach((g) => g.entries.forEach((e, index) => strength.set(e.id, g.entries.length - index)));
  return finishAllGroups(input, (a, b) => {
    const sa = strength.get(a) ?? 0;
    const sb = strength.get(b) ?? 0;
    return sa > sb ? [15, 7 + sb] : [7 + sa, 15];
  });
}

function scheduleCategory(value: Competition, scheduledDate: string, order = 0, matchMinutes = 15): ScheduleCategory {
  return { categoryId: value.categoryId, scheduledDate, order, matchMinutes, competition: value };
}

const scheduleSettings = {
  startDate: "2026-09-10",
  dailyStart: "09:00",
  courtCount: 2,
  preferredRestSlots: 1,
} as const;

describe("Phase 2 tournament engine parity fixtures", () => {
  it("single-group-4: creates six unique round-robin matches and preserves group standings", () => {
    let value = competition([group("A", ["A1", "A2", "A3", "A4"])]);
    expect(value.encounters).toHaveLength(6);
    expect(new Set(value.encounters.map((match) => [match.entryA?.id, match.entryB?.id].sort().join("-"))).size).toBe(6);

    value = scoreByStrength(value);
    const standings = calculateGroupStandings(value, "group-A");
    expect(standings.map((row) => row.entry.id)).toEqual(["A1", "A2", "A3", "A4"]);
    expect(standings.map((row) => row.played)).toEqual([3, 3, 3, 3]);
  });

  it("unequal-3-4-4-normalized: compares cross-group performance using rates and per-match values", () => {
    let value = competition(
      [group("A", ["A1", "A2", "A3"]), group("B", ["B1", "B2", "B3", "B4"]), group("C", ["C1", "C2", "C3", "C4"])],
      { qualifiersPerGroup: 1, wildcardQualifiers: 2, crossGroupMethod: "normalized" },
    );
    value = scoreByStrength(value);

    const a2 = crossGroupStatsForEntry(value, "group-A", "A2");
    const b2 = crossGroupStatsForEntry(value, "group-B", "B2");
    expect(a2?.played).toBe(2);
    expect(b2?.played).toBe(3);
    expect(a2?.consideredEncounterIds).toHaveLength(2);
    expect(b2?.consideredEncounterIds).toHaveLength(3);
    expect(a2?.method).toBe("normalized");
    expect(b2?.winRate).toBeCloseTo(2 / 3, 8);
  });

  it("unequal-3-4-4-equalized: ignores the extra rival only for cross-group comparison", () => {
    let value = competition(
      [group("A", ["A1", "A2", "A3"]), group("B", ["B1", "B2", "B3", "B4"]), group("C", ["C1", "C2", "C3", "C4"])],
      { qualifiersPerGroup: 1, wildcardQualifiers: 2, crossGroupMethod: "equalized" },
    );
    value = scoreByStrength(value);

    const internal = calculateGroupStandings(value, "group-B");
    const b2 = crossGroupStatsForEntry(value, "group-B", "B2");
    expect(internal.find((row) => row.entry.id === "B2")?.played).toBe(3);
    expect(b2?.played).toBe(2);
    expect(b2?.ignoredEncounterIds).toHaveLength(1);
    expect(b2?.method).toBe("equalized");
  });

  it("wildcard-best-second: selects the best runner-up with the active cross-group method", () => {
    let value = competition(
      [group("A", ["A1", "A2", "A3"]), group("B", ["B1", "B2", "B3"])],
      { qualifiersPerGroup: 1, wildcardQualifiers: 1 },
    );
    value = finishAllGroups(value, (a, b) => {
      const winner = a.endsWith("1") || (a === "A2" && b === "A3") || (a === "B2" && b === "B3");
      if (a === "A1" && b === "A2") return [15, 14];
      if (a === "B1" && b === "B2") return [15, 5];
      return winner ? [15, 6] : [6, 15];
    });
    const qualified = qualifiedEntries(value);
    expect(qualified).toHaveLength(3);
    expect(qualified[2]?.entry.id).toBe("A2");
  });

  it("standard-bracket-6-to-8-with-byes: seeds six qualifiers into an eight-slot bracket with two byes", () => {
    let value = competition(
      [group("A", ["A1", "A2", "A3"]), group("B", ["B1", "B2", "B3"]), group("C", ["C1", "C2", "C3"])],
      { qualifiersPerGroup: 2, wildcardQualifiers: 0, playoffMode: "standard", bronzeMatch: true },
    );
    value = scoreByStrength(value);
    const qualifiers = qualifiedEntries(value);
    expect(qualifiers).toHaveLength(6);
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const bracket = buildBracketSlots(qualifiers, 8, value.format);
    expect(bracket.slots.filter((slot) => slot === null)).toHaveLength(2);

    value = generateFinalPhase(value);
    const firstRound = value.encounters.filter((match) => match.stage !== "group" && match.roundNumber === 1 && match.stage !== "consolation");
    expect(firstRound.filter((match) => match.status === "bye")).toHaveLength(2);
    expect(value.encounters.some((match) => match.stage === "bronze")).toBe(true);
  });

  it("top2-final: maps first and second directly to the final", () => {
    let value = competition([group("A", ["A1", "A2", "A3", "A4"])], { playoffMode: "top2_final", bronzeMatch: false });
    value = generateFinalPhase(scoreByStrength(value));
    const finals = value.encounters.filter((match) => match.stage === "final");
    expect(finals).toHaveLength(1);
    expect([finals[0]?.entryA?.id, finals[0]?.entryB?.id]).toEqual(["A1", "A2"]);
  });

  it("top3-step: schedules second vs third and sends the winner to face first", () => {
    let value = competition([group("A", ["A1", "A2", "A3", "A4"])], { playoffMode: "top3_step", bronzeMatch: false });
    value = generateFinalPhase(scoreByStrength(value));
    const preliminary = value.encounters.find((match) => match.id === "playoff:preliminary");
    const final = value.encounters.find((match) => match.id === "playoff:final");
    expect([preliminary?.entryA?.id, preliminary?.entryB?.id]).toEqual(["A2", "A3"]);
    expect(final?.entryA?.id).toBe("A1");
    expect(final?.sourceEncounterBId).toBe("playoff:preliminary");
  });

  it("top4-semis: builds 1v4 and 2v3 with bronze loser sources", () => {
    let value = competition([group("A", ["A1", "A2", "A3", "A4"])], { playoffMode: "top4_semis", bronzeMatch: true });
    value = generateFinalPhase(scoreByStrength(value));
    const semis = value.encounters.filter((match) => match.roundLabel === "Semifinal");
    expect(semis.map((match) => [match.entryA?.id, match.entryB?.id])).toEqual([
      ["A1", "A4"],
      ["A2", "A3"],
    ]);
    const bronze = value.encounters.find((match) => match.stage === "bronze");
    expect(bronze?.sourceLoserAId).toBe("playoff:semi:1");
    expect(bronze?.sourceLoserBId).toBe("playoff:semi:2");
  });

  it("league-only: closes without generating a main playoff", () => {
    let value = competition([group("A", ["A1", "A2", "A3", "A4"])], { playoffMode: "league_only" });
    value = generateFinalPhase(scoreByStrength(value));
    expect(value.finalGenerated).toBe(true);
    expect(value.encounters.every((match) => match.stage === "group")).toBe(true);
  });

  it("consolation: creates a knockout for non-qualified entries", () => {
    let value = competition(
      [group("A", ["A1", "A2", "A3"]), group("B", ["B1", "B2", "B3"])],
      { qualifiersPerGroup: 1, consolationMode: "knockout", bronzeMatch: false },
    );
    value = generateFinalPhase(scoreByStrength(value));
    const consolation = value.encounters.filter((match) => match.stage === "consolation");
    expect(consolation).toHaveLength(3);
  });

  it("bronze-sequential: reserves bronze before final on different time blocks", () => {
    const value = competition([group("A", ["A1", "A2", "A3", "A4"])], {
      playoffMode: "top4_semis",
      bronzeMatch: true,
      medalSchedule: "sequential",
    });
    const schedule = generateTournamentSchedule({ settings: scheduleSettings, categories: [scheduleCategory(value, "2026-09-10")] });
    const bronze = schedule.items.find((item) => item.reserved && item.stage === "bronze");
    const final = schedule.items.find((item) => item.reserved && item.stage === "final");
    expect(bronze).toBeDefined();
    expect(final).toBeDefined();
    expect((bronze?.startOffset ?? 0) < (final?.startOffset ?? 0)).toBe(true);
  });

  it("bronze-simultaneous: reserves bronze and final at the same time on separate courts", () => {
    const value = competition([group("A", ["A1", "A2", "A3", "A4"])], {
      playoffMode: "top4_semis",
      bronzeMatch: true,
      medalSchedule: "simultaneous",
    });
    const schedule = generateTournamentSchedule({ settings: scheduleSettings, categories: [scheduleCategory(value, "2026-09-10")] });
    const bronze = schedule.items.find((item) => item.reserved && item.stage === "bronze");
    const final = schedule.items.find((item) => item.reserved && item.stage === "final");
    expect(bronze?.startOffset).toBe(final?.startOffset);
    expect(new Set([bronze?.court, final?.court]).size).toBe(2);
  });

  it("medal-bo3: a 2-0 final completes without requiring a third set", () => {
    let value = competition([group("A", ["A1", "A2", "A3"])], {
      playoffMode: "top2_final",
      bronzeMatch: false,
      medal: { bestOf: 3, pointTarget: 11 },
    });
    value = generateFinalPhase(scoreByStrength(value));
    const final = value.encounters.find((match) => match.stage === "final");
    expect(final?.bestOf).toBe(3);
    if (!final) throw new Error("fixture final missing");
    value = withEncounterResult(value, final.id, { sets: [{ scoreA: 11, scoreB: 7 }, { scoreA: 11, scoreB: 9 }] });
    const completed = value.encounters.find((match) => match.id === final.id);
    expect(completed?.status).toBe("finished");
    expect(completed?.winnerEntryId).toBe("A1");
    expect(completed?.sets).toHaveLength(2);
  });

  it("two-day-schedule: schedules every match of a day-two category", () => {
    const day1 = competition([group("A", ["A1", "A2", "A3"])], {}, "day1");
    const day2 = competition([group("B", ["B1", "B2", "B3", "B4"])], {}, "day2");
    const schedule = generateTournamentSchedule({
      settings: scheduleSettings,
      categories: [scheduleCategory(day1, "2026-09-10", 0), scheduleCategory(day2, "2026-09-11", 0)],
    });
    const day2GroupItems = schedule.items.filter((item) => item.categoryId === "day2" && !item.reserved);
    expect(day2GroupItems).toHaveLength(6);
    expect(day2GroupItems.every((item) => item.date === "2026-09-11")).toBe(true);
  });

  it("player-multi-category-no-overlap: never puts the same participant on two courts simultaneously", () => {
    const shared = "person-shared";
    const cat1 = competition([
      { id: "group-A", name: "A", entries: [entry("A1", shared), entry("A2"), entry("A3")] },
    ], {}, "cat1");
    const cat2 = competition([
      { id: "group-B", name: "B", entries: [entry("B1", shared), entry("B2"), entry("B3")] },
    ], {}, "cat2");
    const schedule = generateTournamentSchedule({
      settings: scheduleSettings,
      categories: [scheduleCategory(cat1, "2026-09-10", 0), scheduleCategory(cat2, "2026-09-10", 1)],
    });
    const byEncounter = new Map([...cat1.encounters, ...cat2.encounters].map((match) => [match.id, match] as const));
    const sharedItems = schedule.items.filter((item) => {
      const match = item.encounterId ? byEncounter.get(item.encounterId) : null;
      return match ? [...(match.entryA?.participantIds ?? []), ...(match.entryB?.participantIds ?? [])].includes(shared) : false;
    });
    const keys = sharedItems.map((item) => `${item.date}-${item.time}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("two-rounds-regression: generates 12 matches and schedules all leg 1 before any leg 2", () => {
    const value = competition([group("A", ["A1", "A2", "A3", "A4"])], { groupRounds: 2, bronzeMatch: false });
    expect(value.encounters).toHaveLength(12);
    expect(value.encounters.filter((match) => match.legNumber === 1)).toHaveLength(6);
    expect(value.encounters.filter((match) => match.legNumber === 2)).toHaveLength(6);

    const schedule = generateTournamentSchedule({ settings: scheduleSettings, categories: [scheduleCategory(value, "2026-09-10")] });
    const groupItems = schedule.items.filter((item) => !item.reserved);
    const leg1 = groupItems.filter((item) => item.legNumber === 1);
    const leg2 = groupItems.filter((item) => item.legNumber === 2);
    expect(Math.max(...leg1.map((item) => item.startOffset))).toBeLessThan(Math.min(...leg2.map((item) => item.startOffset)));
    const firstLeg2Index = groupItems.findIndex((item) => item.legNumber === 2);
    expect(groupItems.slice(0, firstLeg2Index).every((item) => item.legNumber === 1)).toBe(true);
  });

  it("cosmetic-edit-no-invalidation: renaming an entry preserves structure, schedule identifiers and results", () => {
    let value = competition([group("A", ["A1", "A2", "A3"])], { bronzeMatch: false });
    const match = value.encounters[0];
    if (!match) throw new Error("fixture match missing");
    value = withEncounterResult(value, match.id, { scoreA: 17, scoreB: 15 });
    const fingerprint = competitionStructureFingerprint(value);
    const updated = updateEntryCosmetics(value, "A1", { name: "Augusto actualizado" });
    expect(competitionStructureFingerprint(updated)).toBe(fingerprint);
    expect(updated.encounters.find((candidate) => candidate.id === match.id)?.scoreA).toBe(17);
    expect(updated.encounters.find((candidate) => candidate.id === match.id)?.status).toBe("finished");
    expect(updated.groups[0]?.entries.find((candidate) => candidate.id === "A1")?.name).toBe("Augusto actualizado");
  });
});
