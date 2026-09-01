import { calculateGroupStandings } from "./standings";
import type { Competition, CrossGroupStats, QualifiedEntry, StandingRow } from "./types";

function smallestGroupSize(competition: Competition): number {
  if (!competition.groups.length) return 0;
  return Math.min(...competition.groups.map((group) => group.entries.length));
}

export function crossGroupStatsForEntry(
  competition: Competition,
  groupId: string,
  entryId: string,
): CrossGroupStats | null {
  const group = competition.groups.find((candidate) => candidate.id === groupId);
  if (!group) return null;
  const standings = calculateGroupStandings(competition, groupId);
  const position = standings.findIndex((row) => row.entry.id === entryId) + 1;
  const standing = standings.find((row) => row.entry.id === entryId);
  if (!standing || position <= 0) return null;

  const method = competition.format.crossGroupMethod;
  const targetSize = smallestGroupSize(competition);
  const keep = new Set<string>();
  if (method === "equalized" && targetSize > 0) {
    standings.slice(0, targetSize).forEach((row) => keep.add(row.entry.id));
  }

  let played = 0;
  let wins = 0;
  let scored = 0;
  let conceded = 0;
  const consideredEncounterIds: string[] = [];
  const ignoredEncounterIds: string[] = [];

  for (const match of competition.encounters) {
    if (match.stage !== "group" || match.groupId !== groupId || match.status !== "finished") continue;
    if (match.entryA?.id !== entryId && match.entryB?.id !== entryId) continue;
    if (match.scoreA === null || match.scoreB === null) continue;

    const opponentId = match.entryA?.id === entryId ? match.entryB?.id : match.entryA?.id;
    const shouldIgnore =
      method === "equalized" && (!opponentId || !keep.has(entryId) || !keep.has(opponentId));
    if (shouldIgnore) {
      ignoredEncounterIds.push(match.id);
      continue;
    }

    const own = match.entryA?.id === entryId ? match.scoreA : match.scoreB;
    const opponent = match.entryA?.id === entryId ? match.scoreB : match.scoreA;
    played += 1;
    scored += own;
    conceded += opponent;
    if (own > opponent) wins += 1;
    consideredEncounterIds.push(match.id);
  }

  return {
    entry: standing.entry,
    groupId,
    groupName: group.name,
    position,
    played,
    wins,
    diff: scored - conceded,
    scored,
    winRate: played ? wins / played : 0,
    diffPerMatch: played ? (scored - conceded) / played : 0,
    scoredPerMatch: played ? scored / played : 0,
    consideredEncounterIds,
    ignoredEncounterIds,
    method,
  };
}

export function compareCrossGroupPerformanceDesc(a: CrossGroupStats, b: CrossGroupStats): number {
  return (
    b.winRate - a.winRate ||
    b.diffPerMatch - a.diffPerMatch ||
    b.scoredPerMatch - a.scoredPerMatch ||
    b.entry.rating - a.entry.rating ||
    a.entry.name.localeCompare(b.entry.name)
  );
}

function qualifiedFromStanding(
  competition: Competition,
  row: StandingRow,
  groupId: string,
): QualifiedEntry {
  const cross = crossGroupStatsForEntry(competition, groupId, row.entry.id);
  if (!cross) throw new Error("CROSS_GROUP_STATS_UNAVAILABLE");
  return cross;
}

export function qualifiedEntries(competition: Competition): QualifiedEntry[] {
  const byPosition = new Map<number, QualifiedEntry[]>();
  let maxPosition = 0;

  for (const group of competition.groups) {
    const standings = calculateGroupStandings(competition, group.id);
    standings.forEach((row, index) => {
      const position = index + 1;
      maxPosition = Math.max(maxPosition, position);
      const bucket = byPosition.get(position) ?? [];
      bucket.push(qualifiedFromStanding(competition, row, group.id));
      byPosition.set(position, bucket);
    });
  }

  const fixed: QualifiedEntry[] = [];
  const wildcards: QualifiedEntry[] = [];
  const q = Math.max(1, Math.trunc(competition.format.qualifiersPerGroup));
  const wildcardCount = Math.max(0, Math.trunc(competition.format.wildcardQualifiers));

  for (let position = 1; position <= q; position += 1) {
    const bucket = [...(byPosition.get(position) ?? [])].sort(compareCrossGroupPerformanceDesc);
    fixed.push(...bucket);
  }

  for (let position = q + 1; position <= maxPosition && wildcards.length < wildcardCount; position += 1) {
    const bucket = [...(byPosition.get(position) ?? [])].sort(compareCrossGroupPerformanceDesc);
    for (const entry of bucket) {
      if (wildcards.length >= wildcardCount) break;
      wildcards.push(entry);
    }
  }

  return [...fixed, ...wildcards];
}

export function nonQualifiedEntries(competition: Competition): QualifiedEntry[] {
  const qualifiedIds = new Set(qualifiedEntriesForMode(competition).map((entry) => entry.entry.id));
  const result: QualifiedEntry[] = [];
  for (const group of competition.groups) {
    const standings = calculateGroupStandings(competition, group.id);
    for (const row of standings) {
      if (qualifiedIds.has(row.entry.id)) continue;
      const value = qualifiedFromStanding(competition, row, group.id);
      result.push(value);
    }
  }
  return result.sort(compareCrossGroupPerformanceDesc);
}

export function qualifiedEntriesForMode(competition: Competition): QualifiedEntry[] {
  if (competition.format.playoffMode === "standard") return qualifiedEntries(competition);
  const group = competition.groups[0];
  if (!group) return [];
  const standings = calculateGroupStandings(competition, group.id);
  const limit =
    competition.format.playoffMode === "league_only"
      ? standings.length
      : competition.format.playoffMode === "top2_final"
        ? 2
        : competition.format.playoffMode === "top4_semis"
          ? 4
          : 3;

  return standings.slice(0, limit).map((row) => qualifiedFromStanding(competition, row, group.id));
}
