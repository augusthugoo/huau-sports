import type { Competition, CompetitionEncounter, StandingRow, TournamentEntry } from "./types";

function finishedGroupEncounters(competition: Competition, groupId: string): CompetitionEncounter[] {
  return competition.encounters.filter(
    (encounter) =>
      encounter.stage === "group" && encounter.groupId === groupId && encounter.status === "finished",
  );
}

function scoreForEntry(encounter: CompetitionEncounter, entryId: string): { own: number; opponent: number } | null {
  if (encounter.scoreA === null || encounter.scoreB === null) return null;
  if (encounter.entryA?.id === entryId) return { own: encounter.scoreA, opponent: encounter.scoreB };
  if (encounter.entryB?.id === entryId) return { own: encounter.scoreB, opponent: encounter.scoreA };
  return null;
}

function rowForEntry(entry: TournamentEntry, matches: CompetitionEncounter[]): StandingRow {
  const row: StandingRow = {
    entry,
    played: 0,
    wins: 0,
    losses: 0,
    scored: 0,
    conceded: 0,
    diff: 0,
    miniWins: 0,
    miniDiff: 0,
  };

  for (const encounter of matches) {
    const score = scoreForEntry(encounter, entry.id);
    if (!score) continue;
    row.played += 1;
    row.scored += score.own;
    row.conceded += score.opponent;
    if (score.own > score.opponent) row.wins += 1;
    else row.losses += 1;
  }

  row.diff = row.scored - row.conceded;
  return row;
}

function addMiniTableValues(rows: StandingRow[], matches: CompetitionEncounter[]): void {
  const ties = new Map<number, StandingRow[]>();
  for (const row of rows) {
    const group = ties.get(row.wins) ?? [];
    group.push(row);
    ties.set(row.wins, group);
  }

  for (const tiedRows of ties.values()) {
    if (tiedRows.length < 3) continue;
    const ids = new Set(tiedRows.map((row) => row.entry.id));
    const byId = new Map(tiedRows.map((row) => [row.entry.id, row] as const));

    for (const match of matches) {
      const idA = match.entryA?.id;
      const idB = match.entryB?.id;
      if (!idA || !idB || !ids.has(idA) || !ids.has(idB) || match.scoreA === null || match.scoreB === null) {
        continue;
      }
      const rowA = byId.get(idA);
      const rowB = byId.get(idB);
      if (!rowA || !rowB) continue;
      rowA.miniDiff += match.scoreA - match.scoreB;
      rowB.miniDiff += match.scoreB - match.scoreA;
      if (match.scoreA > match.scoreB) rowA.miniWins += 1;
      else rowB.miniWins += 1;
    }
  }
}

function pairHeadToHead(idA: string, idB: string, matches: CompetitionEncounter[]): number {
  let winsA = 0;
  let winsB = 0;
  let diffA = 0;
  let scoredA = 0;

  for (const match of matches) {
    const isPair =
      (match.entryA?.id === idA && match.entryB?.id === idB) ||
      (match.entryA?.id === idB && match.entryB?.id === idA);
    if (!isPair || match.scoreA === null || match.scoreB === null) continue;

    const aOwn = match.entryA?.id === idA ? match.scoreA : match.scoreB;
    const aOpp = match.entryA?.id === idA ? match.scoreB : match.scoreA;
    if (aOwn > aOpp) winsA += 1;
    else winsB += 1;
    diffA += aOwn - aOpp;
    scoredA += aOwn;
  }

  if (winsA !== winsB) return winsA > winsB ? -1 : 1;
  if (diffA !== 0) return diffA > 0 ? -1 : 1;
  if (scoredA !== 0) {
    const scoredB = matches
      .filter(
        (match) =>
          ((match.entryA?.id === idA && match.entryB?.id === idB) ||
            (match.entryA?.id === idB && match.entryB?.id === idA)) &&
          match.scoreA !== null &&
          match.scoreB !== null,
      )
      .reduce((total, match) => total + (match.entryA?.id === idB ? (match.scoreA ?? 0) : (match.scoreB ?? 0)), 0);
    if (scoredA !== scoredB) return scoredA > scoredB ? -1 : 1;
  }
  return 0;
}

export function calculateGroupStandings(competition: Competition, groupId: string): StandingRow[] {
  const group = competition.groups.find((candidate) => candidate.id === groupId);
  if (!group) return [];
  const matches = finishedGroupEncounters(competition, groupId);
  const rows = group.entries.map((entry) => rowForEntry(entry, matches));
  addMiniTableValues(rows, matches);
  const sameWinsCount = (wins: number) => rows.filter((row) => row.wins === wins).length;

  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (sameWinsCount(a.wins) === 2) {
      const head = pairHeadToHead(a.entry.id, b.entry.id, matches);
      if (head !== 0) return head;
    }
    if (b.miniWins !== a.miniWins) return b.miniWins - a.miniWins;
    if (b.miniDiff !== a.miniDiff) return b.miniDiff - a.miniDiff;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.scored !== a.scored) return b.scored - a.scored;
    if (b.entry.rating !== a.entry.rating) return b.entry.rating - a.entry.rating;
    return a.entry.name.localeCompare(b.entry.name);
  });

  return rows;
}
