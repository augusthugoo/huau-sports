import type { StandardCompetitionFormat } from "./types";

export const DEFAULT_STANDARD_FORMAT: StandardCompetitionFormat = {
  groupRounds: 1,
  qualifiersPerGroup: 2,
  wildcardQualifiers: 0,
  crossGroupMethod: "normalized",
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
