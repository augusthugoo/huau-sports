import { describe, expect, it } from "vitest";
import { buildCompetitionFromGroups } from "@huau/core";
import { applyOrganizerResultOperations, validateOrganizerResultOperations } from "../TournamentOrganizerDayOps";
import type { TournamentDaySnapshot } from "../TournamentDayEngine";

describe("Organizer Day result operation authorization", () => {
  it("only permits score commands, not arbitrary snapshots or structure mutations", () => {
    expect(() => validateOrganizerResultOperations({ snapshot: { groups: [] } })).toThrow("ORGANIZER_DAY_INVALID_OPERATIONS");
    expect(() => validateOrganizerResultOperations([{kind:"structure", categoryId:"c", encounterId:"e", groups:[]}])).toThrow("ORGANIZER_DAY_INVALID_OPERATION");
  });
  it("requires valid nonnegative integer scores and rejects ties", () => {
    expect(() => validateOrganizerResultOperations([{kind:"standard",categoryId:"c",encounterId:"e",result:{scoreA:3,scoreB:0}}])).not.toThrow();
    for (const scoreA of [-1, 2.5, 1000, "11", 0]) {
      expect(() => validateOrganizerResultOperations([{kind:"standard",categoryId:"c",encounterId:"e",result:{scoreA,scoreB:0}}])).toThrow();
    }
  });
  it("refuses duplicate mutations and oversized batches", () => {
    const cmd={kind:"standard",categoryId:"c",encounterId:"e",result:{scoreA:4,scoreB:0}};
    expect(() => validateOrganizerResultOperations([cmd,cmd])).toThrow("ORGANIZER_DAY_DUPLICATE_RESULT");
    expect(() => validateOrganizerResultOperations(Array.from({length:601},()=>cmd))).toThrow("ORGANIZER_DAY_INVALID_OPERATIONS");
  });
  it("accepts pending group fixtures with both players and rejects unassigned sides", () => {
    // Core intentionally creates group fixtures with status=pending until a score arrives.
    const entries = ["Ana", "Bea", "Carla", "Dani"].map((name, i) => ({
      id: `e${i + 1}`, name, participantIds: [`p${i + 1}`], rating: 3.5,
    }));
    const competition = buildCompetitionFromGroups({
      id: "comp1", categoryId: "c1",
      groups: [{ id: "g1", name: "Grupo A", entries }],
    });
    const encounter = competition.encounters[0]!;
    expect(encounter.status).toBe("pending");
    expect(encounter.entryA).toBeTruthy();
    expect(encounter.entryB).toBeTruthy();
    const base: TournamentDaySnapshot = {
      schemaVersion: 1, tournamentId: "t1", baseRevision: 1, createdAt: Date.now(),
      workspace: {
        core: { tournament: { id: "t1", slug: "test", name: "Torneo", courtCount: 2 },
          settings: {}, categories: [{ id: "c1", name: "Singles", entryType: "individual" }], summary: {} },
        participants: { players: [], playerCategories: [] },
        standard: {
          entries: entries.map((e) => ({ id: e.id, categoryId: "c1", displayName: e.name, status: "ready" })),
          groups: [], matches: [], drawSessions: [], standings: [], crossGroup: [], categoryProgress: [],
          competitions: [competition],
        },
        schedule: { schedule: [] },
      },
      team: { profiles: [], categories: [] },
    };
    const operation = { kind: "standard", categoryId: "c1", encounterId: encounter.id,
      result: { scoreA: 11, scoreB: 8 } };
    const updated = applyOrganizerResultOperations(base, [operation]);
    const match = updated.workspace.standard.matches.find((row: { encounterId?: string }) => row.encounterId === encounter.id);
    expect(match).toMatchObject({ status: "finished", scoreA: 11, scoreB: 8 });
    expect(updated.workspace.standard.standings.some((row: { categoryId?: string }) => row.categoryId === "c1")).toBe(true);

    const invalid = structuredClone(base);
    invalid.workspace.standard.competitions[0].encounters[0].entryB = null;
    expect(() => applyOrganizerResultOperations(invalid, [operation])).toThrow("ORGANIZER_DAY_MATCH_NOT_READY");
  });

  it("normalizes team result sets and disallows arbitrary permissions", () => {
    const result=validateOrganizerResultOperations([{kind:"team",categoryId:"c",encounterId:"e",matchId:"m",sets:[{scoreA:11,scoreB:5}],sideAPlayerIds:["a"],sideBPlayerIds:["b"],permissions:["admin"]}]);
    expect(result).toEqual([{kind:"team",categoryId:"c",encounterId:"e",matchId:"m",sets:[{scoreA:11,scoreB:5}],sideAPlayerIds:["a"],sideBPlayerIds:["b"]}]);
  });
});
