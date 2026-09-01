import type { Competition, CompetitionEncounter, TournamentEntry, TournamentGroup } from "./types";

function cloneEntry(entry: TournamentEntry | null): TournamentEntry | null {
  return entry ? { ...entry, participantIds: [...entry.participantIds] } : null;
}

function patchEntry(entry: TournamentEntry | null, entryId: string, name: string): TournamentEntry | null {
  if (!entry || entry.id !== entryId) return cloneEntry(entry);
  return { ...entry, name, participantIds: [...entry.participantIds] };
}

export function updateEntryCosmetics(
  competition: Competition,
  entryId: string,
  patch: { name?: string },
): Competition {
  const current = competition.groups.flatMap((group) => group.entries).find((entry) => entry.id === entryId);
  if (!current) throw new Error("ENTRY_NOT_FOUND");
  const name = patch.name?.trim() || current.name;

  const groups: TournamentGroup[] = competition.groups.map((group) => ({
    ...group,
    entries: group.entries.map((entry) =>
      entry.id === entryId ? { ...entry, name, participantIds: [...entry.participantIds] } : { ...entry, participantIds: [...entry.participantIds] },
    ),
  }));
  const encounters: CompetitionEncounter[] = competition.encounters.map((encounter) => ({
    ...encounter,
    entryA: patchEntry(encounter.entryA, entryId, name),
    entryB: patchEntry(encounter.entryB, entryId, name),
    sets: encounter.sets.map((set) => ({ ...set })),
  }));

  return { ...competition, groups, encounters };
}

export function competitionStructureFingerprint(competition: Competition): string {
  return JSON.stringify({
    groups: competition.groups.map((group) => ({
      id: group.id,
      entries: group.entries.map((entry) => entry.id),
    })),
    encounters: competition.encounters.map((encounter) => ({
      id: encounter.id,
      stage: encounter.stage,
      groupId: encounter.groupId,
      roundLabel: encounter.roundLabel,
      legNumber: encounter.legNumber,
      entryAId: encounter.entryA?.id ?? null,
      entryBId: encounter.entryB?.id ?? null,
      sourceA: encounter.sourceEncounterAId,
      sourceB: encounter.sourceEncounterBId,
      sourceLoserA: encounter.sourceLoserAId,
      sourceLoserB: encounter.sourceLoserBId,
    })),
  });
}
