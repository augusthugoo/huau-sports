import { expect, it } from "vitest";
import { generateGlobalTournamentSchedule, type GlobalScheduleUnit } from "./global-schedule";

const base = {
  dailyStart: "09:00",
  dailyEnd: "18:00",
  courtCount: 3,
  defaultMatchMinutes: 30,
  minimumRestSlots: 1,
  preferredRestSlots: 2,
};

function standard(id: string, categoryId: string, participants: string[], extra: Partial<GlobalScheduleUnit> = {}): GlobalScheduleUnit {
  return { id, categoryId, categoryName: categoryId, kind: "standard", date: "2026-11-15", stage: "group", participants, durationMinutes: 30, ...extra };
}

it("mixes Standard categories when courts are available", () => {
  const result = generateGlobalTournamentSchedule({ settings: base, units: [
    standard("a1", "+40", ["p1", "p2"]),
    standard("a2", "+40", ["p3", "p4"]),
    standard("b1", "+50", ["p5", "p6"]),
  ]});
  expect(result.complete).toBe(true);
  const first = result.assignments.filter((row) => row.startAt === result.assignments[0]!.startAt);
  expect(new Set(first.map((row) => row.categoryId)).size).toBeGreaterThan(1);
});

it("treats minimum rest as hard", () => {
  const result = generateGlobalTournamentSchedule({ settings: { ...base, courtCount: 2 }, units: [
    standard("a1", "A", ["p1", "p2"]),
    standard("a2", "A", ["p1", "p3"]),
  ]});
  const first = result.assignments.find((row) => row.unitId === "a1")!;
  const second = result.assignments.find((row) => row.unitId === "a2")!;
  expect(second.startAt - first.endAt).toBeGreaterThanOrEqual(30 * 60_000);
});

it("enforces dailyEnd", () => {
  const result = generateGlobalTournamentSchedule({ settings: { ...base, dailyEnd: "09:30", courtCount: 1 }, units: [
    standard("a1", "A", ["p1", "p2"]),
    standard("a2", "A", ["p3", "p4"]),
  ]});
  expect(result.complete).toBe(false);
  expect(result.unscheduledUnitIds).toHaveLength(1);
  expect(result.conflicts.some((row) => row.code === "SCHEDULE_EXCEEDS_DAILY_END")).toBe(true);
});

it("keeps a Team encounter on one court and rubbers sequential", () => {
  const team: GlobalScheduleUnit = {
    id: "team-1", categoryId: "+40", kind: "team", date: "2026-11-15", stage: "group", participants: ["a", "b", "c", "d"], durationMinutes: 0,
    rubbers: [
      { id: "md", label: "MD", durationMinutes: 20 },
      { id: "wd", label: "WD", durationMinutes: 20 },
      { id: "ms", label: "MS", durationMinutes: 20 },
      { id: "ws", label: "WS", durationMinutes: 20 },
      { id: "xd", label: "XD", durationMinutes: 20, conditional: true },
    ],
  };
  const result = generateGlobalTournamentSchedule({ settings: base, units: [team] });
  const row = result.assignments[0]!;
  expect(row.rubbers).toHaveLength(5);
  expect(row.rubbers.every((rubber, index) => index === 0 || rubber.startAt === row.rubbers[index - 1]!.endAt)).toBe(true);
  expect(row.endAt - row.startAt).toBe(100 * 60_000);
});

it("allows independent Team encounters simultaneously", () => {
  const unit = (id: string, categoryId: string, participants: string[]): GlobalScheduleUnit => ({
    id, categoryId, kind: "team", date: "2026-11-15", stage: "group", participants, durationMinutes: 0,
    rubbers: [{ id: `${id}-1`, label: "MD", durationMinutes: 20 }, { id: `${id}-2`, label: "WD", durationMinutes: 20 }],
  });
  const result = generateGlobalTournamentSchedule({ settings: base, units: [unit("t1", "A", ["a","b"]), unit("t2", "B", ["c","d"])] });
  expect(result.assignments[0]!.startAt).toBe(result.assignments[1]!.startAt);
  expect(result.assignments[0]!.court).not.toBe(result.assignments[1]!.court);
});

it("does not schedule leg 2 before every leg 1 unit in the same barrier", () => {
  const result = generateGlobalTournamentSchedule({ settings: { ...base, courtCount: 2 }, units: [
    standard("l1a", "A", ["1","2"], { barrierKey: "A:G1", legNumber: 1 }),
    standard("l1b", "A", ["3","4"], { barrierKey: "A:G1", legNumber: 1 }),
    standard("l2a", "A", ["1","3"], { barrierKey: "A:G1", legNumber: 2 }),
  ]});
  const l2 = result.assignments.find((row) => row.unitId === "l2a")!;
  const leg1End = Math.max(...result.assignments.filter((row) => row.unitId.startsWith("l1")).map((row) => row.endAt));
  expect(l2.startAt).toBeGreaterThanOrEqual(leg1End);
});
