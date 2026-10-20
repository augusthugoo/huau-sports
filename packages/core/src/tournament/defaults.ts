import type {
  StandardCompetitionFormat,
  StandardStandingCriterion,
} from "./types";

export const DEFAULT_STANDARD_STANDINGS_CRITERIA: StandardStandingCriterion[] = [
  "head_to_head",
  "mini_wins",
  "mini_diff",
  "point_diff",
  "points_for",
  "rating",
];

const STANDARD_STANDING_CRITERIA = new Set<StandardStandingCriterion>(
  DEFAULT_STANDARD_STANDINGS_CRITERIA,
);

export function normalizeStandardStandingCriteria(
  input: unknown,
): StandardStandingCriterion[] {
  if (!Array.isArray(input)) {
    return [...DEFAULT_STANDARD_STANDINGS_CRITERIA];
  }

  const result: StandardStandingCriterion[] = [];

  for (const candidate of input) {
    if (
      typeof candidate === "string" &&
      STANDARD_STANDING_CRITERIA.has(candidate as StandardStandingCriterion) &&
      !result.includes(candidate as StandardStandingCriterion)
    ) {
      result.push(candidate as StandardStandingCriterion);
    }
  }

  return result.length
    ? result
    : [...DEFAULT_STANDARD_STANDINGS_CRITERIA];
}

export const DEFAULT_STANDARD_FORMAT: StandardCompetitionFormat = {
  groupRounds: 1,
  qualifiersPerGroup: 2,
  wildcardQualifiers: 0,
  crossGroupMethod: "normalized",
  standingsCriteria: [...DEFAULT_STANDARD_STANDINGS_CRITERIA],
  playoffMode: "standard",
  consolationMode: "none",
  avoidGroupRematches: true,
  bronzeMatch: true,
  medalSchedule: "sequential",
  finalDrawMethod: "performance",
  preliminary: { bestOf: 1, pointTarget: 15 },
  medal: { bestOf: 3, pointTarget: 11 },
  preferredRestSlots: 1,
};

export function normalizeStandardFormat(
  input: Partial<StandardCompetitionFormat> = {},
): StandardCompetitionFormat {
  return {
    ...DEFAULT_STANDARD_FORMAT,
    ...input,
    groupRounds: input.groupRounds === 2 ? 2 : 1,
    qualifiersPerGroup: Math.max(1, Math.trunc(input.qualifiersPerGroup ?? 2)),
    wildcardQualifiers: Math.max(0, Math.trunc(input.wildcardQualifiers ?? 0)),
    standingsCriteria: normalizeStandardStandingCriteria(input.standingsCriteria),
    preferredRestSlots: Math.max(0, Math.trunc(input.preferredRestSlots ?? 1)),
    preliminary: {
      bestOf: input.preliminary?.bestOf === 3 ? 3 : 1,
      pointTarget: Math.max(1, Math.trunc(input.preliminary?.pointTarget ?? 15)),
    },
    medal: {
      bestOf: input.medal?.bestOf === 3 ? 3 : 1,
      pointTarget: Math.max(1, Math.trunc(input.medal?.pointTarget ?? 11)),
    },
  };
}
