import { expect, it } from "vitest";
import { generateGlobalTournamentSchedule, type GlobalScheduleUnit } from "./global-schedule";

const base = {
  dailyStart: "09:00",
  dailyEnd: "18:00",
  courtCount: 3,
  defaultMatchMinutes: 30,
  minimumRestSlots: 0,
  preferredRestSlots: 0,
};

function unit(id: string, categoryId: string, extra: Partial<GlobalScheduleUnit> = {}): GlobalScheduleUnit {
  return {
    id,
    categoryId,
    categoryName: categoryId,
    kind: "standard",
    date: "2026-11-15",
    stage: "group",
    participants: [`${id}-a`, `${id}-b`],
    durationMinutes: 30,
    ...extra,
  };
}

it("honors strict category phases before starting a later phase", () => {
  const result = generateGlobalTournamentSchedule({
    settings: base,
    units: [
      unit("a1", "A", { policyPhase: 1 }),
      unit("a2", "A", { policyPhase: 1 }),
      unit("b1", "B", { policyPhase: 2 }),
    ],
  });
  const phaseOneEnd = Math.max(
    ...result.assignments.filter((row) => row.categoryId === "A").map((row) => row.endAt),
  );
  expect(result.assignments.find((row) => row.unitId === "b1")!.startAt).toBeGreaterThanOrEqual(phaseOneEnd);
});

it("honors strict within-category round sequencing", () => {
  const result = generateGlobalTournamentSchedule({
    settings: base,
    units: [
      unit("r1a", "A", { policySequenceKey: "rounds:A", policySequenceIndex: 1 }),
      unit("r1b", "A", { policySequenceKey: "rounds:A", policySequenceIndex: 1 }),
      unit("r2a", "A", { policySequenceKey: "rounds:A", policySequenceIndex: 2 }),
    ],
  });
  const roundOneEnd = Math.max(
    ...result.assignments.filter((row) => row.unitId.startsWith("r1")).map((row) => row.endAt),
  );
  expect(result.assignments.find((row) => row.unitId === "r2a")!.startAt).toBeGreaterThanOrEqual(roundOneEnd);
});

it("supports preferred, allowed and exclusive court policies", () => {
  const result = generateGlobalTournamentSchedule({
    settings: base,
    units: [
      unit("exclusive", "A", { exclusiveCourts: [2] }),
      unit("other", "B"),
      unit("allowed", "C", { allowedCourts: [3] }),
    ],
  });
  expect(result.assignments.find((row) => row.unitId === "exclusive")!.court).toBe(2);
  expect(result.assignments.find((row) => row.unitId === "other")!.court).not.toBe(2);
  expect(result.assignments.find((row) => row.unitId === "allowed")!.court).toBe(3);

  const preferred = generateGlobalTournamentSchedule({
    settings: base,
    units: [unit("preferred", "D", { preferredCourts: [2] })],
  });
  expect(preferred.assignments[0]!.court).toBe(2);
});

it("caps simultaneous courts per category", () => {
  const result = generateGlobalTournamentSchedule({
    settings: base,
    units: [
      unit("a1", "A", { maxConcurrentCourts: 2 }),
      unit("a2", "A", { maxConcurrentCourts: 2 }),
      unit("a3", "A", { maxConcurrentCourts: 2 }),
    ],
  });
  const firstStart = Math.min(...result.assignments.map((row) => row.startAt));
  expect(result.assignments.filter((row) => row.startAt === firstStart)).toHaveLength(2);
  expect(Math.max(...result.assignments.map((row) => row.startAt))).toBeGreaterThan(firstStart);
});
