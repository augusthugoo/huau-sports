import type { TournamentPersistenceBundle } from "./types";

export type HuauTournamentBackupV1 = {
  format: "huau-tournament-backup";
  schemaVersion: "phase3";
  exportedAt: number;
  tournamentId: string;
  data: TournamentPersistenceBundle;
};

export function exportHuauTournamentBackup(bundle: TournamentPersistenceBundle, exportedAt = Math.floor(Date.now() / 1000)): HuauTournamentBackupV1 {
  return {
    format: "huau-tournament-backup",
    schemaVersion: "phase3",
    exportedAt,
    tournamentId: bundle.tournament.id,
    data: JSON.parse(JSON.stringify(bundle)) as TournamentPersistenceBundle,
  };
}

export function importHuauTournamentBackup(input: unknown): TournamentPersistenceBundle {
  if (!input || typeof input !== "object") throw new Error("INVALID_HUAU_BACKUP");
  const backup = input as Partial<HuauTournamentBackupV1>;
  if (backup.format !== "huau-tournament-backup" || backup.schemaVersion !== "phase3" || !backup.data) {
    throw new Error("INVALID_HUAU_BACKUP");
  }
  if (backup.data.schemaVersion !== "phase3" || !backup.data.tournament?.id) throw new Error("INVALID_HUAU_BACKUP");
  return JSON.parse(JSON.stringify(backup.data)) as TournamentPersistenceBundle;
}
