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

it("prevents overlapping matches for the same participant even with zero minimum rest", () => {
  const result = generateGlobalTournamentSchedule({
    settings: {
      ...base,
      courtCount: 2,
      minimumRestSlots: 0,
      preferredRestSlots: 0,
    },
    units: [
      standard("a1", "A", ["p1", "p2"]),
      standard("a2", "A", ["p1", "p3"]),
    ],
  });

  const first = result.assignments.find((row) => row.unitId === "a1")!;
  const second = result.assignments.find((row) => row.unitId === "a2")!;

  expect(
    first.startAt < second.endAt &&
    second.startAt < first.endAt,
  ).toBe(false);

  expect(second.startAt).toBe(first.endAt);
});

it("reserves recovery time after dependencies for a provisional knockout round", () => {
  const result = generateGlobalTournamentSchedule({
    settings: { ...base, courtCount: 2 },
    units: [
      standard("g1", "A", ["p1", "p2"]),
      standard("g2", "A", ["p3", "p4"]),
      standard("semi", "A", [], {
        stage: "playoff",
        dependencyIds: ["g1", "g2"],
        dependencyRestSlots: 1,
      }),
    ],
  });

  const groupsEnd = Math.max(
    ...result.assignments
      .filter((row) => row.unitId === "g1" || row.unitId === "g2")
      .map((row) => row.endAt),
  );
  const semi = result.assignments.find((row) => row.unitId === "semi")!;

  expect(semi.startAt - groupsEnd).toBeGreaterThanOrEqual(30 * 60_000);
});

it("honors category start times and one-minute scheduling precision", () => {
  const result = generateGlobalTournamentSchedule({
    settings: {
      ...base,
      dailyStart: "18:00",
      dailyEnd: "20:00",
      courtCount: 2,
      defaultMatchMinutes: 13,
      minimumRestSlots: 0,
      preferredRestSlots: 0,
      stepMinutes: 1,
    },
    units: [
      standard("male-1", "M50", [], {
        notBefore: "18:15",
        durationMinutes: 13,
      }),
      standard("male-2", "M50", [], {
        notBefore: "18:15",
        durationMinutes: 13,
        dependencyIds: ["male-1"],
      }),
      standard("female-1", "F50", [], {
        notBefore: "18:40",
        durationMinutes: 13,
      }),
    ],
  });

  const male1 = result.assignments.find((row) => row.unitId === "male-1")!;
  const male2 = result.assignments.find((row) => row.unitId === "male-2")!;
  const female1 = result.assignments.find((row) => row.unitId === "female-1")!;

  expect(male1.startAt).toBe(new Date("2026-11-15T18:15:00").getTime());
  expect(male2.startAt).toBe(new Date("2026-11-15T18:28:00").getTime());
  expect(female1.startAt).toBe(new Date("2026-11-15T18:40:00").getTime());
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

it("uses effective match duration for rest slots", () => {
  const result = generateGlobalTournamentSchedule({
    settings: {
      ...base,
      courtCount: 2,
      defaultMatchMinutes: 30,
      minimumRestSlots: 1,
      preferredRestSlots: 1,
    },
    units: [
      standard("short", "A", ["p1", "p2"], { durationMinutes: 20 }),
      standard("long", "B", ["p1", "p3"], {
        durationMinutes: 40,
        dependencyIds: ["short"],
      }),
    ],
  });

  const first = result.assignments.find((row) => row.unitId === "short")!;
  const second = result.assignments.find((row) => row.unitId === "long")!;
  expect(second.startAt - first.endAt).toBeGreaterThanOrEqual(40 * 60_000);
});

it("uses another ready category to buy preferred rest when both can start in the same wave", () => {
  const result = generateGlobalTournamentSchedule({
    settings: {
      ...base,
      courtCount: 1,
      minimumRestSlots: 0,
      preferredRestSlots: 1,
    },
    units: [
      standard("a1", "A", ["p1", "p2"], { durationMinutes: 30, priority: -1 }),
      standard("a2", "A", ["p1", "p3"], { durationMinutes: 30, dependencyIds: ["a1"], priority: -1 }),
      standard("b1", "B", ["p4", "p5"], { durationMinutes: 30, notBefore: "09:30", priority: -2 }),
    ],
  });

  const a1 = result.assignments.find((row) => row.unitId === "a1")!;
  const b1 = result.assignments.find((row) => row.unitId === "b1")!;
  const a2 = result.assignments.find((row) => row.unitId === "a2")!;
  expect(b1.startAt).toBe(a1.endAt);
  expect(a2.startAt).toBe(b1.endAt);
});

it("does not idle a legal earlier slot only to chase preferred rest", () => {
  const result = generateGlobalTournamentSchedule({
    settings: {
      ...base,
      courtCount: 1,
      minimumRestSlots: 0,
      preferredRestSlots: 1,
    },
    units: [
      standard("r1", "A", ["p1", "p2"], { durationMinutes: 30 }),
      standard("r2", "A", ["p1", "p3"], { durationMinutes: 30, dependencyIds: ["r1"] }),
    ],
  });
  const first = result.assignments.find((row) => row.unitId === "r1")!;
  const second = result.assignments.find((row) => row.unitId === "r2")!;
  expect(second.startAt).toBe(first.endAt);
});

it("honors a phase-specific hard end before the global daily end", () => {
  const result = generateGlobalTournamentSchedule({
    settings: {
      ...base,
      dailyStart: "09:00",
      dailyEnd: "12:00",
      courtCount: 1,
      minimumRestSlots: 0,
      preferredRestSlots: 0,
    },
    units: [
      standard("p1", "A", ["a", "b"], { durationMinutes: 20, notAfter: "09:30" }),
      standard("p2", "A", ["c", "d"], { durationMinutes: 20, notAfter: "09:30", dependencyIds: ["p1"] }),
    ],
  });

  expect(result.assignments.some((row) => row.unitId === "p1")).toBe(true);
  expect(result.assignments.some((row) => row.unitId === "p2")).toBe(false);
  expect(result.unscheduledUnitIds).toContain("p2");
});

it("scopes exclusive courts to their operational day", () => {
  const dayOne = standard("exclusive-day-1", "A", ["a", "b"], {
    date: "2026-11-15",
    exclusiveCourts: [2],
  });
  const dayTwo = standard("allowed-day-2", "B", ["c", "d"], {
    date: "2026-11-16",
    allowedCourts: [2],
  });
  const result = generateGlobalTournamentSchedule({
    settings: { ...base, courtCount: 2 },
    units: [dayOne, dayTwo],
  });
  expect(result.assignments.find((row) => row.unitId === "exclusive-day-1")!.court).toBe(2);
  expect(result.assignments.find((row) => row.unitId === "allowed-day-2")!.court).toBe(2);
});

it("keeps continuity without leaving earlier courts idle", () => {
  const result = generateGlobalTournamentSchedule({
    settings: {
      ...base,
      courtCount: 4,
      minimumRestSlots: 0,
      preferredRestSlots: 0,
    },
    units: [
      standard("a1", "A", ["a1", "a2"], { continuityKey: "block:A", maxConcurrentCourts: 2, priority: -1 }),
      standard("a2", "A", ["a3", "a4"], { continuityKey: "block:A", maxConcurrentCourts: 2, priority: -1 }),
      standard("a3", "A", ["a5", "a6"], { continuityKey: "block:A", maxConcurrentCourts: 2, priority: -1 }),
      standard("b1", "B", ["b1", "b2"], { continuityKey: "block:B", maxConcurrentCourts: 2, priority: -2 }),
      standard("b2", "B", ["b3", "b4"], { continuityKey: "block:B", maxConcurrentCourts: 2, priority: -2 }),
      standard("c1", "C", ["c1", "c2"], { continuityKey: "block:C", maxConcurrentCourts: 2, priority: -3 }),
      standard("c2", "C", ["c3", "c4"], { continuityKey: "block:C", maxConcurrentCourts: 2, priority: -3 }),
    ],
  });

  const firstStart = Math.min(...result.assignments.map((row) => row.startAt));
  const firstWave = result.assignments.filter((row) => row.startAt === firstStart);
  expect(firstWave).toHaveLength(4);
  expect(firstWave.filter((row) => row.categoryId === "A")).toHaveLength(2);
  expect(firstWave.filter((row) => row.categoryId === "B")).toHaveLength(2);
  expect(firstWave.filter((row) => row.categoryId === "C")).toHaveLength(0);
  expect(result.assignments.find((row) => row.unitId === "a3")!.startAt).toBeGreaterThan(firstStart);
  expect(result.complete).toBe(true);
});

it("supports explicit hard and target rest in minutes across categories", () => {
  const result = generateGlobalTournamentSchedule({
    settings: { ...base, courtCount: 1, minimumRestSlots: 0, preferredRestSlots: 0 },
    units: [
      standard("a1", "A", ["shared", "a"], { durationMinutes: 20, minimumRestMinutes: 0, preferredRestMinutes: 25, priority: -1 }),
      standard("b1", "B", ["b", "c"], { durationMinutes: 15, notBefore: "09:20", priority: -2 }),
      standard("a2", "A", ["shared", "d"], { durationMinutes: 20, minimumRestMinutes: 0, preferredRestMinutes: 25, dependencyIds: ["a1"], priority: -1 }),
    ],
  });
  const first = result.assignments.find((row) => row.unitId === "a1")!;
  const filler = result.assignments.find((row) => row.unitId === "b1")!;
  const second = result.assignments.find((row) => row.unitId === "a2")!;
  expect(filler.startAt).toBe(first.endAt);
  expect(second.startAt).toBe(filler.endAt);
});

it("releases courts from a short anchored category to the next queue item", () => {
  const result = generateGlobalTournamentSchedule({
    settings: { ...base, dailyStart: "09:00", dailyEnd: "12:00", courtCount: 4, minimumRestSlots: 0, preferredRestSlots: 0 },
    units: [
      standard("a1", "A", ["a1","a2"], { durationMinutes: 30, notBefore: "09:00", maxConcurrentCourts: 2, priority: -1, continuityKey: "A" }),
      standard("a2", "A", ["a3","a4"], { durationMinutes: 30, notBefore: "09:00", maxConcurrentCourts: 2, priority: -1, continuityKey: "A" }),
      standard("a3", "A", ["a5","a6"], { durationMinutes: 30, notBefore: "09:00", maxConcurrentCourts: 2, priority: -1, continuityKey: "A" }),
      standard("b1", "B", ["b1","b2"], { durationMinutes: 15, notBefore: "09:00", maxConcurrentCourts: 2, priority: -2, continuityKey: "B" }),
      standard("b2", "B", ["b3","b4"], { durationMinutes: 15, notBefore: "09:00", maxConcurrentCourts: 2, priority: -2, continuityKey: "B" }),
      standard("c1", "C", ["c1","c2"], { durationMinutes: 20, notBefore: "09:00", maxConcurrentCourts: 2, priority: -3, continuityKey: "C" }),
      standard("c2", "C", ["c3","c4"], { durationMinutes: 20, notBefore: "09:00", maxConcurrentCourts: 2, priority: -3, continuityKey: "C" }),
    ],
  });
  const atNine = result.assignments.filter((row) => row.startAt === new Date("2026-11-15T09:00:00").getTime());
  expect(atNine.filter((row) => row.categoryId === "A")).toHaveLength(2);
  expect(atNine.filter((row) => row.categoryId === "B")).toHaveLength(2);
  const cStart = Math.min(...result.assignments.filter((row) => row.categoryId === "C").map((row) => row.startAt));
  expect(cStart).toBe(new Date("2026-11-15T09:15:00").getTime());
});
