/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  buildCompetitionFromGroups,
  generateFinalPhase,
  type Competition,
} from "@huau/core";
import { syncStandardCompetition } from "./TournamentDayEngine";
import {
  activeDayParticipantCount,
  buildPublicLive,
  buildPublicStructure,
  clearDayCategoryResults,
  createQaFixture,
  ensureDayLocalMeta,
  previewAdminMerge,
  publicReadModelHasPrivateKeys,
  regenerateGlobalSchedule,
  rebuildDayStandardFinalPhase,
  removeParticipantFromCategory,
  setParticipantNoShow,
  swapDayStandardFirstRoundEntry,
  updateDayParticipant,
  type TournamentDayReformSnapshot,
} from "./TournamentDayReformEngine";

type QaPlayer = {
  id: string;
  sportGender?: string;
};

type QaRosterMember = {
  personId: string;
};

type QaTeamEntry = {
  roster: QaRosterMember[];
};

type QaEncounter = {
  roundNumber?: number;
};

type QaTeamCategory = {
  id: string;
  entries: QaTeamEntry[];
  encounters: QaEncounter[];
};

type QaScheduleRow = {
  provisional?: boolean;
  roundLabel?: string | null;
  stage?: string;
  encounterId?: string | null;
  startAt?: number | null;
  endAt?: number | null;
  sideA?: string | null;
  sideB?: string | null;
  courtLabel?: string | null;
};

type QaStandardMatchRow = {
  encounterId?: string | null;
  scheduleStart?: number | null;
  courtLabel?: string | null;
};

type QaPlayerCategoryRow = {
  playerProfileId?: string | null;
  categoryId?: string | null;
};

type QaStandardEntryRow = {
  categoryId?: string | null;
};

function snapshot(): TournamentDayReformSnapshot {
  return {
    schemaVersion: 1,
    tournamentId: "t1",
    baseRevision: 1,
    createdAt: Date.now(),
    workspace: {
      core: {
        tournament: { id: "t1", slug: "qa", name: "QA", startAt: 1_800_000_000, courtCount: 2 },
        settings: { dailyStart: "09:00", dailyEnd: "18:00", defaultMatchMinutes: 30, minimumRestSlots: 1 },
        categories: [{ id: "c1", name: "Singles", entryType: "individual" }],
        summary: {},
      },
      participants: {
        players: [
          {
            id: "p1",
            organizationPersonId: "person1",
            displayName: "Ana",
            contact: "private@example.com",
            sportGender: "female",
            duprSingles: 3.5,
            duprDoubles: 3.4,
            playerStatus: "confirmed",
          },
        ],
        playerCategories: [{ playerProfileId: "p1", categoryId: "c1", partnerProfileId: null }],
      },
      standard: {
        entries: [{ id: "e1", categoryId: "c1", displayName: "Ana", sourceKey: "p1", localProfileIds: ["p1"] }],
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

describe("Tournament Day reform ownership", () => {
  it("keeps a local tombstone across Admin refresh", () => {
    const local = snapshot();
    const meta = ensureDayLocalMeta(local);
    setParticipantNoShow(local, "p1");
    const incoming = snapshot();
    incoming.baseRevision = 2;
    const preview = previewAdminMerge(local, incoming);
    expect(preview.items.some((item) => item.id === "p1" && item.conflict)).toBe(false);
    expect(meta.participantTombstones.p1).toBeTruthy();
  });

  it("does not silently overwrite a local participant override", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);
    updateDayParticipant(local, "p1", { duprSingles: 3.7 });
    const incoming = snapshot();
    incoming.workspace.participants.players[0].duprSingles = 3.6;
    const preview = previewAdminMerge(local, incoming);
    expect(preview.items.find((item) => item.id === "p1")?.conflict).toBe(true);
    expect(local.workspace.participants.players[0].duprSingles).toBe(3.7);
  });
});

describe("Standard participant withdrawal", () => {
  it("removes an imported entry identified by organization person id", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);

    local.workspace.standard.entries = [
      {
        id: "imported-entry-1",
        categoryId: "c1",
        displayName: "Ana",
        status: "confirmed",
        sourceKind: "registration",
        sourceKey: "registration-1",
        participantIds: "person1",
      },
    ];

    removeParticipantFromCategory(local, "p1", "c1");

    expect(
      (local.workspace.participants.playerCategories as QaPlayerCategoryRow[]).some(
        (row) =>
          String(row.playerProfileId) === "p1" &&
          String(row.categoryId) === "c1",
      ),
    ).toBe(false);

    expect(
      (local.workspace.standard.entries as QaStandardEntryRow[]).some(
        (entry) => String(entry.categoryId) === "c1",
      ),
    ).toBe(false);
  });
});

describe("Tournament Day participant hardening", () => {
  it("counts only active players in the operational header", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);

    expect(activeDayParticipantCount(local)).toBe(1);

    setParticipantNoShow(local, "p1");

    expect(activeDayParticipantCount(local)).toBe(0);
  });

  it("invalidates a stale Standard structure when membership changes before results", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);

    local.workspace.participants.players.push({
      id: "p2",
      organizationPersonId: "person2",
      displayName: "Beatriz",
      sportGender: "female",
      playerStatus: "confirmed",
    } as any);

    local.workspace.participants.playerCategories.push({
      playerProfileId: "p2",
      categoryId: "c1",
      partnerProfileId: null,
    } as any);

    local.workspace.standard.entries.push({
      id: "e2",
      categoryId: "c1",
      displayName: "Beatriz",
      sourceKey: "p2",
      localProfileIds: ["p2"],
      status: "ready",
    } as any);

    const competition = buildCompetitionFromGroups({
      id: "competition:c1",
      categoryId: "c1",
      groups: [{
        id: "g1",
        name: "A",
        entries: [
          {
            id: "e1",
            name: "Ana",
            participantIds: ["p1"],
            rating: 0,
          },
          {
            id: "e2",
            name: "Beatriz",
            participantIds: ["p2"],
            rating: 0,
          },
        ],
      }],
      format: {
        playoffMode: "league_only",
      },
    });

    local.workspace.standard.competitions = [competition];
    syncStandardCompetition(local, competition);

    local.workspace.schedule.schedule = [{
      id: "schedule:e1-e2",
      categoryId: "c1",
      encounterId: competition.encounters[0]?.id,
      entryAId: "e1",
      entryBId: "e2",
    }] as any[];

    removeParticipantFromCategory(local, "p1", "c1");

    expect(
      (local.workspace.standard.competitions as Competition[])
        .some((row) => row.categoryId === "c1"),
    ).toBe(false);

    expect(
      (local.workspace.schedule.schedule as any[])
        .some((row) => String(row.categoryId) === "c1"),
    ).toBe(false);
  });
});

describe("provisional Standard playoff scheduling", () => {
  it("reserves semifinals/final before groups finish and binds those slots when qualifiers resolve", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);

    const names = ["Ana", "Beatriz", "Cecilia", "Daniela", "Elena"];

    local.workspace.participants.players = names.map((name, index) => ({
      id: `p${index + 1}`,
      organizationPersonId: `person${index + 1}`,
      displayName: name,
      sportGender: "female",
      playerStatus: "confirmed",
    }));

    local.workspace.participants.playerCategories = names.map((_, index) => ({
      playerProfileId: `p${index + 1}`,
      categoryId: "c1",
      partnerProfileId: null,
    }));

    local.workspace.standard.entries = names.map((name, index) => ({
      id: `e${index + 1}`,
      categoryId: "c1",
      displayName: name,
      sourceKey: `p${index + 1}`,
      localProfileIds: [`p${index + 1}`],
      status: "ready",
    }));

    const competition = buildCompetitionFromGroups({
      id: "competition:c1",
      categoryId: "c1",
      groups: [
        {
          id: "g1",
          name: "A",
          entries: names.map((name, index) => ({
            id: `e${index + 1}`,
            name,
            participantIds: [`p${index + 1}`],
            rating: 0,
          })),
        },
      ],
      format: {
        playoffMode: "top4_semis",
        bronzeMatch: false,
      },
    });

    local.workspace.standard.competitions = [competition];
    syncStandardCompetition(local, competition);
    regenerateGlobalSchedule(local);

    const reserved = (local.workspace.schedule.schedule as QaScheduleRow[]).filter(
      (row) => row.provisional,
    );

    expect(
      reserved.filter((row) => row.roundLabel === "Semifinal"),
    ).toHaveLength(2);
    expect(
      reserved.filter((row) => row.roundLabel === "Final"),
    ).toHaveLength(1);

    const groupEnd = Math.max(
      ...(local.workspace.schedule.schedule as QaScheduleRow[])
        .filter((row) => row.stage === "group")
        .map((row) => Number(row.endAt)),
    );
    const semifinalStart = Math.min(
      ...reserved
        .filter((row) => row.roundLabel === "Semifinal")
        .map((row) => Number(row.startAt)),
    );

    expect(semifinalStart - groupEnd).toBeGreaterThanOrEqual(30 * 60);

    for (const encounter of competition.encounters) {
      if (encounter.stage !== "group" || !encounter.entryA || !encounter.entryB) continue;
      encounter.status = "finished";
      encounter.scoreA = 15;
      encounter.scoreB = 10;
      encounter.winnerEntryId = encounter.entryA.id;
      encounter.sets = [{ scoreA: 15, scoreB: 10 }];
    }

    const withFinals = generateFinalPhase(competition);
    local.workspace.standard.competitions = [withFinals];
    syncStandardCompetition(local, withFinals);

    const semiRow = (local.workspace.schedule.schedule as QaScheduleRow[]).find(
      (row) => row.encounterId === "playoff:semi:1",
    );
    const semiMatch = (local.workspace.standard.matches as QaStandardMatchRow[]).find(
      (row) => row.encounterId === "playoff:semi:1",
    );

    if (!semiRow || !semiMatch) {
      throw new Error("EXPECTED_SCHEDULED_SEMIFINAL");
    }

    expect(semiRow.provisional).toBe(false);
    expect(semiRow.sideA).toBeTruthy();
    expect(semiRow.sideB).toBeTruthy();
    expect(semiMatch.scheduleStart).toBe(semiRow.startAt);
    expect(semiMatch.courtLabel).toBe(semiRow.courtLabel);

    regenerateGlobalSchedule(local);

    const regeneratedFinal = (local.workspace.schedule.schedule as QaScheduleRow[]).find(
      (row) => row.encounterId === "playoff:final",
    );

    if (!regeneratedFinal) {
      throw new Error("EXPECTED_REGENERATED_FINAL");
    }

    expect(regeneratedFinal).toBeTruthy();
    expect(regeneratedFinal.roundLabel).toBe("Final");
    expect(Number(regeneratedFinal.startAt)).toBeGreaterThan(0);
  });
});

describe("rebuilding Standard final phase", () => {
  it("preserves group results and rebuilds the playoff without immediate group rematches", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);

    const base = buildCompetitionFromGroups({
      id: "competition:c1",
      categoryId: "c1",
      groups: [
        {
          id: "group-A",
          name: "A",
          entries: ["A1", "A2", "A3", "A4", "A5"].map((id, index) => ({
            id,
            name: id,
            participantIds: [`pa${index + 1}`],
            rating: 10 - index,
          })),
        },
        {
          id: "group-B",
          name: "B",
          entries: ["B1", "B2", "B3", "B4", "B5"].map((id, index) => ({
            id,
            name: id,
            participantIds: [`pb${index + 1}`],
            rating: 10 - index,
          })),
        },
      ],
      format: {
        qualifiersPerGroup: 4,
        wildcardQualifiers: 0,
        playoffMode: "standard",
        avoidGroupRematches: true,
        bronzeMatch: false,
      },
    });

    for (const encounter of base.encounters) {
      if (encounter.stage !== "group" || !encounter.entryA || !encounter.entryB) continue;

      const rankA = Number(encounter.entryA.id.slice(1));
      const rankB = Number(encounter.entryB.id.slice(1));
      const aWins = rankA < rankB;

      encounter.status = "finished";
      encounter.scoreA = aWins ? 15 : 6;
      encounter.scoreB = aWins ? 6 : 15;
      encounter.winnerEntryId = aWins ? encounter.entryA.id : encounter.entryB.id;
      encounter.sets = [{
        scoreA: encounter.scoreA,
        scoreB: encounter.scoreB,
      }];
    }

    const groupBefore = base.encounters
      .filter((encounter) => encounter.stage === "group")
      .map((encounter) => ({
        id: encounter.id,
        status: encounter.status,
        scoreA: encounter.scoreA,
        scoreB: encounter.scoreB,
        winnerEntryId: encounter.winnerEntryId,
      }));

    const stale = generateFinalPhase(base);

    const quarterfinals = stale.encounters.filter(
      (encounter) =>
        encounter.stage !== "group" &&
        encounter.stage !== "consolation" &&
        encounter.roundNumber === 1,
    );

    const q1 = quarterfinals[0];
    const groupA = stale.groups.find((group) => group.id === "group-A");

    if (!q1 || !groupA?.entries[0] || !groupA.entries[3]) {
      throw new Error("EXPECTED_STALE_QUARTERFINAL");
    }

    // Simula el bug real del torneo: A1-A4.
    q1.entryA = groupA.entries[0];
    q1.entryB = groupA.entries[3];
    q1.status = "finished";
    q1.scoreA = 15;
    q1.scoreB = 10;
    q1.winnerEntryId = q1.entryA.id;
    q1.sets = [{ scoreA: 15, scoreB: 10 }];

    local.workspace.standard.competitions = [stale];
    syncStandardCompetition(local, stale);

    rebuildDayStandardFinalPhase(local, "c1");

    const rebuilt = (
      local.workspace.standard.competitions as Competition[]
    ).find((competition) => competition.categoryId === "c1");

    if (!rebuilt) {
      throw new Error("EXPECTED_REBUILT_FINAL_PHASE");
    }

    const groupAfter = rebuilt.encounters
      .filter((encounter) => encounter.stage === "group")
      .map((encounter) => ({
        id: encounter.id,
        status: encounter.status,
        scoreA: encounter.scoreA,
        scoreB: encounter.scoreB,
        winnerEntryId: encounter.winnerEntryId,
      }));

    expect(groupAfter).toEqual(groupBefore);

    const rebuiltQuarterfinals = rebuilt.encounters.filter(
      (encounter) =>
        encounter.stage !== "group" &&
        encounter.stage !== "consolation" &&
        encounter.roundNumber === 1,
    );

    const rebuiltPairs = rebuiltQuarterfinals.map((encounter) => [
      encounter.entryA?.id,
      encounter.entryB?.id,
    ]);

    expect(rebuiltPairs).toHaveLength(4);

    expect(
      rebuiltPairs.every(
        ([left, right]) =>
          Boolean(left) &&
          Boolean(right) &&
          String(left).charAt(0) !== String(right).charAt(0),
      ),
    ).toBe(true);

    expect(
      new Set(rebuiltPairs.flat().filter(Boolean)),
    ).toHaveLength(8);

    expect(
      rebuilt.encounters
        .filter((encounter) => encounter.stage !== "group")
        .every((encounter) => encounter.status !== "finished"),
    ).toBe(true);
  });
});

describe("manual Standard first-round override", () => {
  it("swaps qualifiers without touching completed group results", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);

    const base = buildCompetitionFromGroups({
      id: "competition:c1",
      categoryId: "c1",
      groups: [
        {
          id: "group-A",
          name: "A",
          entries: ["A1", "A2", "A3", "A4"].map(
            (id, index) => ({
              id,
              name: id,
              participantIds: [`pa${index + 1}`],
              rating: 10 - index,
            }),
          ),
        },
        {
          id: "group-B",
          name: "B",
          entries: ["B1", "B2", "B3", "B4"].map(
            (id, index) => ({
              id,
              name: id,
              participantIds: [`pb${index + 1}`],
              rating: 10 - index,
            }),
          ),
        },
      ],
      format: {
        qualifiersPerGroup: 2,
        wildcardQualifiers: 0,
        playoffMode: "standard",
        avoidGroupRematches: true,
        bronzeMatch: false,
      },
    });

    for (const encounter of base.encounters) {
      if (
        encounter.stage !== "group" ||
        !encounter.entryA ||
        !encounter.entryB
      ) {
        continue;
      }

      const rankA = Number(encounter.entryA.id.slice(1));
      const rankB = Number(encounter.entryB.id.slice(1));
      const aWins = rankA < rankB;

      encounter.status = "finished";
      encounter.scoreA = aWins ? 15 : 7;
      encounter.scoreB = aWins ? 7 : 15;
      encounter.winnerEntryId =
        aWins ? encounter.entryA.id : encounter.entryB.id;
      encounter.sets = [{
        scoreA: encounter.scoreA,
        scoreB: encounter.scoreB,
      }];
    }

    const generated = generateFinalPhase(base);
    local.workspace.standard.competitions = [generated];
    syncStandardCompetition(local, generated);

    const groupBefore = generated.encounters
      .filter((encounter) => encounter.stage === "group")
      .map((encounter) => ({
        id: encounter.id,
        status: encounter.status,
        scoreA: encounter.scoreA,
        scoreB: encounter.scoreB,
        winnerEntryId: encounter.winnerEntryId,
      }));

    const firstBefore = generated.encounters.filter(
      (encounter) =>
        encounter.stage !== "group" &&
        encounter.stage !== "consolation" &&
        encounter.roundNumber === 1,
    );

    const target = firstBefore[0];
    const source = firstBefore[1];

    if (
      !target?.entryA ||
      !source?.entryA
    ) {
      throw new Error("EXPECTED_EDITABLE_FIRST_ROUND");
    }

    const originalTargetId = target.entryA.id;
    const replacementId = source.entryA.id;

    swapDayStandardFirstRoundEntry(
      local,
      "c1",
      target.id,
      "A",
      replacementId,
    );

    const rebuilt = (
      local.workspace.standard.competitions as Competition[]
    ).find((competition) => competition.categoryId === "c1");

    if (!rebuilt) {
      throw new Error("EXPECTED_REBUILT_COMPETITION");
    }

    const firstAfter = rebuilt.encounters.filter(
      (encounter) =>
        encounter.stage !== "group" &&
        encounter.stage !== "consolation" &&
        encounter.roundNumber === 1,
    );

    expect(
      firstAfter.find((encounter) => encounter.id === target.id)
        ?.entryA?.id,
    ).toBe(replacementId);

    expect(
      firstAfter.some(
        (encounter) =>
          encounter.id === source.id &&
          (
            encounter.entryA?.id === originalTargetId ||
            encounter.entryB?.id === originalTargetId
          ),
      ),
    ).toBe(true);

    const ids = firstAfter.flatMap((encounter) =>
      [encounter.entryA?.id, encounter.entryB?.id]
        .filter(Boolean),
    );

    expect(new Set(ids).size).toBe(ids.length);

    expect(
      rebuilt.encounters
        .filter((encounter) => encounter.stage === "group")
        .map((encounter) => ({
          id: encounter.id,
          status: encounter.status,
          scoreA: encounter.scoreA,
          scoreB: encounter.scoreB,
          winnerEntryId: encounter.winnerEntryId,
        })),
    ).toEqual(groupBefore);
  });
});

describe("clearing Standard results", () => {
  it("removes a generated final phase from the stored competition", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);

    const base = buildCompetitionFromGroups({
      id: "competition:c1",
      categoryId: "c1",
      groups: [
        {
          id: "g1",
          name: "A",
          entries: ["Ana", "Beatriz", "Cecilia", "Daniela"].map(
            (name, index) => ({
              id: `e${index + 1}`,
              name,
              participantIds: [`p${index + 1}`],
              rating: 0,
            }),
          ),
        },
      ],
      format: {
        playoffMode: "top4_semis",
        bronzeMatch: false,
      },
    });

    for (const encounter of base.encounters) {
      if (!encounter.entryA || !encounter.entryB) continue;
      encounter.status = "finished";
      encounter.scoreA = 15;
      encounter.scoreB = 8;
      encounter.winnerEntryId = encounter.entryA.id;
      encounter.sets = [{ scoreA: 15, scoreB: 8 }];
    }

    const withFinals = generateFinalPhase(base);

    local.workspace.standard.competitions = [withFinals];
    syncStandardCompetition(local, withFinals);

    clearDayCategoryResults(local, "c1");

    const rebuilt = (
      local.workspace.standard.competitions as Competition[]
    ).find((competition) => competition.categoryId === "c1");

    if (!rebuilt) {
      throw new Error("EXPECTED_REBUILT_STANDARD_COMPETITION");
    }

    expect(rebuilt.finalGenerated).toBe(false);
    expect(
      rebuilt.encounters.every((encounter) => encounter.stage === "group"),
    ).toBe(true);
    expect(
      rebuilt.encounters.every((encounter) => encounter.status !== "finished"),
    ).toBe(true);
  });
});

describe("public read models", () => {
  it("sanitizes private contact/payment identity fields", () => {
    const local = snapshot();
    ensureDayLocalMeta(local);
    const structure = buildPublicStructure(local);
    const live = buildPublicLive(local);
    expect(publicReadModelHasPrivateKeys(structure)).toBe(false);
    expect(publicReadModelHasPrivateKeys(live)).toBe(false);
    expect(JSON.stringify(structure)).not.toContain("private@example.com");
  });
});

describe("private QA fixture", () => {
  it("builds 65 players with 6 +40 teams and 7 +50 teams without duplicate roster members", () => {
    const qa = createQaFixture(snapshot());
    const qaPlayers = (qa.workspace.participants.players as QaPlayer[]).filter((player) =>
      player.id.startsWith("local-player:qa-"),
    );
    expect(qaPlayers).toHaveLength(65);
    expect(qaPlayers.filter((player) => player.sportGender === "male")).toHaveLength(33);
    expect(qaPlayers.filter((player) => player.sportGender === "female")).toHaveLength(32);

    const qaCategories = qa.team.categories as QaTeamCategory[];
    const c40 = qaCategories.find((category) => category.id === "qa-team-40");
    const c50 = qaCategories.find((category) => category.id === "qa-team-50");
    expect(c40).toBeDefined();
    expect(c50).toBeDefined();
    if (!c40 || !c50) throw new Error("QA_TEAM_CATEGORY_MISSING");

    expect(c40.entries).toHaveLength(6);
    expect(c50.entries).toHaveLength(7);
    for (const category of [c40, c50]) {
      const ids = category.entries.flatMap((entry) => entry.roster.map((member) => member.personId));
      expect(new Set(ids).size).toBe(ids.length);
      expect(category.entries.every((entry) => entry.roster.length >= 4 && entry.roster.length <= 6)).toBe(true);
    }
    const c50Rounds = new Set(c50.encounters.map((encounter) => encounter.roundNumber));
    expect(c50Rounds.size).toBe(7);
  });
});
