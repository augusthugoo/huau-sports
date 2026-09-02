import type { PlayoffMode } from "../tournament/types";

export type TeamSportGender = "male" | "female" | "unspecified";
export type TeamCompetitionGender = "male" | "female" | "mixed" | "open";
export type TeamRosterComposition = "open" | "male" | "female" | "mixed";
export type TeamRosterRole = "player" | "captain" | "substitute";
export type TeamRubberMode = "singles" | "doubles";
export type TeamRubberPlayCondition = "always" | "if_tied";
export type TeamEncounterWinnerRule = "majority" | "first_to";
export type TeamSide = "A" | "B";

export type TeamRosterGenderRules = {
  maleMin: number;
  maleMax: number | null;
  femaleMin: number;
  femaleMax: number | null;
};

export type TeamRosterConfig = {
  min: number;
  max: number;
  composition: TeamRosterComposition;
  rules: TeamRosterGenderRules;
  substitutesAllowed: boolean;
  captainRequired: boolean;
};

export type TeamRubberDefinition = {
  key: string;
  label: string;
  order: number;
  mode: TeamRubberMode;
  gender: TeamCompetitionGender;
  play: TeamRubberPlayCondition;
  isTiebreaker: boolean;
  weight: number;
  bestOf: 1 | 3;
  pointTarget: number;
  scoringMode: string | null;
};

export type TeamEncounterConfig = {
  winnerRule: TeamEncounterWinnerRule;
  targetWins: number | null;
  playRemainingAfterClinched: boolean;
  rubbers: TeamRubberDefinition[];
};

export type TeamCompetitionConfig = {
  groupRounds: 1 | 2;
  playoffMode: PlayoffMode;
};

export type TeamStandingCriterion =
  | "encounter_wins"
  | "encounter_win_rate"
  | "rubber_diff"
  | "point_diff"
  | "points_for";

export type TeamStandingsConfig = {
  criteria: TeamStandingCriterion[];
};

export type TeamFormat = {
  schemaVersion: 1;
  roster: TeamRosterConfig;
  encounter: TeamEncounterConfig;
  competition: TeamCompetitionConfig;
  standings: TeamStandingsConfig;
};

export type TeamRosterMember = {
  personId: string;
  name: string;
  sportGender: TeamSportGender;
  role: TeamRosterRole;
};

export type TeamEntry = {
  id: string;
  name: string;
  roster: TeamRosterMember[];
};

export type TeamLineupAssignment = {
  rubberKey: string;
  personIds: string[];
};

export type TeamLineupStatus = "draft" | "locked";
export type TeamEncounterLifecycleStatus = "pending" | "ready" | "in_progress" | "finished" | "skipped";

export type TeamLineupMutationContext = {
  lineupStatus: TeamLineupStatus;
  encounterStatus: TeamEncounterLifecycleStatus;
  hasResults: boolean;
  administrativeOverride: boolean;
};

export type TeamValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type TeamValidationResult = {
  valid: boolean;
  issues: TeamValidationIssue[];
};

export type TeamRubberResult = {
  rubberKey: string;
  winnerSide: TeamSide;
  pointsA: number;
  pointsB: number;
};

export type TeamRubberStateStatus = "pending" | "ready" | "finished" | "skipped";

export type TeamRubberState = {
  definition: TeamRubberDefinition;
  status: TeamRubberStateStatus;
  result: TeamRubberResult | null;
};

export type TeamEncounterScore = {
  entryAId: string;
  entryBId: string;
  weightedWinsA: number;
  weightedWinsB: number;
  rubbersWonA: number;
  rubbersWonB: number;
  pointsA: number;
  pointsB: number;
  winnerEntryId: string | null;
  complete: boolean;
  nextRubberKey: string | null;
  rubbers: TeamRubberState[];
};

export type TeamGroup = {
  id: string;
  name: string;
  entries: TeamEntry[];
};

export type TeamEncounterPlan = {
  id: string;
  groupId: string | null;
  groupName: string | null;
  legNumber: number;
  entryAId: string;
  entryBId: string;
  rubbers: TeamRubberDefinition[];
};

export type TeamStandingEncounter = {
  id: string;
  entryAId: string;
  entryBId: string;
  winnerEntryId: string;
  rubbersWonA: number;
  rubbersWonB: number;
  pointsA: number;
  pointsB: number;
};

export type TeamStandingRow = {
  entryId: string;
  entryName: string;
  played: number;
  wins: number;
  losses: number;
  winRate: number;
  rubbersFor: number;
  rubbersAgainst: number;
  rubberDiff: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
};

export type TeamStandingsResult = {
  rows: TeamStandingRow[];
  explanation: {
    criteria: TeamStandingCriterion[];
    fallback: "entry_id";
  };
};
