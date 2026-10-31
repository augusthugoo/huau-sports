import { describe, expect, it } from "vitest";
import { projectTournamentManagerStatus, summarizeTournamentDaySession, tournamentManagerPaths } from "./TournamentManagerStatus";

const remote = { hasPublishedSnapshot: true, publishedRevision: 17,
  syncStatus: "idle" as const, finalizedAt: null };

describe("Tournament Manager L1.0 (solo lectura)", () => {
  it("distingue ausencia de sesión de una lectura fallida", () => {
    expect(projectTournamentManagerStatus(null, null).local).toBe("absent");
    expect(projectTournamentManagerStatus(null, null, true).local).toBe("unknown");
    expect(projectTournamentManagerStatus(null, remote, false, true).checkpoint).toBe("unknown");
  });

  it("reconoce cambios locales sin llamarlos checkpoint publicado", () => {
    const local = summarizeTournamentDaySession({ dirty: true, updatedAt: 123456,
      snapshot: { localMeta: { publicDirty: { structure: 2, live: 0,
        structureRevision: 5, liveRevision: 3, lastStructurePublishedAt: 50,
        lastLivePublishedAt: 60 } } } });
    const result = projectTournamentManagerStatus(local, null);
    expect(result.local).toBe("dirty");
    expect(result.checkpoint).toBe("unknown");
    expect(result.structure).toEqual({ revision: 5, dirty: true });
    expect(result.live).toEqual({ revision: 3, dirty: false });
  });

  it("no confunde puntero reportado por D1 con comprobación del objeto R2", () => {
    const status = projectTournamentManagerStatus(null, remote);
    expect(status.checkpoint).toBe("reported");
    expect(status.revision).toBe(17);
    expect(status.structure).toBeNull();
    expect(status.live).toBeNull();
  });

  it("separa estructura pública de resultados públicos", () => {
    const local = summarizeTournamentDaySession({ dirty: false,
      snapshot: { localMeta: { publicDirty: { structure: 0, live: 3,
        structureRevision: 6, liveRevision: 4, lastStructurePublishedAt: 60,
        lastLivePublishedAt: null } } } });
    const result = projectTournamentManagerStatus(local, remote);
    expect(result.structure).toEqual({ revision: 6, dirty: false });
    expect(result.live).toEqual({ revision: null, dirty: true });
  });

  it("no presupone que no hay checkpoint ante fallo de API", () => {
    const result = projectTournamentManagerStatus(null,
      { ...remote, syncStatus: "failed" }, false, false);
    expect(result.sync).toBe("failed");
    expect(projectTournamentManagerStatus(null, remote, false, true).checkpoint).toBe("unknown");
    expect(projectTournamentManagerStatus(null,
      { ...remote, hasPublishedSnapshot: false }).checkpoint).toBe("not-recorded");
  });

  it("preserva rutas existentes con identificadores escapados", () => {
    expect(tournamentManagerPaths("org test", "torneo 1", "slug-x")).toEqual({
      admin: "/admin/organizations/org%20test/tournaments/torneo%201/manage",
      day: "/admin/organizations/org%20test/tournaments/torneo%201/day",
      tv: "/admin/organizations/org%20test/tournaments/torneo%201/day?view=tv",
      public: "/tournaments/slug-x",
    });
  });

  it("ignora metadatos incompletos sin modificar snapshots", () => {
    const source = { dirty: false, snapshot: { localMeta: {} } };
    const before = JSON.stringify(source);
    const local = summarizeTournamentDaySession(source);
    expect(local?.publicDirty).toBeNull();
    expect(JSON.stringify(source)).toBe(before);
  });
});
