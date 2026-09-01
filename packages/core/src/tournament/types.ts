export type EntryId = string;
export type EncounterId = string;

export type TournamentEntry = {
  id: EntryId;
  name: string;
  participantIds: string[];
  rating: number;
};

export type TournamentGroup = {
  id: string;
  name: string;
  entries: TournamentEntry[];
};

export type CrossGroupMethod = "normalized" | "equalized";
export type PlayoffMode = "standard" | "top2_final" | "top3_step" | "top4_semis" | "league_only";
export type ConsolationMode = "none" | "knockout";
export type MedalSchedule = "sequential" | "simultaneous";
export type FinalDrawMethod = "performance" | "pots";

export type MatchRule = {
  bestOf: 1 | 3;
  pointTarget: number;
};

export type StandardCompetitionFormat = {
  groupRounds: 1 | 2;
  qualifiersPerGroup: number;
  wildcardQualifiers: number;
  crossGroupMethod: CrossGroupMethod;
  playoffMode: PlayoffMode;
  consolationMode: ConsolationMode;
  avoidGroupRematches: boolean;
  bronzeMatch: boolean;
  medalSchedule: MedalSchedule;
  finalDrawMethod: FinalDrawMethod;
  preliminary: MatchRule;
  medal: MatchRule;
  preferredRestSlots: number;
};

export type EncounterStage = "group" | "playoff" | "consolation" | "bronze" | "final";
export type EncounterStatus = "pending" | "bye" | "ready" | "in_progress" | "finished" | "skipped";

export type MatchSet = {
  scoreA: number;
  scoreB: number;
};

export type CompetitionEncounter = {
  id: EncounterId;
  stage: EncounterStage;
  groupId: string | null;
  groupName: string | null;
  roundLabel: string | null;
  roundNumber: number | null;
  legNumber: number;
  entryA: TournamentEntry | null;
  entryB: TournamentEntry | null;
  sourceEncounterAId: EncounterId | null;
  sourceEncounterBId: EncounterId | null;
  sourceLoserAId: EncounterId | null;
  sourceLoserBId: EncounterId | null;
  status: EncounterStatus;
  winnerEntryId: EntryId | null;
  scoreA: number | null;
  scoreB: number | null;
  sets: MatchSet[];
  bestOf: 1 | 3;
  pointTarget: number;
};

export type Competition = {
  id: string;
  categoryId: string;
  format: StandardCompetitionFormat;
  groups: TournamentGroup[];
  encounters: CompetitionEncounter[];
  finalGenerated: boolean;
};

export type StandingRow = {
  entry: TournamentEntry;
  played: number;
  wins: number;
  losses: number;
  scored: number;
  conceded: number;
  diff: number;
  miniWins: number;
  miniDiff: number;
};

export type CrossGroupStats = {
  entry: TournamentEntry;
  groupId: string;
  groupName: string;
  position: number;
  played: number;
  wins: number;
  diff: number;
  scored: number;
  winRate: number;
  diffPerMatch: number;
  scoredPerMatch: number;
  consideredEncounterIds: string[];
  ignoredEncounterIds: string[];
  method: CrossGroupMethod;
};

export type QualifiedEntry = CrossGroupStats;

export type BracketBuildResult = {
  slots: Array<QualifiedEntry | null>;
  rematchFallback: boolean;
};

export type ScheduleCategory = {
  categoryId: string;
  scheduledDate: string;
  order: number;
  matchMinutes: number;
  competition: Competition;
};

export type TournamentScheduleSettings = {
  startDate: string;
  dailyStart: string;
  courtCount: number;
  preferredRestSlots: number;
};

export type ScheduleItem = {
  encounterId: string | null;
  reserved: boolean;
  categoryId: string;
  stage: EncounterStage;
  roundLabel: string | null;
  legNumber: number;
  blockIndex: number;
  startOffset: number;
  durationMinutes: number;
  court: number;
  date: string;
  time: string;
};

export type ScheduleResult = {
  items: ScheduleItem[];
  categoryWindows: Record<string, { startOffset: number; endOffset: number; date: string }>;
};
