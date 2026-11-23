import { describe, expect, it } from "vitest";
import { validateOrganizerResultOperations } from "../TournamentOrganizerDayOps";

describe("Organizer Day result operation authorization", () => {
  it("only permits score commands, not arbitrary snapshots or structure mutations", () => {
    expect(() => validateOrganizerResultOperations({ snapshot: { groups: [] } })).toThrow("ORGANIZER_DAY_INVALID_OPERATIONS");
    expect(() => validateOrganizerResultOperations([{kind:"structure", categoryId:"c", encounterId:"e", groups:[]}])).toThrow("ORGANIZER_DAY_INVALID_OPERATION");
  });
  it("requires valid nonnegative integer scores and rejects ties", () => {
    expect(() => validateOrganizerResultOperations([{kind:"standard",categoryId:"c",encounterId:"e",result:{scoreA:3,scoreB:0}}])).not.toThrow();
    for (const scoreA of [-1, 2.5, 1000, "11", 0]) {
      expect(() => validateOrganizerResultOperations([{kind:"standard",categoryId:"c",encounterId:"e",result:{scoreA,scoreB:0}}])).toThrow();
    }
  });
  it("refuses duplicate mutations and oversized batches", () => {
    const cmd={kind:"standard",categoryId:"c",encounterId:"e",result:{scoreA:4,scoreB:0}};
    expect(() => validateOrganizerResultOperations([cmd,cmd])).toThrow("ORGANIZER_DAY_DUPLICATE_RESULT");
    expect(() => validateOrganizerResultOperations(Array.from({length:601},()=>cmd))).toThrow("ORGANIZER_DAY_INVALID_OPERATIONS");
  });
  it("normalizes team result sets and disallows arbitrary permissions", () => {
    const result=validateOrganizerResultOperations([{kind:"team",categoryId:"c",encounterId:"e",matchId:"m",sets:[{scoreA:11,scoreB:5}],permissions:["admin"]}]);
    expect(result).toEqual([{kind:"team",categoryId:"c",encounterId:"e",matchId:"m",sets:[{scoreA:11,scoreB:5}]}]);
  });
});
