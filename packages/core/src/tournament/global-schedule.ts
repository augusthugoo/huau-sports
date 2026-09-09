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
) {
  return (unit.dependencyIds ?? []).every((dependencyId) => assignmentsByUnit.has(dependencyId));
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
      !courtFree(lock.court, lock.startAt, lock.endAt, assignments, closedCourts, breaks) ||
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
      .filter((unit) => dependenciesReady(unit, assignmentsByUnit))
      .filter((unit) => barrierReady(unit, units, assignmentsByUnit))
      .sort((a, b) => unitOrderScore(a, categoryCounts) - unitOrderScore(b, categoryCounts));

    for (const unit of ready) {
      const durationMs = assignmentDuration(unit) * MINUTE;
      const earliestAt = Math.max(dependencyEnd(unit, assignmentsByUnit), barrierEnd(unit, units, assignmentsByUnit));
      const dayEnd = localDateMinute(unit.date, parseClock(settings.dailyEnd));
      let best: { court: number; startAt: number; preferred: boolean } | null = null;

      for (const preferred of [true, false]) {
        for (const startAt of candidateTimes(unit.date, settings, earliestAt)) {
          const endAt = startAt + durationMs;
          if (endAt > dayEnd) break;
          for (let court = 1; court <= courtCount; court += 1) {
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
    const unresolved = (unit.dependencyIds ?? []).some((dependencyId) => !assignmentsByUnit.has(dependencyId));
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
