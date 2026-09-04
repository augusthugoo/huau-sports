import type { TeamFormat, TeamStandingCriterion } from "./types";

export const DEFAULT_TEAM_STANDINGS_CRITERIA: TeamStandingCriterion[] = [
  "encounter_wins",
  "encounter_win_rate",
  "rubber_diff",
  "point_diff",
  "points_for",
];

export function createMixedFiveRubberTeamFormat(mixedDoublesPlay: "always" | "if_tied" = "always"): TeamFormat {
  return {
    schemaVersion: 1,
    roster: {
      min: 4,
      max: 6,
      composition: "mixed",
      rules: {
        maleMin: 2,
        maleMax: null,
        femaleMin: 2,
        femaleMax: null,
      },
      substitutesAllowed: true,
      captainRequired: false,
    },
    encounter: {
      winnerRule: "majority",
      targetWins: null,
      playRemainingAfterClinched: true,
      rubbers: [
        {
          key: "md",
          label: "Dobles Masculino",
          order: 1,
          mode: "doubles",
          gender: "male",
          play: "always",
          isTiebreaker: false,
          weight: 1,
          bestOf: 1,
          pointTarget: 15,
          scoringMode: null,
        },
        {
          key: "wd",
          label: "Dobles Femenino",
          order: 2,
          mode: "doubles",
          gender: "female",
          play: "always",
          isTiebreaker: false,
          weight: 1,
          bestOf: 1,
          pointTarget: 15,
          scoringMode: null,
        },
        {
          key: "ms",
          label: "Singles Masculino",
          order: 3,
          mode: "singles",
          gender: "male",
          play: "always",
          isTiebreaker: false,
          weight: 1,
          bestOf: 1,
          pointTarget: 15,
          scoringMode: null,
        },
        {
          key: "ws",
          label: "Singles Femenino",
          order: 4,
          mode: "singles",
          gender: "female",
          play: "always",
          isTiebreaker: false,
          weight: 1,
          bestOf: 1,
          pointTarget: 15,
          scoringMode: null,
        },
        {
          key: "xd",
          label: "Dobles Mixto",
          order: 5,
          mode: "doubles",
          gender: "mixed",
          play: mixedDoublesPlay,
          isTiebreaker: mixedDoublesPlay === "if_tied",
          weight: 1,
          bestOf: 1,
          pointTarget: 15,
          scoringMode: null,
        },
      ],
    },
    competition: {
      groupRounds: 1,
      playoffMode: "standard",
      qualifiersPerGroup: 2,
      wildcardQualifiers: 0,
      bronzeMatch: false,
    },
    standings: {
      criteria: [...DEFAULT_TEAM_STANDINGS_CRITERIA],
    },
  };
}

/** Official Uruguay Senior Team Pickleball Cup 2026 preset.
 * Four mandatory rubbers award 2 standings points each; mixed doubles is only
 * played at 2-2 and awards 1 standings point. The generic Team preset remains
 * unchanged so other tournaments keep their existing semantics.
 */
export function createSeniorTeamCupFormat(): TeamFormat {
  const base = createMixedFiveRubberTeamFormat("if_tied");
  return {
    ...base,
    roster: {
      ...base.roster,
      min: 4,
      max: 6,
      captainRequired: true,
    },
    encounter: {
      ...base.encounter,
      winnerRule: "majority",
      targetWins: null,
      playRemainingAfterClinched: true,
      rubbers: base.encounter.rubbers.map((rubber) => ({
        ...rubber,
        play: rubber.key === "xd" ? "if_tied" : "always",
        isTiebreaker: rubber.key === "xd",
        weight: rubber.key === "xd" ? 1 : 2,
        pointTarget: 15,
        scoringMode: "rally-win-by-2-cap-21",
      })),
    },
    standings: {
      criteria: ["standing_points", "encounter_wins", "head_to_head", "rubber_diff", "point_diff"],
    },
  };
}
