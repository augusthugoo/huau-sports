import type { TournamentPersistenceBundle, TournamentBundleSummary } from "./types";

type UnknownRecord = Record<string, unknown>;
type IdFactory = (kind: string, sourceKey: string) => string;

export type LegacyImportOptions = {
  organizationId: string;
  createdByUserId: string;
  tournamentId?: string;
  slug?: string;
  now?: number;
  timezone?: string;
  currency?: string;
  utcOffsetMinutes?: number;
  idFactory?: IdFactory;
};

const record = (value: unknown): UnknownRecord => (value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {});
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const stringValue = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const numberValue = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const boolValue = (value: unknown, fallback = false): boolean => (typeof value === "boolean" ? value : fallback);
const nullableNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "legacy-tournament";

const defaultIdFactory: IdFactory = (kind, sourceKey) => `${kind}:${sourceKey}`;

function parseDateTime(date: string, time: string, utcOffsetMinutes: number): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match || !clock) return 0;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]));
  return Math.floor((utc - utcOffsetMinutes * 60_000) / 1000);
}

function inferGender(category: string): "male" | "female" | "mixed" | "open" {
  const value = category.toLowerCase();
  if (value.includes("mixto") || value.includes("mixed")) return "mixed";
  if (value.includes("femen") || value.includes("women")) return "female";
  if (value.includes("mascul") || value.includes("men")) return "male";
  return "open";
}

function inferEntryType(category: string, playerIds?: unknown[]): "individual" | "pair" {
  if (category.toLowerCase().includes("single")) return "individual";
  return (playerIds?.length ?? 0) <= 1 ? "individual" : "pair";
}

function mapTournamentStatus(status: string): TournamentPersistenceBundle["tournament"]["status"] {
  const value = status.toLowerCase();
  if (value.includes("final") || value.includes("complet")) return "completed";
  if (value.includes("vivo") || value.includes("live")) return "live";
  if (value.includes("cronograma") || value.includes("scheduled")) return "scheduled";
  if (value.includes("sorteo") || value.includes("draw")) return "draw_ready";
  if (value.includes("cerrad")) return "registration_closed";
  if (value.includes("abiert")) return "registration_open";
  if (value.includes("cancel")) return "cancelled";
  return "draft";
}

function mapEncounterStage(stage: string, round: string): "group" | "playoff" | "consolation" | "bronze" | "final" {
  if (stage.toLowerCase().includes("grupo")) return "group";
  const value = round.toLowerCase();
  if (value.includes("tercer") || value.includes("bronze") || value.includes("bronce")) return "bronze";
  if (value === "final" || value.includes("gran final")) return "final";
  if (value.includes("consuelo") || value.includes("consol")) return "consolation";
  return "playoff";
}

function mapEncounterStatus(status: string, hasEntries: boolean): "pending" | "bye" | "ready" | "in_progress" | "finished" | "skipped" {
  const value = status.toLowerCase();
  if (value.includes("bye")) return "bye";
  if (value.includes("final")) return "finished";
  if (value.includes("curso") || value.includes("progress")) return "in_progress";
  return hasEntries ? "ready" : "pending";
}

function mapMatchStatus(status: string): "pending" | "ready" | "in_progress" | "finished" | "skipped" {
  const value = status.toLowerCase();
  if (value.includes("bye")) return "skipped";
  if (value.includes("final")) return "finished";
  if (value.includes("curso") || value.includes("progress")) return "in_progress";
  return "pending";
}

function competitionStatus(matches: UnknownRecord[], finalGenerated: boolean): TournamentPersistenceBundle["competitions"][number]["status"] {
  if (!matches.length) return "groups_generated";
  const pending = matches.some((match) => stringValue(match.status).toLowerCase() === "pendiente");
  const hasFinal = matches.some((match) => stringValue(match.stage).toLowerCase() !== "grupo");
  if (!pending && finalGenerated) return "completed";
  if (hasFinal && finalGenerated) return "final_phase";
  const groupsPending = matches.some((match) => stringValue(match.stage).toLowerCase() === "grupo" && stringValue(match.status).toLowerCase() !== "finalizado");
  return groupsPending ? "group_stage" : "groups_complete";
}

function buildFormatConfig(format: UnknownRecord) {
  const sizes = array(format.sizes).map((value) => numberValue(value)).filter((value) => value > 0);
  const singleRoundMatches = sizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0);
  const groupMatches = numberValue(format.groupMatches);
  const groupRounds: 1 | 2 = singleRoundMatches > 0 && groupMatches >= singleRoundMatches * 2 ? 2 : 1;
  const groups = numberValue(format.groups, sizes.length || 1);
  const qualifiersPerGroup = numberValue(format.qualifiersPerGroup, 2);
  const qualified = numberValue(format.qualified, groups * qualifiersPerGroup);
  return {
    schemaVersion: 1,
    groupRounds,
    groupSizes: sizes,
    qualifiersPerGroup,
    wildcardQualifiers: Math.max(0, qualified - groups * qualifiersPerGroup),
    crossGroupMethod: stringValue(format.crossGroupMethod, "normalized"),
    playoffMode: stringValue(format.playoffMode, "standard"),
    consolationMode: stringValue(format.consolationMode, "none"),
    avoidGroupRematches: boolValue(format.avoidGroupRematches),
    bronzeMatch: boolValue(format.bronzeMatch),
    medalSchedule: stringValue(format.medalSchedule, "sequential"),
    preliminary: { bestOf: 1, pointTarget: numberValue(format.standardPointTarget, 15) },
    medal: { bestOf: numberValue(format.medalBestOf, 3), pointTarget: numberValue(format.medalPointTarget, 11) },
    finalDrawMethod: stringValue(format.finalDrawMethod, "performance"),
    legacy: { ...format },
  };
}

export function importLegacyTournamentState(input: unknown, options: LegacyImportOptions): TournamentPersistenceBundle {
  const wrapper = record(input);
  const state = Object.prototype.hasOwnProperty.call(wrapper, "state") ? record(wrapper.state) : wrapper;
  const tournamentSource = record(state.tournament);
  const playersSource = array(state.players).map(record);
  if (!stringValue(tournamentSource.name) || playersSource.length === 0) throw new Error("INVALID_LEGACY_TOURNAMENT");

  const sourceRevision = nullableNumber(wrapper.revision);
  const sourceVersion = stringValue(state.version) || null;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const timezone = options.timezone ?? "America/Montevideo";
  const currency = options.currency ?? "UYU";
  const utcOffsetMinutes = options.utcOffsetMinutes ?? -180;
  const makeId = options.idFactory ?? defaultIdFactory;
  const tournamentId = options.tournamentId ?? makeId("tournament", `${sourceRevision ?? "legacy"}-${slugify(stringValue(tournamentSource.name))}`);
  const childId = (kind: string, key: string | number) => makeId(kind, `${tournamentId}:${String(key)}`);

  const people: TournamentPersistenceBundle["people"] = [];
  const personByLegacyId = new Map<string, string>();
  for (const player of playersSource) {
    const legacyId = String(player.id ?? player.name ?? people.length + 1);
    const personId = childId("person", legacyId);
    personByLegacyId.set(legacyId, personId);
    people.push({
      id: personId,
      organizationId: options.organizationId,
      firstName: stringValue(player.name, `Player ${legacyId}`).trim(),
      lastName: "",
      email: null,
      phone: stringValue(player.contact).trim() || null,
      sportGender: null,
      source: "import",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  const categoryNames = array(tournamentSource.categoryOrder).map((value) => stringValue(value)).filter(Boolean);
  for (const value of array(tournamentSource.categories).map((item) => stringValue(item)).filter(Boolean)) {
    if (!categoryNames.includes(value)) categoryNames.push(value);
  }
  const formatsSource = record(state.formats);
  const competitionsSource = record(state.competitions);
  const categoryDates = record(tournamentSource.categoryDates);

  const categories: TournamentPersistenceBundle["categories"] = [];
  const entries: TournamentPersistenceBundle["entries"] = [];
  const entryMembers: TournamentPersistenceBundle["entryMembers"] = [];
  const formatVersions: TournamentPersistenceBundle["formatVersions"] = [];
  const competitions: TournamentPersistenceBundle["competitions"] = [];
  const groups: TournamentPersistenceBundle["groups"] = [];
  const groupEntries: TournamentPersistenceBundle["groupEntries"] = [];
  const encounters: TournamentPersistenceBundle["encounters"] = [];
  const matches: TournamentPersistenceBundle["matches"] = [];
  const matchResults: TournamentPersistenceBundle["matchResults"] = [];
  const matchSets: TournamentPersistenceBundle["matchSets"] = [];
  const categoryIdByName = new Map<string, string>();
  const entryIdByCategoryAndLegacy = new Map<string, string>();
  const groupIdByCategoryAndName = new Map<string, string>();
  const encounterIdByLegacyMatch = new Map<string, string>();
  const matchIdByLegacyMatch = new Map<string, string>();

  for (let categoryIndex = 0; categoryIndex < categoryNames.length; categoryIndex += 1) {
    const categoryName = categoryNames[categoryIndex]!;
    const categoryId = childId("category", categoryName);
    categoryIdByName.set(categoryName, categoryId);
    const competitionSource = record(competitionsSource[categoryName]);
    const legacyGroups = array(competitionSource.groups).map(record);
    const sampleEntry = legacyGroups.flatMap((group) => array(group.entries).map(record))[0];
    const samplePlayerIds = sampleEntry ? array(sampleEntry.playerIds) : [];
    const entryType = inferEntryType(categoryName, samplePlayerIds);
    const formatSource = record(formatsSource[categoryName] ?? competitionSource.format);
    const formatVersionId = Object.keys(formatSource).length ? childId("format", categoryName) : null;

    categories.push({
      id: categoryId,
      tournamentId,
      name: categoryName,
      entryType,
      competitionGender: inferGender(categoryName),
      maxEntries: null,
      registrationStatus: "closed",
      priceScope: "free",
      priceMinor: null,
      currency,
      formatVersionId,
      scheduledDate: stringValue(categoryDates[categoryName]) || null,
      sortOrder: categoryIndex,
      structureLocked: Object.keys(competitionSource).length > 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    if (formatVersionId) {
      formatVersions.push({
        id: formatVersionId,
        categoryId,
        versionNumber: 1,
        formatKind: "standard",
        configJson: JSON.stringify(buildFormatConfig(formatSource)),
        explanationSchemaVersion: 1,
        createdByUserId: options.createdByUserId,
        createdAt: now,
        lockedAt: Object.keys(competitionSource).length ? now : null,
      });
    }

    const seenLegacyEntries = new Map<string, UnknownRecord>();
    for (const group of legacyGroups) {
      for (const legacyEntry of array(group.entries).map(record)) {
        const legacyEntryId = stringValue(legacyEntry.id) || `${categoryName}:${seenLegacyEntries.size}`;
        if (!seenLegacyEntries.has(legacyEntryId)) seenLegacyEntries.set(legacyEntryId, legacyEntry);
      }
    }
    for (const legacyMatch of array(competitionSource.matches).map(record)) {
      for (const side of ["A", "B"] as const) {
        const legacyEntryId = stringValue(legacyMatch[`entry${side}Id`]);
        if (!legacyEntryId || seenLegacyEntries.has(legacyEntryId)) continue;
        seenLegacyEntries.set(legacyEntryId, {
          id: legacyEntryId,
          name: stringValue(legacyMatch[`team${side}`]),
          playerIds: array(legacyMatch[`team${side}Ids`]),
          rating: 0,
        });
      }
    }
    if (seenLegacyEntries.size === 0) {
      for (const player of playersSource) {
        if (!array(player.categories).map(String).includes(categoryName)) continue;
        if (entryType === "individual") {
          const legacyEntryId = `P${String(player.id)}`;
          seenLegacyEntries.set(legacyEntryId, { id: legacyEntryId, name: player.name, playerIds: [player.id], rating: player.duprSingles });
        }
      }
    }

    for (const [legacyEntryId, legacyEntry] of seenLegacyEntries) {
      const entryId = childId("entry", `${categoryName}:${legacyEntryId}`);
      entryIdByCategoryAndLegacy.set(`${categoryName}|${legacyEntryId}`, entryId);
      const playerIds = array(legacyEntry.playerIds);
      entries.push({
        id: entryId,
        categoryId,
        entryType: inferEntryType(categoryName, playerIds),
        displayName: stringValue(legacyEntry.name, legacyEntryId),
        captainUserId: null,
        status: "confirmed",
        waitlistPosition: null,
        seedRating: nullableNumber(legacyEntry.rating),
        createdByUserId: options.createdByUserId,
        createdByAdmin: true,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      playerIds.forEach((legacyPlayerId, memberIndex) => {
        const personId = personByLegacyId.get(String(legacyPlayerId));
        if (!personId) return;
        entryMembers.push({
          id: childId("entry-member", `${categoryName}:${legacyEntryId}:${String(legacyPlayerId)}`),
          entryId,
          organizationPersonId: personId,
          memberRole: memberIndex === 0 ? "captain" : "player",
          rosterSlot: null,
          status: "manual",
          invitedUserId: null,
          acceptedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      });
    }

    if (!Object.keys(competitionSource).length || !formatVersionId) continue;
    const competitionId = childId("competition", categoryName);
    const legacyMatches = array(competitionSource.matches).map(record);
    competitions.push({
      id: competitionId,
      categoryId,
      formatVersionId,
      status: competitionStatus(legacyMatches, boolValue(competitionSource.finalGenerated)),
      structureRevision: 1,
      createdAt: now,
      updatedAt: now,
    });

    legacyGroups.forEach((group, groupIndex) => {
      const groupName = stringValue(group.name, String.fromCharCode(65 + groupIndex));
      const groupId = childId("group", `${categoryName}:${groupName}`);
      groupIdByCategoryAndName.set(`${categoryName}|${groupName}`, groupId);
      groups.push({ id: groupId, competitionId, name: groupName, sortOrder: groupIndex });
      array(group.entries).map(record).forEach((legacyEntry, entryIndex) => {
        const entryId = entryIdByCategoryAndLegacy.get(`${categoryName}|${stringValue(legacyEntry.id)}`);
        if (entryId) groupEntries.push({ groupId, entryId, seed: null, sortOrder: entryIndex });
      });
    });

    for (const legacyMatch of legacyMatches) {
      const legacyMatchId = String(legacyMatch.id ?? `${categoryName}:${encounters.length}`);
      encounterIdByLegacyMatch.set(legacyMatchId, childId("encounter", `${categoryName}:${legacyMatchId}`));
      matchIdByLegacyMatch.set(legacyMatchId, childId("match", `${categoryName}:${legacyMatchId}`));
    }

    for (const legacyMatch of legacyMatches) {
      const legacyMatchId = String(legacyMatch.id ?? "");
      const encounterId = encounterIdByLegacyMatch.get(legacyMatchId)!;
      const matchId = matchIdByLegacyMatch.get(legacyMatchId)!;
      const stageLabel = stringValue(legacyMatch.stage);
      const roundLabel = stringValue(legacyMatch.round) || null;
      const groupName = stringValue(legacyMatch.group);
      const entryAId = entryIdByCategoryAndLegacy.get(`${categoryName}|${stringValue(legacyMatch.entryAId)}`) ?? null;
      const entryBId = entryIdByCategoryAndLegacy.get(`${categoryName}|${stringValue(legacyMatch.entryBId)}`) ?? null;
      const winnerLegacyId = stringValue(record(legacyMatch.winnerEntry).id);
      const winnerEntryId = winnerLegacyId ? entryIdByCategoryAndLegacy.get(`${categoryName}|${winnerLegacyId}`) ?? null : null;
      const source = (key: string) => {
        const value = numberValue(legacyMatch[key]);
        return value > 0 ? encounterIdByLegacyMatch.get(String(value)) ?? null : null;
      };
      const status = stringValue(legacyMatch.status);
      encounters.push({
        id: encounterId,
        competitionId,
        stage: mapEncounterStage(stageLabel, roundLabel ?? ""),
        groupId: groupName ? groupIdByCategoryAndName.get(`${categoryName}|${groupName}`) ?? null : null,
        roundLabel,
        roundNumber: null,
        legNumber: numberValue(legacyMatch.legNumber, 1),
        entryAId,
        entryBId,
        sourceEncounterAId: source("sourceA"),
        sourceEncounterBId: source("sourceB"),
        sourceLoserAId: source("sourceLoserA"),
        sourceLoserBId: source("sourceLoserB"),
        status: mapEncounterStatus(status, Boolean(entryAId && entryBId)),
        winnerEntryId,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      const scoreA = nullableNumber(legacyMatch.scoreA);
      const scoreB = nullableNumber(legacyMatch.scoreB);
      const winnerSide: "A" | "B" | null = winnerEntryId && winnerEntryId === entryAId ? "A" : winnerEntryId && winnerEntryId === entryBId ? "B" : null;
      matches.push({
        id: matchId,
        encounterId,
        rubberKey: null,
        rubberOrder: 1,
        mode: entryType === "individual" ? "singles" : "doubles",
        competitionGender: inferGender(categoryName),
        bestOf: numberValue(legacyMatch.bestOf, 1),
        pointTarget: nullableNumber(legacyMatch.pointTarget),
        scoringMode: null,
        status: mapMatchStatus(status),
        sideALabel: stringValue(legacyMatch.teamA) || null,
        sideBLabel: stringValue(legacyMatch.teamB) || null,
        winnerSide,
        manualOverride: false,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      if (scoreA !== null || scoreB !== null || stringValue(status).toLowerCase() === "finalizado") {
        const completedAt = stringValue(legacyMatch.completedAt);
        matchResults.push({
          matchId,
          scoreA,
          scoreB,
          winnerSide,
          resultStatus: "final",
          enteredByUserId: options.createdByUserId,
          enteredAt: completedAt ? Math.floor(Date.parse(completedAt) / 1000) : now,
          correctedAt: null,
          updatedAt: now,
        });
      }
      array(legacyMatch.sets).map(record).forEach((legacySet, setIndex) => {
        const a = numberValue(legacySet.a);
        const b = numberValue(legacySet.b);
        matchSets.push({
          id: childId("match-set", `${categoryName}:${legacyMatchId}:${setIndex + 1}`),
          matchId,
          setNumber: setIndex + 1,
          scoreA: a,
          scoreB: b,
          winnerSide: a > b ? "A" : "B",
        });
      });
    }
  }

  const scheduleItems: TournamentPersistenceBundle["scheduleItems"] = [];
  array(state.schedule).map(record).forEach((item, scheduleIndex) => {
    const categoryName = stringValue(item.category);
    const categoryId = categoryIdByName.get(categoryName);
    if (!categoryId) return;
    const legacyMatchId = numberValue(item.matchId);
    const encounterId = legacyMatchId > 0 ? encounterIdByLegacyMatch.get(String(legacyMatchId)) ?? null : null;
    const matchId = legacyMatchId > 0 ? matchIdByLegacyMatch.get(String(legacyMatchId)) ?? null : null;
    const date = stringValue(item.date, stringValue(categoryDates[categoryName], stringValue(tournamentSource.startDate)));
    const time = stringValue(item.time, stringValue(tournamentSource.dailyStart, "09:00"));
    const startAt = parseDateTime(date, time, utcOffsetMinutes);
    const durationMinutes = Math.max(1, numberValue(item.durationMinutes, numberValue(tournamentSource.matchMinutes, 15)));
    const roundLabel = stringValue(item.round) || null;
    scheduleItems.push({
      id: childId("schedule", scheduleIndex),
      tournamentId,
      categoryId,
      encounterId,
      matchId,
      placeholderKey: matchId ? null : `${categoryName}:${roundLabel ?? stringValue(item.stage)}:${numberValue(item.placeholderIndex)}:${numberValue(item.slot)}`,
      stage: mapEncounterStage(stringValue(item.stage), roundLabel ?? ""),
      roundLabel,
      courtLabel: `Cancha ${Math.max(1, numberValue(item.court, 1))}`,
      startAt,
      endAt: startAt + durationMinutes * 60,
      status: matchId ? "bound" : "reserved",
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  });

  const startDate = stringValue(tournamentSource.startDate);
  const endDate = stringValue(tournamentSource.endDate) || startDate;
  const dailyStart = stringValue(tournamentSource.dailyStart, "09:00");
  const dailyEnd = stringValue(tournamentSource.dailyEnd, "20:00");
  const tournament: TournamentPersistenceBundle["tournament"] = {
    id: tournamentId,
    organizerOrganizationId: options.organizationId,
    hostVenueId: null,
    name: stringValue(tournamentSource.name),
    slug: options.slug ?? `${slugify(stringValue(tournamentSource.name))}-${tournamentId.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toLowerCase()}`,
    sport: "pickleball",
    status: mapTournamentStatus(stringValue(tournamentSource.status)),
    visibility: "public",
    startAt: parseDateTime(startDate, dailyStart, utcOffsetMinutes),
    endAt: endDate ? parseDateTime(endDate, dailyEnd, utcOffsetMinutes) : null,
    timezone,
    courtCount: Math.max(1, numberValue(tournamentSource.courtCount, 1)),
    publicParticipants: true,
    publicLive: true,
    structureLocked: competitions.length > 0,
    publishedRevision: 0,
    workingRevision: sourceRevision ?? 1,
    createdByUserId: options.createdByUserId,
    createdAt: now,
    updatedAt: now,
  };

  const scheduleRevisions: TournamentPersistenceBundle["scheduleRevisions"] = scheduleItems.length
    ? [{ id: childId("schedule-revision", 1), tournamentId, revisionNumber: 1, generatedFromStructureRevision: 1, createdByUserId: options.createdByUserId, createdAt: now, isCurrent: true }]
    : [];
  const snapshots: TournamentPersistenceBundle["snapshots"] = [{
    id: childId("snapshot", "legacy-import"),
    tournamentId,
    scopeType: "tournament",
    scopeId: null,
    reason: "legacy_import",
    revision: sourceRevision ?? 1,
    payloadJson: JSON.stringify(input),
    createdByUserId: options.createdByUserId,
    createdAt: now,
  }];
  const auditEvents: TournamentPersistenceBundle["auditEvents"] = [{
    id: childId("audit", "legacy-import"),
    organizationId: options.organizationId,
    tournamentId,
    actorUserId: options.createdByUserId,
    actorType: "platform_admin",
    action: "tournament.legacy_imported",
    entityType: "tournament",
    entityId: tournamentId,
    summary: `Imported legacy tournament ${tournament.name}`,
    metadataJson: JSON.stringify({ sourceVersion, sourceRevision, people: people.length, categories: categories.length }),
    createdAt: now,
  }];

  return {
    schemaVersion: "phase3",
    source: { kind: "legacy", version: sourceVersion, revision: sourceRevision },
    people,
    tournament,
    categories,
    entries,
    entryMembers,
    formatVersions,
    competitions,
    groups,
    groupEntries,
    encounters,
    matches,
    matchResults,
    matchSets,
    scheduleItems,
    scheduleRevisions,
    snapshots,
    auditEvents,
  };
}

export function summarizeTournamentBundle(bundle: TournamentPersistenceBundle): TournamentBundleSummary {
  return {
    people: bundle.people.length,
    categories: bundle.categories.length,
    entries: bundle.entries.length,
    groups: bundle.groups.length,
    encounters: bundle.encounters.length,
    matches: bundle.matches.length,
    finalizedResults: bundle.matchResults.filter((result) => result.resultStatus === "final").length,
    scheduleItems: bundle.scheduleItems.length,
  };
}
