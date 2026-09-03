import { describe, expect, it } from "vitest";
import { ageOnDate, capacityDecision, categoryLimitReached, compactWaitlistPositions, evaluateRegistrationEligibility, registrationPriceMinor, resolveRegistrationPricing, resolveTeamIndividualPrice, teamAgeDivisionOverlapBlocked } from "./registration";

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

  it("asks for sport gender before rejecting a gendered or mixed invitation", () => {
    const female = { ...base, competitionGender: "female" as const };
    const mixedPair = { ...base, entryType: "pair" as const, competitionGender: "mixed" as const };
    expect(evaluateRegistrationEligibility(female, { sportGender: "unspecified", birthDate: null }, "2026-11-15")).toMatchObject({ eligible: false, code: "SPORT_GENDER_REQUIRED" });
    expect(evaluateRegistrationEligibility(mixedPair, { sportGender: "unspecified", birthDate: null }, "2026-11-15")).toMatchObject({ eligible: false, code: "SPORT_GENDER_REQUIRED" });
  });

  it("enforces a tournament-wide max categories per player only after the limit is reached", () => {
    expect(categoryLimitReached(null, 8)).toBe(false);
    expect(categoryLimitReached(2, 1)).toBe(false);
    expect(categoryLimitReached(2, 2)).toBe(true);
    expect(categoryLimitReached(2, 3)).toBe(true);
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

  it("inherits tournament pricing unless a category explicitly overrides it", () => {
    expect(resolveRegistrationPricing({
      categoryPriceScope: "free", categoryPriceMinor: null, tournamentPaymentType: "per_category",
      tournamentEntryFeeMinor: 50000, tournamentBaseFeeMinor: null, tournamentExtraCategoryFeeMinor: null, priorActiveRegistrationCount: 0,
    })).toMatchObject({ priceScope: "per_entry", priceMinor: 50000, source: "tournament" });

    expect(resolveRegistrationPricing({
      categoryPriceScope: "free", categoryPriceMinor: 0, tournamentPaymentType: "per_category",
      tournamentEntryFeeMinor: 50000, tournamentBaseFeeMinor: null, tournamentExtraCategoryFeeMinor: null, priorActiveRegistrationCount: 0,
    })).toMatchObject({ priceScope: "free", priceMinor: 0, source: "category" });
  });

  it("uses base fee for the first active registration and extra fee afterwards", () => {
    const common = {
      categoryPriceScope: "free" as const, categoryPriceMinor: null, tournamentPaymentType: "base_plus_extra" as const,
      tournamentEntryFeeMinor: null, tournamentBaseFeeMinor: 90000, tournamentExtraCategoryFeeMinor: 30000,
    };
    expect(resolveRegistrationPricing({ ...common, priorActiveRegistrationCount: 0 }).priceMinor).toBe(90000);
    expect(resolveRegistrationPricing({ ...common, priorActiveRegistrationCount: 1 }).priceMinor).toBe(30000);
  });

  it("prices additional team divisions with full, extra or free policies", () => {
    expect(resolveTeamIndividualPrice({ individualFeeMinor: 150000, additionalMode: "full", additionalFeeMinor: 50000, priorTeamRegistrationCount: 0 })).toBe(150000);
    expect(resolveTeamIndividualPrice({ individualFeeMinor: 150000, additionalMode: "full", additionalFeeMinor: 50000, priorTeamRegistrationCount: 1 })).toBe(150000);
    expect(resolveTeamIndividualPrice({ individualFeeMinor: 150000, additionalMode: "extra", additionalFeeMinor: 50000, priorTeamRegistrationCount: 1 })).toBe(50000);
    expect(resolveTeamIndividualPrice({ individualFeeMinor: 150000, additionalMode: "free", additionalFeeMinor: 50000, priorTeamRegistrationCount: 1 })).toBe(0);
  });

  it("can disable a second age-division team participation without blocking non-age team categories", () => {
    expect(teamAgeDivisionOverlapBlocked({ allowOverlap: false, priorAgeDivisionCount: 1, categoryHasAgeRule: true })).toBe(true);
    expect(teamAgeDivisionOverlapBlocked({ allowOverlap: true, priorAgeDivisionCount: 1, categoryHasAgeRule: true })).toBe(false);
    expect(teamAgeDivisionOverlapBlocked({ allowOverlap: false, priorAgeDivisionCount: 1, categoryHasAgeRule: false })).toBe(false);
  });

  it("ageOnDate handles birthday boundary", () => {
    expect(ageOnDate("1986-11-16", "2026-11-15")).toBe(39);
    expect(ageOnDate("1986-11-15", "2026-11-15")).toBe(40);
  });
});
