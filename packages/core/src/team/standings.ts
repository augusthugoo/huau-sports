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
    rubbersFor: row.rubbersFor + rubbersFor,
    rubbersAgainst: row.rubbersAgainst + rubbersAgainst,
    rubberDiff: row.rubberDiff + rubbersFor - rubbersAgainst,
    pointsFor: row.pointsFor + pointsFor,
    pointsAgainst: row.pointsAgainst + pointsAgainst,
    pointDiff: row.pointDiff + pointsFor - pointsAgainst,
  };
}

function compareNumberDescending(a: number, b: number): number {
  if (a === b) return 0;
  return b - a;
}

function compareCriterion(a: TeamStandingRow, b: TeamStandingRow, criterion: TeamStandingCriterion): number {
  switch (criterion) {
    case "encounter_wins":
      return compareNumberDescending(a.wins, b.wins);
    case "encounter_win_rate":
      return compareNumberDescending(a.winRate, b.winRate);
    case "rubber_diff":
      return compareNumberDescending(a.rubberDiff, b.rubberDiff);
    case "point_diff":
      return compareNumberDescending(a.pointDiff, b.pointDiff);
    case "points_for":
      return compareNumberDescending(a.pointsFor, b.pointsFor);
  }
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

  const rows = [...rowByEntryId.values()].sort((a, b) => {
    for (const criterion of criteria) {
      const compared = compareCriterion(a, b, criterion);
      if (compared !== 0) return compared;
    }
    return a.entryId.localeCompare(b.entryId);
  });

  return {
    rows,
    explanation: {
      criteria,
      fallback: "entry_id",
    },
  };
}
