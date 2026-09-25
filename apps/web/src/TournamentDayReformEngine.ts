/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  buildCompetitionFromGroups,
  generateGlobalTournamentSchedule,
  generateTeamRoundRobinEncounters,
  type GlobalScheduleBreak,
  type GlobalScheduleClosedCourt,
  type GlobalScheduleConflict,
  type GlobalScheduleLock,
  type GlobalScheduleUnit,
  type TeamFormat,
  type TeamRosterMember,
} from "@huau/core";
import {
  addLocalPlayer,
  addLocalStandardEntry,
  cloneDay,
  createLocalTeam,
  generateLocalTeamStructure,
  reconcileTournamentDaySnapshot,
  syncStandardCompetition,
  teamFormatPreset,
  updateLocalTeamRoster,
  type TournamentDaySnapshot,
} from "./TournamentDayEngine";

export type DayParticipantOverride = Partial<{
  displayName: string;
  sportGender: "male" | "female" | "unspecified";
  club: string;
  contact: string;
  duprSingles: number;
  duprDoubles: number;
  playerStatus: string;
}> & { updatedAt: number };

export type DayTombstone = {
  reason: "no_show" | "withdrawn_local" | "replaced";
  at: number;
  replacementProfileId?: string | null;
};

export type DayPublicDirty = {
  structure: number;
  live: number;
  lastStructurePublishedAt: number | null;
  lastLivePublishedAt: number | null;
  structureRevision: number;
  liveRevision: number;
};

export type DayLocalMeta = {
  schemaVersion: 1;
  adminBaseRevision: number;
  importedAt: number;
  participantOverrides: Record<string, DayParticipantOverride>;
  participantTombstones: Record<string, DayTombstone>;
  teamOverrides: Record<string, { updatedAt: number; name?: string; roster?: TeamRosterMember[] }>;
  teamTombstones: Record<string, { at: number; reason: string }>;
  localParticipantIds: string[];
  localTeamIds: string[];
  schedule: {
    lockedUnitIds: string[];
    closedCourts: GlobalScheduleClosedCourt[];
    breaks: GlobalScheduleBreak[];
    lastConflicts: GlobalScheduleConflict[];
  };
  publicDirty: DayPublicDirty;
  adminBase: {
    participants: Record<string, string>;
    standardEntries: Record<string, string>;
    teams: Record<string, string>;
  };
};

export type TournamentDayReformSnapshot = TournamentDaySnapshot & { localMeta?: DayLocalMeta };

export type ParticipantImpact = {
  profileId: string;
  structuredCategoryIds: string[];
  scheduledRows: number;
  finishedMatches: number;
  dangerous: boolean;
};

export type AdminMergeItem = {
  kind:
    | "participant_new"
    | "participant_cancelled"
    | "participant_modified"
    | "standard_entry_new"
    | "standard_entry_modified"
    | "standard_entry_cancelled"
    | "team_new"
    | "team_modified"
    | "team_cancelled";
  id: string;
  label: string;
  safe: boolean;
  conflict: boolean;
  detail: string;
};

export type AdminMergePreview = {
  items: AdminMergeItem[];
  summary: {
    participantNew: number;
    participantCancelled: number;
    participantModified: number;
    registrationNew: number;
    registrationModified: number;
    registrationCancelled: number;
    teamNew: number;
    teamModified: number;
    teamCancelled: number;
    conflicts: number;
  };
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function participantFingerprint(player: any) {
  return stableJson({
    displayName: player.displayName ?? "",
    sportGender: player.sportGender ?? "unspecified",
    club: player.club ?? "",
    contact: player.contact ?? "",
    duprSingles: Number(player.duprSingles ?? 0),
    duprDoubles: Number(player.duprDoubles ?? 0),
    playerStatus: player.playerStatus ?? "confirmed",
  });
}

function teamFingerprint(entry: any) {
  return stableJson({
    displayName: entry.displayName ?? "",
    roster: [...(entry.roster ?? [])]
      .map((member: any) => ({ personId: member.personId, role: member.role, sportGender: member.sportGender }))
      .sort((a, b) => String(a.personId).localeCompare(String(b.personId))),
  });
}

function standardEntryFingerprint(entry: any) {
  return stableJson({
    categoryId: String(entry.categoryId ?? ""),
    displayName: String(entry.displayName ?? ""),
    status: String(entry.status ?? ""),
    sourceKind: String(entry.sourceKind ?? ""),
    sourceKey: String(entry.sourceKey ?? ""),
    localProfileIds: Array.isArray(entry.localProfileIds) ? entry.localProfileIds.map(String).sort() : [],
    participantIds: String(entry.participantIds ?? ""),
    members: String(entry.members ?? ""),
  });
}

function currentAdminBase(snapshot: TournamentDayReformSnapshot) {
  const participants = Object.fromEntries(
    (snapshot.workspace.participants.players as any[])
      .filter((player) => !String(player.id).startsWith("local-player:"))
      .map((player) => [String(player.id), participantFingerprint(player)]),
  );
  const standardEntries = Object.fromEntries(
    (snapshot.workspace.standard.entries as any[])
      .filter((entry) => !String(entry.id).startsWith("local-entry:"))
      .map((entry) => [String(entry.id), standardEntryFingerprint(entry)]),
  );
  const teams = Object.fromEntries(
    (snapshot.team.categories as any[]).flatMap((category) =>
      (category.entries ?? [])
        .filter((entry: any) => !String(entry.id).startsWith("local-team:"))
        .map((entry: any) => [String(entry.id), teamFingerprint(entry)]),
    ),
  );
  return { participants, standardEntries, teams };
}

export function ensureDayLocalMeta(snapshot: TournamentDayReformSnapshot): DayLocalMeta {
  if (!snapshot.localMeta) {
    snapshot.localMeta = {
      schemaVersion: 1,
      adminBaseRevision: Number(snapshot.baseRevision ?? 0),
      importedAt: Date.now(),
      participantOverrides: {},
      participantTombstones: {},
      teamOverrides: {},
      teamTombstones: {},
      localParticipantIds: [],
      localTeamIds: [],
      schedule: { lockedUnitIds: [], closedCourts: [], breaks: [], lastConflicts: [] },
      publicDirty: {
        structure: 0,
        live: 0,
        lastStructurePublishedAt: null,
        lastLivePublishedAt: null,
        structureRevision: 0,
        liveRevision: 0,
      },
      adminBase: currentAdminBase(snapshot),
    };
  }
  snapshot.localMeta.schemaVersion = 1;
  snapshot.localMeta.adminBaseRevision ??= Number(snapshot.baseRevision ?? 0);
  snapshot.localMeta.importedAt ??= Date.now();
  snapshot.localMeta.participantOverrides ??= {};
  snapshot.localMeta.participantTombstones ??= {};
  snapshot.localMeta.teamOverrides ??= {};
  snapshot.localMeta.teamTombstones ??= {};
  snapshot.localMeta.localParticipantIds ??= [];
  snapshot.localMeta.localTeamIds ??= [];
  snapshot.localMeta.schedule ??= { lockedUnitIds: [], closedCourts: [], breaks: [], lastConflicts: [] };
  snapshot.localMeta.publicDirty ??= {
    structure: 0,
    live: 0,
    lastStructurePublishedAt: null,
    lastLivePublishedAt: null,
    structureRevision: 0,
    liveRevision: 0,
  };
  snapshot.localMeta.adminBase ??= currentAdminBase(snapshot);
  snapshot.localMeta.adminBase.participants ??= {};
  snapshot.localMeta.adminBase.standardEntries ??= Object.fromEntries(
    (snapshot.workspace.standard.entries as any[])
      .filter((entry) => !String(entry.id).startsWith("local-entry:"))
      .map((entry) => [String(entry.id), standardEntryFingerprint(entry)]),
  );
  snapshot.localMeta.adminBase.teams ??= {};
  return snapshot.localMeta;
}

export function initializeReformSnapshot(snapshot: TournamentDayReformSnapshot) {
  reconcileTournamentDaySnapshot(snapshot);
  ensureDayLocalMeta(snapshot);
  return snapshot;
}

export function markStructureDirty(snapshot: TournamentDayReformSnapshot, amount = 1) {
  ensureDayLocalMeta(snapshot).publicDirty.structure += Math.max(1, amount);
}

export function markLiveDirty(snapshot: TournamentDayReformSnapshot, amount = 1) {
  ensureDayLocalMeta(snapshot).publicDirty.live += Math.max(1, amount);
}

export function markStructurePublished(snapshot: TournamentDayReformSnapshot, at = Date.now()) {
  const dirty = ensureDayLocalMeta(snapshot).publicDirty;
  dirty.structure = 0;
  dirty.structureRevision += 1;
  dirty.lastStructurePublishedAt = at;
}

export function markLivePublished(snapshot: TournamentDayReformSnapshot, at = Date.now()) {
  const dirty = ensureDayLocalMeta(snapshot).publicDirty;
  dirty.live = 0;
  dirty.liveRevision += 1;
  dirty.lastLivePublishedAt = at;
}

export function participantImpact(snapshot: TournamentDayReformSnapshot, profileId: string): ParticipantImpact {
  const categories = new Set<string>();
  const assignments = snapshot.workspace.participants.playerCategories as any[];
  assignments.filter((row) => row.playerProfileId === profileId || row.partnerProfileId === profileId).forEach((row) => categories.add(String(row.categoryId)));
  const player = (snapshot.workspace.participants.players as any[]).find((row) => row.id === profileId);
  const personKeys = new Set([profileId, player?.organizationPersonId, player?.userId].filter(Boolean).map(String));
  for (const category of snapshot.team.categories as any[]) {
    if ((category.entries ?? []).some((entry: any) => (entry.roster ?? []).some((member: any) => personKeys.has(String(member.personId))))) categories.add(String(category.id));
  }
  const structuredCategoryIds = [...categories].filter((categoryId) => {
    const standard = (snapshot.workspace.standard.competitions as any[]).find((row) => row.categoryId === categoryId);
    const team = (snapshot.team.categories as any[]).find((row) => row.id === categoryId);
    return Boolean(standard?.encounters?.length || team?.encounters?.length);
  });
  const teamEntryIds = new Set<string>();
  for (const category of snapshot.team.categories as any[]) {
    for (const entry of category.entries ?? []) {
      if ((entry.roster ?? []).some((member: any) => personKeys.has(String(member.personId)))) {
        teamEntryIds.add(String(entry.id));
      }
    }
  }
  const schedule = snapshot.workspace.schedule.schedule as any[];
  const affectedScheduleUnits = new Set<string>();
  for (const row of schedule) {
    if (!categories.has(String(row.categoryId))) continue;
    const standardHit = [row.entryAId, row.entryBId].some(
      (id) => id && standardEntryContainsProfile(snapshot, String(id), profileId),
    );
    const teamHit = [row.entryAId, row.entryBId].some(
      (id) => id && teamEntryIds.has(String(id)),
    );
    if (standardHit || teamHit) {
      affectedScheduleUnits.add(String(row.scheduleUnitId ?? row.encounterId ?? row.id));
    }
  }
  const scheduledRows = affectedScheduleUnits.size;
  const finishedMatches =
    (snapshot.workspace.standard.matches as any[]).filter(
      (match) =>
        match.status === "finished" &&
        categories.has(String(match.categoryId)) &&
        [match.entryAId, match.entryBId].some(
          (id) => id && standardEntryContainsProfile(snapshot, String(id), profileId),
        ),
    ).length +
    (snapshot.team.categories as any[])
      .flatMap((category) => category.encounters ?? [])
      .filter(
        (encounter: any) =>
          teamEntryIds.has(String(encounter.entryAId)) ||
          teamEntryIds.has(String(encounter.entryBId)),
      )
      .flatMap((encounter: any) => encounter.matches ?? [])
      .filter((match: any) => match.status === "finished").length;
  return { profileId, structuredCategoryIds, scheduledRows, finishedMatches, dangerous: finishedMatches > 0 };
}

function standardEntryContainsProfile(snapshot: TournamentDayReformSnapshot, entryId: string, profileId: string) {
  const entry = (snapshot.workspace.standard.entries as any[]).find((row) => String(row.id) === entryId);
  if (!entry) return false;
  if (Array.isArray(entry.localProfileIds) && entry.localProfileIds.map(String).includes(profileId)) return true;
  if (String(entry.sourceKey ?? "") === profileId) return true;
  return String(entry.participantIds ?? "").split("|").includes(profileId);
}

export function addDayParticipant(snapshot: TournamentDayReformSnapshot, input: {
  name: string;
  sportGender: "male" | "female" | "unspecified";
  club?: string;
  contact?: string;
  duprSingles?: number;
  duprDoubles?: number;
  categoryIds?: string[];
}) {
  const before = new Set((snapshot.workspace.participants.players as any[]).map((row) => String(row.id)));
  addLocalPlayer(snapshot, {
    name: input.name,
    sportGender: input.sportGender,
    club: input.club ?? "",
    contact: input.contact ?? "",
    duprSingles: Number(input.duprSingles ?? 0),
    duprDoubles: Number(input.duprDoubles ?? 0),
    categoryId: null,
  });
  const player = (snapshot.workspace.participants.players as any[]).find((row) => !before.has(String(row.id)));
  if (!player) throw new Error("DAY_PARTICIPANT_CREATE_FAILED");
  const meta = ensureDayLocalMeta(snapshot);
  if (!meta.localParticipantIds.includes(String(player.id))) meta.localParticipantIds.push(String(player.id));
  for (const categoryId of input.categoryIds ?? []) {
    assignParticipantToCategory(snapshot, String(player.id), categoryId);
  }
  markStructureDirty(snapshot);
  return player;
}

export function updateDayParticipant(snapshot: TournamentDayReformSnapshot, profileId: string, patch: Partial<{
  displayName: string;
  sportGender: "male" | "female" | "unspecified";
  club: string;
  contact: string;
  duprSingles: number;
  duprDoubles: number;
  playerStatus: string;
}>) {
  const player = (snapshot.workspace.participants.players as any[]).find((row) => String(row.id) === profileId);
  if (!player) throw new Error("DAY_PARTICIPANT_NOT_FOUND");
  Object.assign(player, patch);
  const meta = ensureDayLocalMeta(snapshot);
  if (!meta.localParticipantIds.includes(profileId)) {
    meta.participantOverrides[profileId] = { ...(meta.participantOverrides[profileId] ?? { updatedAt: Date.now() }), ...patch, updatedAt: Date.now() };
  }
  for (const profile of snapshot.team.profiles as any[]) {
    if (String(profile.id) === profileId || String(profile.personId) === String(player.organizationPersonId)) {
      if (patch.displayName !== undefined) profile.displayName = patch.displayName;
      if (patch.sportGender !== undefined) profile.sportGender = patch.sportGender;
      if (patch.duprSingles !== undefined) profile.duprSingles = patch.duprSingles;
      if (patch.duprDoubles !== undefined) profile.duprDoubles = patch.duprDoubles;
    }
  }
  markStructureDirty(snapshot);
}

export function setParticipantNoShow(snapshot: TournamentDayReformSnapshot, profileId: string, reason: DayTombstone["reason"] = "no_show") {
  const player = (snapshot.workspace.participants.players as any[]).find((row) => String(row.id) === profileId);
  if (!player) throw new Error("DAY_PARTICIPANT_NOT_FOUND");
  const impact = participantImpact(snapshot, profileId);
  player.playerStatus = reason === "no_show" ? "no_show" : "withdrawn_local";
  ensureDayLocalMeta(snapshot).participantTombstones[profileId] = { reason, at: Date.now() };
  if (!impact.dangerous) {
    const affectedCategoryIds = new Set(
      (snapshot.workspace.participants.playerCategories as any[])
        .filter((row) => String(row.playerProfileId) === profileId || String(row.partnerProfileId) === profileId)
        .map((row) => String(row.categoryId)),
    );
    snapshot.workspace.standard.entries = (snapshot.workspace.standard.entries as any[]).filter(
      (entry) => !standardEntryContainsProfile(snapshot, String(entry.id), profileId),
    );
    snapshot.workspace.participants.playerCategories = (snapshot.workspace.participants.playerCategories as any[]).filter(
      (row) => String(row.playerProfileId) !== profileId && String(row.partnerProfileId) !== profileId,
    );
    const personId = String(player.organizationPersonId ?? profileId);
    for (const category of snapshot.team.categories as any[]) {
      for (const entry of category.entries ?? []) {
        const before = (entry.roster ?? []).length;
        entry.roster = (entry.roster ?? []).filter((member: any) => String(member.personId) !== personId);
        if (entry.roster.length !== before) {
          affectedCategoryIds.add(String(category.id));
          for (const encounter of category.encounters ?? []) {
            encounter.lineups = (encounter.lineups ?? []).filter((lineup: any) => String(lineup.entryId) !== String(entry.id));
          }
        }
      }
    }
    for (const categoryId of affectedCategoryIds) {
      snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter(
        (row) => String(row.categoryId) !== categoryId,
      );
    }
    reconcileTournamentDaySnapshot(snapshot);
  }
  markStructureDirty(snapshot);
  return impact;
}

export function restoreParticipant(snapshot: TournamentDayReformSnapshot, profileId: string) {
  const player = (snapshot.workspace.participants.players as any[]).find((row) => String(row.id) === profileId);
  if (!player) throw new Error("DAY_PARTICIPANT_NOT_FOUND");
  player.playerStatus = "confirmed";
  delete ensureDayLocalMeta(snapshot).participantTombstones[profileId];
  markStructureDirty(snapshot);
}

export function assignParticipantToCategory(snapshot: TournamentDayReformSnapshot, profileId: string, categoryId: string) {
  const category = (snapshot.workspace.core.categories as any[]).find((row) => String(row.id) === categoryId);
  if (!category) throw new Error("DAY_CATEGORY_NOT_FOUND");
  const assignments = snapshot.workspace.participants.playerCategories as any[];
  if (!assignments.some((row) => String(row.playerProfileId) === profileId && String(row.categoryId) === categoryId)) {
    assignments.push({ playerProfileId: profileId, categoryId, partnerProfileId: null, source: "day" });
  }
  if (category.entryType === "individual") {
    const exists = (snapshot.workspace.standard.entries as any[]).some((entry) => String(entry.categoryId) === categoryId && standardEntryContainsProfile(snapshot, String(entry.id), profileId));
    if (!exists) {
      const player = (snapshot.workspace.participants.players as any[]).find((row) => String(row.id) === profileId);
      addLocalStandardEntry(snapshot, {
        categoryId,
        profileIds: [profileId],
        rating: Math.max(Number(player?.duprSingles ?? 0), Number(player?.duprDoubles ?? 0)),
      });
    }
  }
  markStructureDirty(snapshot);
}

export function removeParticipantFromCategory(snapshot: TournamentDayReformSnapshot, profileId: string, categoryId: string) {
  const competition = (snapshot.workspace.standard.competitions as any[]).find((row) => String(row.categoryId) === categoryId);
  const teamCategory = (snapshot.team.categories as any[]).find((row) => String(row.id) === categoryId);
  const hasResults = Boolean(
    competition?.encounters?.some((encounter: any) => ["finished", "in_progress"].includes(encounter.status)) ||
    teamCategory?.encounters?.some((encounter: any) => (encounter.matches ?? []).some((match: any) => match.resultStatus)),
  );
  if (hasResults) throw new Error("DAY_CATEGORY_REMOVE_HAS_RESULTS");
  snapshot.workspace.participants.playerCategories = (snapshot.workspace.participants.playerCategories as any[]).filter((row) => !(String(row.playerProfileId) === profileId && String(row.categoryId) === categoryId));
  snapshot.workspace.standard.entries = (snapshot.workspace.standard.entries as any[]).filter((entry) => !(String(entry.categoryId) === categoryId && standardEntryContainsProfile(snapshot, String(entry.id), profileId)));
  if (teamCategory) {
    const player = (snapshot.workspace.participants.players as any[]).find((row) => String(row.id) === profileId);
    const personId = String(player?.organizationPersonId ?? profileId);
    for (const entry of teamCategory.entries ?? []) entry.roster = (entry.roster ?? []).filter((member: any) => String(member.personId) !== personId);
  }
  markStructureDirty(snapshot);
}

export function createDayTeam(snapshot: TournamentDayReformSnapshot, categoryId: string, name: string) {
  const category = (snapshot.team.categories as any[]).find((row) => String(row.id) === categoryId);
  if (!category) throw new Error("TEAM_CATEGORY_NOT_FOUND");
  const before = new Set((category.entries ?? []).map((row: any) => String(row.id)));
  createLocalTeam(snapshot, categoryId, name);
  const created = (category.entries ?? []).find((row: any) => !before.has(String(row.id)));
  if (!created) throw new Error("DAY_TEAM_CREATE_FAILED");
  ensureDayLocalMeta(snapshot).localTeamIds.push(String(created.id));
  markStructureDirty(snapshot);
  return created;
}

export function updateDayTeam(snapshot: TournamentDayReformSnapshot, categoryId: string, entryId: string, input: { name?: string; roster?: TeamRosterMember[] }) {
  const category = (snapshot.team.categories as any[]).find((row) => String(row.id) === categoryId);
  const entry = category?.entries?.find((row: any) => String(row.id) === entryId);
  if (!entry) throw new Error("DAY_TEAM_NOT_FOUND");
  if (input.name !== undefined) entry.displayName = input.name.trim();
  if (input.roster !== undefined) updateLocalTeamRoster(snapshot, categoryId, entryId, input.roster);
  const meta = ensureDayLocalMeta(snapshot);
  if (!meta.localTeamIds.includes(entryId)) meta.teamOverrides[entryId] = { updatedAt: Date.now(), ...input };
  markStructureDirty(snapshot);
}

export function deleteDayTeam(snapshot: TournamentDayReformSnapshot, categoryId: string, entryId: string) {
  const category = (snapshot.team.categories as any[]).find((row) => String(row.id) === categoryId);
  const entry = category?.entries?.find((row: any) => String(row.id) === entryId);
  if (!entry) throw new Error("DAY_TEAM_NOT_FOUND");
  if ((category.encounters ?? []).some((encounter: any) => [encounter.entryAId, encounter.entryBId].includes(entryId) && (encounter.matches ?? []).some((match: any) => match.resultStatus))) {
    throw new Error("DAY_TEAM_DELETE_HAS_RESULTS");
  }
  category.entries = category.entries.filter((row: any) => String(row.id) !== entryId);
  category.groups = (category.groups ?? []).filter((row: any) => String(row.entryId) !== entryId);
  if (!ensureDayLocalMeta(snapshot).localTeamIds.includes(entryId)) ensureDayLocalMeta(snapshot).teamTombstones[entryId] = { at: Date.now(), reason: "deleted_local" };
  markStructureDirty(snapshot);
}

function standardEntryParticipantKeys(snapshot: TournamentDayReformSnapshot, entryId: string | null | undefined) {
  if (!entryId) return [];
  const entry = (snapshot.workspace.standard.entries as any[]).find((row) => String(row.id) === String(entryId));
  if (!entry) return [String(entryId)];
  const ids = new Set<string>();
  if (Array.isArray(entry.localProfileIds)) entry.localProfileIds.forEach((id: unknown) => ids.add(String(id)));
  String(entry.participantIds ?? "").split("|").map((value) => value.trim()).filter(Boolean).forEach((value) => ids.add(value));
  if (entry.sourceKey) ids.add(String(entry.sourceKey));
  return [...ids];
}

function teamEntryParticipantKeys(category: any, entryId: string | null | undefined) {
  const entry = category.entries?.find((row: any) => String(row.id) === String(entryId));
  return (entry?.roster ?? []).map((member: any) => String(member.personId));
}

function dayDate(snapshot: TournamentDayReformSnapshot, category: any) {
  if (category?.scheduledDate) return String(category.scheduledDate);
  const raw = Number(snapshot.workspace.core.tournament.startAt ?? Date.now());
  return new Date(raw < 10_000_000_000 ? raw * 1000 : raw).toISOString().slice(0, 10);
}

function applySchedulePolicy(
  snapshot: TournamentDayReformSnapshot,
  units: GlobalScheduleUnit[],
): GlobalScheduleUnit[] {
  const policy = (snapshot.workspace.core.settings as any).schedulePolicy as
    | { mode?: string; categories?: Record<string, any> }
    | undefined;
  if (!policy || !policy.categories) return units;

  const mode = String(policy.mode ?? "efficiency");
  const groupOrder = new Map<string, Map<string, number>>();
  for (const categoryId of new Set(units.map((unit) => unit.categoryId))) {
    const groups = [...new Map(
      units
        .filter((unit) => unit.categoryId === categoryId && unit.groupId)
        .map((unit) => [String(unit.groupId), String(unit.groupName ?? unit.groupId)] as const),
    ).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]));
    groupOrder.set(categoryId, new Map(groups.map(([id], index) => [id, index + 1])));
  }

  return units.map((unit) => {
    const rule = policy.categories?.[unit.categoryId] ?? {};
    const order = Math.max(1, Number(rule.order ?? 999));
    const phase = mode === "categories"
      ? order
      : mode === "blocks"
        ? Math.max(1, Number(rule.phase ?? 1))
        : 0;
    const sequence = String(rule.sequence ?? "free");
    let sequenceKey: string | null = null;
    let sequenceIndex: number | null = null;
    if (sequence === "rounds") {
      sequenceKey = `rounds:${unit.categoryId}`;
      sequenceIndex = Math.max(1, Number(unit.roundNumber ?? 1));
    } else if ((sequence === "groups" || sequence === "group_pairs") && unit.groupId) {
      const groupIndex = groupOrder.get(unit.categoryId)?.get(String(unit.groupId)) ?? 1;
      sequenceKey = `groups:${unit.categoryId}`;
      sequenceIndex = sequence === "group_pairs" ? Math.ceil(groupIndex / 2) : groupIndex;
    }
    return {
      ...unit,
      policyPhase: phase || null,
      policySequenceKey: sequenceKey,
      policySequenceIndex: sequenceIndex,
      priority: mode === "priority" || mode === "blocks" ? -order : (unit.priority ?? 0),
      allowedCourts: Array.isArray(rule.allowedCourts) ? rule.allowedCourts.map(Number) : [],
      preferredCourts: Array.isArray(rule.preferredCourts) ? rule.preferredCourts.map(Number) : [],
      exclusiveCourts: Array.isArray(rule.exclusiveCourts) ? rule.exclusiveCourts.map(Number) : [],
      maxConcurrentCourts: rule.maxConcurrentCourts === null || rule.maxConcurrentCourts === undefined || rule.maxConcurrentCourts === ""
        ? null
        : Math.max(1, Number(rule.maxConcurrentCourts)),
    };
  });
}

function globalUnits(snapshot: TournamentDayReformSnapshot): GlobalScheduleUnit[] {
  const settings = snapshot.workspace.core.settings as any;
  const categories = new Map((snapshot.workspace.core.categories as any[]).map((category) => [String(category.id), category] as const));
  const units: GlobalScheduleUnit[] = [];
  const meta = ensureDayLocalMeta(snapshot);
  const tombstonedKeys = new Set<string>();
  for (const profileId of Object.keys(meta.participantTombstones)) {
    tombstonedKeys.add(profileId);
    const player = (snapshot.workspace.participants.players as any[]).find((row) => String(row.id) === profileId);
    if (player?.organizationPersonId) tombstonedKeys.add(String(player.organizationPersonId));
    if (player?.userId) tombstonedKeys.add(String(player.userId));
  }
  const standardByCategory = new Map((snapshot.workspace.standard.competitions as any[]).map((competition) => [String(competition.categoryId), competition] as const));

  for (const match of snapshot.workspace.standard.matches as any[]) {
    if (!match.entryAId || !match.entryBId || ["bye", "skipped", "finished"].includes(String(match.status))) continue;
    const category = categories.get(String(match.categoryId));
    const competition = standardByCategory.get(String(match.categoryId));
    const encounter = competition?.encounters?.find((row: any) => String(row.id) === String(match.encounterId));
    const deps = [encounter?.sourceEncounterAId, encounter?.sourceEncounterBId, encounter?.sourceLoserAId, encounter?.sourceLoserBId].filter(Boolean).map((id) => `std:${match.categoryId}:${id}`);
    const participants = [...standardEntryParticipantKeys(snapshot, match.entryAId), ...standardEntryParticipantKeys(snapshot, match.entryBId)];
    if (participants.some((participant) => tombstonedKeys.has(participant))) continue;
    units.push({
      id: `std:${match.categoryId}:${match.encounterId}`,
      categoryId: String(match.categoryId),
      categoryName: String(match.categoryName ?? category?.name ?? ""),
      kind: "standard",
      date: dayDate(snapshot, category),
      stage: String(match.stage ?? "group"),
      roundLabel: match.roundLabel ?? null,
      roundNumber: match.roundNumber ?? encounter?.roundNumber ?? null,
      groupId: match.groupId ? String(match.groupId) : null,
      groupName: match.groupName ? String(match.groupName) : null,
      legNumber: match.legNumber ?? encounter?.legNumber ?? 1,
      barrierKey: match.groupId ? `${match.categoryId}:${match.groupId}` : null,
      participants,
      dependencyIds: deps,
      durationMinutes: Math.max(5, Number(settings.defaultMatchMinutes ?? 30)),
      minimumRestSlots: Math.max(0, Number(settings.minimumRestSlots ?? 1)),
      preferredRestSlots: Math.max(0, Number(competition?.format?.preferredRestSlots ?? settings.preferredRestSlots ?? settings.minimumRestSlots ?? 1)),
    });
  }

  for (const teamCategory of snapshot.team.categories as any[]) {
    const coreCategory = categories.get(String(teamCategory.id));
    const format = teamCategory.format as TeamFormat | null;
    for (const encounter of teamCategory.encounters ?? []) {
      if (!encounter.entryAId || !encounter.entryBId || ["bye", "finished"].includes(String(encounter.status))) continue;
      const activeMatches = (encounter.matches ?? []).filter((match: any) => match.status !== "skipped" && match.status !== "finished");
      if (!activeMatches.length) continue;
      const defs = new Map<string, any>((format?.encounter?.rubbers ?? []).map((rubber: any) => [String(rubber.key), rubber] as const));
      units.push({
        id: `team:${teamCategory.id}:${encounter.id}`,
        categoryId: String(teamCategory.id),
        categoryName: String(teamCategory.name ?? coreCategory?.name ?? ""),
        kind: "team",
        date: dayDate(snapshot, coreCategory ?? teamCategory),
        stage: String(encounter.stage ?? "group"),
        roundLabel: encounter.roundLabel ?? null,
        roundNumber: encounter.roundNumber ?? null,
        groupId: encounter.groupId ? String(encounter.groupId) : null,
        groupName: encounter.groupName ? String(encounter.groupName) : null,
        legNumber: encounter.legNumber ?? 1,
        barrierKey: encounter.groupId ? `${teamCategory.id}:${encounter.groupId}` : null,
        participants: [...teamEntryParticipantKeys(teamCategory, encounter.entryAId), ...teamEntryParticipantKeys(teamCategory, encounter.entryBId)],
        dependencyIds: [encounter.sourceEncounterAId, encounter.sourceEncounterBId, encounter.sourceLoserAId, encounter.sourceLoserBId].filter(Boolean).map((id: string) => `team:${teamCategory.id}:${id}`),
        durationMinutes: 0,
        minimumRestSlots: Math.max(0, Number(settings.minimumRestSlots ?? 1)),
        preferredRestSlots: Math.max(0, Number(settings.preferredRestSlots ?? settings.minimumRestSlots ?? 1)),
        rubbers: activeMatches.sort((a: any, b: any) => Number(a.rubberOrder) - Number(b.rubberOrder)).map((match: any) => ({
          id: String(match.id),
          label: String(defs.get(String(match.rubberKey))?.label ?? match.rubberKey ?? "Rubber"),
          durationMinutes: Math.max(5, Number(settings.teamRubberMinutes ?? settings.defaultMatchMinutes ?? 30)),
          conditional: String(defs.get(String(match.rubberKey))?.play ?? "always") === "if_tied",
        })),
      });
    }
  }
  return applySchedulePolicy(snapshot, units);
}

function lockedUnits(snapshot: TournamentDayReformSnapshot, units: GlobalScheduleUnit[]): GlobalScheduleLock[] {
  const meta = ensureDayLocalMeta(snapshot);
  const locked = new Set(meta.schedule.lockedUnitIds);
  const schedule = snapshot.workspace.schedule.schedule as any[];
  const result: GlobalScheduleLock[] = [];
  for (const unit of units) {
    if (!locked.has(unit.id)) continue;
    if (unit.kind === "standard") {
      const encounterId = unit.id.split(":").slice(2).join(":");
      const row = schedule.find((item) => String(item.encounterId) === encounterId && String(item.categoryId) === unit.categoryId);
      if (row?.startAt && row?.endAt) result.push({ unitId: unit.id, court: Number(String(row.courtLabel).match(/\d+/)?.[0] ?? 1), startAt: Number(row.startAt) * (Number(row.startAt) < 10_000_000_000 ? 1000 : 1), endAt: Number(row.endAt) * (Number(row.endAt) < 10_000_000_000 ? 1000 : 1) });
    } else {
      const encounterId = unit.id.split(":").slice(2).join(":");
      const rows = schedule.filter((item) => String(item.encounterId) === encounterId && String(item.categoryId) === unit.categoryId);
      if (rows.length) {
        const startAt = Math.min(...rows.map((row) => Number(row.startAt) * (Number(row.startAt) < 10_000_000_000 ? 1000 : 1)));
        const endAt = Math.max(...rows.map((row) => Number(row.endAt) * (Number(row.endAt) < 10_000_000_000 ? 1000 : 1)));
        result.push({ unitId: unit.id, court: Number(String(rows[0].courtLabel).match(/\d+/)?.[0] ?? 1), startAt, endAt });
      }
    }
  }
  return result;
}

export function regenerateGlobalSchedule(snapshot: TournamentDayReformSnapshot, options: { onlyUnlocked?: boolean } = {}) {
  const units = globalUnits(snapshot);
  const settings = snapshot.workspace.core.settings as any;
  const tournament = snapshot.workspace.core.tournament as any;
  const meta = ensureDayLocalMeta(snapshot);
  const result = generateGlobalTournamentSchedule({
    settings: {
      dailyStart: String(settings.dailyStart ?? "09:00"),
      dailyEnd: String(settings.dailyEnd ?? "20:00"),
      courtCount: Math.max(1, Number(tournament.courtCount ?? 1)),
      defaultMatchMinutes: Math.max(5, Number(settings.defaultMatchMinutes ?? 30)),
      minimumRestSlots: Math.max(0, Number(settings.minimumRestSlots ?? 1)),
      preferredRestSlots: Math.max(0, Number(settings.preferredRestSlots ?? settings.minimumRestSlots ?? 1)),
      stepMinutes: 5,
      regenerateOnlyUnlocked: Boolean(options.onlyUnlocked),
    },
    units,
    locks: options.onlyUnlocked ? lockedUnits(snapshot, units) : [],
    closedCourts: meta.schedule.closedCourts,
    breaks: meta.schedule.breaks,
  });
  meta.schedule.lastConflicts = result.conflicts;
  const old = snapshot.workspace.schedule.schedule as any[];
  const preserved = options.onlyUnlocked ? old.filter((row) => meta.schedule.lockedUnitIds.includes(row.scheduleUnitId)) : old.filter((row) => row.status === "completed");
  const generated: any[] = [];
  const unitById = new Map(units.map((unit) => [unit.id, unit] as const));
  for (const assignment of result.assignments) {
    const unit = unitById.get(assignment.unitId)!;
    const courtLabel = `Cancha ${assignment.court}`;
    if (assignment.kind === "standard") {
      const encounterId = assignment.unitId.split(":").slice(2).join(":");
      const match = (snapshot.workspace.standard.matches as any[]).find((row) => String(row.categoryId) === unit.categoryId && String(row.encounterId) === encounterId);
      if (!match) continue;
      match.scheduleStart = Math.floor(assignment.startAt / 1000);
      match.scheduleEnd = Math.floor(assignment.endAt / 1000);
      match.courtLabel = courtLabel;
      generated.push({
        id: `local-global-schedule:${assignment.unitId}`,
        scheduleUnitId: assignment.unitId,
        categoryId: unit.categoryId,
        categoryName: unit.categoryName ?? match.categoryName ?? "",
        categoryEntryType: "individual",
        encounterId,
        matchId: match.matchId,
        stage: unit.stage,
        roundLabel: unit.roundLabel,
        courtLabel,
        startAt: Math.floor(assignment.startAt / 1000),
        endAt: Math.floor(assignment.endAt / 1000),
        status: "bound",
        groupId: match.groupId ?? null,
        groupName: match.groupName ?? null,
        legNumber: match.legNumber ?? 1,
        entryAId: match.entryAId,
        sideA: match.sideA,
        entryBId: match.entryBId,
        sideB: match.sideB,
        locked: assignment.locked,
      });
    } else {
      const encounterId = assignment.unitId.split(":").slice(2).join(":");
      const category = (snapshot.team.categories as any[]).find((row) => String(row.id) === unit.categoryId);
      const encounter = category?.encounters?.find((row: any) => String(row.id) === encounterId);
      if (!encounter) continue;
      for (const rubber of assignment.rubbers) {
        const match = encounter.matches.find((row: any) => String(row.id) === rubber.id);
        if (!match) continue;
        match.scheduleStart = Math.floor(rubber.startAt / 1000);
        match.scheduleEnd = Math.floor(rubber.endAt / 1000);
        match.courtLabel = courtLabel;
        match.scheduleStatus = "bound";
        generated.push({
          id: `local-global-schedule:${assignment.unitId}:${match.id}`,
          scheduleUnitId: assignment.unitId,
          categoryId: unit.categoryId,
          categoryName: unit.categoryName ?? category?.name ?? "",
          categoryEntryType: "team",
          encounterId,
          matchId: match.id,
          stage: unit.stage,
          roundLabel: unit.roundLabel,
          courtLabel,
          startAt: Math.floor(rubber.startAt / 1000),
          endAt: Math.floor(rubber.endAt / 1000),
          status: "bound",
          groupId: encounter.groupId ?? null,
          groupName: encounter.groupName ?? null,
          legNumber: encounter.legNumber ?? 1,
          entryAId: encounter.entryAId,
          sideA: encounter.sideA,
          entryBId: encounter.entryBId,
          sideB: encounter.sideB,
          rubberKey: match.rubberKey,
          rubberCode: String((category?.format?.encounter?.rubbers ?? []).find((definition: any) => String(definition.key) === String(match.rubberKey))?.displayCode ?? match.rubberKey ?? ""),
          rubberOrder: match.rubberOrder,
          conditional: Boolean(rubber.conditional),
          locked: assignment.locked,
        });
      }
    }
  }
  const generatedIds = new Set(generated.map((row) => row.id));
  snapshot.workspace.schedule.schedule = [...preserved.filter((row) => !generatedIds.has(row.id)), ...generated].sort((a, b) => Number(a.startAt) - Number(b.startAt) || String(a.courtLabel).localeCompare(String(b.courtLabel)));
  markStructureDirty(snapshot);
  return result;
}

export function setScheduleUnitLocked(snapshot: TournamentDayReformSnapshot, scheduleUnitId: string, locked: boolean) {
  const list = ensureDayLocalMeta(snapshot).schedule.lockedUnitIds;
  const set = new Set(list);
  if (locked) set.add(scheduleUnitId); else set.delete(scheduleUnitId);
  ensureDayLocalMeta(snapshot).schedule.lockedUnitIds = [...set];
  for (const row of snapshot.workspace.schedule.schedule as any[]) if (row.scheduleUnitId === scheduleUnitId) row.locked = locked;
}

export function closeCourt(snapshot: TournamentDayReformSnapshot, court: number, startAt: number, endAt: number, label = "Cancha cerrada") {
  ensureDayLocalMeta(snapshot).schedule.closedCourts.push({ court, startAt: startAt * (startAt < 10_000_000_000 ? 1000 : 1), endAt: endAt * (endAt < 10_000_000_000 ? 1000 : 1), label });
  markStructureDirty(snapshot);
}

export function addScheduleBreak(snapshot: TournamentDayReformSnapshot, startAt: number, endAt: number, label = "Descanso") {
  ensureDayLocalMeta(snapshot).schedule.breaks.push({ startAt: startAt * (startAt < 10_000_000_000 ? 1000 : 1), endAt: endAt * (endAt < 10_000_000_000 ? 1000 : 1), label });
  markStructureDirty(snapshot);
}

function currentScheduleLocks(snapshot: TournamentDayReformSnapshot, units: GlobalScheduleUnit[]): GlobalScheduleLock[] {
  const schedule = snapshot.workspace.schedule.schedule as any[];
  const result: GlobalScheduleLock[] = [];
  for (const unit of units) {
    if (unit.kind === "standard") {
      const encounterId = unit.id.split(":").slice(2).join(":");
      const row = schedule.find((item) => String(item.encounterId) === encounterId && String(item.categoryId) === unit.categoryId);
      if (!row?.startAt || !row?.endAt) continue;
      result.push({ unitId: unit.id, court: Number(String(row.courtLabel).match(/\d+/)?.[0] ?? 1), startAt: Number(row.startAt) * (Number(row.startAt) < 10_000_000_000 ? 1000 : 1), endAt: Number(row.endAt) * (Number(row.endAt) < 10_000_000_000 ? 1000 : 1) });
    } else {
      const encounterId = unit.id.split(":").slice(2).join(":");
      const rows = schedule.filter((item) => String(item.encounterId) === encounterId && String(item.categoryId) === unit.categoryId);
      if (!rows.length) continue;
      const courts = new Set(rows.map((row) => String(row.courtLabel)));
      if (courts.size !== 1) {
        result.push({ unitId: unit.id, court: -1, startAt: 0, endAt: 0 });
        continue;
      }
      result.push({ unitId: unit.id, court: Number(String(rows[0].courtLabel).match(/\d+/)?.[0] ?? 1), startAt: Math.min(...rows.map((row) => Number(row.startAt) * (Number(row.startAt) < 10_000_000_000 ? 1000 : 1))), endAt: Math.max(...rows.map((row) => Number(row.endAt) * (Number(row.endAt) < 10_000_000_000 ? 1000 : 1))) });
    }
  }
  return result;
}

export function validateGlobalSchedule(snapshot: TournamentDayReformSnapshot) {
  const units = globalUnits(snapshot);
  const settings = snapshot.workspace.core.settings as any;
  const tournament = snapshot.workspace.core.tournament as any;
  const meta = ensureDayLocalMeta(snapshot);
  return generateGlobalTournamentSchedule({
    settings: { dailyStart: String(settings.dailyStart ?? "09:00"), dailyEnd: String(settings.dailyEnd ?? "20:00"), courtCount: Math.max(1, Number(tournament.courtCount ?? 1)), defaultMatchMinutes: Math.max(5, Number(settings.defaultMatchMinutes ?? 30)), minimumRestSlots: Math.max(0, Number(settings.minimumRestSlots ?? 1)), preferredRestSlots: Math.max(0, Number(settings.preferredRestSlots ?? settings.minimumRestSlots ?? 1)), stepMinutes: 5 },
    units,
    locks: currentScheduleLocks(snapshot, units),
    closedCourts: meta.schedule.closedCourts,
    breaks: meta.schedule.breaks,
  }).conflicts.filter((conflict: GlobalScheduleConflict) => conflict.code === "SCHEDULE_LOCK_CONFLICT");
}

export function updateScheduleUnit(snapshot: TournamentDayReformSnapshot, scheduleUnitId: string, patch: { court?: number; startAt?: number; durationMinutes?: number }) {
  const rows = (snapshot.workspace.schedule.schedule as any[]).filter((row) => row.scheduleUnitId === scheduleUnitId).sort((a, b) => Number(a.startAt) - Number(b.startAt));
  if (!rows.length) throw new Error("SCHEDULE_UNIT_NOT_FOUND");
  const backup = rows.map((row) => ({ row, startAt: row.startAt, endAt: row.endAt, courtLabel: row.courtLabel, locked: row.locked }));
  const oldStart = Number(rows[0].startAt);
  const oldEnd = Number(rows[rows.length - 1].endAt);
  const startAt = patch.startAt ?? oldStart;
  const duration = patch.durationMinutes ? patch.durationMinutes * 60 : oldEnd - oldStart;
  const delta = startAt - oldStart;
  for (const row of rows) {
    row.startAt = Number(row.startAt) + delta;
    row.endAt = Number(row.endAt) + delta;
    if (patch.court) row.courtLabel = `Cancha ${patch.court}`;
  }
  if (rows.length === 1 && patch.durationMinutes) rows[0].endAt = startAt + duration;
  const conflicts = validateGlobalSchedule(snapshot);
  if (conflicts.length) {
    for (const item of backup) { item.row.startAt = item.startAt; item.row.endAt = item.endAt; item.row.courtLabel = item.courtLabel; item.row.locked = item.locked; }
    throw new Error(`SCHEDULE_MANUAL_MOVE_CONFLICT:${conflicts.map((conflict: GlobalScheduleConflict) => conflict.unitId).join(",")}`);
  }
  setScheduleUnitLocked(snapshot, scheduleUnitId, true);
  markStructureDirty(snapshot);
}

export function previewAdminMerge(local: TournamentDayReformSnapshot, incoming: TournamentDayReformSnapshot): AdminMergePreview {
  const meta = ensureDayLocalMeta(local);
  const items: AdminMergeItem[] = [];
  const incomingPlayers = new Map((incoming.workspace.participants.players as any[]).map((row) => [String(row.id), row] as const));
  const localPlayers = new Map((local.workspace.participants.players as any[]).map((row) => [String(row.id), row] as const));
  for (const [id, player] of incomingPlayers) {
    const priorHash = meta.adminBase.participants[id];
    if (!priorHash && !localPlayers.has(id)) {
      items.push({ kind: "participant_new", id, label: String(player.displayName ?? id), safe: true, conflict: false, detail: "Nuevo en Administración." });
      continue;
    }
    if (priorHash && priorHash !== participantFingerprint(player)) {
      const override = meta.participantOverrides[id];
      const tombstone = meta.participantTombstones[id];
      items.push({ kind: "participant_modified", id, label: String(player.displayName ?? id), safe: !override && !tombstone, conflict: Boolean(override || tombstone), detail: tombstone ? "Existe tombstone local; no se resucita automáticamente." : override ? "Existe override local; requiere resolución." : "Cambio de datos base en Administración." });
    }
  }
  for (const [id] of Object.entries(meta.adminBase.participants)) {
    if (!incomingPlayers.has(id) && localPlayers.has(id)) {
      const impact = participantImpact(local, id);
      items.push({ kind: "participant_cancelled", id, label: String(localPlayers.get(id)?.displayName ?? id), safe: !impact.dangerous && impact.structuredCategoryIds.length === 0, conflict: impact.structuredCategoryIds.length > 0, detail: impact.dangerous ? "Cancelación afecta resultados; no se aplica silenciosamente." : impact.structuredCategoryIds.length ? "Cancelación afecta estructura o cronograma." : "Cancelado en Administración." });
    }
  }
  const incomingStandardEntries = new Map(
    (incoming.workspace.standard.entries as any[]).map((entry) => [String(entry.id), entry] as const),
  );
  const localStandardEntries = new Map(
    (local.workspace.standard.entries as any[]).map((entry) => [String(entry.id), entry] as const),
  );
  for (const [id, entry] of incomingStandardEntries) {
    const priorHash = meta.adminBase.standardEntries[id];
    const categoryId = String(entry.categoryId ?? "");
    const competition = (local.workspace.standard.competitions as any[]).find(
      (candidate) => String(candidate.categoryId) === categoryId,
    );
    const started = Boolean(
      competition?.encounters?.some((encounter: any) =>
        ["finished", "in_progress"].includes(String(encounter.status)),
      ),
    );
    const structured = Boolean(competition?.encounters?.length || competition?.groups?.length);
    if (!priorHash && !localStandardEntries.has(id)) {
      items.push({
        kind: "standard_entry_new",
        id,
        label: String(entry.displayName ?? id),
        safe: !structured,
        conflict: structured,
        detail: started
          ? "Inscripción nueva, pero la categoría ya tiene resultados."
          : structured
            ? "Inscripción nueva; requiere rearmar la estructura de la categoría."
            : "Inscripción/entry nueva en Administración.",
      });
    } else if (priorHash && priorHash !== standardEntryFingerprint(entry)) {
      items.push({
        kind: "standard_entry_modified",
        id,
        label: String(entry.displayName ?? id),
        safe: !structured,
        conflict: structured,
        detail: started
          ? "La inscripción cambió y la categoría ya tiene resultados."
          : structured
            ? "La inscripción cambió; requiere revisar grupos/cronograma."
            : "La inscripción/entry cambió en Administración.",
      });
    }
  }
  for (const [id] of Object.entries(meta.adminBase.standardEntries)) {
    const localEntry = localStandardEntries.get(id);
    if (!incomingStandardEntries.has(id) && localEntry) {
      const categoryId = String(localEntry.categoryId ?? "");
      const competition = (local.workspace.standard.competitions as any[]).find(
        (candidate) => String(candidate.categoryId) === categoryId,
      );
      const started = Boolean(
        competition?.encounters?.some((encounter: any) =>
          ["finished", "in_progress"].includes(String(encounter.status)),
        ),
      );
      const structured = Boolean(competition?.encounters?.length || competition?.groups?.length);
      items.push({
        kind: "standard_entry_cancelled",
        id,
        label: String(localEntry.displayName ?? id),
        safe: !structured,
        conflict: structured,
        detail: started
          ? "Cancelación afecta resultados; no se aplica silenciosamente."
          : structured
            ? "Cancelación afecta estructura o cronograma."
            : "Inscripción/entry retirada en Administración.",
      });
    }
  }

  const incomingTeams = new Map<string, { category: any; entry: any }>((incoming.team.categories as any[]).flatMap((category) => (category.entries ?? []).map((entry: any) => [String(entry.id), { category, entry }] as const)));
  const localTeams = new Map<string, { category: any; entry: any }>((local.team.categories as any[]).flatMap((category) => (category.entries ?? []).map((entry: any) => [String(entry.id), { category, entry }] as const)));
  for (const [id, value] of incomingTeams) {
    const priorHash = meta.adminBase.teams[id];
    if (!priorHash && !localTeams.has(id)) items.push({ kind: "team_new", id, label: String(value.entry.displayName ?? id), safe: true, conflict: false, detail: "Equipo nuevo en Administración." });
    else if (priorHash && priorHash !== teamFingerprint(value.entry)) {
      const override = meta.teamOverrides[id];
      const tombstone = meta.teamTombstones[id];
      const localCategory = (local.team.categories as any[]).find((category) => String(category.id) === String(value.category.id));
      const started = localCategory?.encounters?.some((encounter: any) => (encounter.matches ?? []).some((match: any) => match.resultStatus));
      items.push({ kind: "team_modified", id, label: String(value.entry.displayName ?? id), safe: !override && !tombstone && !started, conflict: Boolean(override || tombstone || started), detail: started ? "El equipo ya participa en resultados." : override ? "Existe override Team local." : tombstone ? "Equipo eliminado localmente." : "Roster/equipo cambió en Administración." });
    }
  }
  for (const [id, priorHash] of Object.entries(meta.adminBase.teams)) {
    if (priorHash && !incomingTeams.has(id) && localTeams.has(id)) items.push({ kind: "team_cancelled", id, label: String(localTeams.get(id)?.entry.displayName ?? id), safe: false, conflict: true, detail: "Equipo eliminado/cancelado en Administración; revisar impacto antes de aplicar." });
  }
  const count = (kind: AdminMergeItem["kind"]) => items.filter((item) => item.kind === kind).length;
  return {
    items,
    summary: {
      participantNew: count("participant_new"),
      participantCancelled: count("participant_cancelled"),
      participantModified: count("participant_modified"),
      registrationNew: count("standard_entry_new"),
      registrationModified: count("standard_entry_modified"),
      registrationCancelled: count("standard_entry_cancelled"),
      teamNew: count("team_new"),
      teamModified: count("team_modified"),
      teamCancelled: count("team_cancelled"),
      conflicts: items.filter((item) => item.conflict).length,
    },
  };
}

function copyParticipantRelations(local: TournamentDayReformSnapshot, incoming: TournamentDayReformSnapshot, profileId: string) {
  const incomingPlayer = (incoming.workspace.participants.players as any[]).find((row) => String(row.id) === profileId);
  if (!incomingPlayer) return;
  const index = (local.workspace.participants.players as any[]).findIndex((row) => String(row.id) === profileId);
  if (index >= 0) (local.workspace.participants.players as any[])[index] = cloneDay(incomingPlayer); else (local.workspace.participants.players as any[]).push(cloneDay(incomingPlayer));
  local.workspace.participants.playerCategories = (local.workspace.participants.playerCategories as any[]).filter((row) => String(row.playerProfileId) !== profileId);
  (local.workspace.participants.playerCategories as any[]).push(...cloneDay((incoming.workspace.participants.playerCategories as any[]).filter((row) => String(row.playerProfileId) === profileId)));
  const incomingProfile = (incoming.team.profiles as any[]).find((row) => String(row.id) === profileId || String(row.personId) === String(incomingPlayer.organizationPersonId));
  if (incomingProfile && !(local.team.profiles as any[]).some((row) => String(row.id) === String(incomingProfile.id))) (local.team.profiles as any[]).push(cloneDay(incomingProfile));
  for (const entry of incoming.workspace.standard.entries as any[]) {
    const uses = Array.isArray(entry.localProfileIds) ? entry.localProfileIds.map(String).includes(profileId) : String(entry.sourceKey ?? "") === profileId;
    if (uses && !(local.workspace.standard.entries as any[]).some((row) => String(row.id) === String(entry.id))) (local.workspace.standard.entries as any[]).push(cloneDay(entry));
  }
}

export function applySafeAdminMerge(local: TournamentDayReformSnapshot, incoming: TournamentDayReformSnapshot, preview = previewAdminMerge(local, incoming)) {
  const safeItems = preview.items.filter((item) => item.safe && !item.conflict);
  const meta = ensureDayLocalMeta(local);
  for (const item of safeItems) {
    if (item.kind === "participant_new" || item.kind === "participant_modified") copyParticipantRelations(local, incoming, item.id);
    if (item.kind === "participant_cancelled") {
      const player = (local.workspace.participants.players as any[]).find((row) => String(row.id) === item.id);
      if (player) player.playerStatus = "withdrawn_admin";
    }
    if (item.kind === "standard_entry_new" || item.kind === "standard_entry_modified") {
      const incomingEntry = (incoming.workspace.standard.entries as any[]).find(
        (entry) => String(entry.id) === item.id,
      );
      if (incomingEntry) {
        const index = (local.workspace.standard.entries as any[]).findIndex(
          (entry) => String(entry.id) === item.id,
        );
        if (index >= 0) (local.workspace.standard.entries as any[])[index] = cloneDay(incomingEntry);
        else (local.workspace.standard.entries as any[]).push(cloneDay(incomingEntry));
        const relatedProfileIds = new Set<string>();
        if (Array.isArray(incomingEntry.localProfileIds)) incomingEntry.localProfileIds.forEach((id: unknown) => relatedProfileIds.add(String(id)));
        if (incomingEntry.sourceKey) relatedProfileIds.add(String(incomingEntry.sourceKey));
        for (const profileId of relatedProfileIds) copyParticipantRelations(local, incoming, profileId);
      }
    }
    if (item.kind === "standard_entry_cancelled") {
      local.workspace.standard.entries = (local.workspace.standard.entries as any[]).filter(
        (entry) => String(entry.id) !== item.id,
      );
    }
    if (item.kind === "team_new" || item.kind === "team_modified") {
      const incomingPair = (incoming.team.categories as any[]).flatMap((category) => (category.entries ?? []).map((entry: any) => ({ category, entry }))).find((value) => String(value.entry.id) === item.id);
      if (!incomingPair) continue;
      const localCategory = (local.team.categories as any[]).find((category) => String(category.id) === String(incomingPair.category.id));
      if (!localCategory) (local.team.categories as any[]).push(cloneDay({ ...incomingPair.category, entries: [incomingPair.entry], groups: [], encounters: [], standings: [] }));
      else {
        const idx = localCategory.entries.findIndex((entry: any) => String(entry.id) === item.id);
        if (idx >= 0) localCategory.entries[idx] = cloneDay(incomingPair.entry); else localCategory.entries.push(cloneDay(incomingPair.entry));
      }
    }
  }
  meta.adminBaseRevision = Number(incoming.baseRevision ?? meta.adminBaseRevision);
  meta.importedAt = Date.now();
  meta.adminBase = currentAdminBase(incoming);
  markStructureDirty(local, safeItems.length || 1);
  reconcileTournamentDaySnapshot(local);
  return { applied: safeItems, blocked: preview.items.filter((item) => !item.safe || item.conflict) };
}

function publicPlayer(player: any) {
  return {
    id: String(player.id),
    name: String(player.displayName ?? "Jugador"),
    gender: String(player.sportGender ?? "unspecified"),
    club: String(player.club ?? ""),
    duprSingles: Number(player.duprSingles ?? 0) || null,
    duprDoubles: Number(player.duprDoubles ?? 0) || null,
    status: String(player.playerStatus ?? "confirmed"),
  };
}

function publicTeam(category: any, entry: any) {
  return {
    id: String(entry.id),
    categoryId: String(category.id),
    name: String(entry.displayName ?? "Equipo"),
    roster: (entry.roster ?? []).map((member: any, index: number) => ({
      id: `${String(entry.id)}:p${index + 1}`,
      name: String(member.name ?? "Jugador"),
      gender: String(member.sportGender ?? "unspecified"),
      role: String(member.role ?? "player"),
    })),
  };
}

function publicStandardGroups(groups: any[]) {
  return (groups ?? []).map((group: any) => ({
    id: String(group.id),
    name: String(group.name ?? ""),
    entries: (group.entries ?? []).map((entry: any) => ({
      id: String(entry.id),
      name: String(entry.name ?? entry.displayName ?? ""),
      rating: Number(entry.rating ?? entry.seedRating ?? 0),
    })),
  }));
}

function publicScheduleRow(row: any) {
  return {
    id: String(row.id),
    categoryId: String(row.categoryId),
    categoryName: String(row.categoryName ?? ""),
    kind: String(row.categoryEntryType ?? "individual"),
    encounterId: row.encounterId ? String(row.encounterId) : null,
    matchId: row.matchId ? String(row.matchId) : null,
    stage: String(row.stage ?? "group"),
    roundLabel: row.roundLabel ? String(row.roundLabel) : null,
    court: String(row.courtLabel ?? ""),
    startAt: Number(row.startAt ?? 0),
    endAt: Number(row.endAt ?? 0),
    status: String(row.status ?? "bound"),
    groupId: row.groupId ? String(row.groupId) : null,
    groupName: row.groupName ? String(row.groupName) : null,
    roundNumber: row.roundNumber == null ? null : Number(row.roundNumber),
    entryAId: row.entryAId ? String(row.entryAId) : null,
    sideA: row.sideA ? String(row.sideA) : null,
    entryBId: row.entryBId ? String(row.entryBId) : null,
    sideB: row.sideB ? String(row.sideB) : null,
    rubberKey: row.rubberKey ? String(row.rubberCode ?? row.rubberKey) : null,
  };
}

export function buildPublicStructure(snapshot: TournamentDayReformSnapshot) {
  const tournament = snapshot.workspace.core.tournament as any;
  const meta = ensureDayLocalMeta(snapshot);
  return {
    schemaVersion: 1,
    kind: "structure",
    tournament: {
      id: String(tournament.id ?? snapshot.tournamentId),
      slug: String(tournament.slug ?? ""),
      name: String(tournament.name ?? "Torneo"),
      sport: String(tournament.sport ?? "pickleball"),
      startAt: Number(tournament.startAt ?? 0),
      endAt: tournament.endAt ? Number(tournament.endAt) : null,
      courtCount: Number(tournament.courtCount ?? 1),
      venue:
        typeof tournament.venueName === "string"
          ? tournament.venueName
          : typeof tournament.locationName === "string"
            ? tournament.locationName
            : typeof tournament.venue === "string"
              ? tournament.venue
              : null,
    },
    revision: meta.publicDirty.structureRevision + 1,
    generatedAt: Date.now(),
    categories: (snapshot.workspace.core.categories as any[]).map((category) => ({
      id: String(category.id), name: String(category.name ?? ""), entryType: String(category.entryType ?? "individual"), competitionGender: String(category.competitionGender ?? "open"), scheduledDate: category.scheduledDate ?? null,
    })),
    players: (snapshot.workspace.participants.players as any[]).filter((player) => !meta.participantTombstones[String(player.id)] && !["no_show", "withdrawn_local"].includes(String(player.playerStatus))).map(publicPlayer),
    teams: (snapshot.team.categories as any[]).flatMap((category) => (category.entries ?? []).filter((entry: any) => !meta.teamTombstones[String(entry.id)]).map((entry: any) => publicTeam(category, entry))),
    standard: (snapshot.workspace.standard.competitions as any[]).map((competition) => ({ categoryId: String(competition.categoryId), format: cloneDay(competition.format), groups: publicStandardGroups(competition.groups ?? []), bracket: cloneDay((competition.encounters ?? []).filter((encounter: any) => encounter.stage !== "group").map((encounter: any) => ({ id: encounter.id, stage: encounter.stage, roundLabel: encounter.roundLabel, entryA: encounter.entryA?.name ?? null, entryB: encounter.entryB?.name ?? null, status: encounter.status }))) })),
    team: (snapshot.team.categories as any[]).map((category) => ({ categoryId: String(category.id), format: cloneDay(category.format), groups: cloneDay(category.groups ?? []).map((row: any) => ({ id: row.id, name: row.name, entryId: row.entryId, entryName: row.entryName })), bracket: cloneDay((category.encounters ?? []).filter((encounter: any) => encounter.stage !== "group").map((encounter: any) => ({ id: encounter.id, stage: encounter.stage, roundLabel: encounter.roundLabel, sideA: encounter.sideA, sideB: encounter.sideB, status: encounter.status }))) })),
    schedule: (snapshot.workspace.schedule.schedule as any[]).map(publicScheduleRow),
  };
}

function competitionCompleteLocal(snapshot: TournamentDayReformSnapshot) {
  const terminal = new Set(["finished", "bye", "skipped"]);
  const standard = (snapshot.workspace.standard.competitions as any[]).every(
    (competition) => !(competition.encounters ?? []).length || (competition.encounters ?? []).every((encounter: any) => terminal.has(String(encounter.status))),
  );
  const team = (snapshot.team.categories as any[]).every(
    (category) => !(category.encounters ?? []).length || (category.encounters ?? []).every((encounter: any) => terminal.has(String(encounter.status))),
  );
  return standard && team;
}

function publicTeamLineupNames(
  snapshot: TournamentDayReformSnapshot,
  category: any,
  encounter: any,
  entryId: string | null | undefined,
  rubberKey: string,
) {
  if (!entryId) return [];
  const lineup = (encounter.lineups ?? []).find((row: any) => String(row.entryId) === String(entryId));
  const assignments = Array.isArray(lineup?.assignments) ? lineup.assignments : [];
  const nested = assignments.find((row: any) => String(row.rubberKey) === rubberKey && Array.isArray(row.personIds));
  const personIds = nested
    ? nested.personIds.map((personId: unknown) => String(personId))
    : assignments.filter((row: any) => String(row.rubberKey) === rubberKey && row.personId).sort((a: any,b: any)=>Number(a.position??0)-Number(b.position??0)).map((row: any)=>String(row.personId));
  const entry = (category.entries ?? []).find((row: any) => String(row.id) === String(entryId));
  const knownRoster = [...(entry?.roster ?? []), ...(entry?.rosterHistory ?? [])];
  const profiles = snapshot.team.profiles as any[];
  return personIds.map((personId: string) => {
    const member = knownRoster.find((row: any) => String(row.personId) === String(personId));
    if (member?.name) return String(member.name);
    const profile = profiles.find((row: any) => String(row.personId) === String(personId));
    return String(profile?.displayName ?? "Jugador");
  });
}

export function buildPublicLive(snapshot: TournamentDayReformSnapshot) {
  const tournament = snapshot.workspace.core.tournament as any;
  const meta = ensureDayLocalMeta(snapshot);
  const standardResults = (snapshot.workspace.standard.matches as any[]).filter((match) => match.status === "finished").map((match) => ({ id: String(match.matchId ?? match.encounterId), categoryId: String(match.categoryId), encounterId: String(match.encounterId), sideA: match.sideA ?? null, sideB: match.sideB ?? null, scoreA: match.scoreA ?? null, scoreB: match.scoreB ?? null, sets: cloneDay(match.sets ?? []), status: "finished" }));
  const teamResults = (snapshot.team.categories as any[]).flatMap((category) =>
    (category.encounters ?? []).map((encounter: any) => ({
      categoryId: String(category.id),
      encounterId: String(encounter.id),
      groupId: encounter.groupId ? String(encounter.groupId) : null,
      groupName: encounter.groupName ? String(encounter.groupName) : null,
      roundNumber: encounter.roundNumber == null ? null : Number(encounter.roundNumber),
      sideA: encounter.sideA ?? null,
      sideB: encounter.sideB ?? null,
      status: String(encounter.status ?? "pending"),
      winnerEntryId: encounter.winnerEntryId ?? null,
      rubbers: (encounter.matches ?? []).map((match: any) => {
        const definition = (category.format?.encounter?.rubbers ?? []).find(
          (rubber: any) => String(rubber.key) === String(match.rubberKey),
        );
        const internalKey = String(match.rubberKey ?? "");
        const displayCode = String(definition?.displayCode ?? internalKey).trim() || internalKey;
        return {
          id: String(match.id),
          key: displayCode,
          label: String(definition?.label ?? displayCode),
          order: Number(match.rubberOrder ?? 0),
          weight: Number(definition?.weight ?? 1),
          status: String(match.status ?? "pending"),
          winnerSide: match.winnerSide ?? null,
          scoreA: match.scoreA ?? null,
          scoreB: match.scoreB ?? null,
          sets: cloneDay(match.sets ?? []),
          lineupA: publicTeamLineupNames(snapshot, category, encounter, encounter.entryAId, internalKey),
          lineupB: publicTeamLineupNames(snapshot, category, encounter, encounter.entryBId, internalKey),
        };
      }),
    })),
  );
  return {
    schemaVersion: 1,
    kind: "live",
    tournament: { id: String(tournament.id ?? snapshot.tournamentId), slug: String(tournament.slug ?? ""), name: String(tournament.name ?? "Torneo") },
    revision: meta.publicDirty.liveRevision + 1,
    generatedAt: Date.now(),
    status: competitionCompleteLocal(snapshot) ? "finished" : "live",
    schedule: (snapshot.workspace.schedule.schedule as any[]).map(publicScheduleRow),
    results: { standard: standardResults, team: teamResults },
    standings: { standard: cloneDay(snapshot.workspace.standard.standings ?? []), team: (snapshot.team.categories as any[]).flatMap((category) => (category.standings ?? []).map((standing: any) => ({ categoryId: category.id, categoryName: category.name, groupId: standing.groupId, groupName: standing.groupName, rows: cloneDay(standing.rows ?? []) }))) },
    bracket: {
      standard: (snapshot.workspace.standard.competitions as any[]).flatMap((competition) => (competition.encounters ?? []).filter((encounter: any) => encounter.stage !== "group").map((encounter: any) => ({ categoryId: competition.categoryId, id: encounter.id, stage: encounter.stage, roundLabel: encounter.roundLabel, sideA: encounter.entryA?.name ?? null, sideB: encounter.entryB?.name ?? null, winnerEntryId: encounter.winnerEntryId ?? null, status: encounter.status }))),
      team: (snapshot.team.categories as any[]).flatMap((category) => (category.encounters ?? []).filter((encounter: any) => encounter.stage !== "group").map((encounter: any) => ({ categoryId: category.id, id: encounter.id, stage: encounter.stage, roundLabel: encounter.roundLabel, sideA: encounter.sideA ?? null, sideB: encounter.sideB ?? null, winnerEntryId: encounter.winnerEntryId ?? null, status: encounter.status }))),
    },
  };
}

const PRIVATE_PUBLIC_KEYS = new Set(["contact", "email", "phone", "payment", "proof", "proofkey", "userid", "organizationpersonid", "registrationid", "notes"]);
export function publicReadModelHasPrivateKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(publicReadModelHasPrivateKeys);
  if (!value || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[_-]/g, "");
    if (PRIVATE_PUBLIC_KEYS.has(normalized)) return true;
    if (publicReadModelHasPrivateKeys(item)) return true;
  }
  return false;
}

export function createQaFixture(base: TournamentDayReformSnapshot) {
  const snapshot = cloneDay(base) as TournamentDayReformSnapshot;
  initializeReformSnapshot(snapshot);

  // QA is a sandbox island. Never index or append onto real/local tournament entities.
  snapshot.workspace.core.categories = [];
  snapshot.workspace.participants.players = [];
  snapshot.workspace.participants.playerCategories = [];
  snapshot.workspace.standard.entries = [];
  snapshot.workspace.standard.groups = [];
  snapshot.workspace.standard.matches = [];
  snapshot.workspace.standard.drawSessions = [];
  snapshot.workspace.standard.standings = [];
  snapshot.workspace.standard.crossGroup = [];
  snapshot.workspace.standard.categoryProgress = [];
  snapshot.workspace.standard.competitions = [];
  snapshot.workspace.schedule.schedule = [];
  snapshot.team.profiles = [];
  snapshot.team.categories = [];
  snapshot.workspace.core.summary = {
    ...(snapshot.workspace.core.summary ?? {}),
    completedStandardMatches: 0,
  };
  delete snapshot.localMeta;
  initializeReformSnapshot(snapshot);

  const existingCategories = snapshot.workspace.core.categories as any[];
  const makeCategory = (id: string, name: string) => {
    let core = existingCategories.find((category) => String(category.id) === id);
    if (!core) {
      core = { id, name, entryType: "team", competitionGender: "mixed", registrationStatus: "closed", scheduledDate: new Date(Number(snapshot.workspace.core.tournament.startAt) * (Number(snapshot.workspace.core.tournament.startAt) < 10_000_000_000 ? 1000 : 1)).toISOString().slice(0,10), sortOrder: existingCategories.length };
      existingCategories.push(core);
    }
    let team = (snapshot.team.categories as any[]).find((category) => String(category.id) === id);
    if (!team) {
      team = { id, name, scheduledDate: core.scheduledDate, format: teamFormatPreset("senior_cup_2026"), competitionStatus: null, entries: [], groups: [], encounters: [], standings: [] };
      (snapshot.team.categories as any[]).push(team);
    }
    if (!team.format) team.format = teamFormatPreset("senior_cup_2026");
    return team;
  };
  const c40 = makeCategory("qa-team-40", "Equipos +40");
  const c50 = makeCategory("qa-team-50", "Equipos +50");
  const qaNames = [
    "Nicolás Silva", "Camila Rodríguez",
    "Martín Pereira", "Sofía Fernández",
    "Joaquín García", "Lucía Martínez",
    "Mateo González", "Valentina López",
    "Santiago Cabrera", "Martina Sosa",
    "Federico Bentancur", "Julieta Viera",
    "Ignacio Suárez", "Florencia Ramos",
    "Bruno Acosta", "Agustina Méndez",
    "Facundo Moreira", "Manuela Castro",
    "Tomás Olivera", "Catalina Núñez",
    "Sebastián Rivero", "Josefina Correa",
    "Gonzalo Barrios", "Paula Cardozo",
    "Rodrigo Delgado", "Emilia Techera",
    "Andrés Fagúndez", "Victoria Fontes",
    "Leandro Machado", "María Paz Duarte",
    "Franco Pintos", "Renata Álvarez",
    "Diego Etcheverry", "Clara Lorenzo",
    "Pablo Giménez", "Antonella Díaz",
    "Álvaro Ferreira", "Milagros Píriz",
    "Emiliano Santos", "Delfina Larrosa",
    "Juan Manuel Pérez", "Micaela Romero",
    "Mauricio Vidal", "Belén Cabrera",
    "Ramiro Silveira", "Carolina Méndez",
    "Hernán Freitas", "Malena Rocha",
    "Lucas Perdomo", "Ana Inés Silva",
    "Marcos Rodríguez", "Pilar Pereira",
    "Agustín García", "Noelia Fernández",
    "Felipe González", "Victoria López",
    "Lautaro Sosa", "Jimena Martínez",
    "Matías Suárez", "Rocío Viera",
    "Gabriel Acosta", "Cecilia Ramos",
    "Maximiliano Castro", "Lorena Núñez",
    "Alejandro Rivero",
  ] as const;
  const genders = Array.from({ length: qaNames.length }, (_, index) => index % 2 === 0 ? "male" : "female");
  for (let index = 0; index < qaNames.length; index += 1) {
    const id = `local-player:qa-${index + 1}`;
    if ((snapshot.workspace.participants.players as any[]).some((player) => player.id === id)) continue;
    const displayName = qaNames[index]!;
    const personId = `local-person:qa-${index + 1}`;
    (snapshot.workspace.participants.players as any[]).push({ id, organizationPersonId: personId, displayName, sportGender: genders[index], club: "HUAU QA", contact: "", duprSingles: Number((3.1 + (index % 15) * 0.07).toFixed(3)), duprDoubles: Number((3.2 + (index % 17) * 0.065).toFixed(3)), paymentStatus: "paid", playerStatus: "confirmed", source: "qa" });
    (snapshot.team.profiles as any[]).push({ id, personId, displayName, sportGender: genders[index], duprSingles: Number((3.1 + (index % 15) * 0.07).toFixed(3)), duprDoubles: Number((3.2 + (index % 17) * 0.065).toFixed(3)) });
    ensureDayLocalMeta(snapshot).localParticipantIds.push(id);
  }
  const profiles = snapshot.team.profiles as any[];
  const teamNamesByCategory: Record<string, readonly string[]> = {
    "qa-team-40": ["Costa Sur", "Los Ceibos", "Bahía Pickle", "Rambla Norte", "Monteverde", "Delta"],
    "qa-team-50": ["Atlántico", "Laguna", "La Brava", "Arenas", "Solís", "Punta Norte", "Cordón Pickle"],
  };
  const buildTeams = (category: any, count: number, offset: number) => {
    category.entries = [];
    const teamNames = teamNamesByCategory[String(category.id)] ?? [];
    if (teamNames.length !== count) throw new Error("QA_TEAM_NAMES_MISMATCH");
    let cursor = offset;
    for (let teamIndex = 0; teamIndex < count; teamIndex += 1) {
      const size = 4 + (teamIndex % 3);
      const roster = Array.from({ length: size }, (_, memberIndex) => {
        const profile = profiles[cursor + memberIndex]!;
        return { personId: profile.personId, name: profile.displayName, sportGender: profile.sportGender, role: memberIndex === 0 ? "captain" : "player" };
      });
      cursor += size;
      const teamId = `local-team:${category.id}:${teamIndex + 1}`;
      category.entries.push({ id: teamId, categoryId: category.id, displayName: teamNames[teamIndex]!, status: "confirmed", roster, seedRating: Number((roster.reduce((sum: number, member: any) => { const profile = profiles.find((row) => row.personId === member.personId); return sum + Number(profile?.duprDoubles ?? 0); }, 0) / roster.length).toFixed(3)), seedOrder: teamIndex + 1 });
      const meta = ensureDayLocalMeta(snapshot);
      if (!meta.localTeamIds.includes(teamId)) meta.localTeamIds.push(teamId);
      for (const member of roster) {
        const profile = profiles.find((row) => String(row.personId) === String(member.personId));
        if (!profile) continue;
        const profileId = String(profile.id);
        const assignments = snapshot.workspace.participants.playerCategories as any[];
        if (!assignments.some((row) => String(row.playerProfileId) === profileId && String(row.categoryId) === String(category.id))) {
          assignments.push({ playerProfileId: profileId, categoryId: String(category.id), partnerProfileId: null, source: "qa" });
        }
      }
    }
  };
  buildTeams(c40, 6, 0);
  buildTeams(c50, 7, 30);
  generateLocalTeamStructure(snapshot, String(c40.id), 1);
  generateLocalTeamStructure(snapshot, String(c50.id), 1);
  markStructureDirty(snapshot, 65);
  return snapshot;
}



export function clearDaySchedule(snapshot: TournamentDayReformSnapshot) {
  snapshot.workspace.schedule.schedule = [];
  for (const match of snapshot.workspace.standard.matches as any[]) {
    match.scheduleStart = null;
    match.scheduleEnd = null;
    match.courtLabel = null;
  }
  for (const category of snapshot.team.categories as any[]) {
    for (const encounter of category.encounters ?? []) {
      for (const match of encounter.matches ?? []) {
        match.scheduleStart = null;
        match.scheduleEnd = null;
        match.courtLabel = null;
        match.scheduleStatus = null;
      }
    }
  }
  const meta = ensureDayLocalMeta(snapshot);
  meta.schedule.lockedUnitIds = [];
  meta.schedule.lastConflicts = [];
  markStructureDirty(snapshot);
}

export function resetDayCategoryCompetition(snapshot: TournamentDayReformSnapshot, categoryId: string) {
  snapshot.workspace.standard.competitions = (snapshot.workspace.standard.competitions as any[]).filter(
    (competition) => String(competition.categoryId) !== categoryId,
  );
  snapshot.workspace.standard.groups = (snapshot.workspace.standard.groups as any[]).filter(
    (row) => String(row.categoryId) !== categoryId,
  );
  snapshot.workspace.standard.matches = (snapshot.workspace.standard.matches as any[]).filter(
    (row) => String(row.categoryId) !== categoryId,
  );
  snapshot.workspace.standard.drawSessions = (snapshot.workspace.standard.drawSessions as any[]).filter(
    (row) => String(row.categoryId) !== categoryId,
  );
  snapshot.workspace.standard.standings = (snapshot.workspace.standard.standings as any[]).filter(
    (row) => String(row.categoryId) !== categoryId,
  );
  snapshot.workspace.standard.crossGroup = (snapshot.workspace.standard.crossGroup as any[]).filter(
    (row) => String(row.categoryId) !== categoryId,
  );
  snapshot.workspace.standard.categoryProgress = (snapshot.workspace.standard.categoryProgress as any[]).filter(
    (row) => String(row.id ?? row.categoryId) !== categoryId,
  );
  const teamCategory = (snapshot.team.categories as any[]).find((category) => String(category.id) === categoryId);
  if (teamCategory) {
    teamCategory.groups = [];
    teamCategory.encounters = [];
    teamCategory.standings = [];
    teamCategory.structureLocked = 0;
    teamCategory.competitionStatus = null;
  }
  snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter(
    (row) => String(row.categoryId) !== categoryId,
  );
  const core = (snapshot.workspace.core.categories as any[]).find((category) => String(category.id) === categoryId);
  if (core) {
    core.structureLocked = 0;
    core.competitionStatus = null;
    core.groupMatchCount = 0;
    core.finishedGroupMatchCount = 0;
    core.finalMatchCount = 0;
  }
  markStructureDirty(snapshot);
  markLiveDirty(snapshot);
}

export function clearDayCategoryResults(snapshot: TournamentDayReformSnapshot, categoryId: string) {
  const competition = (snapshot.workspace.standard.competitions as any[]).find(
    (candidate) => String(candidate.categoryId) === categoryId,
  );
  if (competition?.groups?.length) {
    const rebuilt = buildCompetitionFromGroups({
      id: competition.id,
      categoryId,
      groups: cloneDay(competition.groups),
      format: competition.format,
    });
    syncStandardCompetition(snapshot, rebuilt);
  }
  const teamCategory = (snapshot.team.categories as any[]).find(
    (category) => String(category.id) === categoryId,
  );
  if (teamCategory?.format) {
    const rows = teamCategory.groups ?? [];
    const groupIds = [...new Set(rows.map((row: any) => String(row.id)))];
    const entryById = new Map<string, any>(
      (teamCategory.entries ?? []).map((entry: any) => [String(entry.id), entry] as const),
    );
    const encounters: any[] = [];
    for (const groupId of groupIds) {
      const groupRows = rows.filter((row: any) => String(row.id) === groupId);
      if (!groupRows.length) continue;
      const group = {
        id: groupId,
        name: String(groupRows[0]?.name ?? groupId),
        entries: groupRows.map((row: any) => ({
          id: String(row.entryId),
          name: String(row.entryName),
          roster: cloneDay(entryById.get(String(row.entryId))?.roster ?? []),
        })),
      };
      for (const plan of generateTeamRoundRobinEncounters(group as any, teamCategory.format)) {
        const id = `local-team-encounter:${categoryId}:${plan.id}`;
        encounters.push({
          id,
          categoryId,
          stage: "group",
          roundLabel: teamCategory.format.competition.groupRounds === 2
            ? `Group stage · Leg ${plan.legNumber}`
            : "Group stage",
          roundNumber: plan.roundNumber ?? null,
          groupId: plan.groupId,
          groupName: plan.groupName,
          legNumber: plan.legNumber,
          entryAId: plan.entryAId,
          sideA: entryById.get(String(plan.entryAId))?.displayName ?? null,
          entryBId: plan.entryBId,
          sideB: entryById.get(String(plan.entryBId))?.displayName ?? null,
          sourceEncounterAId: null,
          sourceEncounterBId: null,
          sourceLoserAId: null,
          sourceLoserBId: null,
          status: "ready",
          winnerEntryId: null,
          matches: teamMatchRowsForPlan(teamCategory, id, plan.rubbers),
          lineups: [],
        });
      }
    }
    teamCategory.encounters = encounters;
    teamCategory.standings = [];
    teamCategory.competitionStatus = encounters.length ? "group_stage" : null;
  }
  snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter(
    (row) => String(row.categoryId) !== categoryId,
  );
  markStructureDirty(snapshot);
  markLiveDirty(snapshot);
}

export function teamEntryRating(snapshot: TournamentDayReformSnapshot, categoryId: string, entryId: string) {
  const category = (snapshot.team.categories as any[]).find((row) => String(row.id) === categoryId);
  const entry = category?.entries?.find((row: any) => String(row.id) === entryId);
  if (!entry?.roster?.length) return 0;
  const profiles = new Map((snapshot.team.profiles as any[]).map((profile) => [String(profile.personId), profile] as const));
  const values = entry.roster.map((member: any) => Number(profiles.get(String(member.personId))?.duprDoubles ?? 0)).filter((value: number) => value > 0);
  return values.length ? values.reduce((sum: number, value: number) => sum + value, 0) / values.length : 0;
}

export function moveLocalStandardEntryToGroup(snapshot: TournamentDayReformSnapshot, categoryId: string, entryId: string, targetGroupId: string) {
  const competition = (snapshot.workspace.standard.competitions as any[]).find((row) => String(row.categoryId) === categoryId);
  if (!competition) throw new Error("STANDARD_COMPETITION_NOT_FOUND");
  if ((competition.encounters ?? []).some((encounter: any) => ["finished", "in_progress"].includes(String(encounter.status)))) throw new Error("STANDARD_GROUP_MOVE_HAS_RESULTS");
  const groups = cloneDay(competition.groups ?? []);
  let moved: any = null;
  for (const group of groups) {
    const index = group.entries.findIndex((entry: any) => String(entry.id) === entryId);
    if (index >= 0) moved = group.entries.splice(index, 1)[0];
  }
  const target = groups.find((group: any) => String(group.id) === targetGroupId);
  if (!moved || !target) throw new Error("STANDARD_GROUP_MOVE_TARGET_NOT_FOUND");
  target.entries.push(moved);
  const rebuilt = buildCompetitionFromGroups({ id: competition.id, categoryId, groups, format: competition.format });
  syncStandardCompetition(snapshot, rebuilt);
  snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter((row) => String(row.categoryId) !== categoryId);
  markStructureDirty(snapshot);
}

function teamMatchRowsForPlan(category: any, encounterId: string, rubbers: any[]) {
  return rubbers.sort((a,b)=>Number(a.order)-Number(b.order)).map((rubber: any, index: number) => ({
    id: `local-team-match:${encounterId}:${rubber.key}`,
    encounterId,
    rubberKey: rubber.key,
    rubberOrder: rubber.order,
    mode: rubber.mode,
    competitionGender: rubber.gender,
    bestOf: rubber.bestOf,
    pointTarget: rubber.pointTarget,
    scoringMode: rubber.scoringMode,
    status: index === 0 ? "ready" : "pending",
    winnerSide: null, scoreA: null, scoreB: null, resultStatus: null,
    scheduleStart: null, scheduleEnd: null, courtLabel: null, scheduleStatus: null, sets: [],
  }));
}

export function moveLocalTeamEntryToGroup(snapshot: TournamentDayReformSnapshot, categoryId: string, entryId: string, targetGroupId: string) {
  const category = (snapshot.team.categories as any[]).find((row) => String(row.id) === categoryId);
  if (!category?.format) throw new Error("TEAM_FORMAT_NOT_FOUND");
  if ((category.encounters ?? []).some((encounter: any) => (encounter.matches ?? []).some((match: any) => match.resultStatus))) throw new Error("TEAM_GROUP_MOVE_HAS_RESULTS");
  const rows = category.groups ?? [];
  const current = rows.find((row: any) => String(row.entryId) === entryId);
  const targetSeed = rows.find((row: any) => String(row.id) === targetGroupId);
  if (!current || !targetSeed) throw new Error("TEAM_GROUP_MOVE_TARGET_NOT_FOUND");
  current.id = targetSeed.id;
  current.name = targetSeed.name;
  const groupIds = [...new Set(rows.map((row: any) => String(row.id)))];
  const entryById = new Map<string, any>((category.entries ?? []).map((entry: any) => [String(entry.id), entry] as const));
  const encounters: any[] = [];
  for (const groupId of groupIds) {
    const groupRows = rows.filter((row: any) => String(row.id) === groupId);
    const group = { id: groupId, name: String(groupRows[0]?.name ?? groupId), entries: groupRows.map((row: any) => ({ id: String(row.entryId), name: String(row.entryName), rating: Number(entryById.get(String(row.entryId))?.seedRating ?? 0) })) };
    for (const plan of generateTeamRoundRobinEncounters(group as any, category.format)) {
      const id = `local-team-encounter:${categoryId}:${plan.id}`;
      const a = entryById.get(String(plan.entryAId)); const b = entryById.get(String(plan.entryBId));
      encounters.push({ id, categoryId, stage: "group", roundLabel: category.format.competition.groupRounds===2?`Group stage · Leg ${plan.legNumber}`:"Group stage", roundNumber: plan.roundNumber ?? null, groupId: plan.groupId, groupName: plan.groupName, legNumber: plan.legNumber, entryAId: plan.entryAId, sideA: a?.displayName ?? null, entryBId: plan.entryBId, sideB: b?.displayName ?? null, sourceEncounterAId:null, sourceEncounterBId:null, sourceLoserAId:null, sourceLoserBId:null, status:"ready", winnerEntryId:null, matches:teamMatchRowsForPlan(category,id,plan.rubbers), lineups:[] });
    }
  }
  category.encounters = encounters;
  category.standings = [];
  category.competitionStatus = "group_stage";
  snapshot.workspace.schedule.schedule = (snapshot.workspace.schedule.schedule as any[]).filter((row) => String(row.categoryId) !== categoryId);
  markStructureDirty(snapshot);
}
