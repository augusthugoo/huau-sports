/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { updateLocalTeamRoster, type TournamentDaySnapshot } from "./TournamentDayEngine";
import {
  buildPublicLive,
  createQaFixture,
  participantImpact,
  type TournamentDayReformSnapshot,
} from "./TournamentDayReformEngine";

function base(): TournamentDayReformSnapshot {
  return {
    schemaVersion: 1,
    tournamentId: "t-epic",
    baseRevision: 7,
    createdAt: Date.now(),
    workspace: {
      core: {
        tournament: { id: "t-epic", slug: "epic", name: "Epic QA", startAt: 1_800_000_000, courtCount: 4 },
        settings: { dailyStart: "09:00", dailyEnd: "20:00", defaultMatchMinutes: 30, minimumRestSlots: 1 },
        categories: [{ id: "old", name: "Old category", entryType: "individual" }],
        summary: { completedStandardMatches: 1 },
      },
      participants: {
        players: [{ id: "old-player", organizationPersonId: "old-person", displayName: "Old player", sportGender: "male", playerStatus: "confirmed" }],
        playerCategories: [{ playerProfileId: "old-player", categoryId: "old", partnerProfileId: null }],
      },
      standard: {
        entries: [{ id: "old-entry", categoryId: "old", displayName: "Old player", sourceKey: "old-player", status: "ready" }],
        groups: [],
        matches: [],
        drawSessions: [],
        standings: [],
        crossGroup: [],
        categoryProgress: [],
        competitions: [],
      },
      schedule: { schedule: [] },
    },
    team: { profiles: [], categories: [] },
  };
}

describe("epic Tournament Day corrections", () => {
  it("keeps the private QA fixture isolated from pre-existing tournament state", () => {
    const qa = createQaFixture(base());
    expect(qa.workspace.participants.players).toHaveLength(65);
    expect(qa.workspace.participants.players.some((player: any) => player.id === "old-player")).toBe(false);
    expect(qa.workspace.core.categories.map((category: any) => category.id).sort()).toEqual(["qa-team-40", "qa-team-50"]);
    expect(qa.team.categories).toHaveLength(2);
  });

  it("counts a Team encounter once in no-show schedule impact even when it has five rubber rows", () => {
    const qa = createQaFixture(base());
    const category = qa.team.categories.find((row: any) => row.id === "qa-team-40") as any;
    const team = category.entries.find((entry: any) => entry.roster.some((member: any) => member.name === "QA 01"));
    const encounter = category.encounters.find((row: any) => row.entryAId === team.id || row.entryBId === team.id);
    qa.workspace.schedule.schedule.push(
      ...encounter.matches.map((match: any) => ({
        id: `schedule:${match.id}`,
        scheduleUnitId: `team:${category.id}:${encounter.id}`,
        categoryId: category.id,
        categoryEntryType: "team",
        encounterId: encounter.id,
        matchId: match.id,
        entryAId: encounter.entryAId,
        entryBId: encounter.entryBId,
      })),
    );
    expect(participantImpact(qa, "local-player:qa-1").scheduledRows).toBe(1);
  });

  it("allows future roster additions after results when substitutes are enabled without rewriting history", () => {
    const qa = createQaFixture(base());
    const category = qa.team.categories.find((row: any) => row.id === "qa-team-40") as any;
    expect(category.format.roster.substitutesAllowed).toBe(true);
    const entry = category.entries[0];
    const encounter = category.encounters.find((row: any) => row.entryAId === entry.id || row.entryBId === entry.id);
    encounter.matches[0].status = "finished";
    encounter.matches[0].resultStatus = "local";
    encounter.matches[0].winnerSide = "A";
    encounter.matches[0].scoreA = 15;
    encounter.matches[0].scoreB = 10;
    const historical = JSON.stringify(encounter.matches[0]);

    const extraProfile = (qa.team.profiles as any[]).find((profile: any) => profile.displayName === "QA 65");
    updateLocalTeamRoster(
      qa as TournamentDaySnapshot,
      category.id,
      entry.id,
      [
        ...entry.roster,
        {
          personId: extraProfile.personId,
          name: extraProfile.displayName,
          sportGender: extraProfile.sportGender,
          role: "substitute",
        },
      ],
    );

    expect(entry.roster).toHaveLength(5);
    expect(JSON.stringify(encounter.matches[0])).toBe(historical);
  });

  it("publishes Team rubber lineup names without exposing private profile identifiers", () => {
    const qa = createQaFixture(base());
    const category = qa.team.categories.find((row: any) => row.id === "qa-team-40") as any;
    const encounter = category.encounters[0];
    const entryA = category.entries.find((entry: any) => entry.id === encounter.entryAId);
    const entryB = category.entries.find((entry: any) => entry.id === encounter.entryBId);
    encounter.lineups = [entryA, entryB].map((entry: any) => ({
      entryId: entry.id,
      status: "locked",
      assignments: category.format.encounter.rubbers.map((rubber: any) => ({
        rubberKey: rubber.key,
        personIds: entry.roster
          .filter((member: any) => rubber.gender === "male" ? member.sportGender === "male" : rubber.gender === "female" ? member.sportGender === "female" : true)
          .slice(0, rubber.mode === "doubles" ? 2 : 1)
          .map((member: any) => member.personId),
      })),
    }));
    const live = buildPublicLive(qa);
    const published = live.results.team.find((row: any) => row.encounterId === encounter.id);
    expect(published.rubbers[0].lineupA.length).toBeGreaterThan(0);
    expect(published.rubbers[0].lineupA[0]).toMatch(/^QA /);
    expect(JSON.stringify(live)).not.toContain("local-person:qa-");
  });
});
