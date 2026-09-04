import { DEFAULT_TEAM_STANDINGS_CRITERIA } from "./defaults";
import type {
  TeamEntry,
  TeamStandingCriterion,
  TeamStandingEncounter,
  TeamStandingRow,
  TeamStandingsResult,
} from "./types";

function createRow(entry: TeamEntry): TeamStandingRow {
  return {
    entryId: entry.id,
    entryName: entry.name,
    played: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    standingPoints: 0,
    rubbersFor: 0,
    rubbersAgainst: 0,
    rubberDiff: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDiff: 0,
  };
}

function applyEncounter(row: TeamStandingRow, encounter: TeamStandingEncounter): TeamStandingRow {
  const isA = row.entryId === encounter.entryAId;
  const isB = row.entryId === encounter.entryBId;
  if (!isA && !isB) return row;

  const won = row.entryId === encounter.winnerEntryId;
  const standingPointsFor = isA
    ? encounter.standingPointsA ?? encounter.rubbersWonA
    : encounter.standingPointsB ?? encounter.rubbersWonB;
  const rubbersFor = isA ? encounter.rubbersWonA : encounter.rubbersWonB;
  const rubbersAgainst = isA ? encounter.rubbersWonB : encounter.rubbersWonA;
  const pointsFor = isA ? encounter.pointsA : encounter.pointsB;
  const pointsAgainst = isA ? encounter.pointsB : encounter.pointsA;
  const played = row.played + 1;
  const wins = row.wins + (won ? 1 : 0);

  return {
    ...row,
    played,
    wins,
    losses: row.losses + (won ? 0 : 1),
    winRate: wins / played,
    standingPoints: row.standingPoints + standingPointsFor,
    rubbersFor: row.rubbersFor + rubbersFor,
    rubbersAgainst: row.rubbersAgainst + rubbersAgainst,
    rubberDiff: row.rubberDiff + rubbersFor - rubbersAgainst,
    pointsFor: row.pointsFor + pointsFor,
    pointsAgainst: row.pointsAgainst + pointsAgainst,
    pointDiff: row.pointDiff + pointsFor - pointsAgainst,
  };
}

function criterionValue(row: TeamStandingRow, criterion: Exclude<TeamStandingCriterion, "head_to_head">): number {
  switch (criterion) {
    case "standing_points": return row.standingPoints;
    case "encounter_wins": return row.wins;
    case "encounter_win_rate": return row.winRate;
    case "rubber_diff": return row.rubberDiff;
    case "point_diff": return row.pointDiff;
    case "points_for": return row.pointsFor;
  }
}

function directWinner(entryAId: string, entryBId: string, encounters: TeamStandingEncounter[]): string | null {
  let winsA = 0;
  let winsB = 0;
  encounters.forEach((encounter) => {
    const direct =
      (encounter.entryAId === entryAId && encounter.entryBId === entryBId) ||
      (encounter.entryAId === entryBId && encounter.entryBId === entryAId);
    if (!direct) return;
    if (encounter.winnerEntryId === entryAId) winsA += 1;
    if (encounter.winnerEntryId === entryBId) winsB += 1;
  });
  if (winsA === winsB) return null;
  return winsA > winsB ? entryAId : entryBId;
}

function rankRows(
  rows: TeamStandingRow[],
  criteria: TeamStandingCriterion[],
  encounters: TeamStandingEncounter[],
): TeamStandingRow[] {
  let buckets: TeamStandingRow[][] = [rows];
  criteria.forEach((criterion) => {
    const next: TeamStandingRow[][] = [];
    buckets.forEach((bucket) => {
      if (bucket.length <= 1) {
        next.push(bucket);
        return;
      }
      if (criterion === "head_to_head") {
        if (bucket.length === 2) {
          const winner = directWinner(bucket[0]!.entryId, bucket[1]!.entryId, encounters);
          if (winner) {
            const first = bucket.find((row) => row.entryId === winner)!;
            const second = bucket.find((row) => row.entryId !== winner)!;
            next.push([first], [second]);
            return;
          }
        }
        next.push(bucket);
        return;
      }

      const sorted = [...bucket].sort((a, b) => {
        const delta = criterionValue(b, criterion) - criterionValue(a, criterion);
        return delta || a.entryId.localeCompare(b.entryId);
      });
      let current: TeamStandingRow[] = [];
      let previousValue: number | null = null;
      sorted.forEach((row) => {
        const value = criterionValue(row, criterion);
        if (current.length && previousValue !== value) {
          next.push(current);
          current = [];
        }
        current.push(row);
        previousValue = value;
      });
      if (current.length) next.push(current);
    });
    buckets = next;
  });
  return buckets.flatMap((bucket) => [...bucket].sort((a, b) => a.entryId.localeCompare(b.entryId)));
}

export function calculateTeamStandings(input: {
  entries: TeamEntry[];
  encounters: TeamStandingEncounter[];
  criteria?: TeamStandingCriterion[];
}): TeamStandingsResult {
  const criteria = input.criteria?.length ? [...input.criteria] : [...DEFAULT_TEAM_STANDINGS_CRITERIA];
  const rowByEntryId = new Map(input.entries.map((entry) => [entry.id, createRow(entry)] as const));

  input.encounters.forEach((encounter) => {
    const rowA = rowByEntryId.get(encounter.entryAId);
    const rowB = rowByEntryId.get(encounter.entryBId);
    if (!rowA || !rowB) throw new Error(`TEAM_STANDINGS_UNKNOWN_ENTRY:${encounter.id}`);
    if (encounter.winnerEntryId !== encounter.entryAId && encounter.winnerEntryId !== encounter.entryBId) {
      throw new Error(`TEAM_STANDINGS_INVALID_WINNER:${encounter.id}`);
    }
    rowByEntryId.set(encounter.entryAId, applyEncounter(rowA, encounter));
    rowByEntryId.set(encounter.entryBId, applyEncounter(rowB, encounter));
  });

  return {
    rows: rankRows([...rowByEntryId.values()], criteria, input.encounters),
    explanation: { criteria, fallback: "entry_id" },
  };
}
