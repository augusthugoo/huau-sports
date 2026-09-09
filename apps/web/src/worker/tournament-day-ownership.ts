/**
 * Final-sync ownership boundary.
 * Admin-created registration relationships remain canonical in Admin/D1.
 * Tournament Day may only create/replace relationship rows for entities born locally in Day.
 */
export function dayOwnsPlayerCategory(profileSourceId: string) {
  return profileSourceId.startsWith("local-player:");
}

export function dayOwnsTeamRoster(entrySourceId: string) {
  return entrySourceId.startsWith("local-team:");
}
