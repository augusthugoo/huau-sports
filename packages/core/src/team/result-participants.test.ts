import { describe, expect, it } from "vitest";
import {
  createSeniorTeamCupFormat,
  validateTeamResultParticipants,
  type TeamResultInput,
  type TeamRosterMember,
} from "./index";

const format = createSeniorTeamCupFormat();
const rubber = (key: string) => format.encounter.rubbers.find((row) => row.key === key)!;
function roster(prefix: string): TeamRosterMember[] {
  return [
    { personId: `${prefix}m1`, name: "M1", sportGender: "male", role: "captain" },
    { personId: `${prefix}m2`, name: "M2", sportGender: "male", role: "player" },
    { personId: `${prefix}f1`, name: "F1", sportGender: "female", role: "player" },
    { personId: `${prefix}f2`, name: "F2", sportGender: "female", role: "player" },
    { personId: `${prefix}m3`, name: "M3", sportGender: "male", role: "substitute" },
    { personId: `${prefix}u`, name: "U", sportGender: "unspecified", role: "player" },
  ];
}
const a = roster("a"), b = roster("b");
const players = (sideAPlayerIds: string[], sideBPlayerIds: string[]) => ({ sideAPlayerIds, sideBPlayerIds });
const validate = (key: string, input: unknown) => validateTeamResultParticipants(rubber(key), a, b, input);
const codes = (key: string, input: unknown) => validate(key, input).issues.map((issue) => issue.code);

describe("Team Results V2 actual participants", () => {
  it("accepts actual male doubles including a registered substitute", () => {
    const input: TeamResultInput = { ...players(["am1", "am3"], ["bm1", "bm2"]), sets: [{ scoreA: 15, scoreB: 9 }] };
    expect(validate("md", input)).toEqual({ valid: true, issues: [] });
  });
  it("accepts female doubles", () => {
    expect(validate("wd", players(["af1", "af2"], ["bf1", "bf2"])).valid).toBe(true);
  });
  it("accepts male and female singles without other rubber selections", () => {
    expect(validate("ms", players(["am3"], ["bm2"])).valid).toBe(true);
    expect(validate("ws", players(["af1"], ["bf2"])).valid).toBe(true);
  });
  it("accepts one male and one female per mixed side, regardless of order", () => {
    expect(validate("xd", players(["af1", "am2"], ["bm1", "bf2"])).valid).toBe(true);
  });
  it("rejects an incomplete or oversized side", () => {
    expect(codes("md", players(["am1"], ["bm1", "bm2"]))).toContain("TEAM_RESULT_PARTICIPANT_COUNT");
    expect(codes("ms", players(["am1", "am2"], ["bm1"]))).toContain("TEAM_RESULT_PARTICIPANT_COUNT");
  });
  it("rejects an outsider or opponent roster member", () => {
    expect(codes("ms", players(["missing"], ["bm1"]))).toContain("TEAM_RESULT_PERSON_OUTSIDE_ROSTER");
    expect(codes("ms", players(["bm2"], ["bm1"]))).toContain("TEAM_RESULT_PERSON_OUTSIDE_ROSTER");
  });
  it("rejects duplicate IDs within one side", () => {
    expect(codes("md", players(["am1", "am1"], ["bm1", "bm2"]))).toContain("TEAM_RESULT_PERSON_DUPLICATE");
  });
  it("rejects one person on both sides even with inconsistent roster data", () => {
    const result = validateTeamResultParticipants(rubber("ms"), a, [...b, a[0]!], players(["am1"], ["am1"]));
    expect(result.issues.map((issue) => issue.code)).toContain("TEAM_RESULT_PERSON_DUPLICATE");
  });
  it("enforces each configured gender restriction", () => {
    expect(codes("ms", players(["af1"], ["bm1"]))).toContain("TEAM_RESULT_GENDER_MALE");
    expect(codes("ws", players(["af1"], ["bm1"]))).toContain("TEAM_RESULT_GENDER_FEMALE");
    expect(codes("xd", players(["am1", "am2"], ["bm1", "bf1"]))).toContain("TEAM_RESULT_GENDER_MIXED");
    expect(codes("ms", players(["au"], ["bm1"]))).toContain("TEAM_RESULT_GENDER_MALE");
  });
  it("allows unspecified sport gender in open rubbers", () => {
    expect(validateTeamResultParticipants({ ...rubber("ms"), gender: "open" }, a, b, players(["au"], ["bu"])).valid).toBe(true);
  });
  it("rejects absent, malformed and empty IDs without throwing", () => {
    for (const input of [undefined, null, [], {}, { sideAPlayerIds: [42], sideBPlayerIds: ["bm1"] }, players([" "], ["bm1"])]) {
      expect(validate("ms", input).valid).toBe(false);
    }
  });
  it("does not mutate input or roster and allows a player in a different rubber", () => {
    const input = players(["am1", "am2"], ["bm1", "bm2"]);
    const before = JSON.stringify({ a, b, input });
    expect(validate("md", input).valid).toBe(true);
    expect(validate("ms", players(["am1"], ["bm1"])).valid).toBe(true);
    expect(JSON.stringify({ a, b, input })).toBe(before);
  });
});
