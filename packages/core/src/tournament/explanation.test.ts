import { describe, expect, it } from "vitest";
import { createMixedFiveRubberTeamFormat } from "../team/defaults";
import {
  explainStandardFormatConfig,
  explainTeamFormat,
  standardExplanationInputFromConfig,
} from "./explanation";

describe("Format Explanation Engine", () => {
  it("explains a 3/4/4 equalized standard format in Spanish without changing group results", () => {
    const explanation = explainStandardFormatConfig(
      {
        groups: 3,
        sizes: [3, 4, 4],
        groupRounds: 2,
        qualifiersPerGroup: 2,
        wildcardQualifiers: 1,
        crossGroupMethod: "equalized",
        playoffMode: "standard",
        consolationMode: "knockout",
        finalDrawMethod: "pots",
        avoidGroupRematches: true,
        bronzeMatch: true,
        medalSchedule: "simultaneous",
        standardPointTarget: 15,
        medalBestOf: 3,
        medalPointTarget: 11,
        preferredRestSlots: 1,
        seedingMethod: "snake",
        bracketSize: 8,
        byes: 1,
      },
      "es",
    );

    expect(explanation.official).toBe(true);
    expect(explanation.summary).toHaveLength(3);
    expect(explanation.summary[0]).toContain("3 grupos");
    expect(explanation.summary[0]).toContain("3, 4 y 4");
    expect(explanation.summary[0]).toContain("dos vueltas");
    expect(explanation.summary[1]).toContain("2 por grupo");
    expect(explanation.summary[1]).toContain("1 wildcard");

    const cross = explanation.sections.find((section) => section.id === "cross-group");
    expect(cross?.title).toContain("Equiparada");
    expect(cross?.paragraphs.join(" ")).toContain("No se borra ni se modifica ningún partido");

    const finals = explanation.sections.find((section) => section.id === "final-phase");
    expect(finals?.items.join(" ")).toContain("1 bye");
    expect(finals?.items.join(" ")).toContain("consuelo");
    expect(finals?.items.join(" ")).toContain("en paralelo");
  });

  it("explains normalized cross-group comparison in English", () => {
    const explanation = explainStandardFormatConfig(
      {
        groupCount: 2,
        groupSizes: [4, 4],
        groupRounds: 1,
        qualifiersPerGroup: 1,
        wildcardQualifiers: 2,
        crossGroupMethod: "normalized",
        playoffMode: "standard",
      },
      "en",
    );
    const cross = explanation.sections.find((section) => section.id === "cross-group");
    expect(cross?.title).toContain("Normalized");
    expect(cross?.paragraphs.join(" ")).toContain("playing more matches does not create an accumulation advantage");
    expect(cross?.items[0]).toBe("Win percentage.");
  });

  it("describes league-only and top-three modes from the actual configuration", () => {
    const league = explainStandardFormatConfig({ playoffMode: "league_only", groupRounds: 1 }, "es");
    expect(league.summary.join(" ")).toContain("campeón se define por la tabla");
    expect(league.summary.join(" ")).not.toContain("partidos por medallas");

    const ladder = explainStandardFormatConfig({ playoffMode: "top3_step", groupRounds: 1 }, "en");
    expect(ladder.summary.join(" ")).toContain("Second and third place play a preliminary match");
    expect(ladder.summary.join(" ")).toContain("faces first place in the final");
  });

  it("normalizes persisted standard config into explanation input", () => {
    const input = standardExplanationInputFromConfig({
      groups: 3,
      sizes: [3, 4, 4],
      medalBestOf: 3,
      standardPointTarget: 15,
      medalPointTarget: 11,
      seedingMethod: "live",
      avoidGroupRematches: false,
    });
    expect(input.groupCount).toBe(3);
    expect(input.groupSizes).toEqual([3, 4, 4]);
    expect(input.format.medal.bestOf).toBe(3);
    expect(input.format.preliminary.pointTarget).toBe(15);
    expect(input.seedingMethod).toBe("live");
    expect(input.format.avoidGroupRematches).toBe(false);
  });

  it("explains the configurable five-rubber Team preset and deciding mixed doubles", () => {
    const explanation = explainTeamFormat(createMixedFiveRubberTeamFormat("if_tied"), "es");
    expect(explanation.summary.join(" ")).toContain("5 rubbers");
    expect(explanation.summary.join(" ")).toContain("sólo si la serie llega empatada");
    const encounter = explanation.sections.find((section) => section.id === "team-encounter");
    expect(encounter?.items.join(" ")).toContain("Dobles Masculino");
    expect(encounter?.items.join(" ")).toContain("Dobles Mixto");
    expect(encounter?.items.join(" ")).toContain("tiebreaker");
    const standings = explanation.sections.find((section) => section.id === "team-standings");
    expect(standings?.items[0]).toBe("Series ganadas.");
    expect(standings?.items).toContain("Diferencia de rubbers ganados/perdidos.");
  });

  it("explains first-to Team winner rules in English", () => {
    const format = createMixedFiveRubberTeamFormat("always");
    format.encounter.winnerRule = "first_to";
    format.encounter.targetWins = 3;
    format.encounter.playRemainingAfterClinched = false;
    const explanation = explainTeamFormat(format, "en");
    expect(explanation.summary.join(" ")).toContain("first team to reach 3 weighted wins");
    const encounter = explanation.sections.find((section) => section.id === "team-encounter");
    expect(encounter?.items.join(" ")).toContain("remaining rubbers may be skipped");
  });
});
