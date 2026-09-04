import type { TeamFormat, TeamStandingRow } from "./types";

export type TeamGroupStandingSnapshot = {
  groupId: string;
  groupName: string;
  rows: TeamStandingRow[];
};

export type TeamQualifiedEntry = TeamStandingRow & {
  groupId: string;
  groupName: string;
  position: number;
};

export type TeamFinalEncounterStage = "playoff" | "bronze" | "final";
export type TeamFinalEncounterStatus = "pending" | "ready" | "bye";

export type TeamFinalEncounterPlan = {
  id: string;
  stage: TeamFinalEncounterStage;
  roundLabel: string;
  roundNumber: number;
  entryAId: string | null;
  entryBId: string | null;
  sourceEncounterAId: string | null;
  sourceEncounterBId: string | null;
  sourceLoserAId: string | null;
  sourceLoserBId: string | null;
  status: TeamFinalEncounterStatus;
  winnerEntryId: string | null;
};

export type TeamFinalPhasePlan = {
  playoffMode: TeamFormat["competition"]["playoffMode"];
  qualifiers: TeamQualifiedEntry[];
  encounters: TeamFinalEncounterPlan[];
};

export function teamKnockoutRoundLabel(totalRounds: number, index: number): string {
  const remaining = totalRounds - index;
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semifinal";
  if (remaining === 3) return "Quarterfinal";
  return `Round of ${2 ** remaining}`;
}

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < Math.max(1, value)) power *= 2;
  return power;
}

function standardSeedOrder(size: number): number[] {
  if (size <= 1) return [1];
  let order = [1, 2];
  while (order.length < size) {
    const next: number[] = [];
    const sum = order.length * 2 + 1;
    for (const seed of order) next.push(seed, sum - seed);
    order = next;
  }
  return order;
}

function performanceCompare(a: TeamQualifiedEntry, b: TeamQualifiedEntry): number {
  const aPlayed = Math.max(1, a.played);
  const bPlayed = Math.max(1, b.played);
  return (
    b.winRate - a.winRate ||
    b.rubberDiff / bPlayed - a.rubberDiff / aPlayed ||
    b.pointDiff / bPlayed - a.pointDiff / aPlayed ||
    b.pointsFor / bPlayed - a.pointsFor / aPlayed ||
    a.entryName.localeCompare(b.entryName) ||
    a.entryId.localeCompare(b.entryId)
  );
}

function groupRows(standings: TeamGroupStandingSnapshot[]): TeamQualifiedEntry[] {
  return standings.flatMap((standing) =>
    standing.rows.map((row, index) => ({
      ...row,
      groupId: standing.groupId,
      groupName: standing.groupName,
      position: index + 1,
    })),
  );
}

export function qualifyTeamEntries(
  format: TeamFormat,
  standings: TeamGroupStandingSnapshot[],
): TeamQualifiedEntry[] {
  const all = groupRows(standings);
  const mode = format.competition.playoffMode;
  if (mode === "league_only") return [];

  if (mode !== "standard") {
    if (standings.length !== 1) throw new Error("TEAM_PLAYOFF_MODE_REQUIRES_SINGLE_GROUP");
    const count = mode === "top2_final" ? (format.competition.bronzeMatch ? 4 : 2) : mode === "top3_step" ? 3 : 4;
    return all.filter((row) => row.position <= count).sort((a, b) => a.position - b.position);
  }

  const qualifiersPerGroup = Math.max(1, Math.trunc(format.competition.qualifiersPerGroup ?? 2));
  const wildcardQualifiers = Math.max(0, Math.trunc(format.competition.wildcardQualifiers ?? 0));
  const fixed = all.filter((row) => row.position <= qualifiersPerGroup);
  if (!wildcardQualifiers) {
    return fixed.sort((a, b) => a.position - b.position || performanceCompare(a, b));
  }
  const wildcardPool = all
    .filter((row) => row.position > qualifiersPerGroup)
    .sort((a, b) => a.position - b.position || performanceCompare(a, b));
  return [...fixed, ...wildcardPool.slice(0, wildcardQualifiers)].sort(
    (a, b) => a.position - b.position || performanceCompare(a, b),
  );
}

function planEncounter(input: Partial<TeamFinalEncounterPlan> & Pick<TeamFinalEncounterPlan, "id" | "stage" | "roundLabel" | "roundNumber">): TeamFinalEncounterPlan {
  const entryAId = input.entryAId ?? null;
  const entryBId = input.entryBId ?? null;
  const sourceEncounterAId = input.sourceEncounterAId ?? null;
  const sourceEncounterBId = input.sourceEncounterBId ?? null;
  const sourceLoserAId = input.sourceLoserAId ?? null;
  const sourceLoserBId = input.sourceLoserBId ?? null;
  const directCount = Number(Boolean(entryAId)) + Number(Boolean(entryBId));
  const hasSources = Boolean(sourceEncounterAId || sourceEncounterBId || sourceLoserAId || sourceLoserBId);
  const status: TeamFinalEncounterStatus = input.status ?? (directCount === 2 ? "ready" : directCount === 1 && !hasSources ? "bye" : "pending");
  const winnerEntryId = input.winnerEntryId ?? (status === "bye" ? entryAId ?? entryBId : null);
  return {
    id: input.id,
    stage: input.stage,
    roundLabel: input.roundLabel,
    roundNumber: input.roundNumber,
    entryAId,
    entryBId,
    sourceEncounterAId,
    sourceEncounterBId,
    sourceLoserAId,
    sourceLoserBId,
    status,
    winnerEntryId,
  };
}

function seedStandardBracket(qualifiers: TeamQualifiedEntry[], bracketSize: number): Array<TeamQualifiedEntry | null> {
  const seeded = [...qualifiers].sort((a, b) => a.position - b.position || performanceCompare(a, b));
  const bySeed = new Map<number, TeamQualifiedEntry | null>();
  seeded.forEach((entry, index) => bySeed.set(index + 1, entry));
  const slots = standardSeedOrder(bracketSize).map((seed) => bySeed.get(seed) ?? null);

  // Best effort: avoid an immediate same-group rematch by swapping lower-seeded sides.
  for (let index = 0; index < slots.length; index += 2) {
    const left = slots[index];
    const right = slots[index + 1];
    if (!left || !right || left.groupId !== right.groupId) continue;
    for (let candidateIndex = index + 3; candidateIndex < slots.length; candidateIndex += 2) {
      const candidate = slots[candidateIndex];
      const candidateOpponent = slots[candidateIndex - 1];
      if (!candidate) continue;
      if (candidate.groupId === left.groupId) continue;
      if (candidateOpponent && right.groupId === candidateOpponent.groupId) continue;
      slots[index + 1] = candidate;
      slots[candidateIndex] = right;
      break;
    }
  }
  return slots;
}

function standardPlayoff(format: TeamFormat, qualifiers: TeamQualifiedEntry[]): TeamFinalEncounterPlan[] {
  if (qualifiers.length < 2) return [];
  const bracketSize = nextPowerOfTwo(qualifiers.length);
  const totalRounds = Math.round(Math.log2(bracketSize));
  const slots = seedStandardBracket(qualifiers, bracketSize);
  const encounters: TeamFinalEncounterPlan[] = [];
  let previous: TeamFinalEncounterPlan[] = [];

  for (let index = 0; index < bracketSize / 2; index += 1) {
    const stage: TeamFinalEncounterStage = totalRounds === 1 ? "final" : "playoff";
    const encounter = planEncounter({
      id: `team:playoff:r1:m${index + 1}`,
      stage,
      roundLabel: teamKnockoutRoundLabel(totalRounds, 0),
      roundNumber: 1,
      entryAId: slots[index * 2]?.entryId ?? null,
      entryBId: slots[index * 2 + 1]?.entryId ?? null,
    });
    previous.push(encounter);
    encounters.push(encounter);
  }

  for (let round = 1; round < totalRounds; round += 1) {
    const current: TeamFinalEncounterPlan[] = [];
    for (let index = 0; index < previous.length; index += 2) {
      const left = previous[index];
      const right = previous[index + 1];
      if (!left || !right) continue;
      const isFinal = round === totalRounds - 1;
      const encounter = planEncounter({
        id: `team:playoff:r${round + 1}:m${Math.floor(index / 2) + 1}`,
        stage: isFinal ? "final" : "playoff",
        roundLabel: teamKnockoutRoundLabel(totalRounds, round),
        roundNumber: round + 1,
        sourceEncounterAId: left.id,
        sourceEncounterBId: right.id,
      });
      current.push(encounter);
      encounters.push(encounter);
    }
    previous = current;
  }

  if (format.competition.bronzeMatch && qualifiers.length >= 4) {
    const semifinals = encounters.filter((encounter) => encounter.roundLabel === "Semifinal");
    if (semifinals.length >= 2) {
      encounters.push(
        planEncounter({
          id: "team:playoff:bronze",
          stage: "bronze",
          roundLabel: "Third place",
          roundNumber: totalRounds,
          sourceLoserAId: semifinals[0]!.id,
          sourceLoserBId: semifinals[1]!.id,
        }),
      );
    }
  }
  return encounters;
}

function alternativePlayoff(format: TeamFormat, qualifiers: TeamQualifiedEntry[]): TeamFinalEncounterPlan[] {
  const mode = format.competition.playoffMode;
  if (mode === "league_only") return [];
  const byPosition = new Map(qualifiers.map((entry) => [entry.position, entry] as const));
  const entry = (position: number) => byPosition.get(position)?.entryId ?? null;

  if (mode === "top2_final") {
    const encounters: TeamFinalEncounterPlan[] = [];
    if (format.competition.bronzeMatch && entry(3) && entry(4)) {
      encounters.push(
        planEncounter({
          id: "team:playoff:bronze",
          stage: "bronze",
          roundLabel: "Third place",
          roundNumber: 1,
          entryAId: entry(3),
          entryBId: entry(4),
        }),
      );
    }
    encounters.push(
      planEncounter({
        id: "team:playoff:final",
        stage: "final",
        roundLabel: "Final",
        roundNumber: 1,
        entryAId: entry(1),
        entryBId: entry(2),
      }),
    );
    return encounters;
  }

  if (mode === "top4_semis") {
    const semi1 = planEncounter({
      id: "team:playoff:semi:1",
      stage: "playoff",
      roundLabel: "Semifinal",
      roundNumber: 1,
      entryAId: entry(1),
      entryBId: entry(4),
    });
    const semi2 = planEncounter({
      id: "team:playoff:semi:2",
      stage: "playoff",
      roundLabel: "Semifinal",
      roundNumber: 1,
      entryAId: entry(2),
      entryBId: entry(3),
    });
    const encounters = [semi1, semi2];
    if (format.competition.bronzeMatch) {
      encounters.push(
        planEncounter({
          id: "team:playoff:bronze",
          stage: "bronze",
          roundLabel: "Third place",
          roundNumber: 2,
          sourceLoserAId: semi1.id,
          sourceLoserBId: semi2.id,
        }),
      );
    }
    encounters.push(
      planEncounter({
        id: "team:playoff:final",
        stage: "final",
        roundLabel: "Final",
        roundNumber: 2,
        sourceEncounterAId: semi1.id,
        sourceEncounterBId: semi2.id,
      }),
    );
    return encounters;
  }

  const preliminary = planEncounter({
    id: "team:playoff:preliminary",
    stage: "playoff",
    roundLabel: "Preliminary round",
    roundNumber: 1,
    entryAId: entry(2),
    entryBId: entry(3),
  });
  return [
    preliminary,
    planEncounter({
      id: "team:playoff:final",
      stage: "final",
      roundLabel: "Final",
      roundNumber: 2,
      entryAId: entry(1),
      sourceEncounterBId: preliminary.id,
    }),
  ];
}

export function generateTeamFinalPhasePlan(input: {
  format: TeamFormat;
  standings: TeamGroupStandingSnapshot[];
}): TeamFinalPhasePlan {
  if (!input.standings.length) throw new Error("TEAM_STANDINGS_REQUIRED");
  const qualifiers = qualifyTeamEntries(input.format, input.standings);
  const encounters = input.format.competition.playoffMode === "standard"
    ? standardPlayoff(input.format, qualifiers)
    : alternativePlayoff(input.format, qualifiers);
  return { playoffMode: input.format.competition.playoffMode, qualifiers, encounters };
}
