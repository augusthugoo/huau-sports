import { describe, expect, it } from "vitest";
import { dayOwnsPlayerCategory, dayOwnsTeamRoster } from "./tournament-day-ownership";

describe("Tournament Day final-sync ownership", () => {
  it("never claims imported/Admin player-category relationships", () => {
    expect(dayOwnsPlayerCategory("0d23-admin-profile")).toBe(false);
    expect(dayOwnsPlayerCategory("day-profile-deadbeef")).toBe(false);
    expect(dayOwnsPlayerCategory("local-player:walk-in-1")).toBe(true);
  });

  it("never replaces imported/Admin team rosters", () => {
    expect(dayOwnsTeamRoster("registration-team-entry-1")).toBe(false);
    expect(dayOwnsTeamRoster("day-team-previous-sync")).toBe(false);
    expect(dayOwnsTeamRoster("local-team:walk-in-team")).toBe(true);
  });
});
