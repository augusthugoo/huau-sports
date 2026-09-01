import type { ConsolationMode, CrossGroupMethod, FinalDrawMethod, MedalSchedule, PlayoffMode, StandardCompetitionFormat, TournamentEntry, TournamentGroup } from "./types";

export const LEGACY_CATEGORY_PRESETS = [
  "Singles Masculino A", "Singles Masculino B", "Singles Masculino C", "Singles Masculino +50", "Singles Masculino +60",
  "Singles Femenino A", "Singles Femenino B", "Singles Femenino C", "Singles Femenino +50", "Singles Femenino +60",
  "Dobles Masculino A", "Dobles Masculino B", "Dobles Masculino C", "Dobles Masculino +50", "Dobles Masculino +60",
  "Dobles Femenino A", "Dobles Femenino B", "Dobles Femenino C", "Dobles Femenino +50", "Dobles Femenino +60",
  "Dobles Mixto A", "Dobles Mixto B", "Dobles Mixto C", "Dobles Mixto +50", "Dobles Mixto +60",
] as const;

export type LegacySeedingMethod = "snake" | "manual" | "random" | "live";
export type LegacyPaymentType = "per_category" | "base_plus_extra" | "free";
export type LegacyPlayerPayment = "pending" | "paid";
export type LegacyPlayerStatus = "pending" | "confirmed";

export type LegacyTournamentSettings = {
  club: string;
  city: string;
  location: string;
  description: string;
  contact: string;
  dailyStart: string;
  dailyEnd: string;
  defaultMatchMinutes: number;
  paymentType: LegacyPaymentType;
  entryFeeMinor: number | null;
  baseFeeMinor: number | null;
  extraCategoryFeeMinor: number | null;
  registrationCloseAt: number | null;
  minimumGroup: number;
  preferredGroup: number;
  maximumGroup: number;
  suggestedQualifiersPerGroup: 0 | 1 | 2;
  seedingMethod: LegacySeedingMethod;
  minimumRestSlots: number;
};

export const DEFAULT_LEGACY_TOURNAMENT_SETTINGS: LegacyTournamentSettings = {
  club: "",
  city: "Piriápolis",
  location: "",
  description: "",
  contact: "",
  dailyStart: "09:00",
  dailyEnd: "20:00",
  defaultMatchMinutes: 30,
  paymentType: "per_category",
  entryFeeMinor: null,
  baseFeeMinor: null,
  extraCategoryFeeMinor: null,
  registrationCloseAt: null,
  minimumGroup: 3,
  preferredGroup: 4,
  maximumGroup: 4,
  suggestedQualifiersPerGroup: 2,
  seedingMethod: "snake",
  minimumRestSlots: 1,
};

export type LegacyFormatSimulatorInput = {
  entries: number;
  courts: number;
  availableMinutes: number;
  matchMinutes: number;
  minimumGroup: number;
  preferredGroup: number;
  maximumGroup: number;
  finalDrawMethod: FinalDrawMethod;
  avoidGroupRematches: boolean;
  bronzeMatch: boolean;
  medalBestOf: 1 | 3;
  medalSchedule: MedalSchedule;
  standardPointTarget: number;
  medalPointTarget: number;
  groupRounds: 1 | 2;
  crossGroupMethod: CrossGroupMethod;
  playoffMode: PlayoffMode;
  consolationMode: ConsolationMode;
  minimumGuaranteedMatches: number;
  wildcardQualifiers: number;
  requestedQualifiersPerGroup: 0 | 1 | 2;
};

export type LegacyFormatOption = {
  label: "Recomendada" | "Más rápida" | "Más partidos";
  entries: number;
  courts: number;
  groups: number;
  sizes: number[];
  qualifiersPerGroup: number;
  wildcardQualifiers: number;
  qualified: number;
  bracketSize: number;
  byes: number;
  matchMinutes: number;
  finalDrawMethod: FinalDrawMethod;
  avoidGroupRematches: boolean;
  bronzeMatch: boolean;
  medalBestOf: 1 | 3;
  medalSchedule: MedalSchedule;
  standardPointTarget: number;
  medalPointTarget: number;
  groupRounds: 1 | 2;
  crossGroupMethod: CrossGroupMethod;
  playoffMode: PlayoffMode;
  consolationMode: ConsolationMode;
  minimumGuaranteedMatches: number;
  groupMatches: number;
  finalMatches: number;
  consolationMatches: number;
  totalMatches: number;
  guaranteed: number;
  elapsedMinutes: number;
  fits: boolean;
  targetMet: boolean;
  scoreBalance: number;
};

export function balancedGroupSizes(entries: number, groups: number): number[] {
  const safeEntries = Math.max(0, Math.trunc(entries));
  const safeGroups = Math.max(1, Math.trunc(groups));
  const base = Math.floor(safeEntries / safeGroups);
  const remainder = safeEntries % safeGroups;
  return Array.from({ length: safeGroups }, (_, index) => base + (index < remainder ? 1 : 0)).sort((a, b) => a - b);
}

export function groupLabel(index: number): string {
  let value = Math.max(0, Math.trunc(index)) + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function calculateGroupMatchCountFromSizes(sizes: number[], groupRounds: 1 | 2): number {
  return sizes.reduce((sum, size) => sum + ((Math.max(0, size) * Math.max(0, size - 1)) / 2) * groupRounds, 0);
}

function nextPowerOfTwo(value: number) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function knockoutRoundCounts(entries: number): number[] {
  const count = Math.max(0, Math.trunc(entries));
  if (count < 2) return [];
  const bracket = nextPowerOfTwo(count);
  const counts: number[] = [];
  let current = count;
  const target = bracket / 2;
  const first = Math.max(0, current - target);
  if (first > 0) counts.push(first);
  current = target;
  while (current > 1) {
    counts.push(Math.floor(current / 2));
    current = Math.floor(current / 2);
  }
  return counts;
}

function effectiveQualified(option: Pick<LegacyFormatOption, "playoffMode" | "entries" | "groups" | "qualifiersPerGroup" | "wildcardQualifiers">): number {
  if (option.playoffMode === "league_only") return 0;
  if (option.playoffMode === "top2_final") return Math.min(option.entries, 2);
  if (option.playoffMode === "top3_step") return Math.min(option.entries, 3);
  if (option.playoffMode === "top4_semis") return Math.min(option.entries, 4);
  return Math.min(option.entries, option.groups * option.qualifiersPerGroup + option.wildcardQualifiers);
}

function mainFinalMatches(option: Pick<LegacyFormatOption, "playoffMode" | "qualified" | "bronzeMatch">): number {
  if (option.playoffMode === "league_only") return 0;
  if (option.playoffMode === "top2_final") return 1 + (option.bronzeMatch ? 1 : 0);
  if (option.playoffMode === "top3_step") return 2;
  if (option.playoffMode === "top4_semis") return 3 + (option.bronzeMatch ? 1 : 0);
  return Math.max(0, option.qualified - 1) + (option.bronzeMatch && option.qualified >= 4 ? 1 : 0);
}

function consolationMatches(option: Pick<LegacyFormatOption, "entries" | "qualified" | "consolationMode" | "playoffMode">): number {
  if (option.consolationMode !== "knockout" || option.playoffMode === "league_only") return 0;
  return Math.max(0, option.entries - option.qualified - 1);
}

function finalRoundCounts(option: LegacyFormatOption): Array<{ count: number; medal?: "bronze" | "final" }> {
  if (option.playoffMode === "league_only") return [];
  if (option.playoffMode === "top2_final") {
    const result: Array<{ count: number; medal?: "bronze" | "final" }> = [];
    if (option.bronzeMatch) result.push({ count: 1, medal: "bronze" });
    result.push({ count: 1, medal: "final" });
    return result;
  }
  if (option.playoffMode === "top3_step") return [{ count: 1 }, { count: 1, medal: "final" }];
  if (option.playoffMode === "top4_semis") {
    const result: Array<{ count: number; medal?: "bronze" | "final" }> = [{ count: 2 }];
    if (option.bronzeMatch) result.push({ count: 1, medal: "bronze" });
    result.push({ count: 1, medal: "final" });
    return result;
  }
  const roundCounts = knockoutRoundCounts(option.qualified);
  const rounds: Array<{ count: number; medal?: "bronze" | "final" }> = roundCounts.map((count, index) =>
    index === roundCounts.length - 1 ? { count, medal: "final" } : { count },
  );
  if (option.bronzeMatch && option.qualified >= 4) {
    const finalIndex = rounds.findIndex((round) => round.medal === "final");
    if (finalIndex >= 0) rounds.splice(finalIndex, 0, { count: 1, medal: "bronze" });
  }
  return rounds;
}

function estimatedBlocks(option: LegacyFormatOption): number {
  const courts = Math.max(1, option.courts);
  let blocks = 0;
  const consolationEntrants = Math.max(0, option.entries - option.qualified);
  for (const count of knockoutRoundCounts(option.consolationMode === "knockout" ? consolationEntrants : 0)) blocks += Math.ceil(count / courts);
  const rounds = finalRoundCounts(option);
  for (let index = 0; index < rounds.length; index += 1) {
    const current = rounds[index]!;
    const next = rounds[index + 1];
    if (option.medalSchedule === "simultaneous" && courts >= 2 && current.medal === "bronze" && next?.medal === "final") {
      blocks += Math.ceil((current.count + next.count) / courts);
      index += 1;
    } else {
      blocks += Math.ceil(current.count / courts);
    }
  }
  return blocks;
}

function medalExtraBlocks(option: LegacyFormatOption): number {
  if (option.medalBestOf !== 3) return 0;
  const medals = finalRoundCounts(option).filter((round) => round.medal).length;
  if (option.medalSchedule === "simultaneous" && option.courts >= 2 && medals >= 2) return 1;
  return medals;
}

function recalc(option: LegacyFormatOption, availableMinutes: number): LegacyFormatOption {
  option.groupMatches = calculateGroupMatchCountFromSizes(option.sizes, option.groupRounds);
  option.guaranteed = Math.max(0, ((option.sizes[0] ?? option.entries) - 1) * option.groupRounds);
  option.qualified = effectiveQualified(option);
  option.bracketSize = option.playoffMode === "league_only" ? 0 : nextPowerOfTwo(Math.max(2, option.qualified));
  option.byes = option.playoffMode === "standard" ? Math.max(0, option.bracketSize - option.qualified) : 0;
  if (option.playoffMode === "league_only" || option.playoffMode === "top3_step") option.bronzeMatch = false;
  option.finalMatches = mainFinalMatches(option);
  option.consolationMatches = consolationMatches(option);
  option.totalMatches = option.groupMatches + option.finalMatches + option.consolationMatches;
  option.elapsedMinutes = (Math.ceil(option.groupMatches / option.courts) + estimatedBlocks(option) + medalExtraBlocks(option)) * option.matchMinutes;
  option.fits = option.elapsedMinutes <= availableMinutes;
  option.targetMet = option.minimumGuaranteedMatches <= 0 || option.guaranteed >= option.minimumGuaranteedMatches;
  return option;
}

function sameFormat(a: LegacyFormatOption, b: LegacyFormatOption) {
  return a.groups === b.groups && a.qualifiersPerGroup === b.qualifiersPerGroup && a.totalMatches === b.totalMatches && a.playoffMode === b.playoffMode && a.groupRounds === b.groupRounds && a.wildcardQualifiers === b.wildcardQualifiers;
}

export function buildLegacyFormatOptions(raw: LegacyFormatSimulatorInput): LegacyFormatOption[] {
  const input: LegacyFormatSimulatorInput = {
    ...raw,
    entries: Math.max(2, Math.trunc(raw.entries || 0)),
    courts: Math.max(1, Math.trunc(raw.courts || 1)),
    availableMinutes: Math.max(0, Number(raw.availableMinutes || 0)),
    matchMinutes: Math.max(10, Math.trunc(raw.matchMinutes || 30)),
    minimumGroup: Math.max(2, Math.trunc(raw.minimumGroup || 3)),
    preferredGroup: Math.max(2, Math.trunc(raw.preferredGroup || 4)),
    maximumGroup: Math.max(2, Math.trunc(raw.maximumGroup || 4)),
    minimumGuaranteedMatches: Math.max(0, Math.trunc(raw.minimumGuaranteedMatches || 0)),
    wildcardQualifiers: Math.max(0, Math.trunc(raw.wildcardQualifiers || 0)),
    requestedQualifiersPerGroup: raw.requestedQualifiersPerGroup === 1 || raw.requestedQualifiersPerGroup === 2 ? raw.requestedQualifiersPerGroup : 0,
  };
  input.preferredGroup = Math.max(input.minimumGroup, input.preferredGroup);
  input.maximumGroup = Math.max(input.preferredGroup, input.maximumGroup);
  const candidates: LegacyFormatOption[] = [];
  for (let groups = 1; groups <= Math.min(26, input.entries); groups += 1) {
    if (input.playoffMode !== "standard" && groups !== 1) continue;
    const sizes = balancedGroupSizes(input.entries, groups);
    const minSize = sizes[0] ?? 0;
    const maxSize = sizes[sizes.length - 1] ?? 0;
    if (input.playoffMode === "standard" && (minSize < Math.max(2, input.minimumGroup - 1) || maxSize > input.maximumGroup)) continue;
    const qualifierOptions = input.playoffMode === "standard"
      ? [1, 2].filter((value) => value <= minSize && (!input.requestedQualifiersPerGroup || value === input.requestedQualifiersPerGroup))
      : [input.playoffMode === "league_only" ? input.entries : input.playoffMode === "top2_final" ? 2 : input.playoffMode === "top4_semis" ? 4 : 3];
    for (const q of qualifierOptions) {
      // V2.4.2 validates the requested wildcard total before capping
      // the persisted wildcard count for a valid candidate.
      const requestedQualified = input.playoffMode === "standard" ? groups * q + input.wildcardQualifiers : q;
      if (input.playoffMode !== "league_only" && (requestedQualified < 2 || requestedQualified > input.entries)) continue;
      const wildcard = input.playoffMode === "standard" ? Math.min(input.wildcardQualifiers, Math.max(0, input.entries - groups * q)) : 0;
      const initialQualified = input.playoffMode === "standard" ? Math.min(input.entries, requestedQualified) : q;
      const option: LegacyFormatOption = {
        label: "Recomendada",
        entries: input.entries,
        courts: input.courts,
        groups,
        sizes: [...sizes],
        qualifiersPerGroup: q,
        wildcardQualifiers: wildcard,
        qualified: initialQualified,
        bracketSize: input.playoffMode === "league_only" ? 0 : nextPowerOfTwo(Math.max(2, initialQualified)),
        byes: 0,
        matchMinutes: input.matchMinutes,
        finalDrawMethod: input.finalDrawMethod,
        avoidGroupRematches: input.avoidGroupRematches,
        bronzeMatch:
          input.bronzeMatch &&
          (input.playoffMode === "top2_final"
            ? input.entries >= 4
            : input.playoffMode === "top4_semis"
              ? true
              : input.playoffMode === "standard"
                ? initialQualified >= 4
                : false),
        medalBestOf: input.medalBestOf,
        medalSchedule: input.medalSchedule,
        standardPointTarget: Math.max(1, input.standardPointTarget),
        medalPointTarget: Math.max(1, input.medalPointTarget),
        groupRounds: input.groupRounds,
        crossGroupMethod: input.crossGroupMethod,
        playoffMode: input.playoffMode,
        consolationMode: input.consolationMode,
        minimumGuaranteedMatches: input.minimumGuaranteedMatches,
        groupMatches: 0,
        finalMatches: 0,
        consolationMatches: 0,
        totalMatches: 0,
        guaranteed: 0,
        elapsedMinutes: 0,
        fits: false,
        targetMet: false,
        scoreBalance: Math.abs((sizes.reduce((sum, value) => sum + value, 0) / sizes.length) - input.preferredGroup) + (maxSize - minSize) * 2 + (input.playoffMode === "standard" ? (q === 2 ? 0.25 : 0.7) : 0) + (input.groupRounds === 2 ? 0.2 : 0),
      };
      candidates.push(recalc(option, input.availableMinutes));
    }
  }
  if (!candidates.length && input.playoffMode === "standard") {
    candidates.push(recalc({
      label: "Recomendada", entries: input.entries, courts: input.courts, groups: 1, sizes: [input.entries], qualifiersPerGroup: Math.min(2, input.entries), wildcardQualifiers: 0,
      qualified: Math.min(2, input.entries), bracketSize: 2, byes: 0, matchMinutes: input.matchMinutes, finalDrawMethod: input.finalDrawMethod,
      avoidGroupRematches: input.avoidGroupRematches, bronzeMatch: false, medalBestOf: input.medalBestOf, medalSchedule: input.medalSchedule,
      standardPointTarget: input.standardPointTarget, medalPointTarget: input.medalPointTarget, groupRounds: input.groupRounds,
      crossGroupMethod: input.crossGroupMethod, playoffMode: "standard", consolationMode: input.consolationMode,
      minimumGuaranteedMatches: input.minimumGuaranteedMatches, groupMatches: 0, finalMatches: 0, consolationMatches: 0, totalMatches: 0,
      guaranteed: 0, elapsedMinutes: 0, fits: false, targetMet: false, scoreBalance: 99,
    }, input.availableMinutes));
  }
  const hasTarget = candidates.some((candidate) => candidate.targetMet);
  const eligible = (hasTarget ? candidates.filter((candidate) => candidate.targetMet) : candidates).slice();
  const result: LegacyFormatOption[] = [];
  const pushUnique = (candidate: LegacyFormatOption, label: LegacyFormatOption["label"]) => {
    const clone = { ...candidate, sizes: [...candidate.sizes], label };
    if (!result.some((existing) => sameFormat(existing, clone))) result.push(clone);
  };
  eligible.sort((a, b) => a.scoreBalance - b.scoreBalance || a.elapsedMinutes - b.elapsedMinutes);
  if (eligible[0]) pushUnique(eligible[0], "Recomendada");
  eligible.sort((a, b) => a.elapsedMinutes - b.elapsedMinutes || a.totalMatches - b.totalMatches);
  if (eligible[0]) pushUnique(eligible[0], "Más rápida");
  eligible.sort((a, b) => (a.fits === b.fits ? b.totalMatches - a.totalMatches || a.elapsedMinutes - b.elapsedMinutes : a.fits ? -1 : 1));
  if (eligible[0]) pushUnique(eligible[0], "Más partidos");
  return result;
}

export function legacyOptionToStandardFormat(option: LegacyFormatOption, preferredRestSlots = 1): StandardCompetitionFormat {
  return {
    groupRounds: option.groupRounds,
    qualifiersPerGroup: option.qualifiersPerGroup,
    wildcardQualifiers: option.wildcardQualifiers,
    crossGroupMethod: option.crossGroupMethod,
    playoffMode: option.playoffMode,
    consolationMode: option.consolationMode,
    avoidGroupRematches: option.avoidGroupRematches,
    bronzeMatch: option.bronzeMatch,
    medalSchedule: option.medalSchedule,
    finalDrawMethod: option.finalDrawMethod,
    preliminary: { bestOf: 1, pointTarget: option.standardPointTarget },
    medal: { bestOf: option.medalBestOf, pointTarget: option.medalPointTarget },
    preferredRestSlots: Math.max(0, Math.trunc(preferredRestSlots)),
  };
}

function distributeInLegacySnakeOrder(entries: TournamentEntry[], groupSizes: number[]): TournamentGroup[] {
  if (groupSizes.reduce((sum, value) => sum + Math.max(0, Math.trunc(value)), 0) !== entries.length) {
    throw new Error("GROUP_SIZE_MISMATCH");
  }
  const groups: TournamentGroup[] = groupSizes.map((_, index) => ({ id: `group-${index + 1}`, name: groupLabel(index), entries: [] }));
  let entryIndex = 0;
  let row = 0;
  while (entryIndex < entries.length) {
    const order = row % 2 === 0
      ? groups.map((_, groupIndex) => groupIndex)
      : groups.map((_, groupIndex) => groups.length - 1 - groupIndex);
    let placed = false;
    for (const groupIndex of order) {
      if (entryIndex >= entries.length) break;
      const group = groups[groupIndex]!;
      if (group.entries.length >= Math.max(0, Math.trunc(groupSizes[groupIndex] ?? 0))) continue;
      group.entries.push({ ...entries[entryIndex]!, participantIds: [...entries[entryIndex]!.participantIds] });
      entryIndex += 1;
      placed = true;
    }
    if (!placed) throw new Error("GROUP_SIZE_MISMATCH");
    row += 1;
  }
  return groups;
}

export function distributeEntriesRandomly(entries: TournamentEntry[], groupSizes: number[], random: () => number = Math.random): TournamentGroup[] {
  const shuffled = entries.map((entry) => ({ ...entry, participantIds: [...entry.participantIds] }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  // Shuffle the bowl first, then use the same alternating serpentine
  // placement while respecting the exact V2.4.2 group capacities.
  return distributeInLegacySnakeOrder(shuffled, groupSizes);
}

export function distributeEntriesSnake(entries: TournamentEntry[], groupSizes: number[]): TournamentGroup[] {
  const sorted = entries
    .map((entry) => ({ ...entry, participantIds: [...entry.participantIds] }))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  return distributeInLegacySnakeOrder(sorted, groupSizes);
}

export function groupsFromEntryIds(entries: TournamentEntry[], groupSizes: number[], orderedEntryIds: string[]): TournamentGroup[] {
  if (groupSizes.reduce((sum, value) => sum + value, 0) !== entries.length) throw new Error("GROUP_SIZE_MISMATCH");
  if (new Set(orderedEntryIds).size !== entries.length || orderedEntryIds.length !== entries.length) throw new Error("MANUAL_GROUP_ASSIGNMENT_INVALID");
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const groups: TournamentGroup[] = [];
  let cursor = 0;
  groupSizes.forEach((size, index) => {
    const groupEntries: TournamentEntry[] = [];
    for (let offset = 0; offset < size; offset += 1) {
      const entry = entryMap.get(orderedEntryIds[cursor++] ?? "");
      if (!entry) throw new Error("MANUAL_GROUP_ASSIGNMENT_INVALID");
      groupEntries.push({ ...entry, participantIds: [...entry.participantIds] });
    }
    groups.push({ id: `group-${index + 1}`, name: groupLabel(index), entries: groupEntries });
  });
  return groups;
}

export type LiveDrawState = {
  entryOrder: string[];
  targetSequence: string[];
  assignments: Record<string, string[]>;
  revealIndex: number;
  lastEntryId: string | null;
  lastGroup: string | null;
  status: "ready" | "running" | "complete";
};

export function createDrawTargetSequence(groupSizes: number[]): string[] {
  const remaining = groupSizes.map((value) => Math.max(0, Math.trunc(value)));
  const total = remaining.reduce((sum, value) => sum + value, 0);
  const result: string[] = [];
  while (result.length < total) {
    let added = false;
    remaining.forEach((count, index) => {
      if (count > 0) {
        result.push(groupLabel(index));
        remaining[index] = count - 1;
        added = true;
      }
    });
    if (!added) break;
  }
  return result;
}

export function createLiveDrawState(entryIds: string[], groupSizes: number[], random: () => number = Math.random): LiveDrawState {
  if (groupSizes.reduce((sum, value) => sum + value, 0) !== entryIds.length) throw new Error("GROUP_SIZE_MISMATCH");
  const order = [...entryIds];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  const assignments: Record<string, string[]> = {};
  groupSizes.forEach((_, index) => { assignments[groupLabel(index)] = []; });
  return { entryOrder: order, targetSequence: createDrawTargetSequence(groupSizes), assignments, revealIndex: 0, lastEntryId: null, lastGroup: null, status: "ready" };
}

export function advanceLiveDraw(state: LiveDrawState): LiveDrawState {
  if (state.status === "complete") return { ...state, assignments: Object.fromEntries(Object.entries(state.assignments).map(([key, value]) => [key, [...value]])) };
  const index = state.revealIndex;
  if (index >= state.entryOrder.length) return { ...state, status: "complete" };
  const entryId = state.entryOrder[index]!;
  const group = state.targetSequence[index]!;
  const assignments = Object.fromEntries(Object.entries(state.assignments).map(([key, value]) => [key, [...value]]));
  assignments[group] = [...(assignments[group] ?? []), entryId];
  const revealIndex = index + 1;
  return { ...state, assignments, revealIndex, lastEntryId: entryId, lastGroup: group, status: revealIndex >= state.entryOrder.length ? "complete" : "running" };
}
