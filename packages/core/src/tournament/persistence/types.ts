export type ImportedPersonRecord = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  sportGender: string | null;
  source: "import";
  status: "active";
  createdAt: number;
  updatedAt: number;
};

export type ImportedTournamentRecord = {
  id: string;
  organizerOrganizationId: string;
  hostVenueId: string | null;
  name: string;
  slug: string;
  sport: "pickleball" | "padel" | "tennis";
  status: "draft" | "registration_open" | "registration_closed" | "draw_ready" | "scheduled" | "live" | "completed" | "cancelled";
  visibility: "public" | "members" | "invite";
  startAt: number;
  endAt: number | null;
  timezone: string;
  courtCount: number;
  publicParticipants: boolean;
  publicLive: boolean;
  structureLocked: boolean;
  publishedRevision: number;
  workingRevision: number;
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
};

export type ImportedCategoryRecord = {
  id: string;
  tournamentId: string;
  name: string;
  entryType: "individual" | "pair" | "team";
  competitionGender: "male" | "female" | "mixed" | "open" | null;
  maxEntries: number | null;
  registrationStatus: "closed" | "open" | "waitlist_only";
  priceScope: "free" | "per_entry" | "per_person";
  priceMinor: number | null;
  currency: string | null;
  formatVersionId: string | null;
  scheduledDate: string | null;
  sortOrder: number;
  structureLocked: boolean;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type ImportedEntryRecord = {
  id: string;
  categoryId: string;
  entryType: "individual" | "pair" | "team";
  displayName: string;
  captainUserId: string | null;
  status: "confirmed";
  waitlistPosition: number | null;
  seedRating: number | null;
  createdByUserId: string | null;
  createdByAdmin: boolean;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type ImportedEntryMemberRecord = {
  id: string;
  entryId: string;
  organizationPersonId: string;
  memberRole: "player" | "captain" | "substitute";
  rosterSlot: string | null;
  status: "manual";
  invitedUserId: string | null;
  acceptedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ImportedFormatVersionRecord = {
  id: string;
  categoryId: string;
  versionNumber: number;
  formatKind: "standard" | "team";
  configJson: string;
  explanationSchemaVersion: number;
  createdByUserId: string;
  createdAt: number;
  lockedAt: number | null;
};

export type ImportedCompetitionRecord = {
  id: string;
  categoryId: string;
  formatVersionId: string;
  status: "draft" | "groups_generated" | "group_stage" | "groups_complete" | "final_phase" | "completed";
  structureRevision: number;
  createdAt: number;
  updatedAt: number;
};

export type ImportedGroupRecord = { id: string; competitionId: string; name: string; sortOrder: number };
export type ImportedGroupEntryRecord = { groupId: string; entryId: string; seed: number | null; sortOrder: number };

export type ImportedEncounterRecord = {
  id: string;
  competitionId: string;
  stage: "group" | "playoff" | "consolation" | "bronze" | "final";
  groupId: string | null;
  roundLabel: string | null;
  roundNumber: number | null;
  legNumber: number;
  entryAId: string | null;
  entryBId: string | null;
  sourceEncounterAId: string | null;
  sourceEncounterBId: string | null;
  sourceLoserAId: string | null;
  sourceLoserBId: string | null;
  status: "pending" | "bye" | "ready" | "in_progress" | "finished" | "skipped";
  winnerEntryId: string | null;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type ImportedMatchRecord = {
  id: string;
  encounterId: string;
  rubberKey: string | null;
  rubberOrder: number;
  mode: "singles" | "doubles";
  competitionGender: "male" | "female" | "mixed" | "open" | null;
  bestOf: number;
  pointTarget: number | null;
  scoringMode: string | null;
  status: "pending" | "ready" | "in_progress" | "finished" | "skipped";
  sideALabel: string | null;
  sideBLabel: string | null;
  winnerSide: "A" | "B" | null;
  manualOverride: boolean;
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type ImportedMatchResultRecord = {
  matchId: string;
  scoreA: number | null;
  scoreB: number | null;
  winnerSide: "A" | "B" | null;
  resultStatus: "pending" | "final" | "corrected";
  enteredByUserId: string | null;
  enteredAt: number | null;
  correctedAt: number | null;
  updatedAt: number;
};

export type ImportedMatchSetRecord = {
  id: string;
  matchId: string;
  setNumber: number;
  scoreA: number;
  scoreB: number;
  winnerSide: "A" | "B";
};

export type ImportedScheduleItemRecord = {
  id: string;
  tournamentId: string;
  categoryId: string;
  encounterId: string | null;
  matchId: string | null;
  placeholderKey: string | null;
  stage: string;
  roundLabel: string | null;
  courtLabel: string;
  startAt: number;
  endAt: number;
  status: "reserved" | "bound" | "completed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  version: number;
};

export type ImportedScheduleRevisionRecord = {
  id: string;
  tournamentId: string;
  revisionNumber: number;
  generatedFromStructureRevision: number;
  createdByUserId: string;
  createdAt: number;
  isCurrent: boolean;
};

export type ImportedSnapshotRecord = {
  id: string;
  tournamentId: string;
  scopeType: "tournament" | "category";
  scopeId: string | null;
  reason: string;
  revision: number;
  payloadJson: string;
  createdByUserId: string | null;
  createdAt: number;
};

export type ImportedAuditRecord = {
  id: string;
  organizationId: string | null;
  tournamentId: string | null;
  actorUserId: string | null;
  actorType: "user" | "platform_admin" | "system" | "webhook";
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  metadataJson: string | null;
  createdAt: number;
};

export type TournamentPersistenceBundle = {
  schemaVersion: "phase3";
  source: { kind: "legacy" | "huau"; version: string | null; revision: number | null };
  people: ImportedPersonRecord[];
  tournament: ImportedTournamentRecord;
  categories: ImportedCategoryRecord[];
  entries: ImportedEntryRecord[];
  entryMembers: ImportedEntryMemberRecord[];
  formatVersions: ImportedFormatVersionRecord[];
  competitions: ImportedCompetitionRecord[];
  groups: ImportedGroupRecord[];
  groupEntries: ImportedGroupEntryRecord[];
  encounters: ImportedEncounterRecord[];
  matches: ImportedMatchRecord[];
  matchResults: ImportedMatchResultRecord[];
  matchSets: ImportedMatchSetRecord[];
  scheduleItems: ImportedScheduleItemRecord[];
  scheduleRevisions: ImportedScheduleRevisionRecord[];
  snapshots: ImportedSnapshotRecord[];
  auditEvents: ImportedAuditRecord[];
};

export type TournamentBundleSummary = {
  people: number;
  categories: number;
  entries: number;
  groups: number;
  encounters: number;
  matches: number;
  finalizedResults: number;
  scheduleItems: number;
};
