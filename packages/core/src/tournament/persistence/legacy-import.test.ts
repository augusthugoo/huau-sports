import { describe, expect, it } from "vitest";
import { exportHuauTournamentBackup, importHuauTournamentBackup, importLegacyTournamentState, summarizeTournamentBundle } from "./index";

const legacy = {
  revision: 257,
  state: {
    version: "2.2-local-server",
    tournament: {
      name: "Torneo Polideportivo",
      startDate: "2026-08-15",
      endDate: "2026-08-16",
      dailyStart: "09:00",
      dailyEnd: "20:00",
      courtCount: 3,
      matchMinutes: 15,
      categories: ["Singles Masculino B", "Dobles Masculino B"],
      categoryOrder: ["Dobles Masculino B", "Singles Masculino B"],
      categoryDates: { "Dobles Masculino B": "2026-08-15", "Singles Masculino B": "2026-08-16" },
      status: "Borrador",
    },
    players: [
      { id: 1001, name: "Pablo", categories: ["Singles Masculino B", "Dobles Masculino B"] },
      { id: 1002, name: "Bernardo", categories: ["Dobles Masculino B"] },
      { id: 1003, name: "David", categories: ["Singles Masculino B"] },
    ],
    formats: {
      "Dobles Masculino B": { groups: 1, sizes: [2], qualifiersPerGroup: 2, qualified: 2, groupMatches: 1, bronzeMatch: false, medalBestOf: 3, medalSchedule: "sequential", standardPointTarget: 15, medalPointTarget: 11 },
      "Singles Masculino B": { groups: 1, sizes: [2], qualifiersPerGroup: 2, qualified: 2, groupMatches: 1, bronzeMatch: false, medalBestOf: 3, medalSchedule: "sequential", standardPointTarget: 15, medalPointTarget: 11 },
    },
    competitions: {
      "Dobles Masculino B": {
        category: "Dobles Masculino B",
        format: { groups: 1, sizes: [2], qualifiersPerGroup: 2, qualified: 2, groupMatches: 1 },
        groups: [{ name: "A", entries: [{ id: "D1001-1002", name: "Pablo / Bernardo", playerIds: [1001, 1002], rating: 0 }, { id: "D1003-1002", name: "David / Bernardo", playerIds: [1003, 1002], rating: 0 }] }],
        matches: [{ id: 1101, stage: "Grupo", group: "A", round: "Fase de grupos", teamA: "Pablo / Bernardo", teamB: "David / Bernardo", entryAId: "D1001-1002", entryBId: "D1003-1002", teamAIds: [1001, 1002], teamBIds: [1003, 1002], scoreA: 15, scoreB: 10, status: "Finalizado", winnerEntry: { id: "D1001-1002" }, bestOf: 1, pointTarget: 15, sets: [], completedAt: "2026-08-15T12:00:00.000Z" }],
        finalGenerated: false,
      },
      "Singles Masculino B": {
        category: "Singles Masculino B",
        format: { groups: 1, sizes: [2], qualifiersPerGroup: 2, qualified: 2, groupMatches: 1 },
        groups: [{ name: "A", entries: [{ id: "P1001", name: "Pablo", playerIds: [1001], rating: 0 }, { id: "P1003", name: "David", playerIds: [1003], rating: 0 }] }],
        matches: [{ id: 1201, stage: "Grupo", group: "A", round: "Fase de grupos", teamA: "Pablo", teamB: "David", entryAId: "P1001", entryBId: "P1003", teamAIds: [1001], teamBIds: [1003], scoreA: "", scoreB: "", status: "Pendiente", winnerEntry: null, bestOf: 1, pointTarget: 15, sets: [] }],
        finalGenerated: false,
      },
    },
    schedule: [
      { matchId: 1101, category: "Dobles Masculino B", stage: "Grupo", slot: 0, startOffset: 0, durationMinutes: 15, court: 1, date: "2026-08-15", time: "09:00" },
      { matchId: 0, reserved: true, category: "Dobles Masculino B", stage: "Final", round: "Final", placeholderIndex: 0, slot: 1, startOffset: 15, durationMinutes: 30, court: 1, date: "2026-08-15", time: "09:15" },
    ],
  },
};

const options = {
  organizationId: "org-1",
  createdByUserId: "user-1",
  tournamentId: "tournament-1",
  slug: "torneo-polideportivo-test",
  now: 1_788_000_000,
  idFactory: (kind: string, key: string) => `${kind}-${key.replace(/[^a-zA-Z0-9]+/g, "-")}`,
};

describe("Phase 3 legacy tournament import", () => {
  it("imports people, categories, entries, groups, results and schedule without mutating source", () => {
    const before = JSON.stringify(legacy);
    const bundle = importLegacyTournamentState(legacy, options);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(summarizeTournamentBundle(bundle)).toEqual({ people: 3, categories: 2, entries: 4, groups: 2, encounters: 2, matches: 2, finalizedResults: 1, scheduleItems: 2 });
    expect(bundle.categories.map((category) => category.name)).toEqual(["Dobles Masculino B", "Singles Masculino B"]);
    expect(bundle.scheduleItems[1]?.status).toBe("reserved");
    expect(bundle.snapshots[0]?.payloadJson).toBe(before);
  });

  it("round-trips a HUAU phase3 backup without losing normalized records", () => {
    const bundle = importLegacyTournamentState(legacy, options);
    const backup = exportHuauTournamentBackup(bundle, 123);
    const restored = importHuauTournamentBackup(JSON.parse(JSON.stringify(backup)));
    expect(restored).toEqual(bundle);
    expect(summarizeTournamentBundle(restored)).toEqual(summarizeTournamentBundle(bundle));
  });
});
