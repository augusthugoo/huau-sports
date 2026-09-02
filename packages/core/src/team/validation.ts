import type {
  TeamFormat,
  TeamLineupAssignment,
  TeamLineupMutationContext,
  TeamRosterMember,
  TeamRubberDefinition,
  TeamValidationIssue,
  TeamValidationResult,
} from "./types";

function result(issues: TeamValidationIssue[]): TeamValidationResult {
  return { valid: issues.length === 0, issues };
}

function pushIssue(issues: TeamValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function validateRubber(issues: TeamValidationIssue[], rubber: TeamRubberDefinition, index: number): void {
  const path = `encounter.rubbers.${index}`;
  if (rubber.key.trim().length === 0) pushIssue(issues, "RUBBER_KEY_REQUIRED", `${path}.key`, "Rubber key is required.");
  if (rubber.label.trim().length === 0) pushIssue(issues, "RUBBER_LABEL_REQUIRED", `${path}.label`, "Rubber label is required.");
  if (!positiveInteger(rubber.order)) pushIssue(issues, "RUBBER_ORDER_INVALID", `${path}.order`, "Rubber order must be a positive integer.");
  if (!Number.isFinite(rubber.weight) || rubber.weight <= 0) {
    pushIssue(issues, "RUBBER_WEIGHT_INVALID", `${path}.weight`, "Rubber weight must be greater than zero.");
  }
  if (!positiveInteger(rubber.pointTarget)) {
    pushIssue(issues, "RUBBER_POINT_TARGET_INVALID", `${path}.pointTarget`, "Point target must be a positive integer.");
  }
  if (rubber.gender === "mixed" && rubber.mode !== "doubles") {
    pushIssue(issues, "MIXED_RUBBER_REQUIRES_DOUBLES", `${path}.gender`, "Mixed gender rubbers require doubles mode in V1.");
  }
  if (rubber.isTiebreaker && rubber.play !== "if_tied") {
    pushIssue(issues, "TIEBREAKER_CONDITION_INVALID", `${path}.play`, "A tiebreaker rubber must use the if_tied condition.");
  }
}

export function validateTeamFormat(format: TeamFormat): TeamValidationResult {
  const issues: TeamValidationIssue[] = [];
  const { roster, encounter, standings } = format;

  if (format.schemaVersion !== 1) {
    pushIssue(issues, "TEAM_FORMAT_SCHEMA_UNSUPPORTED", "schemaVersion", "Only TeamFormat schema version 1 is supported.");
  }
  if (!positiveInteger(roster.min)) pushIssue(issues, "ROSTER_MIN_INVALID", "roster.min", "Roster minimum must be a positive integer.");
  if (!positiveInteger(roster.max)) pushIssue(issues, "ROSTER_MAX_INVALID", "roster.max", "Roster maximum must be a positive integer.");
  if (roster.max < roster.min) pushIssue(issues, "ROSTER_RANGE_INVALID", "roster.max", "Roster maximum cannot be lower than minimum.");

  const quotas = [
    ["maleMin", roster.rules.maleMin],
    ["femaleMin", roster.rules.femaleMin],
  ] as const;
  quotas.forEach(([key, value]) => {
    if (!nonNegativeInteger(value)) pushIssue(issues, "ROSTER_QUOTA_INVALID", `roster.rules.${key}`, "Minimum quota must be a non-negative integer.");
  });

  const maxima = [
    ["maleMax", roster.rules.maleMax],
    ["femaleMax", roster.rules.femaleMax],
  ] as const;
  maxima.forEach(([key, value]) => {
    if (value !== null && !nonNegativeInteger(value)) {
      pushIssue(issues, "ROSTER_QUOTA_INVALID", `roster.rules.${key}`, "Maximum quota must be null or a non-negative integer.");
    }
  });

  if (roster.rules.maleMax !== null && roster.rules.maleMax < roster.rules.maleMin) {
    pushIssue(issues, "ROSTER_MALE_RANGE_INVALID", "roster.rules.maleMax", "Male maximum cannot be lower than male minimum.");
  }
  if (roster.rules.femaleMax !== null && roster.rules.femaleMax < roster.rules.femaleMin) {
    pushIssue(issues, "ROSTER_FEMALE_RANGE_INVALID", "roster.rules.femaleMax", "Female maximum cannot be lower than female minimum.");
  }
  if (roster.rules.maleMin + roster.rules.femaleMin > roster.max) {
    pushIssue(issues, "ROSTER_QUOTAS_EXCEED_MAX", "roster.rules", "Minimum gender quotas cannot exceed the roster maximum.");
  }

  if (encounter.rubbers.length === 0) {
    pushIssue(issues, "RUBBERS_REQUIRED", "encounter.rubbers", "At least one rubber is required.");
  }

  encounter.rubbers.forEach((rubber, index) => validateRubber(issues, rubber, index));

  const keys = new Set<string>();
  const orders = new Set<number>();
  encounter.rubbers.forEach((rubber, index) => {
    if (keys.has(rubber.key)) pushIssue(issues, "RUBBER_KEY_DUPLICATE", `encounter.rubbers.${index}.key`, "Rubber keys must be unique.");
    if (orders.has(rubber.order)) pushIssue(issues, "RUBBER_ORDER_DUPLICATE", `encounter.rubbers.${index}.order`, "Rubber orders must be unique.");
    keys.add(rubber.key);
    orders.add(rubber.order);
  });

  if (encounter.winnerRule === "first_to") {
    if (encounter.targetWins === null || !Number.isFinite(encounter.targetWins) || encounter.targetWins <= 0) {
      pushIssue(issues, "TARGET_WINS_REQUIRED", "encounter.targetWins", "first_to requires a positive targetWins value.");
    }
  } else if (encounter.targetWins !== null) {
    pushIssue(issues, "TARGET_WINS_NOT_APPLICABLE", "encounter.targetWins", "majority format must keep targetWins null.");
  }

  if (standings.criteria.length === 0) {
    pushIssue(issues, "STANDINGS_CRITERIA_REQUIRED", "standings.criteria", "At least one team standings criterion is required.");
  }
  if (new Set(standings.criteria).size !== standings.criteria.length) {
    pushIssue(issues, "STANDINGS_CRITERIA_DUPLICATE", "standings.criteria", "Team standings criteria cannot repeat.");
  }

  return result(issues);
}

export function validateTeamRoster(format: TeamFormat, roster: TeamRosterMember[]): TeamValidationResult {
  const issues: TeamValidationIssue[] = [];
  const config = format.roster;
  const ids = new Set<string>();

  roster.forEach((member, index) => {
    if (ids.has(member.personId)) {
      pushIssue(issues, "ROSTER_PERSON_DUPLICATE", `roster.${index}.personId`, "A person cannot appear twice in the same roster.");
    }
    ids.add(member.personId);
    if (member.role === "substitute" && !config.substitutesAllowed) {
      pushIssue(issues, "SUBSTITUTES_NOT_ALLOWED", `roster.${index}.role`, "This format does not allow substitute roster members.");
    }
  });

  if (roster.length < config.min) pushIssue(issues, "ROSTER_TOO_SMALL", "roster", `Roster requires at least ${config.min} members.`);
  if (roster.length > config.max) pushIssue(issues, "ROSTER_TOO_LARGE", "roster", `Roster allows at most ${config.max} members.`);

  const maleCount = roster.filter((member) => member.sportGender === "male").length;
  const femaleCount = roster.filter((member) => member.sportGender === "female").length;
  if (maleCount < config.rules.maleMin) pushIssue(issues, "ROSTER_MALE_MIN", "roster", `Roster requires at least ${config.rules.maleMin} male members.`);
  if (femaleCount < config.rules.femaleMin) pushIssue(issues, "ROSTER_FEMALE_MIN", "roster", `Roster requires at least ${config.rules.femaleMin} female members.`);
  if (config.rules.maleMax !== null && maleCount > config.rules.maleMax) {
    pushIssue(issues, "ROSTER_MALE_MAX", "roster", `Roster allows at most ${config.rules.maleMax} male members.`);
  }
  if (config.rules.femaleMax !== null && femaleCount > config.rules.femaleMax) {
    pushIssue(issues, "ROSTER_FEMALE_MAX", "roster", `Roster allows at most ${config.rules.femaleMax} female members.`);
  }

  if (config.composition === "male" && roster.some((member) => member.sportGender !== "male")) {
    pushIssue(issues, "ROSTER_COMPOSITION_MALE", "roster", "Male roster composition only accepts male members.");
  }
  if (config.composition === "female" && roster.some((member) => member.sportGender !== "female")) {
    pushIssue(issues, "ROSTER_COMPOSITION_FEMALE", "roster", "Female roster composition only accepts female members.");
  }
  if (config.captainRequired && roster.filter((member) => member.role === "captain").length !== 1) {
    pushIssue(issues, "ROSTER_CAPTAIN_REQUIRED", "roster", "Exactly one captain is required by this format.");
  }
  if (roster.filter((member) => member.role === "captain").length > 1) {
    pushIssue(issues, "ROSTER_CAPTAIN_DUPLICATE", "roster", "A team roster cannot contain more than one captain.");
  }

  return result(issues);
}

function expectedParticipants(rubber: TeamRubberDefinition): number {
  return rubber.mode === "singles" ? 1 : 2;
}

function validateGenderForRubber(
  issues: TeamValidationIssue[],
  rubber: TeamRubberDefinition,
  members: TeamRosterMember[],
  path: string,
): void {
  if (rubber.gender === "open") return;
  if (rubber.gender === "male" && members.some((member) => member.sportGender !== "male")) {
    pushIssue(issues, "LINEUP_GENDER_MALE", path, `${rubber.label} requires male players.`);
    return;
  }
  if (rubber.gender === "female" && members.some((member) => member.sportGender !== "female")) {
    pushIssue(issues, "LINEUP_GENDER_FEMALE", path, `${rubber.label} requires female players.`);
    return;
  }
  if (rubber.gender === "mixed") {
    const maleCount = members.filter((member) => member.sportGender === "male").length;
    const femaleCount = members.filter((member) => member.sportGender === "female").length;
    if (members.length !== 2 || maleCount !== 1 || femaleCount !== 1) {
      pushIssue(issues, "LINEUP_GENDER_MIXED", path, `${rubber.label} requires one male and one female player.`);
    }
  }
}

export function validateTeamLineup(
  format: TeamFormat,
  roster: TeamRosterMember[],
  assignments: TeamLineupAssignment[],
): TeamValidationResult {
  const issues: TeamValidationIssue[] = [];
  const rosterById = new Map(roster.map((member) => [member.personId, member] as const));
  const rubberByKey = new Map(format.encounter.rubbers.map((rubber) => [rubber.key, rubber] as const));
  const assignmentByKey = new Map<string, TeamLineupAssignment>();

  assignments.forEach((assignment, index) => {
    const path = `assignments.${index}`;
    if (assignmentByKey.has(assignment.rubberKey)) {
      pushIssue(issues, "LINEUP_RUBBER_DUPLICATE", `${path}.rubberKey`, "A rubber can only have one lineup assignment.");
      return;
    }
    assignmentByKey.set(assignment.rubberKey, assignment);
    const rubber = rubberByKey.get(assignment.rubberKey);
    if (!rubber) {
      pushIssue(issues, "LINEUP_RUBBER_UNKNOWN", `${path}.rubberKey`, "Lineup references an unknown rubber.");
      return;
    }

    const uniqueIds = new Set(assignment.personIds);
    if (uniqueIds.size !== assignment.personIds.length) {
      pushIssue(issues, "LINEUP_PERSON_DUPLICATE", `${path}.personIds`, "A person cannot fill two positions in the same rubber.");
    }
    if (assignment.personIds.length !== expectedParticipants(rubber)) {
      pushIssue(
        issues,
        "LINEUP_SIZE_INVALID",
        `${path}.personIds`,
        `${rubber.label} requires exactly ${expectedParticipants(rubber)} player(s).`,
      );
    }

    const members: TeamRosterMember[] = [];
    assignment.personIds.forEach((personId, personIndex) => {
      const member = rosterById.get(personId);
      if (!member) {
        pushIssue(issues, "LINEUP_PERSON_OUTSIDE_ROSTER", `${path}.personIds.${personIndex}`, "Lineup player must belong to the team roster.");
      } else {
        members.push(member);
      }
    });
    if (members.length === assignment.personIds.length) validateGenderForRubber(issues, rubber, members, `${path}.personIds`);
  });

  format.encounter.rubbers.forEach((rubber) => {
    if (!assignmentByKey.has(rubber.key)) {
      pushIssue(issues, "LINEUP_RUBBER_MISSING", `assignments.${rubber.key}`, `Lineup is missing ${rubber.label}.`);
    }
  });

  return result(issues);
}

export function validateTeamLineupMutation(context: TeamLineupMutationContext): TeamValidationResult {
  const issues: TeamValidationIssue[] = [];
  const encounterStarted = context.encounterStatus === "in_progress" || context.encounterStatus === "finished";

  if ((context.lineupStatus === "locked" || encounterStarted) && !context.administrativeOverride) {
    pushIssue(issues, "LINEUP_LOCKED", "lineup", "Locked or started encounter lineups require an explicit administrative override.");
  }
  if (context.hasResults && context.administrativeOverride) {
    pushIssue(issues, "LINEUP_OVERRIDE_AFTER_RESULT", "lineup", "A lineup cannot be overridden after a rubber result exists.");
  }

  return result(issues);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`TEAM_FORMAT_INVALID:${path}`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`TEAM_FORMAT_INVALID:${path}`);
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`TEAM_FORMAT_INVALID:${path}`);
  return value;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`TEAM_FORMAT_INVALID:${path}`);
  return value;
}

function asNullableNumber(value: unknown, path: string): number | null {
  return value === null ? null : asNumber(value, path);
}

function asEnum<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  const candidate = asString(value, path);
  if (!allowed.includes(candidate)) throw new Error(`TEAM_FORMAT_INVALID:${path}`);
  return candidate as T[number];
}

export function parseTeamFormat(value: unknown): TeamFormat {
  const root = asRecord(value, "root");
  const roster = asRecord(root.roster, "roster");
  const rules = asRecord(roster.rules, "roster.rules");
  const encounter = asRecord(root.encounter, "encounter");
  const competition = asRecord(root.competition, "competition");
  const standings = asRecord(root.standings, "standings");
  if (!Array.isArray(encounter.rubbers)) throw new Error("TEAM_FORMAT_INVALID:encounter.rubbers");
  if (!Array.isArray(standings.criteria)) throw new Error("TEAM_FORMAT_INVALID:standings.criteria");
  const schemaVersion = asNumber(root.schemaVersion, "schemaVersion");
  const groupRounds = asNumber(competition.groupRounds, "competition.groupRounds");
  if (schemaVersion !== 1) throw new Error("TEAM_FORMAT_INVALID:schemaVersion");
  if (groupRounds !== 1 && groupRounds !== 2) throw new Error("TEAM_FORMAT_INVALID:competition.groupRounds");

  const parsed: TeamFormat = {
    schemaVersion: 1,
    roster: {
      min: asNumber(roster.min, "roster.min"),
      max: asNumber(roster.max, "roster.max"),
      composition: asEnum(roster.composition, ["open", "male", "female", "mixed"] as const, "roster.composition"),
      rules: {
        maleMin: asNumber(rules.maleMin, "roster.rules.maleMin"),
        maleMax: asNullableNumber(rules.maleMax, "roster.rules.maleMax"),
        femaleMin: asNumber(rules.femaleMin, "roster.rules.femaleMin"),
        femaleMax: asNullableNumber(rules.femaleMax, "roster.rules.femaleMax"),
      },
      substitutesAllowed: asBoolean(roster.substitutesAllowed, "roster.substitutesAllowed"),
      captainRequired: asBoolean(roster.captainRequired, "roster.captainRequired"),
    },
    encounter: {
      winnerRule: asEnum(encounter.winnerRule, ["majority", "first_to"] as const, "encounter.winnerRule"),
      targetWins: asNullableNumber(encounter.targetWins, "encounter.targetWins"),
      playRemainingAfterClinched: asBoolean(encounter.playRemainingAfterClinched, "encounter.playRemainingAfterClinched"),
      rubbers: encounter.rubbers.map((candidate, index) => {
        const rubber = asRecord(candidate, `encounter.rubbers.${index}`);
        const bestOf = asNumber(rubber.bestOf, `encounter.rubbers.${index}.bestOf`);
        if (bestOf !== 1 && bestOf !== 3) throw new Error(`TEAM_FORMAT_INVALID:encounter.rubbers.${index}.bestOf`);
        return {
          key: asString(rubber.key, `encounter.rubbers.${index}.key`),
          label: asString(rubber.label, `encounter.rubbers.${index}.label`),
          order: asNumber(rubber.order, `encounter.rubbers.${index}.order`),
          mode: asEnum(rubber.mode, ["singles", "doubles"] as const, `encounter.rubbers.${index}.mode`),
          gender: asEnum(rubber.gender, ["male", "female", "mixed", "open"] as const, `encounter.rubbers.${index}.gender`),
          play: asEnum(rubber.play, ["always", "if_tied"] as const, `encounter.rubbers.${index}.play`),
          isTiebreaker: asBoolean(rubber.isTiebreaker, `encounter.rubbers.${index}.isTiebreaker`),
          weight: asNumber(rubber.weight, `encounter.rubbers.${index}.weight`),
          bestOf,
          pointTarget: asNumber(rubber.pointTarget, `encounter.rubbers.${index}.pointTarget`),
          scoringMode: rubber.scoringMode === null ? null : asString(rubber.scoringMode, `encounter.rubbers.${index}.scoringMode`),
        };
      }),
    },
    competition: {
      groupRounds,
      playoffMode: asEnum(
        competition.playoffMode,
        ["standard", "top2_final", "top3_step", "top4_semis", "league_only"] as const,
        "competition.playoffMode",
      ),
    },
    standings: {
      criteria: standings.criteria.map((criterion, index) =>
        asEnum(
          criterion,
          ["encounter_wins", "encounter_win_rate", "rubber_diff", "point_diff", "points_for"] as const,
          `standings.criteria.${index}`,
        ),
      ),
    },
  };

  const validation = validateTeamFormat(parsed);
  if (!validation.valid) {
    const first = validation.issues[0];
    throw new Error(first ? `TEAM_FORMAT_INVALID:${first.code}:${first.path}` : "TEAM_FORMAT_INVALID");
  }
  return parsed;
}

export function parseTeamFormatJson(json: string): TeamFormat {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error("TEAM_FORMAT_INVALID_JSON");
  }
  return parseTeamFormat(value);
}
