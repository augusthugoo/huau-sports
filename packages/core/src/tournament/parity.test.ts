import { describe, expect, it } from "vitest";
import {
  advanceLiveDraw,
  balancedGroupSizes,
  buildLegacyFormatOptions,
  createDrawTargetSequence,
  createLiveDrawState,
  distributeEntriesRandomly,
  distributeEntriesSnake,
  groupsFromEntryIds,
  type LegacyFormatSimulatorInput,
} from "./parity";

const base: LegacyFormatSimulatorInput = {
  entries: 11,
  courts: 3,
  availableMinutes: 480,
  matchMinutes: 20,
  minimumGroup: 3,
  preferredGroup: 4,
  maximumGroup: 4,
  finalDrawMethod: "performance",
  avoidGroupRematches: true,
  bronzeMatch: true,
  medalBestOf: 1,
  medalSchedule: "sequential",
  standardPointTarget: 15,
  medalPointTarget: 11,
  groupRounds: 1,
  crossGroupMethod: "normalized",
  playoffMode: "standard",
  consolationMode: "none",
  minimumGuaranteedMatches: 0,
  wildcardQualifiers: 0,
  requestedQualifiersPerGroup: 2,
};

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`,
    name: `E${index + 1}`,
    participantIds: [`p${index + 1}`],
    rating: count - index,
  }));

describe("legacy parity helpers", () => {
  it("offers recommended/fastest/more-match format candidates", () => {
    const options = buildLegacyFormatOptions(base);
    expect(options.length).toBeGreaterThanOrEqual(1);
    expect(options[0]?.label).toBe("Recomendada");
    expect(options[0]?.sizes.reduce((sum, value) => sum + value, 0)).toBe(11);
  });

  it("balances 11 entries exactly as the legacy 3/4/4 fixture", () => {
    expect(balancedGroupSizes(11, 3)).toEqual([3, 4, 4]);
  });

  it("snake seeding follows the legacy alternating cycle and exact unequal capacities", () => {
    const groups = distributeEntriesSnake(entries(11), [3, 4, 4]);
    expect(groups.map((group) => group.entries.length)).toEqual([3, 4, 4]);
    expect(groups.map((group) => group.entries.map((entry) => entry.id))).toEqual([
      ["e1", "e6", "e7"],
      ["e2", "e5", "e8", "e11"],
      ["e3", "e4", "e9", "e10"],
    ]);
  });

  it("random seeding shuffles first but still uses the legacy alternating placement", () => {
    // random=0 leaves a deterministic Fisher-Yates order that is easy to assert.
    const groups = distributeEntriesRandomly(entries(7), [2, 2, 3], () => 0);
    expect(groups.map((group) => group.entries.length)).toEqual([2, 2, 3]);
    const flat = groups.flatMap((group) => group.entries.map((entry) => entry.id));
    expect(new Set(flat).size).toBe(7);
    expect(groups.map((group) => group.entries.map((entry) => entry.id))).toEqual([
      ["e2", "e7"],
      ["e3", "e6"],
      ["e4", "e5", "e1"],
    ]);
  });

  it("manual groups reject missing/duplicate assignments and wrong capacities", () => {
    expect(() => groupsFromEntryIds(entries(4), [2, 2], ["e1", "e2", "e2", "e4"])).toThrow("MANUAL_GROUP_ASSIGNMENT_INVALID");
    expect(() => groupsFromEntryIds(entries(4), [3, 2], ["e1", "e2", "e3", "e4"])).toThrow("GROUP_SIZE_MISMATCH");
  });

  it("top-2 final preserves the legacy optional bronze match when the group has at least four entries", () => {
    const option = buildLegacyFormatOptions({ ...base, entries: 6, minimumGroup: 3, preferredGroup: 6, maximumGroup: 6, playoffMode: "top2_final" })[0];
    expect(option?.qualified).toBe(2);
    expect(option?.bronzeMatch).toBe(true);
    expect(option?.finalMatches).toBe(2);
  });

  it("rejects a standard candidate when the requested wildcard total exceeds entries, before capping", () => {
    const options = buildLegacyFormatOptions({ ...base, entries: 4, minimumGroup: 2, preferredGroup: 2, maximumGroup: 2, wildcardQualifiers: 3, requestedQualifiersPerGroup: 1 });
    // 2 groups × 1 qualifier + 3 requested wildcards = 5, so that otherwise-attractive 2+2 candidate is invalid in V2.4.2.
    expect(options.some((option) => option.groups === 2)).toBe(false);
  });

  it("two rounds doubles the group-stage match count and guaranteed matches", () => {
    const one = buildLegacyFormatOptions({ ...base, entries: 4, minimumGroup: 4, preferredGroup: 4, maximumGroup: 4, groupRounds: 1, requestedQualifiersPerGroup: 2 })[0]!;
    const two = buildLegacyFormatOptions({ ...base, entries: 4, minimumGroup: 4, preferredGroup: 4, maximumGroup: 4, groupRounds: 2, requestedQualifiersPerGroup: 2 })[0]!;
    expect(one.groupMatches).toBe(6);
    expect(two.groupMatches).toBe(12);
    expect(one.guaranteed).toBe(3);
    expect(two.guaranteed).toBe(6);
  });

  it("live draw rotates A/B/C while respecting capacities", () => {
    let draw = createLiveDrawState(["1", "2", "3", "4", "5", "6", "7"], [2, 2, 3], () => 0.5);
    while (draw.status !== "complete") draw = advanceLiveDraw(draw);
    expect(draw.targetSequence).toEqual(["A", "B", "C", "A", "B", "C", "C"]);
    expect(Object.values(draw.assignments).map((values) => values.length)).toEqual([2, 2, 3]);
  });

  it("live draw target sequence handles unequal groups exactly like V2.4.2", () => {
    expect(createDrawTargetSequence([3, 4, 4])).toEqual(["A", "B", "C", "A", "B", "C", "A", "B", "C", "B", "C"]);
  });
});
