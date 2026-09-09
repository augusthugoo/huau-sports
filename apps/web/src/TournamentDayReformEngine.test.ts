import { describe, expect, it } from "vitest";
import {
  buildPublicLive,
  buildPublicStructure,
  createQaFixture,
  ensureDayLocalMeta,
  previewAdminMerge,
  publicReadModelHasPrivateKeys,
  setParticipantNoShow,
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
