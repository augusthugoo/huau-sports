/* eslint-disable @typescript-eslint/no-explicit-any */
import type { TeamResultParticipants } from "@huau/core";

/** Never show a planned lineup as a played match. Legacy finished snapshots only. */
export function actualTeamPlayerIds(encounter: any, match: any, side: "A" | "B"): string[] {
  if (!match?.resultStatus) return [];
  const key = side === "A" ? "sideAPlayerIds" : "sideBPlayerIds";
  if (match.participants != null) {
    const value = match.participants[key];
    return Array.isArray(value) ? value.filter((id: unknown): id is string => typeof id === "string") : [];
  }
  const entryId = side === "A" ? encounter.entryAId : encounter.entryBId;
  const lineup = (encounter.lineups ?? []).find((row: any) => row.status === "locked" && String(row.entryId) === String(entryId));
  const assignments = Array.isArray(lineup?.assignments) ? lineup.assignments : [];
  const nested = assignments.find((row: any) => String(row.rubberKey) === String(match.rubberKey) && Array.isArray(row.personIds));
  if (nested) return nested.personIds.map(String);
  return assignments.filter((row: any) => String(row.rubberKey) === String(match.rubberKey) && (row.personId ?? row.organizationPersonId))
    .sort((a: any,b: any) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((row: any) => String(row.personId ?? row.organizationPersonId));
}

export function teamResultParticipantsFromForm(data: FormData): TeamResultParticipants {
  return { sideAPlayerIds: data.getAll("actual-team-A").map(String).filter(Boolean),
    sideBPlayerIds: data.getAll("actual-team-B").map(String).filter(Boolean) };
}
