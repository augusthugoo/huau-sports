import { nonQualifiedEntries, qualifiedEntries, qualifiedEntriesForMode } from "./qualification";
import { calculateGroupStandings } from "./standings";
import type {
  BracketBuildResult,
  Competition,
  CompetitionEncounter,
  QualifiedEntry,
  StandardCompetitionFormat,
  TournamentEntry,
} from "./types";

export function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < Math.max(1, value)) power *= 2;
  return power;
}

export function standardSeedOrder(size: number): number[] {
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

function candidatePreferenceOrder(count: number, targetIndex: number): number[] {
  return Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => Math.abs(a - targetIndex) - Math.abs(b - targetIndex) || a - b,
  );
}

function opponentSeedFor(seedNumber: number, seedOrder: number[]): number {
  const index = seedOrder.indexOf(seedNumber);
  if (index < 0) return 0;
  return index % 2 === 0 ? (seedOrder[index + 1] ?? 0) : (seedOrder[index - 1] ?? 0);
}

function deterministicPotsOrder(values: QualifiedEntry[]): QualifiedEntry[] {
  return [...values].sort(
    (a, b) =>
      a.groupName.localeCompare(b.groupName) ||
      a.entry.name.localeCompare(b.entry.name) ||
      a.entry.id.localeCompare(b.entry.id),
  );
}

function assignPoolToSeedNumbers(input: {
  seedNumbers: number[];
  pool: QualifiedEntry[];
  seeded: Array<QualifiedEntry | null>;
  seedOrder: number[];
  avoidRematches: boolean;
}): { bySeed: Map<number, QualifiedEntry | null>; fallback: boolean } {
  let slotCandidate: Array<number | undefined> = [];
  let candidateSlot: Array<number | undefined> = [];
  const preferences = input.seedNumbers.map((_, index) => candidatePreferenceOrder(input.pool.length, index));

  const candidateAllowed = (slotIndex: number, candidateIndex: number, enforceAvoid: boolean) => {
    if (!enforceAvoid) return true;
    const seedNumber = input.seedNumbers[slotIndex];
    const candidate = input.pool[candidateIndex];
    if (!seedNumber || !candidate) return true;
    const opponentSeed = opponentSeedFor(seedNumber, input.seedOrder);
    const opponent = input.seeded[opponentSeed] ?? null;
    return !opponent || opponent.groupId !== candidate.groupId;
  };

  const tryAssign = (slotIndex: number, seen: Set<number>, enforceAvoid: boolean): boolean => {
    for (const candidateIndex of preferences[slotIndex] ?? []) {
      if (seen.has(candidateIndex) || !candidateAllowed(slotIndex, candidateIndex, enforceAvoid)) continue;
      seen.add(candidateIndex);
      const previousSlot = candidateSlot[candidateIndex];
      if (previousSlot === undefined || tryAssign(previousSlot, seen, enforceAvoid)) {
        candidateSlot[candidateIndex] = slotIndex;
        slotCandidate[slotIndex] = candidateIndex;
        return true;
      }
    }
    return false;
  };

  const run = (enforceAvoid: boolean): boolean => {
    slotCandidate = [];
    candidateSlot = [];
    for (let slot = 0; slot < input.seedNumbers.length; slot += 1) {
      if (!tryAssign(slot, new Set<number>(), enforceAvoid)) return false;
    }
    return true;
  };

  const avoided = run(input.avoidRematches);
  if (!avoided) run(false);
  const bySeed = new Map<number, QualifiedEntry | null>();
  input.seedNumbers.forEach((seedNumber, index) => {
    const candidateIndex = slotCandidate[index];
    bySeed.set(seedNumber, candidateIndex === undefined ? null : (input.pool[candidateIndex] ?? null));
  });
  return { bySeed, fallback: input.avoidRematches && !avoided };
}

export function buildBracketSlots(
  qualifiers: QualifiedEntry[],
  bracketSize: number,
  format: StandardCompetitionFormat,
): BracketBuildResult {
  const firsts = qualifiers.filter((entry) => entry.position === 1).sort(compareSeedPerformance);
  let seconds = qualifiers.filter((entry) => entry.position === 2).sort(compareSeedPerformance);
  const rest = qualifiers.filter((entry) => entry.position > 2).sort(compareSeedPerformance);
  const seedOrder = standardSeedOrder(bracketSize);
  const seeded: Array<QualifiedEntry | null> = Array.from({ length: bracketSize + 1 }, () => null);

  firsts.forEach((entry, index) => {
    seeded[index + 1] = entry;
  });
  if (format.finalDrawMethod === "pots") seconds = deterministicPotsOrder(seconds);

  const secondSeedNumbers = seconds.map((_, index) => firsts.length + index + 1);
  const assignment = assignPoolToSeedNumbers({
    seedNumbers: secondSeedNumbers,
    pool: seconds,
    seeded,
    seedOrder,
    avoidRematches: format.avoidGroupRematches,
  });
  secondSeedNumbers.forEach((seedNumber) => {
    seeded[seedNumber] = assignment.bySeed.get(seedNumber) ?? null;
  });

  let nextSeed = firsts.length + seconds.length + 1;
  for (const entry of rest) {
    seeded[nextSeed] = entry;
    nextSeed += 1;
  }

  return {
    slots: seedOrder.map((seedNumber) => seeded[seedNumber] ?? null),
    rematchFallback: assignment.fallback,
  };
}

function compareSeedPerformance(a: QualifiedEntry, b: QualifiedEntry): number {
  return (
    b.winRate - a.winRate ||
    b.diffPerMatch - a.diffPerMatch ||
    b.scoredPerMatch - a.scoredPerMatch ||
    b.entry.rating - a.entry.rating ||
    a.entry.name.localeCompare(b.entry.name)
  );
}

function cloneEntry(entry: TournamentEntry | null): TournamentEntry | null {
  return entry ? { ...entry, participantIds: [...entry.participantIds] } : null;
}

function matchRuleForStage(format: StandardCompetitionFormat, stage: CompetitionEncounter["stage"]) {
  return stage === "bronze" || stage === "final" ? format.medal : format.preliminary;
}

function makeEncounter(input: {
  id: string;
  stage: CompetitionEncounter["stage"];
  roundLabel: string;
  roundNumber: number;
  entryA?: TournamentEntry | null;
  entryB?: TournamentEntry | null;
  sourceA?: string | null;
  sourceB?: string | null;
  sourceLoserA?: string | null;
  sourceLoserB?: string | null;
  format: StandardCompetitionFormat;
}): CompetitionEncounter {
  const rule = matchRuleForStage(input.format, input.stage);
  return {
    id: input.id,
    stage: input.stage,
    groupId: null,
    groupName: null,
    roundLabel: input.roundLabel,
    roundNumber: input.roundNumber,
    legNumber: 1,
    entryA: cloneEntry(input.entryA ?? null),
    entryB: cloneEntry(input.entryB ?? null),
    sourceEncounterAId: input.sourceA ?? null,
    sourceEncounterBId: input.sourceB ?? null,
    sourceLoserAId: input.sourceLoserA ?? null,
    sourceLoserBId: input.sourceLoserB ?? null,
    status: "pending",
    winnerEntryId: null,
    scoreA: null,
    scoreB: null,
    sets: [],
    bestOf: rule.bestOf,
    pointTarget: rule.pointTarget,
  };
}

export function knockoutRoundLabel(totalRounds: number, index: number): string {
  const remaining = totalRounds - index;
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semifinal";
  if (remaining === 3) return "Quarterfinal";
  return `Round of ${2 ** remaining}`;
}

function entryFromQualified(value: QualifiedEntry | null): TournamentEntry | null {
  return value ? value.entry : null;
}

function markFirstRoundByes(matches: CompetitionEncounter[]): void {
  for (const match of matches) {
    if (match.entryA && !match.entryB) {
      match.winnerEntryId = match.entryA.id;
      match.status = "bye";
    } else if (!match.entryA && match.entryB) {
      match.winnerEntryId = match.entryB.id;
      match.status = "bye";
    }
  }
}

function buildSimpleKnockout(
  entries: QualifiedEntry[],
  format: StandardCompetitionFormat,
  prefix: string,
  stage: "consolation" | "playoff",
): CompetitionEncounter[] {
  if (entries.length < 2) return [];
  const bracketSize = nextPowerOfTwo(entries.length);
  const totalRounds = Math.round(Math.log2(bracketSize));
  const slots = Array.from({ length: bracketSize }, (_, index) => entries[index]?.entry ?? null);
  const matches: CompetitionEncounter[] = [];
  let previous: CompetitionEncounter[] = [];

  for (let index = 0; index < bracketSize / 2; index += 1) {
    const match = makeEncounter({
      id: `${prefix}:r1:m${index + 1}`,
      stage,
      roundLabel: `${prefix} · ${knockoutRoundLabel(totalRounds, 0)}`,
      roundNumber: 1,
      entryA: slots[index * 2] ?? null,
      entryB: slots[index * 2 + 1] ?? null,
      format,
    });
    previous.push(match);
    matches.push(match);
  }
  markFirstRoundByes(previous);

  for (let round = 1; round < totalRounds; round += 1) {
    const current: CompetitionEncounter[] = [];
    for (let index = 0; index < previous.length; index += 2) {
      const left = previous[index];
      const right = previous[index + 1];
      if (!left || !right) continue;
      const isFinal = round === totalRounds - 1;
      const match = makeEncounter({
        id: `${prefix}:r${round + 1}:m${Math.floor(index / 2) + 1}`,
        stage: isFinal && stage === "playoff" ? "final" : stage,
        roundLabel: isFinal && stage === "playoff" ? "Final" : `${prefix} · ${knockoutRoundLabel(totalRounds, round)}`,
        roundNumber: round + 1,
        sourceA: left.id,
        sourceB: right.id,
        format,
      });
      current.push(match);
      matches.push(match);
    }
    previous = current;
  }
  return matches;
}

function standardPlayoff(competition: Competition): CompetitionEncounter[] {
  const qualifiers = qualifiedEntries(competition);
  if (qualifiers.length < 2) return [];
  const bracketSize = nextPowerOfTwo(qualifiers.length);
  const totalRounds = Math.round(Math.log2(bracketSize));
  const bracket = buildBracketSlots(qualifiers, bracketSize, competition.format);
  const matches: CompetitionEncounter[] = [];
  let previous: CompetitionEncounter[] = [];

  for (let index = 0; index < bracketSize / 2; index += 1) {
    const stage: CompetitionEncounter["stage"] = totalRounds === 1 ? "final" : "playoff";
    const match = makeEncounter({
      id: `playoff:r1:m${index + 1}`,
      stage,
      roundLabel: knockoutRoundLabel(totalRounds, 0),
      roundNumber: 1,
      entryA: entryFromQualified(bracket.slots[index * 2] ?? null),
      entryB: entryFromQualified(bracket.slots[index * 2 + 1] ?? null),
      format: competition.format,
    });
    previous.push(match);
    matches.push(match);
  }
  markFirstRoundByes(previous);

  for (let round = 1; round < totalRounds; round += 1) {
    const current: CompetitionEncounter[] = [];
    for (let index = 0; index < previous.length; index += 2) {
      const left = previous[index];
      const right = previous[index + 1];
      if (!left || !right) continue;
      const isFinal = round === totalRounds - 1;
      const match = makeEncounter({
        id: `playoff:r${round + 1}:m${Math.floor(index / 2) + 1}`,
        stage: isFinal ? "final" : "playoff",
        roundLabel: knockoutRoundLabel(totalRounds, round),
        roundNumber: round + 1,
        sourceA: left.id,
        sourceB: right.id,
        format: competition.format,
      });
      current.push(match);
      matches.push(match);
    }
    previous = current;
  }

  if (competition.format.bronzeMatch && qualifiers.length >= 4) {
    const semifinals = matches.filter((match) => match.roundLabel === "Semifinal");
    if (semifinals.length >= 2) {
      const first = semifinals[0];
      const second = semifinals[1];
      if (first && second) {
        matches.push(
          makeEncounter({
            id: "playoff:bronze",
            stage: "bronze",
            roundLabel: "Third place",
            roundNumber: totalRounds,
            sourceLoserA: first.id,
            sourceLoserB: second.id,
            format: competition.format,
          }),
        );
      }
    }
  }
  return matches;
}

function singleGroupEntry(competition: Competition, position: number): TournamentEntry | null {
  const group = competition.groups[0];
  if (!group) return null;
  return calculateGroupStandings(competition, group.id)[position - 1]?.entry ?? null;
}

function alternativePlayoff(competition: Competition): CompetitionEncounter[] {
  const format = competition.format;
  if (format.playoffMode === "league_only") return [];
  if (format.playoffMode === "top2_final") {
    const matches: CompetitionEncounter[] = [];
    if (format.bronzeMatch && competition.groups[0] && competition.groups[0].entries.length >= 4) {
      matches.push(
        makeEncounter({
          id: "playoff:bronze",
          stage: "bronze",
          roundLabel: "Third place",
          roundNumber: 1,
          entryA: singleGroupEntry(competition, 3),
          entryB: singleGroupEntry(competition, 4),
          format,
        }),
      );
    }
    matches.push(
      makeEncounter({
        id: "playoff:final",
        stage: "final",
        roundLabel: "Final",
        roundNumber: 1,
        entryA: singleGroupEntry(competition, 1),
        entryB: singleGroupEntry(competition, 2),
        format,
      }),
    );
    return matches;
  }

  if (format.playoffMode === "top4_semis") {
    const semi1 = makeEncounter({
      id: "playoff:semi:1",
      stage: "playoff",
      roundLabel: "Semifinal",
      roundNumber: 1,
      entryA: singleGroupEntry(competition, 1),
      entryB: singleGroupEntry(competition, 4),
      format,
    });
    const semi2 = makeEncounter({
      id: "playoff:semi:2",
      stage: "playoff",
      roundLabel: "Semifinal",
      roundNumber: 1,
      entryA: singleGroupEntry(competition, 2),
      entryB: singleGroupEntry(competition, 3),
      format,
    });
    const matches = [semi1, semi2];
    if (format.bronzeMatch) {
      matches.push(
        makeEncounter({
          id: "playoff:bronze",
          stage: "bronze",
          roundLabel: "Third place",
          roundNumber: 2,
          sourceLoserA: semi1.id,
          sourceLoserB: semi2.id,
          format,
        }),
      );
    }
    matches.push(
      makeEncounter({
        id: "playoff:final",
        stage: "final",
        roundLabel: "Final",
        roundNumber: 2,
        sourceA: semi1.id,
        sourceB: semi2.id,
        format,
      }),
    );
    return matches;
  }

  const preliminary = makeEncounter({
    id: "playoff:preliminary",
    stage: "playoff",
    roundLabel: "Preliminary round",
    roundNumber: 1,
    entryA: singleGroupEntry(competition, 2),
    entryB: singleGroupEntry(competition, 3),
    format,
  });
  return [
    preliminary,
    makeEncounter({
      id: "playoff:final",
      stage: "final",
      roundLabel: "Final",
      roundNumber: 2,
      entryA: singleGroupEntry(competition, 1),
      sourceB: preliminary.id,
      format,
    }),
  ];
}

export function generateFinalPhase(competition: Competition): Competition {
  const withoutFinals = competition.encounters.filter((encounter) => encounter.stage === "group");
  if (withoutFinals.some((encounter) => encounter.status !== "finished")) {
    throw new Error("GROUP_STAGE_INCOMPLETE");
  }

  const consolation =
    competition.format.consolationMode === "knockout" && competition.format.playoffMode !== "league_only"
      ? buildSimpleKnockout(nonQualifiedEntries(competition), competition.format, "consolation", "consolation")
      : [];
  const main =
    competition.format.playoffMode === "standard"
      ? standardPlayoff(competition)
      : alternativePlayoff(competition);

  return progressEncounterSources({
    ...competition,
    encounters: [...withoutFinals, ...consolation, ...main],
    finalGenerated: true,
  });
}

function loserEntry(encounter: CompetitionEncounter): TournamentEntry | null {
  if (encounter.status !== "finished" || !encounter.winnerEntryId || !encounter.entryA || !encounter.entryB) return null;
  return encounter.winnerEntryId === encounter.entryA.id ? encounter.entryB : encounter.entryA;
}

function winnerEntry(encounter: CompetitionEncounter): TournamentEntry | null {
  if (!encounter.winnerEntryId) return null;
  if (encounter.entryA?.id === encounter.winnerEntryId) return encounter.entryA;
  if (encounter.entryB?.id === encounter.winnerEntryId) return encounter.entryB;
  return null;
}

function assignSourceEntry(
  encounter: CompetitionEncounter,
  side: "A" | "B",
  source: TournamentEntry | null,
): CompetitionEncounter {
  if (!source) return encounter;
  return side === "A" ? { ...encounter, entryA: cloneEntry(source) } : { ...encounter, entryB: cloneEntry(source) };
}

export function progressEncounterSources(competition: Competition): Competition {
  let encounters = competition.encounters.map((encounter) => ({
    ...encounter,
    entryA: cloneEntry(encounter.entryA),
    entryB: cloneEntry(encounter.entryB),
    sets: encounter.sets.map((set) => ({ ...set })),
  }));
  const maxPasses = Math.max(1, encounters.length * 2);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    const map = new Map(encounters.map((encounter) => [encounter.id, encounter] as const));
    encounters = encounters.map((encounter) => {
      let next = encounter;
      const sourceA = encounter.sourceEncounterAId ? map.get(encounter.sourceEncounterAId) : null;
      const sourceB = encounter.sourceEncounterBId ? map.get(encounter.sourceEncounterBId) : null;
      const loserA = encounter.sourceLoserAId ? map.get(encounter.sourceLoserAId) : null;
      const loserB = encounter.sourceLoserBId ? map.get(encounter.sourceLoserBId) : null;

      const desiredA = sourceA ? winnerEntry(sourceA) : loserA ? loserEntry(loserA) : null;
      const desiredB = sourceB ? winnerEntry(sourceB) : loserB ? loserEntry(loserB) : null;
      if (desiredA && next.entryA?.id !== desiredA.id) {
        next = assignSourceEntry(next, "A", desiredA);
        changed = true;
      }
      if (desiredB && next.entryB?.id !== desiredB.id) {
        next = assignSourceEntry(next, "B", desiredB);
        changed = true;
      }

      if (next.status === "pending" && ((next.entryA && !next.entryB) || (!next.entryA && next.entryB))) {
        const missingSourcePending =
          (!next.entryA && (next.sourceEncounterAId || next.sourceLoserAId)) ||
          (!next.entryB && (next.sourceEncounterBId || next.sourceLoserBId));
        if (!missingSourcePending) {
          next = {
            ...next,
            status: "bye",
            winnerEntryId: next.entryA?.id ?? next.entryB?.id ?? null,
          };
          changed = true;
        }
      }
      if (next.status === "pending" && next.entryA && next.entryB) {
        next = { ...next, status: "ready" };
        changed = true;
      }
      return next;
    });
    if (!changed) break;
  }

  return { ...competition, encounters };
}

export function requiredMainQualifiers(competition: Competition): QualifiedEntry[] {
  return qualifiedEntriesForMode(competition);
}
