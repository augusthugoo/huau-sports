import type {
  CompetitionEncounter,
  EncounterStage,
  ScheduleCategory,
  ScheduleItem,
  ScheduleResult,
  TournamentScheduleSettings,
} from "./types";

function parseTime(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${twoDigits(h)}:${twoDigits(m)}`;
}

function addDays(dateString: string, days: number): string {
  const [year = "1970", month = "1", day = "1"] = dateString.split("-");
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

function daysBetween(start: string, end: string): number {
  const [ay = "1970", am = "1", ad = "1"] = start.split("-");
  const [by = "1970", bm = "1", bd = "1"] = end.split("-");
  const a = new Date(Number(ay), Number(am) - 1, Number(ad));
  const b = new Date(Number(by), Number(bm) - 1, Number(bd));
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function workingDayMinutes(settings: TournamentScheduleSettings): number {
  return Math.max(10, 1440 - parseTime(settings.dailyStart));
}

function alignWorkingOffset(settings: TournamentScheduleSettings, offset: number, duration: number): number {
  const capacity = workingDayMinutes(settings);
  const safeDuration = Math.max(10, duration);
  let result = Math.max(0, offset);
  const minuteInDay = result % capacity;
  if (minuteInDay + safeDuration > capacity) result += capacity - minuteInDay;
  return result;
}

function advanceWorkingOffset(settings: TournamentScheduleSettings, offset: number, duration: number): number {
  const aligned = alignWorkingOffset(settings, offset, duration);
  return alignWorkingOffset(settings, aligned + duration, duration);
}

function offsetAfterBlocks(
  settings: TournamentScheduleSettings,
  startOffset: number,
  duration: number,
  blocks: number,
): number {
  let offset = alignWorkingOffset(settings, startOffset, duration);
  for (let index = 0; index < blocks; index += 1) offset = advanceWorkingOffset(settings, offset, duration);
  return offset;
}

function workingOffsetDateTime(settings: TournamentScheduleSettings, offset: number): { date: string; time: string } {
  const capacity = workingDayMinutes(settings);
  const dayOffset = Math.floor(Math.max(0, offset) / capacity);
  const minuteInDay = Math.max(0, offset) % capacity;
  return {
    date: addDays(settings.startDate, dayOffset),
    time: formatTime(parseTime(settings.dailyStart) + minuteInDay),
  };
}

function participantIds(match: CompetitionEncounter): string[] {
  return [...(match.entryA?.participantIds ?? []), ...(match.entryB?.participantIds ?? [])];
}

function sharesParticipantWithSelected(match: CompetitionEncounter, selected: CompetitionEncounter[]): boolean {
  const current = new Set(participantIds(match));
  return selected.some((candidate) => participantIds(candidate).some((id) => current.has(id)));
}

function chooseMatchForBlock(input: {
  queue: CompetitionEncounter[];
  selected: CompetitionEncounter[];
  lastBlockByParticipant: Map<string, number>;
  blockIndex: number;
  restSlots: number;
  enforceRest: boolean;
}): CompetitionEncounter | null {
  for (const match of input.queue) {
    if (sharesParticipantWithSelected(match, input.selected)) continue;
    if (input.enforceRest) {
      const violates = participantIds(match).some((id) => {
        const last = input.lastBlockByParticipant.get(id);
        return last !== undefined && input.blockIndex - last <= input.restSlots;
      });
      if (violates) continue;
    }
    return match;
  }
  return null;
}

function interleaveByGroup(matches: CompetitionEncounter[]): CompetitionEncounter[] {
  const buckets = new Map<string, CompetitionEncounter[]>();
  const keys: string[] = [];
  for (const match of matches) {
    const key = match.groupId ?? "A";
    if (!buckets.has(key)) {
      buckets.set(key, []);
      keys.push(key);
    }
    buckets.get(key)?.push(match);
  }
  const result: CompetitionEncounter[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const key of keys) {
      const value = buckets.get(key)?.shift();
      if (value) {
        result.push(value);
        remaining = true;
      }
    }
  }
  return result;
}

function scheduleOneLeg(input: {
  settings: TournamentScheduleSettings;
  categoryId: string;
  matches: CompetitionEncounter[];
  items: ScheduleItem[];
  startOffset: number;
  startBlock: number;
  duration: number;
  lastBlockByParticipant: Map<string, number>;
}): { nextOffset: number; nextBlock: number } {
  const queue = interleaveByGroup(input.matches);
  let currentOffset = alignWorkingOffset(input.settings, input.startOffset, input.duration);
  let blockIndex = input.startBlock;
  let safetyBlocks = 0;

  while (queue.length) {
    const selected: CompetitionEncounter[] = [];
    for (let court = 1; court <= input.settings.courtCount; court += 1) {
      let match = chooseMatchForBlock({
        queue,
        selected,
        lastBlockByParticipant: input.lastBlockByParticipant,
        blockIndex,
        restSlots: input.settings.preferredRestSlots,
        enforceRest: true,
      });
      if (!match) {
        match = chooseMatchForBlock({
          queue,
          selected,
          lastBlockByParticipant: input.lastBlockByParticipant,
          blockIndex,
          restSlots: input.settings.preferredRestSlots,
          enforceRest: false,
        });
      }
      if (!match) continue;

      queue.splice(queue.findIndex((candidate) => candidate.id === match?.id), 1);
      selected.push(match);
      const timing = workingOffsetDateTime(input.settings, currentOffset);
      input.items.push({
        encounterId: match.id,
        reserved: false,
        categoryId: input.categoryId,
        stage: "group",
        roundLabel: match.roundLabel,
        legNumber: match.legNumber,
        blockIndex,
        startOffset: currentOffset,
        durationMinutes: input.duration,
        court,
        date: timing.date,
        time: timing.time,
      });
      participantIds(match).forEach((id) => input.lastBlockByParticipant.set(id, blockIndex));
    }
    currentOffset = advanceWorkingOffset(input.settings, currentOffset, input.duration);
    blockIndex += 1;
    safetyBlocks += 1;
    if (safetyBlocks > 10_000) throw new Error("SCHEDULE_SAFETY_LIMIT");
  }

  return { nextOffset: currentOffset, nextBlock: blockIndex };
}

export function scheduleCategoryGroupMatches(input: {
  settings: TournamentScheduleSettings;
  categoryId: string;
  matches: CompetitionEncounter[];
  items: ScheduleItem[];
  startOffset: number;
  startBlock: number;
  duration: number;
  lastBlockByParticipant: Map<string, number>;
}): { nextOffset: number; nextBlock: number } {
  let cursor = { nextOffset: input.startOffset, nextBlock: input.startBlock };
  const legs = [...new Set(input.matches.map((match) => match.legNumber))].sort((a, b) => a - b);

  // Regression fix: scheduling is explicitly partitioned by leg. The next leg is not
  // eligible until the previous leg queue is completely empty.
  for (const legNumber of legs) {
    cursor = scheduleOneLeg({
      ...input,
      matches: input.matches.filter((match) => match.legNumber === legNumber),
      startOffset: cursor.nextOffset,
      startBlock: cursor.nextBlock,
    });
  }
  return cursor;
}

function standardKnockoutPlan(count: number): Array<{ stage: EncounterStage; roundLabel: string; count: number }> {
  if (count < 2) return [];
  const bracketSize = 2 ** Math.ceil(Math.log2(count));
  const totalRounds = Math.round(Math.log2(bracketSize));
  const plan: Array<{ stage: EncounterStage; roundLabel: string; count: number }> = [];
  for (let index = 0; index < totalRounds; index += 1) {
    const matchCount = index === 0 ? Math.max(1, count - bracketSize / 2) : bracketSize / 2 ** (index + 1);
    if (matchCount <= 0) continue;
    const remaining = totalRounds - index;
    const label = remaining === 1 ? "Final" : remaining === 2 ? "Semifinal" : remaining === 3 ? "Quarterfinal" : "Preliminary round";
    plan.push({ stage: remaining === 1 ? "final" : "playoff", roundLabel: label, count: Math.round(matchCount) });
  }
  return plan;
}

function effectiveQualifiedCount(category: ScheduleCategory): number {
  const format = category.competition.format;
  const entries = category.competition.groups.reduce((total, group) => total + group.entries.length, 0);
  if (format.playoffMode === "league_only") return entries;
  if (format.playoffMode === "top2_final") return Math.min(2, entries);
  if (format.playoffMode === "top4_semis") return Math.min(4, entries);
  if (format.playoffMode === "top3_step") return Math.min(3, entries);
  return Math.min(entries, format.qualifiersPerGroup * category.competition.groups.length + format.wildcardQualifiers);
}

function finalPlan(category: ScheduleCategory): Array<{ stage: EncounterStage; roundLabel: string; count: number }> {
  const format = category.competition.format;
  const entries = category.competition.groups.reduce((total, group) => total + group.entries.length, 0);
  const plan: Array<{ stage: EncounterStage; roundLabel: string; count: number }> = [];
  if (format.playoffMode === "league_only") return plan;
  if (format.playoffMode === "top2_final") {
    if (format.bronzeMatch && entries >= 4) plan.push({ stage: "bronze", roundLabel: "Third place", count: 1 });
    plan.push({ stage: "final", roundLabel: "Final", count: 1 });
    return plan;
  }
  if (format.playoffMode === "top4_semis") {
    plan.push({ stage: "playoff", roundLabel: "Semifinal", count: 2 });
    if (format.bronzeMatch) plan.push({ stage: "bronze", roundLabel: "Third place", count: 1 });
    plan.push({ stage: "final", roundLabel: "Final", count: 1 });
    return plan;
  }
  if (format.playoffMode === "top3_step") {
    return [
      { stage: "playoff", roundLabel: "Preliminary round", count: 1 },
      { stage: "final", roundLabel: "Final", count: 1 },
    ];
  }
  const main = standardKnockoutPlan(effectiveQualifiedCount(category));
  for (const round of main) {
    if (round.roundLabel === "Final" && format.bronzeMatch && effectiveQualifiedCount(category) >= 4) {
      plan.push({ stage: "bronze", roundLabel: "Third place", count: 1 });
    }
    plan.push(round);
  }
  return plan;
}

function consolationPlan(category: ScheduleCategory): Array<{ stage: EncounterStage; roundLabel: string; count: number }> {
  const format = category.competition.format;
  if (format.consolationMode !== "knockout" || format.playoffMode === "league_only") return [];
  const total = category.competition.groups.reduce((sum, group) => sum + group.entries.length, 0);
  const count = Math.max(0, total - effectiveQualifiedCount(category));
  return standardKnockoutPlan(count).map((item) => ({
    stage: "consolation" as const,
    roundLabel: `Consolation · ${item.roundLabel}`,
    count: item.count,
  }));
}

function reserveFinalPhase(input: {
  settings: TournamentScheduleSettings;
  category: ScheduleCategory;
  items: ScheduleItem[];
  startOffset: number;
  startBlock: number;
}): { nextOffset: number; nextBlock: number } {
  const plan = [...consolationPlan(input.category), ...finalPlan(input.category)];
  let currentOffset = alignWorkingOffset(input.settings, input.startOffset, input.category.matchMinutes);
  let blockIndex = input.startBlock;

  for (let index = 0; index < plan.length; index += 1) {
    const round = plan[index];
    if (!round) continue;
    const nextRound = plan[index + 1];
    const simultaneousMedals =
      input.category.competition.format.medalSchedule === "simultaneous" &&
      input.settings.courtCount >= 2 &&
      round.stage === "bronze" &&
      nextRound?.stage === "final";
    const medalDuration = input.category.competition.format.medal.bestOf === 3 ? input.category.matchMinutes * 2 : input.category.matchMinutes;

    if (simultaneousMedals && nextRound) {
      currentOffset = alignWorkingOffset(input.settings, currentOffset, medalDuration);
      const timing = workingOffsetDateTime(input.settings, currentOffset);
      input.items.push({
        encounterId: null,
        reserved: true,
        categoryId: input.category.categoryId,
        stage: "bronze",
        roundLabel: round.roundLabel,
        legNumber: 1,
        blockIndex,
        startOffset: currentOffset,
        durationMinutes: medalDuration,
        court: 1,
        date: timing.date,
        time: timing.time,
      });
      input.items.push({
        encounterId: null,
        reserved: true,
        categoryId: input.category.categoryId,
        stage: "final",
        roundLabel: nextRound.roundLabel,
        legNumber: 1,
        blockIndex,
        startOffset: currentOffset,
        durationMinutes: medalDuration,
        court: 2,
        date: timing.date,
        time: timing.time,
      });
      currentOffset = offsetAfterBlocks(input.settings, currentOffset, medalDuration, 1);
      blockIndex += 1;
      index += 1;
      continue;
    }

    const isMedal = round.stage === "bronze" || round.stage === "final";
    const duration = isMedal ? medalDuration : input.category.matchMinutes;
    currentOffset = alignWorkingOffset(input.settings, currentOffset, duration);
    for (let matchIndex = 0; matchIndex < round.count; matchIndex += 1) {
      const batch = Math.floor(matchIndex / input.settings.courtCount);
      const startOffset = offsetAfterBlocks(input.settings, currentOffset, duration, batch);
      const timing = workingOffsetDateTime(input.settings, startOffset);
      input.items.push({
        encounterId: null,
        reserved: true,
        categoryId: input.category.categoryId,
        stage: round.stage,
        roundLabel: round.roundLabel,
        legNumber: 1,
        blockIndex: blockIndex + batch,
        startOffset,
        durationMinutes: duration,
        court: (matchIndex % input.settings.courtCount) + 1,
        date: timing.date,
        time: timing.time,
      });
    }
    const batches = Math.ceil(round.count / input.settings.courtCount);
    currentOffset = offsetAfterBlocks(input.settings, currentOffset, duration, batches);
    blockIndex += batches;
  }
  return { nextOffset: currentOffset, nextBlock: blockIndex };
}

export function generateTournamentSchedule(input: {
  settings: TournamentScheduleSettings;
  categories: ScheduleCategory[];
}): ScheduleResult {
  const settings: TournamentScheduleSettings = {
    ...input.settings,
    courtCount: Math.max(1, Math.trunc(input.settings.courtCount)),
    preferredRestSlots: Math.max(0, Math.trunc(input.settings.preferredRestSlots)),
  };
  const items: ScheduleItem[] = [];
  const categoryWindows: ScheduleResult["categoryWindows"] = {};
  const dayCursor = new Map<string, number>();
  const dayBlock = new Map<string, number>();
  const dayLastBlockByParticipant = new Map<string, Map<string, number>>();
  const categories = [...input.categories].sort(
    (a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.order - b.order,
  );

  for (const category of categories) {
    const date = category.scheduledDate;
    const dayOffset = daysBetween(settings.startDate, date);
    const dayStartOffset = dayOffset * workingDayMinutes(settings);
    const cursor = dayCursor.get(date) ?? dayStartOffset;
    const block = dayBlock.get(date) ?? dayOffset * 10_000;
    const lastBlock = dayLastBlockByParticipant.get(date) ?? new Map<string, number>();
    dayLastBlockByParticipant.set(date, lastBlock);
    const categoryStart = alignWorkingOffset(settings, cursor, category.matchMinutes);
    const groupMatches = category.competition.encounters.filter((encounter) => encounter.stage === "group");

    let result = scheduleCategoryGroupMatches({
      settings,
      categoryId: category.categoryId,
      matches: groupMatches,
      items,
      startOffset: categoryStart,
      startBlock: block,
      duration: category.matchMinutes,
      lastBlockByParticipant: lastBlock,
    });
    result = reserveFinalPhase({
      settings,
      category,
      items,
      startOffset: result.nextOffset,
      startBlock: result.nextBlock,
    });

    dayCursor.set(date, result.nextOffset);
    dayBlock.set(date, result.nextBlock);
    categoryWindows[category.categoryId] = {
      startOffset: categoryStart,
      endOffset: result.nextOffset,
      date,
    };
  }

  items.sort((a, b) => a.startOffset - b.startOffset || a.court - b.court);
  return { items, categoryWindows };
}
