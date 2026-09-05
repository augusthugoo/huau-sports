/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  advanceLiveDraw,
  balancedGroupSizes,
  buildCompetitionFromGroups,
  calculateGroupStandings,
  calculateTeamStandings,
  createMixedFiveRubberTeamFormat,
  createSeniorTeamCupFormat,
  createLiveDrawState,
  crossGroupStatsForEntry,
  distributeEntriesRandomly,
  distributeEntriesSnake,
  generateFinalPhase,
  generateTeamFinalPhasePlan,
  generateTeamRoundRobinEncounters,
  generateTournamentSchedule,
  groupsFromEntryIds,
  normalizeStandardFormat,
  scoreTeamEncounter,
  validateTeamLineup,
  validateTeamRoster,
  withEncounterResult,
  type Competition,
  type StandardCompetitionFormat,
  type TeamFormat,
  type TeamLineupAssignment,
  type TeamRosterMember,
  type TeamRubberResult,
  type TeamStandingEncounter,
  type TournamentEntry,
} from "@huau/core";

export type TournamentDaySnapshot = {
  schemaVersion: 1;
  tournamentId: string;
  baseRevision: number;
  createdAt: number;
  workspace: any;
  team: any;
};

export type StandardResultInput =
  | { scoreA: number; scoreB: number }
  | { sets: Array<{ scoreA: number; scoreB: number }> };

export type TeamSetInput = { scoreA: number; scoreB: number };

export function cloneDay<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function localId(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function categoryById(snapshot: TournamentDaySnapshot, categoryId: string) {
  return snapshot.workspace.core.categories.find((category: any) => category.id === categoryId);
}

function standardEntryModel(snapshot: TournamentDaySnapshot, row: any): TournamentEntry {
  const profiles = snapshot.workspace.participants.players as any[];
  const byProfileId = new Map(profiles.map((profile) => [String(profile.id), profile] as const));
  const resolved = new Set<string>();

  const addProfile = (profileId: string) => {
    const profile = byProfileId.get(profileId);
    if (!profile) return false;
    resolved.add(
      String(
        profile.organizationPersonId ||
          profile.userId ||
          profile.id ||
          `profile:${profileId}`,
      ),
    );
    return true;
  };

  if (Array.isArray(row.localProfileIds)) {
    row.localProfileIds
      .map((value: unknown) => String(value))
      .filter(Boolean)
      .forEach(addProfile);
  }

  const sourceKey = typeof row.sourceKey === "string" ? row.sourceKey : "";
  if (sourceKey && !resolved.size) {
    if (!addProfile(sourceKey) && row.sourceKind === "legacy_pair") {
      sourceKey.split(":").filter(Boolean).forEach(addProfile);
    }
  }

  // Imported/legacy rows can lack source metadata. Names are only a final
  // fallback so the local scheduler can still enforce rest slots.
  if (!resolved.size && typeof row.members === "string" && row.members) {
    row.members
      .split(" · ")
      .map((name: string) => name.trim())
      .filter(Boolean)
      .forEach((name: string) => resolved.add(`local-name:${name}`));
  }

  return {
    id: row.id,
    name: row.displayName,
    participantIds: [...resolved],
    rating: Number(row.seedRating ?? 0),
  };
}

function standardFormatFor(snapshot: TournamentDaySnapshot, categoryId: string): StandardCompetitionFormat {
  const competition = snapshot.workspace.standard.competitions.find(
    (item: Competition) => item.categoryId === categoryId,
  );
  if (competition) return normalizeStandardFormat(competition.format);
  const category = categoryById(snapshot, categoryId);
  if (!category?.configJson) return normalizeStandardFormat();
  try {
    return normalizeStandardFormat(JSON.parse(category.configJson) as Partial<StandardCompetitionFormat>);
  } catch {
    return normalizeStandardFormat();
  }
}

function standardCompetitionByCategory(snapshot: TournamentDaySnapshot, categoryId: string): Competition | null {
  return (
    snapshot.workspace.standard.competitions.find(
      (competition: Competition) => competition.categoryId === categoryId,
    ) ?? null
  );
}

function setStandardCompetition(snapshot: TournamentDaySnapshot, competition: Competition) {
  const competitions = snapshot.workspace.standard.competitions as Competition[];
  const index = competitions.findIndex((candidate) => candidate.categoryId === competition.categoryId);
  if (index >= 0) competitions[index] = competition;
  else competitions.push(competition);
  syncStandardCompetition(snapshot, competition);
}

export function syncStandardCompetition(
  snapshot: TournamentDaySnapshot,
  competition: Competition,
) {
  const category = categoryById(snapshot, competition.categoryId);
  const oldMatches = (snapshot.workspace.standard.matches as any[]).filter(
    (match) => match.categoryId === competition.categoryId,
  );
  const oldByEncounter = new Map(oldMatches.map((match) => [match.encounterId, match] as const));

  const nextMatches = competition.encounters.map((encounter) => {
    const previous = oldByEncounter.get(encounter.id);
    const sets = (encounter.sets ?? []).map((set, index) => ({
      setNumber: index + 1,
      scoreA: set.scoreA,
      scoreB: set.scoreB,
      winnerSide: set.scoreA > set.scoreB ? "A" : "B",
    }));
    return {
      ...(previous ?? {}),
      encounterId: encounter.id,
      categoryId: competition.categoryId,
      categoryName: category?.name ?? "",
      stage: encounter.stage,
      groupId: encounter.groupId,
      groupName: encounter.groupName,
      roundLabel: encounter.roundLabel,
      roundNumber: encounter.roundNumber,
      legNumber: encounter.legNumber,
      entryAId: encounter.entryA?.id ?? null,
      sideA: encounter.entryA?.name ?? null,
      entryBId: encounter.entryB?.id ?? null,
      sideB: encounter.entryB?.name ?? null,
      status: encounter.status,
      winnerEntryId: encounter.winnerEntryId,
      matchId: previous?.matchId ?? `local-standard-match:${encounter.id}`,
      bestOf: encounter.bestOf,
      pointTarget: encounter.pointTarget,
      scoreA: encounter.scoreA,
      scoreB: encounter.scoreB,
      resultStatus:
        encounter.status === "finished"
          ? previous?.resultStatus === "final" || previous?.resultStatus === "corrected"
            ? previous.resultStatus
            : "local"
          : null,
      scheduleStart: previous?.scheduleStart ?? null,
      scheduleEnd: previous?.scheduleEnd ?? null,
      courtLabel: previous?.courtLabel ?? null,
      sets,
    };
  });

  snapshot.workspace.standard.matches = [
    ...(snapshot.workspace.standard.matches as any[]).filter(
      (match) => match.categoryId !== competition.categoryId,
    ),
    ...nextMatches,
  ];

  const standings = (snapshot.workspace.standard.standings as any[]).filter(
    (standing) => standing.categoryId !== competition.categoryId,
  );
  const crossGroup = (snapshot.workspace.standard.crossGroup as any[]).filter(
    (row) => row.categoryId !== competition.categoryId,
  );

  for (const group of competition.groups) {
    const rows = calculateGroupStandings(competition, group.id);
    standings.push({
      categoryId: competition.categoryId,
      groupId: group.id,
      groupName: group.name,
      rows: rows.map((standing, index) => ({
        position: index + 1,
        entryId: standing.entry.id,
        name: standing.entry.name,
        played: standing.played,
        wins: standing.wins,
        losses: standing.losses,
        scored: standing.scored,
        conceded: standing.conceded,
        diff: standing.diff,
        rating: standing.entry.rating,
      })),
    });
    rows.forEach((standing, index) => {
      const stats = crossGroupStatsForEntry(competition, group.id, standing.entry.id);
      if (!stats) return;
      crossGroup.push({
        categoryId: competition.categoryId,
        groupId: group.id,
        groupName: group.name,
        position: index + 1,
        entryId: standing.entry.id,
        name: standing.entry.name,
        played: stats.played,
        wins: stats.wins,
        winRate: stats.winRate,
        diff: stats.diff,
        diffPerMatch: stats.diffPerMatch,
        scored: stats.scored,
        scoredPerMatch: stats.scoredPerMatch,
        method: stats.method,
        ignoredEncounterIds: stats.ignoredEncounterIds,
      });
    });
  }

  snapshot.workspace.standard.standings = standings;
  snapshot.workspace.standard.crossGroup = crossGroup;

  const groupMatchCount = competition.encounters.filter((encounter) => encounter.stage === "group").length;
  const finishedGroupMatchCount = competition.encounters.filter(
    (encounter) => encounter.stage === "group" && encounter.status === "finished",
  ).length;
  const finalMatchCount = competition.encounters.filter((encounter) => encounter.stage !== "group").length;

  snapshot.workspace.core.categories = snapshot.workspace.core.categories.map((item: any) =>
    item.id === competition.categoryId
      ? {
          ...item,
          groupMatchCount,
          finishedGroupMatchCount,
          finalMatchCount,
          structureLocked: competition.groups.length ? 1 : item.structureLocked,
          competitionStatus:
            competition.encounters.length &&
            competition.encounters.every((encounter) =>
              ["finished", "bye", "skipped"].includes(encounter.status),
            )
              ? "completed"
              : competition.finalGenerated
                ? "final_phase"
                : competition.groups.length
                  ? "group_stage"
                  : item.competitionStatus,
          configJson: JSON.stringify(competition.format),
        }
      : item,
  );

  const progress = snapshot.workspace.standard.categoryProgress as any[];
  const progressIndex = progress.findIndex((item) => item.id === competition.categoryId);
  const progressRow = {
    id: competition.categoryId,
    formatVersionId: category?.formatVersionId ?? null,
    configJson: JSON.stringify(competition.format),
    competitionStatus:
      competition.encounters.length &&
      competition.encounters.every((encounter) =>
        ["finished", "bye", "skipped"].includes(encounter.status),
      )
        ? "completed"
        : competition.finalGenerated
          ? "final_phase"
          : "group_stage",
    groupMatchCount,
    finishedGroupMatchCount,
    finalMatchCount,
  };
  if (progressIndex >= 0) progress[progressIndex] = progressRow;
  else progress.push(progressRow);

  snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).map((row) => {
    if (row.categoryId !== competition.categoryId || !row.encounterId) return row;
    const encounter = competition.encounters.find((candidate) => candidate.id === row.encounterId);
    if (!encounter) return row;
    return {
      ...row,
      entryAId: encounter.entryA?.id ?? null,
      sideA: encounter.entryA?.name ?? null,
      entryBId: encounter.entryB?.id ?? null,
      sideB: encounter.entryB?.name ?? null,
      status: encounter.status === "finished" ? "completed" : row.status,
    };
  });

  snapshot.workspace.core.summary.completedStandardMatches = (
    snapshot.workspace.standard.matches as any[]
  ).filter((match) => match.status === "finished").length;
}

export function saveLocalStandardFormat(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  patch: Partial<StandardCompetitionFormat>,
) {
  const current = standardFormatFor(snapshot, categoryId);
  const next = normalizeStandardFormat({
    ...current,
    ...patch,
    preliminary: { ...current.preliminary, ...patch.preliminary },
    medal: { ...current.medal, ...patch.medal },
  });
  snapshot.workspace.core.categories = snapshot.workspace.core.categories.map((category: any) =>
    category.id === categoryId ? { ...category, configJson: JSON.stringify(next) } : category,
  );
  const competition = standardCompetitionByCategory(snapshot, categoryId);
  if (competition) {
    if (competition.encounters.some((encounter) => encounter.status === "finished")) {
      throw new Error("STANDARD_FORMAT_AFTER_RESULTS");
    }
    const rebuilt = buildCompetitionFromGroups({
      id: competition.id,
      categoryId,
      groups: competition.groups,
      format: next,
    });
    setStandardCompetition(snapshot, rebuilt);
    snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter(
      (row) => row.categoryId !== categoryId,
    );
  }
}

export function generateLocalStandardStructure(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  groupCount: number,
  method: "snake" | "random",
) {
  const existingCompetition = standardCompetitionByCategory(snapshot, categoryId);
  if (existingCompetition?.encounters.some((encounter) => encounter.status === "finished")) {
    throw new Error("STANDARD_STRUCTURE_AFTER_RESULTS");
  }
  const rows = (snapshot.workspace.standard.entries as any[]).filter(
    (entry) =>
      entry.categoryId === categoryId &&
      entry.status !== "withdrawn" &&
      entry.status !== "rejected",
  );
  if (rows.length < 2) throw new Error("STANDARD_ENTRIES_REQUIRED");
  const groups = Math.max(1, Math.min(Math.trunc(groupCount || 1), Math.max(1, Math.floor(rows.length / 2))));
  const sizes = balancedGroupSizes(rows.length, groups);
  const models = rows.map((row) => standardEntryModel(snapshot, row));
  const distributed =
    method === "random"
      ? distributeEntriesRandomly(models, sizes)
      : distributeEntriesSnake(models, sizes);
  const competition = buildCompetitionFromGroups({
    id: standardCompetitionByCategory(snapshot, categoryId)?.id ?? localId("local-standard-competition"),
    categoryId,
    groups: distributed.map((group) => ({
      ...group,
      id: localId(`local-standard-group-${categoryId}`),
    })),
    format: standardFormatFor(snapshot, categoryId),
  });
  setStandardCompetition(snapshot, competition);
  snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter(
    (row) => row.categoryId !== categoryId,
  );
}


export function startLocalLiveDraw(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  groupCount: number,
) {
  const existingCompetition = standardCompetitionByCategory(snapshot, categoryId);
  if (existingCompetition?.encounters.some((encounter) => encounter.status === "finished")) {
    throw new Error("STANDARD_STRUCTURE_AFTER_RESULTS");
  }
  const rows = (snapshot.workspace.standard.entries as any[]).filter(
    (entry) =>
      entry.categoryId === categoryId &&
      entry.status !== "withdrawn" &&
      entry.status !== "rejected",
  );
  if (rows.length < 2) throw new Error("STANDARD_ENTRIES_REQUIRED");
  const groups = Math.max(
    1,
    Math.min(Math.trunc(groupCount || 1), Math.max(1, Math.floor(rows.length / 2))),
  );
  const sizes = balancedGroupSizes(rows.length, groups);
  const state = createLiveDrawState(rows.map((row) => String(row.id)), sizes);
  const session = {
    categoryId,
    status: state.status,
    stateJson: JSON.stringify({ ...state, groupSizes: sizes }),
    updatedAt: Date.now(),
  };
  const drawSessions = snapshot.workspace.standard.drawSessions as any[];
  const index = drawSessions.findIndex((candidate) => candidate.categoryId === categoryId);
  if (index >= 0) drawSessions[index] = session;
  else drawSessions.push(session);
  return state;
}

export function advanceLocalLiveDraw(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
) {
  const drawSessions = snapshot.workspace.standard.drawSessions as any[];
  const session = drawSessions.find((candidate) => candidate.categoryId === categoryId);
  if (!session) throw new Error("LIVE_DRAW_NOT_STARTED");
  const stored = JSON.parse(String(session.stateJson || "{}")) as any;
  const next = advanceLiveDraw(stored);
  const groupSizes = Array.isArray(stored.groupSizes)
    ? stored.groupSizes.map((value: unknown) => Math.max(0, Math.trunc(Number(value))))
    : Object.keys(next.assignments ?? {}).map((key) => (next.assignments[key] ?? []).length);
  session.status = next.status;
  session.stateJson = JSON.stringify({ ...next, groupSizes });
  session.updatedAt = Date.now();

  if (next.status === "complete") {
    const sourceRows = (snapshot.workspace.standard.entries as any[]).filter(
      (entry) =>
        entry.categoryId === categoryId &&
        entry.status !== "withdrawn" &&
        entry.status !== "rejected",
    );
    const models = sourceRows.map((row) => standardEntryModel(snapshot, row));
    const labels = Object.keys(next.assignments ?? {}).sort((a, b) => a.localeCompare(b));
    const orderedIds = labels.flatMap((label) => next.assignments[label] ?? []);
    const groups = groupsFromEntryIds(models, groupSizes, orderedIds).map((group: { id: string; name: string; entries: TournamentEntry[] }) => ({
      ...group,
      id: localId(`local-standard-group-${categoryId}`),
    }));
    const competition = buildCompetitionFromGroups({
      id: standardCompetitionByCategory(snapshot, categoryId)?.id ?? localId("local-standard-competition"),
      categoryId,
      groups,
      format: standardFormatFor(snapshot, categoryId),
    });
    setStandardCompetition(snapshot, competition);
    snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter(
      (row) => row.categoryId !== categoryId,
    );
  }
  return next;
}

export function setLocalStandardResult(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  encounterId: string,
  result: StandardResultInput,
) {
  const competition = standardCompetitionByCategory(snapshot, categoryId);
  if (!competition) throw new Error("COMPETITION_NOT_FOUND");
  const target = competition.encounters.find((encounter) => encounter.id === encounterId);
  if (!target) throw new Error("ENCOUNTER_NOT_FOUND");

  if (
    target.stage === "group" &&
    target.status === "finished" &&
    competition.finalGenerated &&
    competition.encounters.some(
      (encounter) =>
        encounter.stage !== "group" &&
        (encounter.status === "finished" || encounter.status === "in_progress"),
    )
  ) {
    throw new Error("STANDARD_RESULT_HAS_DOWNSTREAM_FINAL");
  }

  if (target.stage !== "group" && target.status === "finished") {
    const descendants = new Set<string>();
    const queue = [target.id];
    while (queue.length) {
      const sourceId = queue.shift()!;
      for (const candidate of competition.encounters) {
        if (
          candidate.sourceEncounterAId === sourceId ||
          candidate.sourceEncounterBId === sourceId ||
          candidate.sourceLoserAId === sourceId ||
          candidate.sourceLoserBId === sourceId
        ) {
          if (!descendants.has(candidate.id)) {
            descendants.add(candidate.id);
            queue.push(candidate.id);
          }
        }
      }
    }
    if (
      competition.encounters.some(
        (candidate) =>
          descendants.has(candidate.id) &&
          (candidate.status === "finished" || candidate.status === "in_progress"),
      )
    ) {
      throw new Error("STANDARD_RESULT_HAS_DOWNSTREAM_ENCOUNTER");
    }
  }

  const base =
    target.stage === "group" && target.status === "finished" && competition.finalGenerated
      ? {
          ...competition,
          encounters: competition.encounters.filter((encounter) => encounter.stage === "group"),
          finalGenerated: false,
        }
      : competition;

  let next = withEncounterResult(base, encounterId, result);
  const groups = next.encounters.filter((encounter) => encounter.stage === "group");
  if (
    groups.length > 0 &&
    !next.finalGenerated &&
    next.format.playoffMode !== "league_only" &&
    groups.every((encounter) => encounter.status === "finished")
  ) {
    next = generateFinalPhase(next);
  }
  setStandardCompetition(snapshot, next);
}

export function addLocalCategory(
  snapshot: TournamentDaySnapshot,
  input: {
    name: string;
    entryType: "individual" | "pair" | "team";
    competitionGender: "male" | "female" | "mixed" | "open";
    scheduledDate: string | null;
  },
) {
  const categoryId = localId("local-category");
  const category = {
    id: categoryId,
    name: input.name,
    entryType: input.entryType,
    competitionGender: input.competitionGender,
    minAge: null,
    maxAge: null,
    maxEntries: null,
    registrationStatus: "closed",
    priceScope: "free",
    priceMinor: null,
    currency: "UYU",
    scheduledDate: input.scheduledDate,
    sortOrder: snapshot.workspace.core.categories.length,
    structureLocked: 0,
    formatVersionId: null,
    entryCount: 0,
    competitionStatus: null,
    groupMatchCount: 0,
    finishedGroupMatchCount: 0,
    finalMatchCount: 0,
    configJson:
      input.entryType === "team"
        ? JSON.stringify(createMixedFiveRubberTeamFormat())
        : JSON.stringify(normalizeStandardFormat()),
  };
  snapshot.workspace.core.categories.push(category);
  if (input.entryType === "team") {
    snapshot.team.categories.push({
      id: categoryId,
      name: input.name,
      scheduledDate: input.scheduledDate,
      structureLocked: 0,
      formatVersionId: null,
      competitionStatus: null,
      entryCount: 0,
      format: createMixedFiveRubberTeamFormat(),
      entries: [],
      groups: [],
      encounters: [],
      standings: [],
    });
  }
  return categoryId;
}

export function addLocalPlayer(
  snapshot: TournamentDaySnapshot,
  input: {
    name: string;
    sportGender: "male" | "female" | "unspecified";
    club: string;
    contact: string;
    duprSingles: number;
    duprDoubles: number;
    categoryId?: string | null;
  },
) {
  const profileId = localId("local-player");
  const personId = localId("local-person");
  const player = {
    id: profileId,
    organizationPersonId: personId,
    userId: null,
    displayName: input.name,
    club: input.club,
    contact: input.contact,
    sportGender: input.sportGender,
    duprSingles: Number(input.duprSingles || 0),
    duprDoubles: Number(input.duprDoubles || 0),
    paymentStatus: "pending",
    playerStatus: "confirmed",
    notes: "Walk-in local Tournament Day",
    sortOrder: snapshot.workspace.participants.players.length,
  };
  snapshot.workspace.participants.players.push(player);
  snapshot.workspace.core.summary.playerCount = snapshot.workspace.participants.players.length;
  snapshot.team.profiles.push({
    profileId,
    personId,
    displayName: input.name,
    club: input.club,
    playerStatus: "confirmed",
    sportGender: input.sportGender,
  });

  if (input.categoryId) {
    snapshot.workspace.participants.playerCategories.push({
      playerProfileId: profileId,
      categoryId: input.categoryId,
      partnerProfileId: null,
    });
    const category = categoryById(snapshot, input.categoryId);
    if (category?.entryType === "individual") {
      addLocalStandardEntry(snapshot, {
        categoryId: input.categoryId,
        profileIds: [profileId],
        rating: Math.max(Number(input.duprSingles || 0), Number(input.duprDoubles || 0)),
      });
    }
  }
  return { profileId, personId };
}

export function addLocalStandardEntry(
  snapshot: TournamentDaySnapshot,
  input: { categoryId: string; profileIds: string[]; displayName?: string; rating: number },
) {
  const category = categoryById(snapshot, input.categoryId);
  if (!category || category.entryType === "team") throw new Error("STANDARD_CATEGORY_REQUIRED");
  const requested = [...new Set(input.profileIds.filter(Boolean))];
  const required = category.entryType === "pair" ? 2 : 1;
  if (requested.length !== required) {
    throw new Error(category.entryType === "pair" ? "PAIR_REQUIRES_TWO_PLAYERS" : "INDIVIDUAL_REQUIRES_ONE_PLAYER");
  }
  const profiles = snapshot.workspace.participants.players as any[];
  const selected = requested.map((profileId) =>
    profiles.find((profile) => String(profile.id) === profileId),
  );
  if (selected.some((profile) => !profile)) throw new Error("STANDARD_ENTRY_PLAYER_NOT_FOUND");

  const usedProfileIds = new Set<string>();
  for (const existing of snapshot.workspace.standard.entries as any[]) {
    if (existing.categoryId !== input.categoryId || existing.status === "withdrawn" || existing.status === "rejected") continue;
    if (Array.isArray(existing.localProfileIds)) {
      existing.localProfileIds.forEach((value: unknown) => usedProfileIds.add(String(value)));
    } else if (typeof existing.sourceKey === "string" && existing.sourceKey) {
      if (existing.sourceKind === "legacy_pair") {
        existing.sourceKey.split(":").filter(Boolean).forEach((value: string) => usedProfileIds.add(value));
      } else {
        usedProfileIds.add(existing.sourceKey);
      }
    }
  }
  if (requested.some((profileId) => usedProfileIds.has(profileId))) {
    throw new Error("STANDARD_ENTRY_PLAYER_ALREADY_USED");
  }
  const names = selected.map((profile) => String(profile.displayName || "Jugador"));
  const displayName = input.displayName?.trim() ||
    (category.entryType === "pair" ? names.join(" / ") : names[0] || "Jugador");
  const entry = {
    id: localId("local-entry"),
    categoryId: input.categoryId,
    displayName,
    entryType: category.entryType,
    status: "ready",
    seedRating: Number(input.rating || 0),
    sourceKind: category.entryType === "pair" ? "local_walk_in_pair" : "local_walk_in",
    sourceKey: category.entryType === "individual" ? requested[0] : null,
    localProfileIds: requested,
    members: names.join(" · "),
  };
  snapshot.workspace.standard.entries.push(entry);
  const assignments = snapshot.workspace.participants.playerCategories as any[];
  requested.forEach((profileId, index) => {
    const partnerProfileId = category.entryType === "pair"
      ? requested[index === 0 ? 1 : 0] ?? null
      : null;
    const existingAssignment = assignments.findIndex(
      (assignment) => assignment.playerProfileId === profileId && assignment.categoryId === input.categoryId,
    );
    const nextAssignment = {
      playerProfileId: profileId,
      categoryId: input.categoryId,
      partnerProfileId,
    };
    if (existingAssignment >= 0) assignments[existingAssignment] = nextAssignment;
    else assignments.push(nextAssignment);
  });
  category.entryCount = Number(category.entryCount ?? 0) + 1;
  return entry.id;
}

function teamCategory(snapshot: TournamentDaySnapshot, categoryId: string) {
  return snapshot.team.categories.find((category: any) => category.id === categoryId);
}

function teamEntryName(category: any, entryId: string | null | undefined) {
  return category.entries.find((entry: any) => entry.id === entryId)?.displayName ?? null;
}

function teamCoreEntry(entry: any) {
  return {
    id: entry.id,
    name: entry.displayName,
    roster: (entry.roster ?? []).map((member: any) => ({ ...member })),
  };
}

function balancedTeamSizes(entries: number, groups: number) {
  return balancedGroupSizes(entries, groups);
}

function distributeTeamSnake(entries: any[], sizes: number[]) {
  const groups = sizes.map(() => [] as any[]);
  let cursor = 0;
  let row = 0;
  while (cursor < entries.length) {
    const order =
      row % 2 === 0
        ? groups.map((_, index) => index)
        : groups.map((_, index) => groups.length - 1 - index);
    let moved = false;
    for (const index of order) {
      if (cursor >= entries.length) break;
      if (groups[index]!.length >= sizes[index]!) continue;
      groups[index]!.push(entries[cursor++]!);
      moved = true;
    }
    if (!moved) break;
    row += 1;
  }
  return groups;
}

export function setLocalTeamFormat(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  format: TeamFormat,
) {
  const category = teamCategory(snapshot, categoryId);
  if (!category) throw new Error("TEAM_CATEGORY_NOT_FOUND");
  if (
    category.encounters.some((encounter: any) =>
      encounter.matches.some((match: any) => Boolean(match.resultStatus)),
    )
  ) {
    throw new Error("TEAM_FORMAT_AFTER_RESULTS");
  }
  category.format = cloneDay(format);
  if (category.encounters.length || category.groups.length) {
    category.groups = [];
    category.encounters = [];
    category.standings = [];
    category.structureLocked = 0;
    category.competitionStatus = null;
    snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter(
      (row) => row.categoryId !== categoryId,
    );
  }
  const coreCategory = categoryById(snapshot, categoryId);
  if (coreCategory) {
    coreCategory.configJson = JSON.stringify(format);
    coreCategory.structureLocked = category.structureLocked;
    coreCategory.competitionStatus = category.competitionStatus;
    coreCategory.groupMatchCount = 0;
    coreCategory.finishedGroupMatchCount = 0;
    coreCategory.finalMatchCount = 0;
  }
}

export function applyLocalTeamPreset(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  preset: "senior_cup_2026" | "generic",
) {
  setLocalTeamFormat(
    snapshot,
    categoryId,
    preset === "senior_cup_2026"
      ? createSeniorTeamCupFormat()
      : createMixedFiveRubberTeamFormat(),
  );
}

export function createLocalTeam(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  name: string,
) {
  const category = teamCategory(snapshot, categoryId);
  if (!category) throw new Error("TEAM_CATEGORY_NOT_FOUND");
  const entry = {
    id: localId("local-team"),
    categoryId,
    displayName: name,
    status: "ready",
    roster: [],
  };
  category.entries.push(entry);
  category.entryCount = category.entries.length;
  const coreCategory = categoryById(snapshot, categoryId);
  if (coreCategory) coreCategory.entryCount = category.entries.length;
  return entry.id;
}

export function updateLocalTeamRoster(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  entryId: string,
  roster: TeamRosterMember[],
) {
  const category = teamCategory(snapshot, categoryId);
  if (!category?.format) throw new Error("TEAM_FORMAT_NOT_FOUND");
  const entry = category.entries.find((candidate: any) => candidate.id === entryId);
  if (!entry) throw new Error("TEAM_NOT_FOUND");
  if (
    category.encounters.some((encounter: any) =>
      encounter.matches.some((match: any) => Boolean(match.resultStatus)),
    )
  ) {
    throw new Error("TEAM_ROSTER_AFTER_RESULTS");
  }
  const occupied = new Map<string, string>();
  for (const otherEntry of category.entries as any[]) {
    if (otherEntry.id === entryId) continue;
    for (const member of otherEntry.roster ?? []) {
      occupied.set(String(member.personId), String(otherEntry.displayName ?? otherEntry.id));
    }
  }
  const conflict = roster.find((member) => occupied.has(member.personId));
  if (conflict) {
    throw new Error(`TEAM_ROSTER_PERSON_ALREADY_ASSIGNED:${occupied.get(conflict.personId)}`);
  }
  const validation = validateTeamRoster(category.format, roster);
  if (!validation.valid) {
    const error = new Error(validation.issues.map((issue) => issue.code).join(","));
    error.name = "TEAM_ROSTER_INVALID";
    throw error;
  }

  const previousPersonIds = new Set<string>(
    (entry.roster ?? []).map((member: any) => String(member.personId)),
  );
  const nextPersonIds = new Set(roster.map((member) => member.personId));
  entry.roster = cloneDay(roster);

  const profileByPersonId = new Map(
    (snapshot.team.profiles as any[]).map((profile) => [String(profile.personId), String(profile.profileId)] as const),
  );
  const assignments = snapshot.workspace.participants.playerCategories as any[];
  for (let index = assignments.length - 1; index >= 0; index -= 1) {
    const assignment = assignments[index];
    if (assignment?.categoryId !== categoryId) continue;
    const personId = [...profileByPersonId.entries()].find(([, profileId]) => profileId === assignment.playerProfileId)?.[0];
    if (personId && previousPersonIds.has(personId) && !nextPersonIds.has(personId)) {
      assignments.splice(index, 1);
    }
  }
  for (const personId of nextPersonIds) {
    const profileId = profileByPersonId.get(personId);
    if (!profileId) continue;
    const existingAssignment = assignments.findIndex(
      (assignment) => assignment.playerProfileId === profileId && assignment.categoryId === categoryId,
    );
    const nextAssignment = { playerProfileId: profileId, categoryId, partnerProfileId: null };
    if (existingAssignment >= 0) assignments[existingAssignment] = nextAssignment;
    else assignments.push(nextAssignment);
  }

  for (const encounter of category.encounters as any[]) {
    encounter.lineups = encounter.lineups.filter((lineup: any) => lineup.entryId !== entryId);
  }
}

export function generateLocalTeamStructure(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  groupCount: number,
) {
  const category = teamCategory(snapshot, categoryId);
  if (!category?.format) throw new Error("TEAM_FORMAT_NOT_FOUND");
  if (
    category.encounters.some((encounter: any) =>
      encounter.matches.some((match: any) => Boolean(match.resultStatus)),
    )
  ) {
    throw new Error("TEAM_STRUCTURE_AFTER_RESULTS");
  }
  if (category.entries.length < 2) throw new Error("TEAM_ENTRIES_REQUIRED");

  for (const entry of category.entries) {
    const validation = validateTeamRoster(category.format, entry.roster);
    if (!validation.valid) throw new Error(`TEAM_ROSTER_INVALID:${entry.displayName}`);
  }

  const maxGroups =
    category.format.competition.playoffMode === "standard"
      ? Math.max(1, Math.floor(category.entries.length / 2))
      : 1;
  const groups = Math.max(1, Math.min(Math.trunc(groupCount || 1), maxGroups));
  const sizes = balancedTeamSizes(category.entries.length, groups);
  const ordered = [...category.entries].sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id),
  );
  const distributed = distributeTeamSnake(ordered, sizes);
  category.groups = [];
  category.encounters = [];
  distributed.forEach((groupEntries, index) => {
    const groupId = localId(`local-team-group-${categoryId}`);
    const groupName = String.fromCharCode(65 + index);
    groupEntries.forEach((entry, entryIndex) => {
      category.groups.push({
        id: groupId,
        name: groupName,
        categoryId,
        entryId: entry.id,
        entryName: entry.displayName,
        sortOrder: entryIndex,
      });
    });
    const plans = generateTeamRoundRobinEncounters(
      {
        id: groupId,
        name: groupName,
        entries: groupEntries.map(teamCoreEntry),
      },
      category.format,
    );
    plans.forEach((plan, encounterIndex) => {
      const encounterId = localId(`local-team-encounter-${categoryId}`);
      category.encounters.push({
        id: encounterId,
        categoryId,
        stage: "group",
        roundLabel: `Grupo ${groupName}`,
        roundNumber: encounterIndex + 1,
        groupId,
        groupName,
        legNumber: plan.legNumber,
        entryAId: plan.entryAId,
        sideA: teamEntryName(category, plan.entryAId),
        entryBId: plan.entryBId,
        sideB: teamEntryName(category, plan.entryBId),
        sourceEncounterAId: null,
        sourceEncounterBId: null,
        sourceLoserAId: null,
        sourceLoserBId: null,
        status: "ready",
        winnerEntryId: null,
        matches: [...category.format.encounter.rubbers]
          .sort((a, b) => a.order - b.order)
          .map((rubber, rubberIndex) => ({
            id: localId("local-team-match"),
            encounterId,
            rubberKey: rubber.key,
            rubberOrder: rubber.order,
            mode: rubber.mode,
            competitionGender: rubber.gender,
            bestOf: rubber.bestOf,
            pointTarget: rubber.pointTarget,
            scoringMode: rubber.scoringMode,
            status: rubberIndex === 0 ? "ready" : "pending",
            winnerSide: null,
            scoreA: null,
            scoreB: null,
            resultStatus: null,
            scheduleStart: null,
            scheduleEnd: null,
            courtLabel: null,
            scheduleStatus: null,
            sets: [],
          })),
        lineups: [],
      });
    });
  });
  category.structureLocked = 1;
  category.competitionStatus = "group_stage";
  snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter(
    (row) => row.categoryId !== categoryId,
  );
  recalculateTeamCategory(category);
  const coreCategory = categoryById(snapshot, categoryId);
  if (coreCategory) {
    coreCategory.structureLocked = 1;
    coreCategory.competitionStatus = "group_stage";
    coreCategory.groupMatchCount = category.encounters.filter((encounter: any) => encounter.stage === "group").length;
    coreCategory.finishedGroupMatchCount = 0;
    coreCategory.finalMatchCount = 0;
  }
}

function teamEncounterResult(format: TeamFormat, encounter: any): ReturnType<typeof scoreTeamEncounter> {
  const results: TeamRubberResult[] = encounter.matches
    .filter(
      (match: any) =>
        (match.resultStatus === "final" ||
          match.resultStatus === "corrected" ||
          match.resultStatus === "local") &&
        match.winnerSide,
    )
    .map((match: any) => ({
      rubberKey: match.rubberKey,
      winnerSide: match.winnerSide,
      pointsA: Number(match.scoreA ?? 0),
      pointsB: Number(match.scoreB ?? 0),
    }));
  return scoreTeamEncounter({
    format,
    entryAId: encounter.entryAId,
    entryBId: encounter.entryBId,
    results,
  });
}

export function recalculateTeamCategory(category: any) {
  if (!category.format) return category;
  const format = category.format as TeamFormat;
  const groupIds = [...new Set(category.groups.map((row: any) => row.id))] as string[];
  const standings: any[] = [];
  for (const groupId of groupIds) {
    const groupRows = category.groups.filter((row: any) => row.id === groupId && row.entryId);
    const entries = groupRows
      .map((row: any) => category.entries.find((entry: any) => entry.id === row.entryId))
      .filter(Boolean)
      .map(teamCoreEntry);
    const standingEncounters: TeamStandingEncounter[] = [];
    category.encounters
      .filter(
        (encounter: any) =>
          encounter.stage === "group" &&
          encounter.groupId === groupId &&
          encounter.status === "finished" &&
          encounter.winnerEntryId,
      )
      .forEach((encounter: any) => {
        const score = teamEncounterResult(format, encounter);
        if (!score.winnerEntryId) return;
        standingEncounters.push({
          id: encounter.id,
          entryAId: encounter.entryAId,
          entryBId: encounter.entryBId,
          winnerEntryId: score.winnerEntryId,
          standingPointsA: score.standingPointsA,
          standingPointsB: score.standingPointsB,
          rubbersWonA: score.rubbersWonA,
          rubbersWonB: score.rubbersWonB,
          pointsA: score.pointsA,
          pointsB: score.pointsB,
        });
      });
    const result = calculateTeamStandings({
      entries,
      encounters: standingEncounters,
      criteria: format.standings.criteria,
    });
    standings.push({
      groupId,
      groupName: groupRows[0]?.name ?? "",
      rows: result.rows,
      explanation: result.explanation,
    });
  }
  category.standings = standings;
  return category;
}

function sourceResolved(encounterById: Map<string, any>, id: string | null | undefined, loser: boolean) {
  if (!id) return null;
  const source = encounterById.get(id);
  if (!source || !["finished", "bye"].includes(source.status) || !source.winnerEntryId) return null;
  if (!loser) return source.winnerEntryId;
  if (!source.entryAId || !source.entryBId) return null;
  return source.winnerEntryId === source.entryAId ? source.entryBId : source.entryAId;
}

function makeTeamMatches(category: any, encounterId: string, ready: boolean) {
  const format = category.format as TeamFormat;
  return [...format.encounter.rubbers]
    .sort((a, b) => a.order - b.order)
    .map((rubber, index) => ({
      id: localId("local-team-match"),
      encounterId,
      rubberKey: rubber.key,
      rubberOrder: rubber.order,
      mode: rubber.mode,
      competitionGender: rubber.gender,
      bestOf: rubber.bestOf,
      pointTarget: rubber.pointTarget,
      scoringMode: rubber.scoringMode,
      status: ready && index === 0 ? "ready" : "pending",
      winnerSide: null,
      scoreA: null,
      scoreB: null,
      resultStatus: null,
      scheduleStart: null,
      scheduleEnd: null,
      courtLabel: null,
      scheduleStatus: null,
      sets: [],
    }));
}

export function progressLocalTeamFinals(category: any) {
  const entryName = new Map<string, string>(category.entries.map((entry: any) => [String(entry.id), String(entry.displayName)] as const));
  for (let pass = 0; pass < 64; pass += 1) {
    const byId = new Map<string, any>(category.encounters.map((encounter: any) => [String(encounter.id), encounter] as const));
    let changed = false;
    for (const encounter of category.encounters.filter((candidate: any) => candidate.stage !== "group")) {
      if (["finished", "bye"].includes(encounter.status)) continue;
      const desiredA = encounter.sourceEncounterAId
        ? sourceResolved(byId, encounter.sourceEncounterAId, false)
        : encounter.sourceLoserAId
          ? sourceResolved(byId, encounter.sourceLoserAId, true)
          : encounter.entryAId;
      const desiredB = encounter.sourceEncounterBId
        ? sourceResolved(byId, encounter.sourceEncounterBId, false)
        : encounter.sourceLoserBId
          ? sourceResolved(byId, encounter.sourceLoserBId, true)
          : encounter.entryBId;
      const hasSources = Boolean(
        encounter.sourceEncounterAId ||
          encounter.sourceEncounterBId ||
          encounter.sourceLoserAId ||
          encounter.sourceLoserBId,
      );
      let nextStatus = desiredA && desiredB ? "ready" : "pending";
      let winnerEntryId = encounter.winnerEntryId ?? null;
      if (!hasSources && Boolean(desiredA) !== Boolean(desiredB)) {
        nextStatus = "bye";
        winnerEntryId = desiredA ?? desiredB;
      }
      if (
        desiredA !== encounter.entryAId ||
        desiredB !== encounter.entryBId ||
        nextStatus !== encounter.status ||
        winnerEntryId !== encounter.winnerEntryId
      ) {
        const participantsChanged =
          desiredA !== encounter.entryAId || desiredB !== encounter.entryBId;
        encounter.entryAId = desiredA;
        encounter.entryBId = desiredB;
        encounter.sideA = desiredA ? entryName.get(desiredA) ?? null : null;
        encounter.sideB = desiredB ? entryName.get(desiredB) ?? null : null;
        encounter.status = nextStatus;
        encounter.winnerEntryId = winnerEntryId;
        if (participantsChanged) encounter.lineups = [];
        if (nextStatus === "ready" && (!encounter.matches || !encounter.matches.length)) {
          encounter.matches = makeTeamMatches(category, encounter.id, true);
        }
        changed = true;
      }
    }
    if (!changed) break;
  }
  const final = category.encounters.find(
    (encounter: any) => encounter.stage === "final" && ["finished", "bye"].includes(encounter.status),
  );
  const unfinishedMedal = category.encounters.some(
    (encounter: any) =>
      (encounter.stage === "final" || encounter.stage === "bronze") &&
      !["finished", "bye"].includes(encounter.status),
  );
  if (final && !unfinishedMedal) category.competitionStatus = "completed";
}

export function ensureLocalTeamFinalPhase(category: any) {
  if (!category.format) return;
  const groupEncounters = category.encounters.filter((encounter: any) => encounter.stage === "group");
  if (
    !groupEncounters.length ||
    !groupEncounters.every((encounter: any) => encounter.status === "finished") ||
    category.encounters.some((encounter: any) => encounter.stage !== "group")
  ) return;
  recalculateTeamCategory(category);
  const plan = generateTeamFinalPhasePlan({
    format: category.format,
    standings: category.standings.map((standing: any) => ({
      groupId: standing.groupId,
      groupName: standing.groupName,
      rows: standing.rows,
    })),
  });
  if (category.format.competition.playoffMode === "league_only" || !plan.encounters.length) {
    category.competitionStatus = "completed";
    return;
  }
  const idMap = new Map<string, string>(
    plan.encounters.map((encounter) => [
      encounter.id,
      localId(`local-team-final-${category.id}`),
    ] as const),
  );
  const entryName = new Map<string, string>(category.entries.map((entry: any) => [String(entry.id), String(entry.displayName)] as const));
  for (const planned of plan.encounters) {
    const id = idMap.get(planned.id)!;
    category.encounters.push({
      id,
      categoryId: category.id,
      stage: planned.stage,
      roundLabel: planned.roundLabel,
      roundNumber: planned.roundNumber,
      groupId: null,
      groupName: null,
      legNumber: 1,
      entryAId: planned.entryAId,
      sideA: planned.entryAId ? entryName.get(planned.entryAId) ?? null : null,
      entryBId: planned.entryBId,
      sideB: planned.entryBId ? entryName.get(planned.entryBId) ?? null : null,
      sourceEncounterAId: planned.sourceEncounterAId
        ? idMap.get(planned.sourceEncounterAId) ?? null
        : null,
      sourceEncounterBId: planned.sourceEncounterBId
        ? idMap.get(planned.sourceEncounterBId) ?? null
        : null,
      sourceLoserAId: planned.sourceLoserAId
        ? idMap.get(planned.sourceLoserAId) ?? null
        : null,
      sourceLoserBId: planned.sourceLoserBId
        ? idMap.get(planned.sourceLoserBId) ?? null
        : null,
      status: planned.status,
      winnerEntryId: planned.winnerEntryId,
      matches: planned.status === "bye" ? [] : makeTeamMatches(category, id, planned.status === "ready"),
      lineups: [],
    });
  }
  category.competitionStatus = "final_phase";
  progressLocalTeamFinals(category);
}

function validateTeamSets(match: any, scoringMode: string | null, sets: TeamSetInput[]) {
  const bestOf = Number(match.bestOf ?? 1) === 3 ? 3 : 1;
  const needed = bestOf === 3 ? 2 : 1;
  const pointTarget = Math.max(1, Number(match.pointTarget ?? 15));
  let winsA = 0;
  let winsB = 0;
  let pointsA = 0;
  let pointsB = 0;
  if (!sets.length || sets.length > bestOf) throw new Error("TEAM_RESULT_SET_COUNT_INVALID");
  for (const set of sets) {
    if (
      !Number.isInteger(set.scoreA) ||
      !Number.isInteger(set.scoreB) ||
      set.scoreA < 0 ||
      set.scoreB < 0 ||
      set.scoreA === set.scoreB
    ) throw new Error("TEAM_RESULT_SET_INVALID");
    if (scoringMode === "rally-win-by-2-cap-21") {
      const winner = Math.max(set.scoreA, set.scoreB);
      const loser = Math.min(set.scoreA, set.scoreB);
      if (winner < pointTarget || winner > 21 || (winner < 21 && winner - loser < 2)) {
        throw new Error("TEAM_RESULT_RALLY_SCORE_INVALID");
      }
    }
    if (winsA >= needed || winsB >= needed) throw new Error("TEAM_RESULT_EXTRA_SET");
    pointsA += set.scoreA;
    pointsB += set.scoreB;
    if (set.scoreA > set.scoreB) winsA += 1;
    else winsB += 1;
  }
  if (winsA !== needed && winsB !== needed) throw new Error("TEAM_RESULT_INCOMPLETE");
  return {
    winnerSide: (winsA > winsB ? "A" : "B") as "A" | "B",
    pointsA,
    pointsB,
  };
}

export function saveLocalTeamLineup(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  encounterId: string,
  entryId: string,
  assignments: TeamLineupAssignment[],
) {
  const category = teamCategory(snapshot, categoryId);
  if (!category?.format) throw new Error("TEAM_FORMAT_NOT_FOUND");
  const encounter = category.encounters.find((candidate: any) => candidate.id === encounterId);
  const entry = category.entries.find((candidate: any) => candidate.id === entryId);
  if (!encounter || !entry) throw new Error("TEAM_LINEUP_TARGET_NOT_FOUND");
  const hasResults = encounter.matches.some((match: any) => match.resultStatus);
  if (hasResults) throw new Error("TEAM_LINEUP_AFTER_RESULTS");
  const validation = validateTeamLineup(category.format, entry.roster, assignments);
  if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.code).join(","));
  const lineupId =
    encounter.lineups.find((lineup: any) => lineup.entryId === entryId)?.id ??
    localId("local-team-lineup");
  const flatAssignments = assignments.flatMap((assignment) =>
    assignment.personIds.map((personId, index) => ({
      lineupId,
      rubberKey: assignment.rubberKey,
      personId,
      position: index + 1,
    })),
  );
  const lineup = {
    id: lineupId,
    encounterId,
    entryId,
    status: "locked",
    lockedAt: Math.floor(Date.now() / 1000),
    assignments: flatAssignments,
  };
  const existing = encounter.lineups.findIndex((candidate: any) => candidate.entryId === entryId);
  if (existing >= 0) encounter.lineups[existing] = lineup;
  else encounter.lineups.push(lineup);
}

export function setLocalTeamResult(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  encounterId: string,
  matchId: string,
  sets: TeamSetInput[],
) {
  const category = teamCategory(snapshot, categoryId);
  if (!category?.format) throw new Error("TEAM_FORMAT_NOT_FOUND");
  const encounter = category.encounters.find((candidate: any) => candidate.id === encounterId);
  if (!encounter) throw new Error("TEAM_ENCOUNTER_NOT_FOUND");
  const match = encounter.matches.find((candidate: any) => candidate.id === matchId);
  if (!match) throw new Error("TEAM_MATCH_NOT_FOUND");

  if (match.resultStatus && encounter.stage === "group") {
    const finalEncounters = category.encounters.filter((candidate: any) => candidate.stage !== "group");
    const downstreamResult = finalEncounters.some((candidate: any) =>
      candidate.matches.some((candidateMatch: any) => Boolean(candidateMatch.resultStatus)),
    );
    if (downstreamResult) throw new Error("TEAM_RESULT_HAS_DOWNSTREAM_FINAL");
    if (finalEncounters.length) {
      category.encounters = category.encounters.filter((candidate: any) => candidate.stage === "group");
      category.competitionStatus = "group_stage";
    }
  }

  if (match.resultStatus && encounter.stage !== "group") {
    const descendants = new Set<string>();
    const queue = [encounter.id];
    while (queue.length) {
      const source = queue.shift()!;
      for (const candidate of category.encounters as any[]) {
        if (
          candidate.sourceEncounterAId === source ||
          candidate.sourceEncounterBId === source ||
          candidate.sourceLoserAId === source ||
          candidate.sourceLoserBId === source
        ) {
          if (!descendants.has(candidate.id)) {
            descendants.add(candidate.id);
            queue.push(candidate.id);
          }
        }
      }
    }
    const hasDownstreamResult = (category.encounters as any[])
      .filter((candidate) => descendants.has(candidate.id))
      .some((candidate) =>
        candidate.matches.some((candidateMatch: any) => Boolean(candidateMatch.resultStatus)),
      );
    if (hasDownstreamResult) throw new Error("TEAM_RESULT_HAS_DOWNSTREAM_ENCOUNTER");
  }

  const locked = new Set(
    encounter.lineups
      .filter((lineup: any) => lineup.status === "locked")
      .map((lineup: any) => lineup.entryId),
  );
  if (!locked.has(encounter.entryAId) || !locked.has(encounter.entryBId)) {
    throw new Error("TEAM_MATCH_LINEUPS_NOT_LOCKED");
  }

  const laterResult = encounter.matches.some(
    (candidate: any) =>
      Number(candidate.rubberOrder) > Number(match.rubberOrder) &&
      Boolean(candidate.resultStatus),
  );
  if (match.resultStatus && laterResult) throw new Error("TEAM_RESULT_HAS_DOWNSTREAM_RUBBER");

  const definition = category.format.encounter.rubbers.find(
    (rubber: any) => rubber.key === match.rubberKey,
  );
  const outcome = validateTeamSets(match, definition?.scoringMode ?? null, sets);

  match.sets = sets.map((set, index) => ({
    setNumber: index + 1,
    scoreA: set.scoreA,
    scoreB: set.scoreB,
    winnerSide: set.scoreA > set.scoreB ? "A" : "B",
  }));
  match.scoreA = outcome.pointsA;
  match.scoreB = outcome.pointsB;
  match.winnerSide = outcome.winnerSide;
  match.resultStatus = match.resultStatus ? "corrected" : "local";
  match.status = "finished";
  match.scheduleStatus = "completed";

  const score = teamEncounterResult(category.format, encounter);
  score.rubbers.forEach((state) => {
    const row = encounter.matches.find(
      (candidate: any) => candidate.rubberKey === state.definition.key,
    );
    if (!row || row.resultStatus) return;
    row.status = state.status;
    if (state.status === "skipped") row.scheduleStatus = "cancelled";
  });
  encounter.status = score.complete ? "finished" : "in_progress";
  encounter.winnerEntryId = score.winnerEntryId;

  recalculateTeamCategory(category);
  if (score.complete) {
    if (encounter.stage === "group") ensureLocalTeamFinalPhase(category);
    else progressLocalTeamFinals(category);
  }

  const coreCategory = categoryById(snapshot, categoryId);
  if (coreCategory) {
    coreCategory.finishedGroupMatchCount = category.encounters.filter(
      (candidate: any) => candidate.stage === "group" && candidate.status === "finished",
    ).length;
    coreCategory.finalMatchCount = category.encounters.filter(
      (candidate: any) => candidate.stage !== "group",
    ).length;
    coreCategory.competitionStatus = category.competitionStatus;
  }

  snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).map(
    (row) => {
      if (row.matchId !== matchId) return row;
      return { ...row, status: "completed" };
    },
  );
}

export function addLocalTeamMember(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  entryId: string,
  personId: string,
  role: "player" | "captain" | "substitute",
) {
  const category = teamCategory(snapshot, categoryId);
  if (!category?.format) throw new Error("TEAM_FORMAT_NOT_FOUND");
  const entry = category.entries.find((candidate: any) => candidate.id === entryId);
  const profile = snapshot.team.profiles.find((candidate: any) => candidate.personId === personId);
  if (!entry || !profile) throw new Error("TEAM_ROSTER_PERSON_NOT_FOUND");
  if (entry.roster.some((member: any) => member.personId === personId)) return;
  const roster = [
    ...entry.roster,
    {
      personId,
      name: profile.displayName,
      role,
      sportGender: profile.sportGender,
    },
  ];
  const validation = validateTeamRoster(category.format, roster);
  if (!validation.valid && roster.length >= category.format.roster.min) {
    const hard = validation.issues.filter((issue) =>
      ["ROSTER_TOO_LARGE", "ROSTER_MALE_MAX", "ROSTER_FEMALE_MAX", "CAPTAIN_REQUIRED"].includes(issue.code),
    );
    if (hard.length) throw new Error(hard.map((issue) => issue.code).join(","));
  }
  entry.roster = roster;
}

export function removeLocalTeamMember(
  snapshot: TournamentDaySnapshot,
  categoryId: string,
  entryId: string,
  personId: string,
) {
  const category = teamCategory(snapshot, categoryId);
  const entry = category?.entries.find((candidate: any) => candidate.id === entryId);
  if (!entry) throw new Error("TEAM_NOT_FOUND");
  entry.roster = entry.roster.filter((member: any) => member.personId !== personId);
}

export function generateLocalStandardSchedule(snapshot: TournamentDaySnapshot) {
  const tournament = snapshot.workspace.core.tournament;
  const settings = snapshot.workspace.core.settings;
  const categories = (snapshot.workspace.standard.competitions as Competition[])
    .map((competition) => {
      const category = categoryById(snapshot, competition.categoryId);
      if (!category) return null;
      const scheduledDate =
        category.scheduledDate ??
        new Date(
          tournament.startAt < 10_000_000_000
            ? tournament.startAt * 1000
            : tournament.startAt,
        )
          .toISOString()
          .slice(0, 10);
      return {
        categoryId: competition.categoryId,
        scheduledDate,
        order: Number(category.sortOrder ?? 0),
        matchMinutes: Number(settings.defaultMatchMinutes ?? 30),
        competition,
      };
    })
    .filter(Boolean) as any[];

  if (!categories.length) throw new Error("STANDARD_COMPETITIONS_REQUIRED");
  const startDate = new Date(
    tournament.startAt < 10_000_000_000
      ? tournament.startAt * 1000
      : tournament.startAt,
  )
    .toISOString()
    .slice(0, 10);
  const result = generateTournamentSchedule({
    settings: {
      startDate,
      dailyStart: settings.dailyStart,
      courtCount: tournament.courtCount,
      preferredRestSlots: settings.minimumRestSlots ?? 1,
    },
    categories,
  });
  const existingTeam = (snapshot.workspace.schedule.schedule as any[]).filter(
    (row) => row.categoryEntryType === "team",
  );
  const categoryName = new Map(
    snapshot.workspace.core.categories.map((category: any) => [category.id, category.name] as const),
  );
  const matchByEncounter = new Map(
    (snapshot.workspace.standard.matches as any[]).map((match) => [match.encounterId, match] as const),
  );
  const standardRows = result.items.map((item) => {
    const match = item.encounterId ? matchByEncounter.get(item.encounterId) : null;
    const start = localDateTimeToUnix(item.date, item.time);
    return {
      id: localId("local-schedule"),
      categoryId: item.categoryId,
      categoryName: categoryName.get(item.categoryId) ?? "",
      categoryEntryType: "individual",
      encounterId: item.encounterId,
      matchId: match?.matchId ?? null,
      stage: item.stage,
      roundLabel: item.roundLabel,
      courtLabel: `Cancha ${item.court}`,
      startAt: start,
      endAt: start + item.durationMinutes * 60,
      status: item.reserved ? "reserved" : "bound",
      groupId: match?.groupId ?? null,
      groupName: match?.groupName ?? null,
      legNumber: item.legNumber,
      entryAId: match?.entryAId ?? null,
      sideA: match?.sideA ?? null,
      entryBId: match?.entryBId ?? null,
      sideB: match?.sideB ?? null,
      rubberKey: null,
      rubberOrder: null,
      matchMode: null,
      matchGender: null,
      bestOf: match?.bestOf ?? null,
    };
  });
  snapshot.workspace.schedule.schedule = [...standardRows, ...existingTeam].sort(
    (a: any, b: any) => Number(a.startAt) - Number(b.startAt) || String(a.courtLabel).localeCompare(String(b.courtLabel)),
  );
}

export function localDateTimeToUnix(date: string, time: string) {
  return Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000);
}

export function unixToLocalDateTime(value: number) {
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function updateLocalScheduleRow(
  snapshot: TournamentDaySnapshot,
  scheduleId: string,
  patch: { courtLabel?: string; startAt?: number; endAt?: number; status?: string },
) {
  const row = (snapshot.workspace.schedule.schedule as any[]).find(
    (candidate) => candidate.id === scheduleId,
  );
  if (!row) throw new Error("SCHEDULE_ITEM_NOT_FOUND");
  Object.assign(row, patch);
}

export function addLocalScheduleRow(
  snapshot: TournamentDaySnapshot,
  input: {
    categoryId: string;
    encounterId: string | null;
    matchId: string | null;
    stage: string;
    roundLabel: string | null;
    courtLabel: string;
    startAt: number;
    durationMinutes: number;
    sideA?: string | null;
    sideB?: string | null;
  },
) {
  const category = categoryById(snapshot, input.categoryId);
  snapshot.workspace.schedule.schedule.push({
    id: localId("local-schedule"),
    categoryId: input.categoryId,
    categoryName: category?.name ?? "",
    categoryEntryType: category?.entryType ?? "individual",
    encounterId: input.encounterId,
    matchId: input.matchId,
    stage: input.stage,
    roundLabel: input.roundLabel,
    courtLabel: input.courtLabel,
    startAt: input.startAt,
    endAt: input.startAt + input.durationMinutes * 60,
    status: "bound",
    groupId: null,
    groupName: null,
    legNumber: 1,
    entryAId: null,
    sideA: input.sideA ?? null,
    entryBId: null,
    sideB: input.sideB ?? null,
    rubberKey: null,
    rubberOrder: null,
    matchMode: null,
    matchGender: null,
    bestOf: null,
  });
  snapshot.workspace.schedule.schedule.sort(
    (a: any, b: any) => Number(a.startAt) - Number(b.startAt),
  );
}


export function generateLocalTeamSchedule(snapshot: TournamentDaySnapshot) {
  const tournament = snapshot.workspace.core.tournament;
  const settings = snapshot.workspace.core.settings;
  const pad = (value: number) => String(value).padStart(2, "0");
  const startDate = new Date(
    tournament.startAt < 10_000_000_000 ? tournament.startAt * 1000 : tournament.startAt,
  );
  const defaultDate = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;
  const [startHour = "09", startMinute = "00"] = String(settings.dailyStart ?? "09:00").split(":");
  const baseMinute = Number(startHour) * 60 + Number(startMinute);
  const duration = Math.max(5, Number(settings.defaultMatchMinutes ?? 30));
  const courts = Math.max(1, Number(tournament.courtCount ?? 1));
  const existingStandard = (snapshot.workspace.schedule.schedule as any[]).filter(
    (row) => row.categoryEntryType !== "team",
  );
  const rows: any[] = [];
  const categoryOffset = new Map<string, number>();

  for (const category of snapshot.team.categories as any[]) {
    const date = category.scheduledDate ?? defaultDate;
    let slot = categoryOffset.get(date) ?? 0;
    const encounters = [...category.encounters].sort(
      (a: any, b: any) =>
        (a.stage === "group" ? 0 : 1) - (b.stage === "group" ? 0 : 1) ||
        Number(a.roundNumber ?? 0) - Number(b.roundNumber ?? 0) ||
        Number(a.legNumber ?? 0) - Number(b.legNumber ?? 0),
    );
    for (const encounter of encounters) {
      for (const match of [...encounter.matches].sort(
        (a: any, b: any) => Number(a.rubberOrder) - Number(b.rubberOrder),
      )) {
        if (match.status === "skipped") continue;
        const court = (slot % courts) + 1;
        const block = Math.floor(slot / courts);
        const minute = baseMinute + block * duration;
        const day = new Date(`${date}T00:00:00`);
        day.setMinutes(minute);
        const dateString = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
        const timeString = `${pad(day.getHours())}:${pad(day.getMinutes())}`;
        const startAt = localDateTimeToUnix(dateString, timeString);
        match.scheduleStart = startAt;
        match.scheduleEnd = startAt + duration * 60;
        match.courtLabel = `Cancha ${court}`;
        match.scheduleStatus = match.status === "finished" ? "completed" : "bound";
        rows.push({
          id: localId("local-team-schedule"),
          categoryId: category.id,
          categoryName: category.name,
          categoryEntryType: "team",
          encounterId: encounter.id,
          matchId: match.id,
          stage: encounter.stage,
          roundLabel: encounter.roundLabel,
          courtLabel: match.courtLabel,
          startAt,
          endAt: startAt + duration * 60,
          status: match.scheduleStatus,
          groupId: encounter.groupId,
          groupName: encounter.groupName,
          legNumber: encounter.legNumber,
          entryAId: encounter.entryAId,
          sideA: encounter.sideA,
          entryBId: encounter.entryBId,
          sideB: encounter.sideB,
          rubberKey: match.rubberKey,
          rubberOrder: match.rubberOrder,
          matchMode: match.mode,
          matchGender: match.competitionGender,
          bestOf: match.bestOf,
        });
        slot += 1;
      }
    }
    categoryOffset.set(date, slot);
  }
  snapshot.workspace.schedule.schedule = [...existingStandard, ...rows].sort(
    (a: any, b: any) =>
      Number(a.startAt) - Number(b.startAt) ||
      String(a.courtLabel).localeCompare(String(b.courtLabel)),
  );
}

export function teamFormatPreset(name: "senior_cup_2026" | "generic"): TeamFormat {
  return name === "senior_cup_2026"
    ? createSeniorTeamCupFormat()
    : createMixedFiveRubberTeamFormat();
}
