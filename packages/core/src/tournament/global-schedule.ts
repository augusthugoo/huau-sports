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
  dependencyRestSlots?: number;
  dependencyRestMinutes?: number;
  notBefore?: string | null;
  notAfter?: string | null;
  durationMinutes: number;
  minimumRestSlots?: number;
  preferredRestSlots?: number;
  minimumRestMinutes?: number;
  preferredRestMinutes?: number;
  priority?: number;
  groupId?: string | null;
  groupName?: string | null;
  policyPhase?: number | null;
  policySequenceKey?: string | null;
  policySequenceIndex?: number | null;
  continuityKey?: string | null;
  allowedCourts?: number[];
  preferredCourts?: number[];
  exclusiveCourts?: number[];
  maxConcurrentCourts?: number | null;
  reservationKey?: string | null;
  reservationMode?: "strict" | "flexible" | null;
  reservedCourts?: number | null;
  reservationBlock?: number | null;
  reservationOrder?: number | null;
  reservationAdaptive?: boolean | null;
  reservationRoundKey?: string | null;
  reservationRoundOrder?: number | null;
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
  minimumRestMinutes?: number;
  preferredRestMinutes?: number;
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

function restSlotMinutes(unit: GlobalScheduleUnit) {
  if (unit.kind === "team" && unit.rubbers?.length) {
    return Math.max(
      1,
      ...unit.rubbers.map((rubber) => Math.max(1, rubber.durationMinutes)),
    );
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

type ScheduleIndexes = {
  byCourt: Map<number, GlobalScheduleAssignment[]>;
  byCategory: Map<string, GlobalScheduleAssignment[]>;
  byParticipant: Map<string, GlobalScheduleAssignment[]>;
  continuityLastEnd: Map<string, number>;
  eventTimes: Set<number>;
};

function createScheduleIndexes(
  closedCourts: GlobalScheduleClosedCourt[],
  breaks: GlobalScheduleBreak[],
): ScheduleIndexes {
  return {
    byCourt: new Map(),
    byCategory: new Map(),
    byParticipant: new Map(),
    continuityLastEnd: new Map(),
    eventTimes: new Set([
      ...closedCourts.map((row) => row.endAt),
      ...breaks.map((row) => row.endAt),
    ]),
  };
}

function indexScheduleAssignment(
  indexes: ScheduleIndexes,
  assignment: GlobalScheduleAssignment,
  unit: GlobalScheduleUnit,
) {
  const courtRows = indexes.byCourt.get(assignment.court) ?? [];
  courtRows.push(assignment);
  indexes.byCourt.set(assignment.court, courtRows);

  const categoryRows = indexes.byCategory.get(unit.categoryId) ?? [];
  categoryRows.push(assignment);
  indexes.byCategory.set(unit.categoryId, categoryRows);

  for (const participant of new Set(unit.participants.filter(Boolean))) {
    const rows = indexes.byParticipant.get(participant) ?? [];
    rows.push(assignment);
    indexes.byParticipant.set(participant, rows);
  }

  if (unit.continuityKey) {
    const key = `${unit.date}:${unit.continuityKey}`;
    indexes.continuityLastEnd.set(
      key,
      Math.max(
        indexes.continuityLastEnd.get(key) ?? 0,
        assignment.endAt,
      ),
    );
  }

  indexes.eventTimes.add(assignment.endAt);
}

function restMsFor(
  unit: GlobalScheduleUnit,
  other: GlobalScheduleUnit,
  settings: GlobalScheduleSettings,
  preferred: boolean,
) {
  const hardMinutes = unit.minimumRestMinutes ?? settings.minimumRestMinutes;
  const targetMinutes = unit.preferredRestMinutes ?? settings.preferredRestMinutes;
  const explicitMinutes = preferred
    ? targetMinutes ?? hardMinutes
    : hardMinutes;

  const slots = preferred
    ? Math.max(
        unit.preferredRestSlots ??
          settings.preferredRestSlots ??
          unit.minimumRestSlots ??
          settings.minimumRestSlots,
        unit.minimumRestSlots ?? settings.minimumRestSlots,
      )
    : Math.max(0, unit.minimumRestSlots ?? settings.minimumRestSlots);

  return explicitMinutes !== undefined
    ? Math.max(0, Number(explicitMinutes)) * MINUTE
    : slots *
        Math.max(restSlotMinutes(unit), restSlotMinutes(other)) *
        MINUTE;
}

function participantRestOk(
  unit: GlobalScheduleUnit,
  startAt: number,
  endAt: number,
  indexes: ScheduleIndexes,
  unitsById: Map<string, GlobalScheduleUnit>,
  settings: GlobalScheduleSettings,
  preferred: boolean,
) {
  const seen = new Set<string>();

  for (const participant of new Set(unit.participants.filter(Boolean))) {
    for (const assignment of indexes.byParticipant.get(participant) ?? []) {
      if (seen.has(assignment.unitId)) continue;
      seen.add(assignment.unitId);

      const other = unitsById.get(assignment.unitId);
      if (!other) continue;

      if (
        intervalsOverlap(
          startAt,
          endAt,
          assignment.startAt,
          assignment.endAt,
        )
      ) {
        return false;
      }

      const restMs = restMsFor(unit, other, settings, preferred);
      if (
        assignment.endAt <= startAt &&
        startAt - assignment.endAt < restMs
      ) {
        return false;
      }
      if (
        endAt <= assignment.startAt &&
        assignment.startAt - endAt < restMs
      ) {
        return false;
      }
    }
  }

  return true;
}

function courtFree(
  court: number,
  startAt: number,
  endAt: number,
  indexes: ScheduleIndexes,
  closedCourts: GlobalScheduleClosedCourt[],
  breaks: GlobalScheduleBreak[],
) {
  if (
    (indexes.byCourt.get(court) ?? []).some((assignment) =>
      intervalsOverlap(
        startAt,
        endAt,
        assignment.startAt,
        assignment.endAt,
      ),
    )
  ) {
    return false;
  }
  if (
    closedCourts.some(
      (closed) =>
        closed.court === court &&
        intervalsOverlap(
          startAt,
          endAt,
          closed.startAt,
          closed.endAt,
        ),
    )
  ) {
    return false;
  }
  if (
    breaks.some((pause) =>
      intervalsOverlap(
        startAt,
        endAt,
        pause.startAt,
        pause.endAt,
      ),
    )
  ) {
    return false;
  }
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

function dependencyReadyAt(
  unit: GlobalScheduleUnit,
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
  unitsById: Map<string, GlobalScheduleUnit>,
) {
  const explicitMinutes = unit.dependencyRestMinutes;
  const slots = Math.max(0, Number(unit.dependencyRestSlots ?? 0));
  return Math.max(
    0,
    ...(unit.dependencyIds ?? []).map((dependencyId) => {
      const assignment = assignmentsByUnit.get(dependencyId);
      if (!assignment) return 0;
      const dependency = unitsById.get(dependencyId);
      const slotMinutes = dependency
        ? Math.max(restSlotMinutes(unit), restSlotMinutes(dependency))
        : restSlotMinutes(unit);
      const restMinutes =
        explicitMinutes !== undefined
          ? Math.max(0, Number(explicitMinutes))
          : slots * slotMinutes;
      return assignment.endAt + restMinutes * MINUTE;
    }),
  );
}

function dependencyPreferredReadyAt(
  unit: GlobalScheduleUnit,
  assignmentsByUnit: Map<string, GlobalScheduleAssignment>,
  unitsById: Map<string, GlobalScheduleUnit>,
) {
  const hardMinutes = unit.dependencyRestMinutes;
  const targetMinutes = unit.preferredRestMinutes;
  const slots = Math.max(
    Number(unit.dependencyRestSlots ?? 0),
    Number(unit.preferredRestSlots ?? unit.dependencyRestSlots ?? 0),
  );
  return Math.max(
    0,
    ...(unit.dependencyIds ?? []).map((dependencyId) => {
      const assignment = assignmentsByUnit.get(dependencyId);
      if (!assignment) return 0;
      const dependency = unitsById.get(dependencyId);
      const slotMinutes = dependency
        ? Math.max(restSlotMinutes(unit), restSlotMinutes(dependency))
        : restSlotMinutes(unit);
      const restMinutes =
        targetMinutes !== undefined || hardMinutes !== undefined
          ? Math.max(0, Number(targetMinutes ?? hardMinutes ?? 0))
          : slots * slotMinutes;
      return assignment.endAt + restMinutes * MINUTE;
    }),
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
  const owners = new Map<string, Set<string>>();
  for (const unit of units) {
    for (const court of unit.exclusiveCourts ?? []) {
      const value = Math.trunc(Number(court));
      if (value < 1 || value > courtCount) continue;
      const key = `${unit.date}:${value}`;
      const set = owners.get(key) ?? new Set<string>();
      set.add(unit.categoryId);
      owners.set(key, set);
    }
  }
  return owners;
}

function courtOrder(
  unit: GlobalScheduleUnit,
  courtCount: number,
  exclusiveOwners: Map<string, Set<string>>,
) {
  const all = Array.from({ length: courtCount }, (_, index) => index + 1);
  const valid = (values: number[] | undefined) => [...new Set((values ?? [])
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => value >= 1 && value <= courtCount))];
  const exclusive = valid(unit.exclusiveCourts);
  const allowed = valid(unit.allowedCourts);
  let base = exclusive.length ? exclusive : allowed.length ? allowed : all;
  base = base.filter((court) => {
    const owners = exclusiveOwners.get(`${unit.date}:${court}`);
    return !owners?.size || owners.has(unit.categoryId);
  });
  const preferred = valid(unit.preferredCourts).filter((court) => base.includes(court));
  return [...preferred, ...base.filter((court) => !preferred.includes(court))];
}

function categoryConcurrencyOk(
  unit: GlobalScheduleUnit,
  startAt: number,
  endAt: number,
  indexes: ScheduleIndexes,
) {
  const max = Number(unit.maxConcurrentCourts ?? 0);
  if (!Number.isFinite(max) || max <= 0) return true;

  let simultaneous = 0;
  for (const assignment of indexes.byCategory.get(unit.categoryId) ?? []) {
    if (
      intervalsOverlap(
        startAt,
        endAt,
        assignment.startAt,
        assignment.endAt,
      )
    ) {
      simultaneous += 1;
      if (simultaneous >= max) return false;
    }
  }
  return true;
}

type StrictReservationRoundState = {
  key: string;
  order: number;
  requested: number;
  totalUnits: number;
  assignedUnits: number;
  lastEnd: number;
};

type StrictReservationState = {
  key: string;
  date: string;
  block: number;
  order: number;
  requested: number;
  gateAt: number;
  totalUnits: number;
  assignedUnits: number;
  lastEnd: number;
  adaptive: boolean;
  rounds: Map<string, StrictReservationRoundState>;
};

type ReservationContext = {
  groupsByDate: Map<string, StrictReservationState[]>;
  strictGroupByUnitId: Map<string, StrictReservationState>;
  reservationKeyByUnitId: Map<string, string>;
  assignmentsByReservationKey: Map<string, GlobalScheduleAssignment[]>;
};

function buildReservationContext(
  units: GlobalScheduleUnit[],
  settings: GlobalScheduleSettings,
): ReservationContext {
  const byDateAndKey = new Map<string, StrictReservationState>();
  const strictGroupByUnitId = new Map<string, StrictReservationState>();
  const reservationKeyByUnitId = new Map<string, string>();

  for (const unit of units) {
    if (!unit.reservationKey) continue;
    reservationKeyByUnitId.set(unit.id, unit.reservationKey);
    if (unit.reservationMode !== "strict") continue;

    const requested = Math.max(
      0,
      Math.trunc(Number(unit.reservedCourts ?? 0)),
    );
    if (!requested) continue;

    const mapKey = `${unit.date}:${unit.reservationKey}`;
    const block = Math.max(1, Number(unit.reservationBlock ?? 1));
    const order = Math.max(1, Number(unit.reservationOrder ?? 999));
    const gateAt = localDateMinute(
      unit.date,
      parseClock(unit.notBefore ?? settings.dailyStart),
    );

    const group =
      byDateAndKey.get(mapKey) ?? {
        key: unit.reservationKey,
        date: unit.date,
        block,
        order,
        requested,
        gateAt,
        totalUnits: 0,
        assignedUnits: 0,
        lastEnd: 0,
        adaptive: false,
        rounds: new Map(),
      };

    group.block = Math.min(group.block, block);
    group.order = Math.min(group.order, order);
    group.requested = Math.max(group.requested, requested);
    group.gateAt = Math.min(group.gateAt, gateAt);
    group.totalUnits += 1;
    group.adaptive = group.adaptive || Boolean(unit.reservationAdaptive);

    const roundKey = String(
      unit.reservationRoundKey ??
        `${unit.stage}:${Math.max(1, Number(unit.roundNumber ?? 1))}`,
    );
    const roundOrder = Math.max(
      1,
      Number(
        unit.reservationRoundOrder ??
          unit.roundNumber ??
          1,
      ),
    );
    const round =
      group.rounds.get(roundKey) ?? {
        key: roundKey,
        order: roundOrder,
        requested,
        totalUnits: 0,
        assignedUnits: 0,
        lastEnd: 0,
      };
    round.order = Math.min(round.order, roundOrder);
    round.requested = Math.max(round.requested, requested);
    round.totalUnits += 1;
    group.rounds.set(roundKey, round);

    byDateAndKey.set(mapKey, group);
    strictGroupByUnitId.set(unit.id, group);
  }

  const groupsByDate = new Map<string, StrictReservationState[]>();
  for (const group of byDateAndKey.values()) {
    const rows = groupsByDate.get(group.date) ?? [];
    rows.push(group);
    groupsByDate.set(group.date, rows);
  }
  for (const rows of groupsByDate.values()) {
    rows.sort(
      (a, b) =>
        a.block - b.block ||
        a.order - b.order ||
        a.key.localeCompare(b.key),
    );
  }

  return {
    groupsByDate,
    strictGroupByUnitId,
    reservationKeyByUnitId,
    assignmentsByReservationKey: new Map(),
  };
}

function indexReservationAssignment(
  context: ReservationContext,
  assignment: GlobalScheduleAssignment,
  unit: GlobalScheduleUnit,
) {
  if (unit.reservationKey) {
    const key = `${unit.date}:${unit.reservationKey}`;
    const rows = context.assignmentsByReservationKey.get(key) ?? [];
    rows.push(assignment);
    context.assignmentsByReservationKey.set(key, rows);
  }

  const group = context.strictGroupByUnitId.get(unit.id);
  if (group) {
    group.assignedUnits += 1;
    group.lastEnd = Math.max(group.lastEnd, assignment.endAt);

    const roundKey = String(
      unit.reservationRoundKey ??
        `${unit.stage}:${Math.max(1, Number(unit.roundNumber ?? 1))}`,
    );
    const round = group.rounds.get(roundKey);
    if (round) {
      round.assignedUnits += 1;
      round.lastEnd = Math.max(round.lastEnd, assignment.endAt);
    }
  }
}

function reservationRequestedAt(
  group: StrictReservationState,
  startAt: number,
) {
  if (!group.adaptive) return group.requested;

  const activeRound = [...group.rounds.values()]
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.key.localeCompare(b.key),
    )
    .find(
      (round) =>
        !(
          round.assignedUnits >= round.totalUnits &&
          round.lastEnd <= startAt
        ),
    );

  if (!activeRound) return 0;

  return Math.max(
    0,
    Math.min(
      activeRound.requested,
      activeRound.totalUnits,
    ),
  );
}

function reservationCapacityOk(
  unit: GlobalScheduleUnit,
  startAt: number,
  endAt: number,
  indexes: ScheduleIndexes,
  context: ReservationContext,
  courtCount: number,
) {
  if (unit.reservationBlock === null || unit.reservationBlock === undefined) {
    return true;
  }

  const candidateBlock = Math.max(1, Number(unit.reservationBlock ?? 1));
  const allocations = new Map<string, number>();
  let remaining = courtCount;

  for (const group of context.groupsByDate.get(unit.date) ?? []) {
    if (group.block > candidateBlock) break;
    if (startAt < group.gateAt) continue;
    if (
      group.assignedUnits >= group.totalUnits &&
      group.lastEnd <= startAt
    ) {
      continue;
    }

    const requested = reservationRequestedAt(group, startAt);
    if (requested <= 0) continue;

    const allocation = Math.max(
      0,
      Math.min(requested, remaining),
    );
    allocations.set(group.key, allocation);
    remaining -= allocation;
  }

  const ownKey = unit.reservationKey ?? null;
  const ownAllocation = ownKey
    ? allocations.get(ownKey)
    : undefined;

  if (ownAllocation !== undefined) {
    if (ownAllocation <= 0) return false;
    let ownUsed = 0;
    for (
      const assignment of
        context.assignmentsByReservationKey.get(
          `${unit.date}:${ownKey}`,
        ) ?? []
    ) {
      if (
        intervalsOverlap(
          startAt,
          endAt,
          assignment.startAt,
          assignment.endAt,
        )
      ) {
        ownUsed += 1;
        if (ownUsed >= ownAllocation) return false;
      }
    }
    return true;
  }

  if (remaining <= 0) return false;

  let outsiderUsed = 0;
  for (const rows of indexes.byCourt.values()) {
    for (const assignment of rows) {
      if (
        !intervalsOverlap(
          startAt,
          endAt,
          assignment.startAt,
          assignment.endAt,
        )
      ) {
        continue;
      }

      const key = context.reservationKeyByUnitId.get(assignment.unitId);
      if (!key || !allocations.has(key)) {
        outsiderUsed += 1;
        if (outsiderUsed >= remaining) return false;
      }
    }
  }

  return true;
}

function stageOrder(unit: GlobalScheduleUnit) {
  if (unit.stage === "group") return 0;
  if (unit.stage === "playoff") return 1;
  if (unit.stage === "bronze") return 2;
  if (unit.stage === "final") return 3;
  return 1;
}

function compareReadyUnits(
  a: GlobalScheduleUnit,
  b: GlobalScheduleUnit,
  indexes: ScheduleIndexes,
) {
  // Compatibilidad con la política actual: un priority mayor va primero.
  const priority = Number(b.priority ?? 0) - Number(a.priority ?? 0);
  if (priority !== 0) return priority;

  const lastFor = (unit: GlobalScheduleUnit) =>
    unit.continuityKey
      ? indexes.continuityLastEnd.get(
          `${unit.date}:${unit.continuityKey}`,
        ) ?? 0
      : 0;

  const lastA = lastFor(a);
  const lastB = lastFor(b);

  // Sólo desempata candidatos que pueden entrar en el mismo wave. Una
  // categoría ya iniciada conserva pulso, pero nunca deja una cancha ociosa
  // si otra categoría legal puede jugar antes.
  if (Boolean(a.continuityKey) || Boolean(b.continuityKey)) {
    if (Boolean(lastA) !== Boolean(lastB)) return lastA ? -1 : 1;
    if (lastA !== lastB) return lastB - lastA;
  }

  const stage = stageOrder(a) - stageOrder(b);
  if (stage !== 0) return stage;

  const round = Number(a.roundNumber ?? 0) - Number(b.roundNumber ?? 0);
  if (round !== 0) return round;

  const leg = Number(a.legNumber ?? 0) - Number(b.legNumber ?? 0);
  if (leg !== 0) return leg;

  return a.id.localeCompare(b.id);
}

function unitEndMinute(unit: GlobalScheduleUnit, settings: GlobalScheduleSettings) {
  const dailyEnd = parseClock(settings.dailyEnd);
  return unit.notAfter
    ? Math.min(dailyEnd, parseClock(unit.notAfter))
    : dailyEnd;
}

function unitEndAt(unit: GlobalScheduleUnit, settings: GlobalScheduleSettings) {
  return localDateMinute(unit.date, unitEndMinute(unit, settings));
}

function candidateTimes(
  unit: GlobalScheduleUnit,
  settings: GlobalScheduleSettings,
  earliestAt: number,
  indexes: ScheduleIndexes,
  unitsById: Map<string, GlobalScheduleUnit>,
  latestAt = Number.POSITIVE_INFINITY,
) {
  const dayStartMinute = parseClock(settings.dailyStart);
  const unitStartMinute = unit.notBefore
    ? parseClock(unit.notBefore)
    : dayStartMinute;
  const startMinute = Math.max(dayStartMinute, unitStartMinute);
  const endMinute = unitEndMinute(unit, settings);
  if (endMinute <= startMinute) return [];

  const startAt = Math.max(
    localDateMinute(unit.date, startMinute),
    earliestAt,
  );
  const endAt = localDateMinute(unit.date, endMinute);
  const step = Math.max(1, settings.stepMinutes ?? 5) * MINUTE;
  const values = new Set<number>();

  const add = (value: number) => {
    if (!Number.isFinite(value)) return;
    const rounded = Math.ceil(value / step) * step;
    if (
      rounded >= startAt &&
      rounded < endAt &&
      rounded <= latestAt
    ) {
      values.add(rounded);
    }
  };

  add(startAt);

  for (const value of indexes.eventTimes) {
    add(value);
  }

  const seen = new Set<string>();
  for (const participant of new Set(unit.participants.filter(Boolean))) {
    for (const assignment of indexes.byParticipant.get(participant) ?? []) {
      if (seen.has(assignment.unitId)) continue;
      seen.add(assignment.unitId);
      const other = unitsById.get(assignment.unitId);
      if (!other) continue;
      add(
        assignment.endAt +
          restMsFor(unit, other, settings, false),
      );
    }
  }

  return [...values].sort((a, b) => a - b);
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
  const indexes = createScheduleIndexes(closedCourts, breaks);
  const reservationContext = buildReservationContext(units, settings);

  const indexAssignment = (
    assignment: GlobalScheduleAssignment,
    unit: GlobalScheduleUnit,
  ) => {
    indexScheduleAssignment(indexes, assignment, unit);
    indexReservationAssignment(
      reservationContext,
      assignment,
      unit,
    );
  };

  for (const lock of input.locks ?? []) {
    const unit = unitsById.get(lock.unitId);
    if (!unit) continue;
    const dayStart = localDateMinute(unit.date, parseClock(settings.dailyStart));
    const unitStart = unit.notBefore
      ? localDateMinute(unit.date, parseClock(unit.notBefore))
      : dayStart;
    const dayEnd = unitEndAt(unit, settings);
    const invalid =
      lock.court < 1 ||
      lock.court > courtCount ||
      lock.startAt < Math.max(dayStart, unitStart) ||
      lock.endAt > dayEnd ||
      lock.endAt <= lock.startAt ||
      !courtOrder(unit, courtCount, exclusiveOwners).includes(lock.court) ||
      !courtFree(lock.court, lock.startAt, lock.endAt, indexes, closedCourts, breaks) ||
      !categoryConcurrencyOk(unit, lock.startAt, lock.endAt, indexes) ||
      !reservationCapacityOk(
        unit,
        lock.startAt,
        lock.endAt,
        indexes,
        reservationContext,
        courtCount,
      ) ||
      !participantRestOk(unit, lock.startAt, lock.endAt, indexes, unitsById, settings, false);
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
    indexAssignment(assignment, unit);
  }

  const pending = units.filter((unit) => !assignmentsByUnit.has(unit.id));

  let progress = true;
  while (pending.some((unit) => !assignmentsByUnit.has(unit.id)) && progress) {
    progress = false;

    const ready = pending
      .filter((unit) => !assignmentsByUnit.has(unit.id))
      .filter((unit) => dependenciesReady(unit, assignmentsByUnit, unitsById))
      .filter((unit) => barrierReady(unit, units, assignmentsByUnit))
      .filter((unit) => policyPhaseReady(unit, units, assignmentsByUnit))
      .filter((unit) => policySequenceReady(unit, units, assignmentsByUnit))
      .sort((a, b) => compareReadyUnits(a, b, indexes));

    const candidates: Array<{
      unit: GlobalScheduleUnit;
      court: number;
      startAt: number;
      preferred: boolean;
    }> = [];
    let earliestCandidateStart = Number.POSITIVE_INFINITY;

    for (const unit of ready) {
      const durationMs = assignmentDuration(unit) * MINUTE;
      const earliestAt = Math.max(
        dependencyReadyAt(unit, assignmentsByUnit, unitsById),
        barrierEnd(unit, units, assignmentsByUnit),
        policyPhaseEnd(unit, units, assignmentsByUnit),
        policySequenceEnd(unit, units, assignmentsByUnit),
      );
      const dayEnd = unitEndAt(unit, settings);
      let best: { court: number; startAt: number; preferred: boolean } | null = null;

      for (const startAt of candidateTimes(
        unit,
        settings,
        earliestAt,
        indexes,
        unitsById,
        earliestCandidateStart,
      )) {
        const endAt = startAt + durationMs;
        if (endAt > dayEnd) break;
        if (!categoryConcurrencyOk(unit, startAt, endAt, indexes)) continue;
        if (!reservationCapacityOk(
          unit,
          startAt,
          endAt,
          indexes,
          reservationContext,
          courtCount,
        )) continue;

        for (const court of courtOrder(unit, courtCount, exclusiveOwners)) {
          if (!courtFree(court, startAt, endAt, indexes, closedCourts, breaks)) {
            continue;
          }
          if (!participantRestOk(
            unit,
            startAt,
            endAt,
            indexes,
            unitsById,
            settings,
            false,
          )) {
            continue;
          }
          const preferred =
            startAt >= dependencyPreferredReadyAt(unit, assignmentsByUnit, unitsById) &&
            participantRestOk(
              unit,
              startAt,
              endAt,
              indexes,
              unitsById,
              settings,
              true,
            );
          best = { court, startAt, preferred };
          break;
        }
        if (best) break;
      }

      if (!best) continue;
      if (best.startAt < earliestCandidateStart) {
        earliestCandidateStart = best.startAt;
        candidates.length = 0;
      }
      if (best.startAt === earliestCandidateStart) {
        candidates.push({ unit, ...best });
      }
    }

    if (!candidates.length) continue;

    candidates.sort(
      (a, b) =>
        Number(b.preferred) - Number(a.preferred) ||
        compareReadyUnits(a.unit, b.unit, indexes) ||
        a.court - b.court ||
        a.unit.id.localeCompare(b.unit.id),
    );

    const chosen = candidates[0]!;
    const durationMs = assignmentDuration(chosen.unit) * MINUTE;
    const assignment: GlobalScheduleAssignment = {
      unitId: chosen.unit.id,
      categoryId: chosen.unit.categoryId,
      kind: chosen.unit.kind,
      court: chosen.court,
      startAt: chosen.startAt,
      endAt: chosen.startAt + durationMs,
      locked: false,
      rubbers: expandRubbers(chosen.unit, chosen.startAt),
    };
    assignments.push(assignment);
    assignmentsByUnit.set(chosen.unit.id, assignment);
    indexAssignment(assignment, chosen.unit);
    progress = true;
  }

  for (const assignment of assignments) {
    const unit = unitsById.get(assignment.unitId);
    if (!unit) continue;
    const dependencyViolation = (unit.dependencyIds ?? []).some((dependencyId) => {
      if (!unitsById.has(dependencyId)) return false;
      const dependency = assignmentsByUnit.get(dependencyId);
      return !dependency || dependency.endAt > assignment.startAt;
    });
    const dependencyRestViolation =
      dependencyReadyAt(unit, assignmentsByUnit, unitsById) > assignment.startAt;
    const barrierViolation = lowerBarrierUnits(unit, units).some((candidate) => {
      const previous = assignmentsByUnit.get(candidate.id);
      return !previous || previous.endAt > assignment.startAt;
    });
    if (dependencyViolation || dependencyRestViolation || barrierViolation) {
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
        : `No entra el bloque ${unit.id} antes de ${unit.notAfter ?? settings.dailyEnd} respetando canchas, bloqueos y descanso mínimo.`,
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
