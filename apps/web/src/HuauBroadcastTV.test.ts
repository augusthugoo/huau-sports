import { describe, expect, it } from "vitest";
import { planBroadcastScenes } from "./HuauBroadcastTV";

const empty = {
  mode: "general" as const,
  blocks: [],
  standings: [],
  brackets: [],
  results: [],
  matchesPerScene: 4,
  sideGroupsPerScene: 2,
  tableGroupsPerScene: 4,
  standingRowsPerCard: 5,
  bracketMatchesPerRound: 4,
};

describe("HUAU Broadcast: bounded scenes, no missing matches", () => {
  it("shows an empty view rather than creating an empty document", () => {
    const scenes = planBroadcastScenes(empty);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.kind).toBe("matches");
  });
  it("splits a busy four-court schedule into fixed-size scenes", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      id: `m-${i}`, categoryId: "A", categoryName: "Masculino A", courtLabel: `Cancha ${1 + i % 4}`,
      startAt: 1_800_000_000 + i * 900, roundLabel: "Grupo A", sideA: "Jugador A", sideB: "Jugador B",
    }));
    const scenes = planBroadcastScenes({ ...empty, blocks });
    const displayed = scenes.filter((s) => s.kind === "matches");
    expect(displayed.map((s) => s.matches.length)).toEqual([4, 4, 2]);
    expect(displayed.flatMap((s) => s.matches.map((m) => m.id))).toEqual(blocks.map((m) => m.id));
  });
  it("paginates long standings and retains every participant", () => {
    const standings = [{ kind: "standard", categoryId: "A", categoryName: "A", groupId: "G1", groupName: "Grupo A",
      rows: Array.from({ length: 12 }, (_, i) => ({ entryId: String(i), name: `Jugador ${i}`, position: i + 1 })) }];
    const scenes = planBroadcastScenes({ ...empty, standings });
    const tables = scenes.filter((s) => s.kind === "tables");
    expect(tables.flatMap((s) => s.groups.map((g) => g.rows?.length))).toEqual([5, 5, 2]);
    expect(tables.flatMap((s) => s.groups.flatMap((g) => (g.rows ?? []).map((r) => r.entryId)))).toEqual(standings.flatMap((g) => g.rows.map((r) => r.entryId)));
  });
  it("preserves the three-column bracket 4+2+1", () => {
    const encounters = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, roundNumber: 1, roundLabel: "Cuartos", sideA: "A", sideB: "B", status: "pending", score: null })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `s${i}`, roundNumber: 2, roundLabel: "Semifinal", sideA: "A", sideB: "B", status: "pending", score: null })),
      { id: "f", roundNumber: 3, roundLabel: "Final", sideA: "A", sideB: "B", status: "pending", score: null },
    ];
    const scenes = planBroadcastScenes({ ...empty, brackets: [{ kind: "standard", categoryId: "A", categoryName: "Masculino A", encounters }] });
    const bracket = scenes.find((s) => s.kind === "bracket");
    expect(bracket?.rounds.map((r) => r.matches.length)).toEqual([4, 2, 1]);
  });
  it("splits 16-player brackets rather than clipping eight first-round matches", () => {
    const encounters = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, roundNumber: 1, roundLabel: "Octavos", sideA: "A", sideB: "B", status: "pending", score: null })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, roundNumber: 2, roundLabel: "Cuartos", sideA: "A", sideB: "B", status: "pending", score: null })),
    ];
    const scenes = planBroadcastScenes({ ...empty, brackets: [{ kind: "standard", categoryId: "A", categoryName: "A", encounters }] });
    const ids = scenes.filter((s) => s.kind === "bracket").flatMap((s) => s.rounds.flatMap((r) => r.matches.map((m) => m.id)));
    expect(ids.sort()).toEqual(encounters.map((m) => m.id).sort());
  });
  it("category mode isolates the selected bracket", () => {
    const make = (id: string) => ({ kind: "standard", categoryId: id, categoryName: id, encounters: [{ id: `f-${id}`, roundNumber: 1, roundLabel: "Final", sideA: "A", sideB: "B", status: "pending", score: null }] });
    const scenes = planBroadcastScenes({ ...empty, mode: "category", selectedCategoryId: "B", brackets: [make("A"), make("B")] });
    expect(scenes.filter((s) => s.kind === "bracket").map((s) => s.bracket.categoryId)).toEqual(["B"]);
  });
  it("court mode contains no competition-wide bracket or standings scenes", () => {
    const scenes = planBroadcastScenes({ ...empty, mode: "courts", standings: [{ kind: "standard", categoryId: "A", categoryName: "A", rows: [{ entryId: "1", name: "Uno" }] }] });
    expect(scenes.every((scene) => scene.kind === "matches")).toBe(true);
  });
});
