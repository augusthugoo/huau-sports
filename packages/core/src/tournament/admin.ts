import type { TournamentEntry, TournamentGroup } from "./types";

export type TournamentSetupChecklistInput = {
  hasGeneral: boolean;
  categoryCount: number;
  entryCount: number;
  generatedCategoryCount: number;
  scheduledCategoryCount: number;
};

export type TournamentSetupChecklistItem = {
  key: "general" | "categories" | "participants" | "structure" | "schedule";
  complete: boolean;
};

export function recommendedGroupCount(entryCount: number): number {
  const count = Math.max(0, Math.trunc(entryCount));
  if (count <= 5) return count >= 2 ? 1 : 0;
  return Math.max(2, Math.ceil(count / 4));
}

export function distributeEntriesIntoGroups(
  entries: TournamentEntry[],
  requestedGroupCount: number,
): TournamentGroup[] {
  if (entries.length < 2) throw new Error("NOT_ENOUGH_ENTRIES");
  const groupCount = Math.max(1, Math.min(entries.length, Math.trunc(requestedGroupCount || 1)));
  const groups: TournamentGroup[] = Array.from({ length: groupCount }, (_, index) => ({
    id: `group-${index + 1}`,
    name: String.fromCharCode(65 + index),
    entries: [],
  }));
  const seeded = entries
    .map((entry) => ({ ...entry, participantIds: [...entry.participantIds] }))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));

  seeded.forEach((entry, index) => {
    const row = Math.floor(index / groupCount);
    const position = index % groupCount;
    const groupIndex = row % 2 === 0 ? position : groupCount - 1 - position;
    groups[groupIndex]?.entries.push(entry);
  });

  return groups;
}

export function tournamentSetupChecklist(
  input: TournamentSetupChecklistInput,
): TournamentSetupChecklistItem[] {
  return [
    { key: "general", complete: input.hasGeneral },
    { key: "categories", complete: input.categoryCount > 0 },
    { key: "participants", complete: input.categoryCount > 0 && input.entryCount >= input.categoryCount * 2 },
    {
      key: "structure",
      complete: input.categoryCount > 0 && input.generatedCategoryCount === input.categoryCount,
    },
    {
      key: "schedule",
      complete: input.categoryCount > 0 && input.scheduledCategoryCount === input.categoryCount,
    },
  ];
}
