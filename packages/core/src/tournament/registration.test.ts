import { describe, expect, it } from "vitest";
import { ageOnDate, capacityDecision, compactWaitlistPositions, evaluateRegistrationEligibility, registrationPriceMinor } from "./registration";

const base = {
  entryType: "individual" as const,
  competitionGender: "open" as const,
  minAge: null,
  maxAge: null,
  maxEntries: null,
  registrationStatus: "open" as const,
  priceScope: "free" as const,
  priceMinor: null,
  currency: "UYU",
};

describe("Phase 6 registration acceptance", () => {
  it("REG-AT-001 accepts an eligible individual registration", () => {
    expect(evaluateRegistrationEligibility(base, { sportGender: "male", birthDate: "2000-06-01" }, "2026-11-15")).toEqual({ eligible: true, age: 26 });
  });

  it("validates explicit age limits at tournament date", () => {
    const plus40 = { ...base, minAge: 40 };
    expect(evaluateRegistrationEligibility(plus40, { sportGender: "male", birthDate: "1986-11-15" }, "2026-11-15")).toEqual({ eligible: true, age: 40 });
    expect(evaluateRegistrationEligibility(plus40, { sportGender: "male", birthDate: "1987-01-01" }, "2026-11-15").eligible).toBe(false);
  });

  it("requires matching sport gender for gendered categories", () => {
    const female = { ...base, competitionGender: "female" as const };
    expect(evaluateRegistrationEligibility(female, { sportGender: "female", birthDate: null }, "2026-11-15").eligible).toBe(true);
    expect(evaluateRegistrationEligibility(female, { sportGender: "male", birthDate: null }, "2026-11-15")).toMatchObject({ eligible: false, code: "GENDER_NOT_ELIGIBLE" });
  });

  it("REG-AT-005 sends overflow entries to waitlist and compacts positions", () => {
    expect(capacityDecision({ maxEntries: 8, occupiedEntries: 8, registrationStatus: "open" })).toBe("waitlist");
    expect(compactWaitlistPositions([{ id: "a", waitlistPosition: 2 }, { id: "b", waitlistPosition: 4 }])).toEqual([
      { id: "a", waitlistPosition: 1 }, { id: "b", waitlistPosition: 2 },
    ]);
  });

  it("prices free, per-entry and per-person without inventing payment", () => {
    expect(registrationPriceMinor({ priceScope: "free", priceMinor: 500 }, 2)).toBe(0);
    expect(registrationPriceMinor({ priceScope: "per_entry", priceMinor: 60000 }, 2)).toBe(60000);
    expect(registrationPriceMinor({ priceScope: "per_person", priceMinor: 60000 }, 2)).toBe(120000);
  });

  it("ageOnDate handles birthday boundary", () => {
    expect(ageOnDate("1986-11-16", "2026-11-15")).toBe(39);
    expect(ageOnDate("1986-11-15", "2026-11-15")).toBe(40);
  });
});
