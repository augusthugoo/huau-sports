import { describe, expect, it } from "vitest";
import { distributeEntriesIntoGroups, recommendedGroupCount, tournamentSetupChecklist } from "./admin";

const entries = Array.from({ length: 11 }, (_, index) => ({
  id: `E${index + 1}`,
  name: `Entry ${index + 1}`,
  participantIds: [`P${index + 1}`],
  rating: 11 - index,
}));

describe("Phase 4 tournament admin helpers", () => {
  it("recommends compact 3-5 player groups", () => {
    expect(recommendedGroupCount(4)).toBe(1);
    expect(recommendedGroupCount(6)).toBe(2);
    expect(recommendedGroupCount(11)).toBe(3);
  });

  it("distributes seeded entries with a snake pattern", () => {
    const groups = distributeEntriesIntoGroups(entries, 3);
    expect(groups.map((group) => group.entries.length)).toEqual([3, 4, 4]);
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(["E1", "E6", "E7"]);
    expect(groups[1]?.entries.map((entry) => entry.id)).toEqual(["E2", "E5", "E8", "E11"]);
    expect(groups[2]?.entries.map((entry) => entry.id)).toEqual(["E3", "E4", "E9", "E10"]);
  });

  it("only marks structure and schedule complete when every category is ready", () => {
    const checklist = tournamentSetupChecklist({
      hasGeneral: true,
      categoryCount: 3,
      entryCount: 8,
      generatedCategoryCount: 2,
      scheduledCategoryCount: 2,
    });
    expect(checklist.find((item) => item.key === "participants")?.complete).toBe(true);
    expect(checklist.find((item) => item.key === "structure")?.complete).toBe(false);
    expect(checklist.find((item) => item.key === "schedule")?.complete).toBe(false);
  });
});
