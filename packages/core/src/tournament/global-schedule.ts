export type GlobalScheduleKind = "standard" | "team";

export type GlobalScheduleRubber = {
  id: string;
  label: string;
  durationMinutes: number;
  conditional?: boolean;
};

export type GlobalScheduleUnit = {
  id: string;
  categoryId: string;
  categoryName?: string;
  kind: GlobalScheduleKind;
  date: string;
  stage: string;
  roundLabel?: string | null;
  roundNumber?: number | null;
  legNumber?: number | null;
  barrierKey?: string | null;
  participants: string[];
  dependencyIds?: string[];
  durationMinutes: number;
  minimumRestSlots?: number;
  preferredRestSlots?: number;
  priority?: number;
  groupId?: string | null;
  groupName?: string | null;
  policyPhase?: number | null;
  policySequenceKey?: string | null;
  policySequenceIndex?: number | null;
  allowedCourts?: number[];
  preferredCourts?: number[];
  exclusiveCourts?: number[];
  maxConcurrentCourts?: number | null;
  rubbers?: GlobalScheduleRubber[];
};

export type GlobalScheduleLock = {
  unitId: string;
  court: number;
  startAt: number;
  endAt: number;
};

export type GlobalScheduleClosedCourt = {
  court: number;
  startAt: number;
  endAt: number;
  label?: string;
};

export type GlobalScheduleBreak = {
  startAt: number;
  endAt: number;
  label?: string;
};

export type GlobalScheduleSettings = {
  dailyStart: string;
  dailyEnd: string;
  courtCount: number;
  defaultMatchMinutes: number;
  minimumRestSlots: number;
  preferredRestSlots?: number;
  stepMinutes?: number;
  regenerateOnlyUnlocked?: boolean;
};

export type GlobalScheduleRubberAssignment = GlobalScheduleRubber & {
  startAt: number;
  endAt: number;
};

export type GlobalScheduleAssignment = {
  unitId: string;
  categoryId: string;
  kind: GlobalScheduleKind;
  court: number;
  startAt: number;
  endAt: number;
  locked: boolean;
  rubbers: GlobalScheduleRubberAssignment[];
};

export type GlobalScheduleConflict = {
  unitId: string;
  code:
    | "SCHEDULE_EXCEEDS_DAILY_END"
    | "SCHEDULE_DEPENDENCY_UNRESOLVED"
    | "SCHEDULE_LOCK_CONFLICT"
    | "SCHEDULE_INVALID_WINDOW";
  message: string;
};

export type GlobalScheduleResult = {
  assignments: GlobalScheduleAssignment[];
  conflicts: GlobalScheduleConflict[];
  unscheduledUnitIds: string[];
  complete: boolean;
};

const MINUTE = 60_000;

function parseClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`INVALID_CLOCK:${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`INVALID_CLOCK:${value}`);
  }
  return hour * 60 + minute;
}

function localDateMinute(date: string, minuteOfDay: number): number {
  const day = new Date(`${date}T00:00:00`);
  if (Number.isNaN(day.getTime())) throw new Error(`INVALID_DATE:${date}`);
  day.setMinutes(minuteOfDay);
  return day.getTime();
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

function assignmentDuration(unit: GlobalScheduleUnit) {
  if (unit.kind === "team" && unit.rubbers?.length) {
    return unit.rubbers.reduce((sum, rubber) => sum + Math.max(1, rubber.durationMinutes), 0);
  }
  return Math.max(1, unit.durationMinutes);
}

function expandRubbers(unit: GlobalScheduleUnit, startAt: number): GlobalScheduleRubberAssignment[] {
  if (unit.kind !== "team" || !unit.rubbers?.length) return [];
  let cursor = startAt;
  return unit.rubbers.map((rubber) => {
    const endAt = cursor + Math.max(1, rubber.durationMinutes) * MINUTE;
    const assignment = { ...rubber, startAt: cursor, endAt };
    cursor = endAt;
    return assignment;
  });
}

function participantRestOk(
  unit: GlobalScheduleUnit,
  startAt: number,
  endAt: number,
  assignments: GlobalScheduleAssignment[],
  unitsById: Map<string, GlobalScheduleUnit>,
  settings: GlobalScheduleSettings,
  preferred: boolean,
) {
  const unitParticipants = new Set(unit.participants.filter(Boolean));
  if (!unitParticipants.size) return true;
  const slots = preferred
    ? Math.max(unit.preferredRestSlots ?? settings.preferredRestSlots ?? unit.minimumRestSlots ?? settings.minimumRestSlots, unit.minimumRestSlots ?? settings.minimumRestSlots)
    : Math.max(0, unit.minimumRestSlots ?? settings.minimumRestSlots);
  const restMs = slots * Math.max(1, settings.defaultMatchMinutes) * MINUTE;
  if (restMs <= 0) return true;

  return assignments.every((assignment) => {
    const other = unitsById.get(assignment.unitId);
    if (!other) return true;
    const shared = other.participants.some((participant) => unitParticipants.has(participant));
    if (!shared) return true;
    if (intervalsOverlap(startAt, endAt, assignment.startAt, assignment.endAt)) return false;
    if (assignment.endAt <= startAt) return startAt - assignment.endAt >= restMs;
    if (endAt <= assignment.startAt) return assignment.startAt - endAt >= restMs;
    return false;
  });
}

function courtFree(
  court: number,
  startAt: number,
  endAt: number,
  assignments: GlobalScheduleAssignment[],
  closedCourts: GlobalScheduleClosedCourt[],
  breaks: GlobalScheduleBreak[],
) {
  if (assignments.some((assignment) => assignment.court === court && intervalsOverlap(startAt, endAt, assignment.startAt, assignment.endAt))) {
    return false;
  }
  if (closedCourts.some((closed) => closed.court === court && intervalsOverlap(startAt, endAt, closed.startAt, closed.endAt))) {
    return false;
  }
  if (breaks.some((pause) => intervalsOverlap(startAt, endAt, pause.startAt, pause.endAt))) return false;
  return true;
}

function dependenciesReady(
  unit: GlobalScheduleUnit,
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
  unitsById: Map<string, GlobalScheduleUnit>,
) {
  return (unit.dependencyIds ?? []).every(
    (dependencyId) => !unitsById.has(dependencyId) || assignmentsByUnit.has(dependencyId),
  );
}

function dependencyEnd(unit: GlobalScheduleUnit, assignmentsByUnit: Map<string, GlobalScheduleAssignment>) {
  return Math.max(
    0,
    ...(unit.dependencyIds ?? []).map((dependencyId) => assignmentsByUnit.get(dependencyId)?.endAt ?? 0),
  );
}

function lowerBarrierUnits(unit: GlobalScheduleUnit, units: GlobalScheduleUnit[]) {
  if (!unit.barrierKey || !unit.legNumber || unit.legNumber <= 1) return [];
  return units.filter(
    (candidate) =>
      candidate.id !== unit.id &&
      candidate.barrierKey === unit.barrierKey &&
      Number(candidate.legNumber ?? 1) < Number(unit.legNumber ?? 1),
  );
}

function barrierReady(
  unit: GlobalScheduleUnit,
  units: GlobalScheduleUnit[],
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
) {
  return lowerBarrierUnits(unit, units).every((candidate) => assignmentsByUnit.has(candidate.id));
}

function barrierEnd(
  unit: GlobalScheduleUnit,
  units: GlobalScheduleUnit[],
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
) {
  return Math.max(
    0,
    ...lowerBarrierUnits(unit, units).map(
      (candidate) => assignmentsByUnit.get(candidate.id)?.endAt ?? 0,
    ),
  );
}

function lowerPolicyPhaseUnits(unit: GlobalScheduleUnit, units: GlobalScheduleUnit[]) {
  const phase = Number(unit.policyPhase ?? 0);
  if (phase <= 1) return [];
  return units.filter(
    (candidate) =>
      candidate.id !== unit.id &&
      candidate.date === unit.date &&
      Number(candidate.policyPhase ?? 0) > 0 &&
      Number(candidate.policyPhase ?? 0) < phase,
  );
}

function policyPhaseReady(
  unit: GlobalScheduleUnit,
  units: GlobalScheduleUnit[],
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
) {
  return lowerPolicyPhaseUnits(unit, units).every((candidate) => assignmentsByUnit.has(candidate.id));
}

function policyPhaseEnd(
  unit: GlobalScheduleUnit,
  units: GlobalScheduleUnit[],
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
) {
  return Math.max(
    0,
    ...lowerPolicyPhaseUnits(unit, units).map(
      (candidate) => assignmentsByUnit.get(candidate.id)?.endAt ?? 0,
    ),
  );
}

function lowerPolicySequenceUnits(unit: GlobalScheduleUnit, units: GlobalScheduleUnit[]) {
  const key = unit.policySequenceKey;
  const index = Number(unit.policySequenceIndex ?? 0);
  if (!key || index <= 1) return [];
  return units.filter(
    (candidate) =>
      candidate.id !== unit.id &&
      candidate.date === unit.date &&
      candidate.policySequenceKey === key &&
      Number(candidate.policySequenceIndex ?? 0) > 0 &&
      Number(candidate.policySequenceIndex ?? 0) < index,
  );
}

function policySequenceReady(
  unit: GlobalScheduleUnit,
  units: GlobalScheduleUnit[],
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
) {
  return lowerPolicySequenceUnits(unit, units).every((candidate) => assignmentsByUnit.has(candidate.id));
}

function policySequenceEnd(
  unit: GlobalScheduleUnit,
  units: GlobalScheduleUnit[],
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
) {
  return Math.max(
    0,
    ...lowerPolicySequenceUnits(unit, units).map(
      (candidate) => assignmentsByUnit.get(candidate.id)?.endAt ?? 0,
    ),
  );
}

function exclusiveCourtOwners(units: GlobalScheduleUnit[], courtCount: number) {
  const owners = new Map<number, Set<string>>();
  for (const unit of units) {
    for (const court of unit.exclusiveCourts ?? []) {
      const value = Math.trunc(Number(court));
      if (value < 1 || value > courtCount) continue;
      const set = owners.get(value) ?? new Set<string>();
      set.add(unit.categoryId);
      owners.set(value, set);
    }
  }
  return owners;
}

function courtOrder(
  unit: GlobalScheduleUnit,
  courtCount: number,
  exclusiveOwners: Map<number, Set<string>>,
) {
  const all = Array.from({ length: courtCount }, (_, index) => index + 1);
  const valid = (values: number[] | undefined) => [...new Set((values ?? [])
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => value >= 1 && value <= courtCount))];
  const exclusive = valid(unit.exclusiveCourts);
  const allowed = valid(unit.allowedCourts);
  let base = exclusive.length ? exclusive : allowed.length ? allowed : all;
  base = base.filter((court) => {
    const owners = exclusiveOwners.get(court);
    return !owners?.size || owners.has(unit.categoryId);
  });
  const preferred = valid(unit.preferredCourts).filter((court) => base.includes(court));
  return [...preferred, ...base.filter((court) => !preferred.includes(court))];
}

function categoryConcurrencyOk(
  unit: GlobalScheduleUnit,
  startAt: number,
  endAt: number,
  assignments: GlobalScheduleAssignment[],
) {
  const max = Number(unit.maxConcurrentCourts ?? 0);
  if (!Number.isFinite(max) || max <= 0) return true;
  const simultaneous = assignments.filter(
    (assignment) =>
      assignment.categoryId === unit.categoryId &&
      intervalsOverlap(startAt, endAt, assignment.startAt, assignment.endAt),
  ).length;
  return simultaneous < max;
}

function unitOrderScore(unit: GlobalScheduleUnit, categoryCounts: Map<string, number>) {
  const stageWeight = unit.stage === "group" ? 0 : unit.stage === "playoff" ? 20 : unit.stage === "bronze" ? 30 : unit.stage === "final" ? 40 : 10;
  return (unit.priority ?? 0) * -1000 + stageWeight + (categoryCounts.get(unit.categoryId) ?? 0) * 3 + Number(unit.roundNumber ?? 0) + Number(unit.legNumber ?? 0) * 2;
}

function candidateTimes(date: string, settings: GlobalScheduleSettings, earliestAt: number) {
  const startMinute = parseClock(settings.dailyStart);
  const endMinute = parseClock(settings.dailyEnd);
  if (endMinute <= startMinute) return [];
  const startAt = Math.max(localDateMinute(date, startMinute), earliestAt);
  const endAt = localDateMinute(date, endMinute);
  const step = Math.max(1, settings.stepMinutes ?? 5) * MINUTE;
  const rounded = Math.ceil(startAt / step) * step;
  const values: number[] = [];
  for (let cursor = rounded; cursor < endAt; cursor += step) values.push(cursor);
  return values;
}

export function generateGlobalTournamentSchedule(input: {
  settings: GlobalScheduleSettings;
  units: GlobalScheduleUnit[];
  locks?: GlobalScheduleLock[];
  closedCourts?: GlobalScheduleClosedCourt[];
  breaks?: GlobalScheduleBreak[];
}): GlobalScheduleResult {
  const settings = input.settings;
  const courtCount = Math.max(1, Math.trunc(settings.courtCount));
  const units = [...input.units];
  const unitsById = new Map(units.map((unit) => [unit.id, unit] as const));
  const assignments: GlobalScheduleAssignment[] = [];
  const conflicts: GlobalScheduleConflict[] = [];
  const assignmentsByUnit = new Map<string, GlobalScheduleAssignment>();
  const closedCourts = input.closedCourts ?? [];
  const breaks = input.breaks ?? [];
  const exclusiveOwners = exclusiveCourtOwners(units, courtCount);

  for (const lock of input.locks ?? []) {
    const unit = unitsById.get(lock.unitId);
    if (!unit) continue;
    const dayStart = localDateMinute(unit.date, parseClock(settings.dailyStart));
    const dayEnd = localDateMinute(unit.date, parseClock(settings.dailyEnd));
    const invalid =
      lock.court < 1 ||
      lock.court > courtCount ||
      lock.startAt < dayStart ||
      lock.endAt > dayEnd ||
      lock.endAt <= lock.startAt ||
      !courtOrder(unit, courtCount, exclusiveOwners).includes(lock.court) ||
      !courtFree(lock.court, lock.startAt, lock.endAt, assignments, closedCourts, breaks) ||
      !categoryConcurrencyOk(unit, lock.startAt, lock.endAt, assignments) ||
      !participantRestOk(unit, lock.startAt, lock.endAt, assignments, unitsById, settings, false);
    if (invalid) {
      conflicts.push({
        unitId: unit.id,
        code: "SCHEDULE_LOCK_CONFLICT",
        message: `El bloque bloqueado ${unit.id} entra en conflicto con cancha, horario o descanso mínimo.`,
      });
      continue;
    }
    const assignment: GlobalScheduleAssignment = {
      unitId: unit.id,
      categoryId: unit.categoryId,
      kind: unit.kind,
      court: lock.court,
      startAt: lock.startAt,
      endAt: lock.endAt,
      locked: true,
      rubbers: expandRubbers(unit, lock.startAt),
    };
    assignments.push(assignment);
    assignmentsByUnit.set(unit.id, assignment);
  }

  const pending = units.filter((unit) => !assignmentsByUnit.has(unit.id));
  const categoryCounts = new Map<string, number>();
  assignments.forEach((assignment) => categoryCounts.set(assignment.categoryId, (categoryCounts.get(assignment.categoryId) ?? 0) + 1));

  let progress = true;
  while (pending.some((unit) => !assignmentsByUnit.has(unit.id)) && progress) {
    progress = false;
    const ready = pending
      .filter((unit) => !assignmentsByUnit.has(unit.id))
      .filter((unit) => dependenciesReady(unit, assignmentsByUnit, unitsById))
      .filter((unit) => barrierReady(unit, units, assignmentsByUnit))
      .filter((unit) => policyPhaseReady(unit, units, assignmentsByUnit))
      .filter((unit) => policySequenceReady(unit, units, assignmentsByUnit))
      .sort((a, b) => unitOrderScore(a, categoryCounts) - unitOrderScore(b, categoryCounts));

    for (const unit of ready) {
      const durationMs = assignmentDuration(unit) * MINUTE;
      const earliestAt = Math.max(
        dependencyEnd(unit, assignmentsByUnit),
        barrierEnd(unit, units, assignmentsByUnit),
        policyPhaseEnd(unit, units, assignmentsByUnit),
        policySequenceEnd(unit, units, assignmentsByUnit),
      );
      const dayEnd = localDateMinute(unit.date, parseClock(settings.dailyEnd));
      let best: { court: number; startAt: number; preferred: boolean } | null = null;

      for (const preferred of [true, false]) {
        for (const startAt of candidateTimes(unit.date, settings, earliestAt)) {
          const endAt = startAt + durationMs;
          if (endAt > dayEnd) break;
          if (!categoryConcurrencyOk(unit, startAt, endAt, assignments)) continue;
          for (const court of courtOrder(unit, courtCount, exclusiveOwners)) {
            if (!courtFree(court, startAt, endAt, assignments, closedCourts, breaks)) continue;
            if (!participantRestOk(unit, startAt, endAt, assignments, unitsById, settings, false)) continue;
            if (preferred && !participantRestOk(unit, startAt, endAt, assignments, unitsById, settings, true)) continue;
            best = { court, startAt, preferred };
            break;
          }
          if (best) break;
        }
        if (best) break;
      }

      if (!best) continue;
      const assignment: GlobalScheduleAssignment = {
        unitId: unit.id,
        categoryId: unit.categoryId,
        kind: unit.kind,
        court: best.court,
        startAt: best.startAt,
        endAt: best.startAt + durationMs,
        locked: false,
        rubbers: expandRubbers(unit, best.startAt),
      };
      assignments.push(assignment);
      assignmentsByUnit.set(unit.id, assignment);
      categoryCounts.set(unit.categoryId, (categoryCounts.get(unit.categoryId) ?? 0) + 1);
      progress = true;
    }
  }

  for (const assignment of assignments) {
    const unit = unitsById.get(assignment.unitId);
    if (!unit) continue;
    const dependencyViolation = (unit.dependencyIds ?? []).some((dependencyId) => {
      if (!unitsById.has(dependencyId)) return false;
      const dependency = assignmentsByUnit.get(dependencyId);
      return !dependency || dependency.endAt > assignment.startAt;
    });
    const barrierViolation = lowerBarrierUnits(unit, units).some((candidate) => {
      const previous = assignmentsByUnit.get(candidate.id);
      return !previous || previous.endAt > assignment.startAt;
    });
    if (dependencyViolation || barrierViolation) {
      conflicts.push({
        unitId: unit.id,
        code: assignment.locked ? "SCHEDULE_LOCK_CONFLICT" : "SCHEDULE_DEPENDENCY_UNRESOLVED",
        message: assignment.locked
          ? `El bloque bloqueado ${unit.id} empieza antes de que termine una dependencia o vuelta previa.`
          : `El bloque ${unit.id} empieza antes de que termine una dependencia o vuelta previa.`,
      });
    }
  }

  const unscheduled = pending.filter((unit) => !assignmentsByUnit.has(unit.id));
  for (const unit of unscheduled) {
    const unresolved =
      (unit.dependencyIds ?? []).some(
        (dependencyId) => unitsById.has(dependencyId) && !assignmentsByUnit.has(dependencyId),
      ) ||
      !policyPhaseReady(unit, units, assignmentsByUnit) ||
      !policySequenceReady(unit, units, assignmentsByUnit);
    conflicts.push({
      unitId: unit.id,
      code: unresolved ? "SCHEDULE_DEPENDENCY_UNRESOLVED" : "SCHEDULE_EXCEEDS_DAILY_END",
      message: unresolved
        ? `No se pudo programar ${unit.id} porque una dependencia anterior no quedó programada.`
        : `No entra el bloque ${unit.id} antes de ${settings.dailyEnd} respetando canchas, bloqueos y descanso mínimo.`,
    });
  }

  assignments.sort((a, b) => a.startAt - b.startAt || a.court - b.court || a.unitId.localeCompare(b.unitId));
  return {
    assignments,
    conflicts,
    unscheduledUnitIds: unscheduled.map((unit) => unit.id),
    complete: unscheduled.length === 0 && conflicts.every((conflict) => conflict.code !== "SCHEDULE_LOCK_CONFLICT"),
  };
}
