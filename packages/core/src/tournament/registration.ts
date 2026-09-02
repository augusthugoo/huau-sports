export type RegistrationEntryType = "individual" | "pair" | "team";
export type RegistrationGender = "male" | "female" | "mixed" | "open" | null;
export type RegistrationPriceScope = "free" | "per_entry" | "per_person";
export type TournamentRegistrationPaymentType = "per_category" | "base_plus_extra" | "free";

export type RegistrationPricingResolution = {
  priceScope: RegistrationPriceScope;
  priceMinor: number;
  source: "category" | "tournament";
  tournamentPaymentType: TournamentRegistrationPaymentType | null;
};

export type RegistrationCategoryRule = {
  entryType: RegistrationEntryType;
  competitionGender: RegistrationGender;
  minAge: number | null;
  maxAge: number | null;
  maxEntries: number | null;
  registrationStatus: "closed" | "open" | "waitlist_only";
  priceScope: RegistrationPriceScope;
  priceMinor: number | null;
  currency: string | null;
};

export type RegistrationProfile = {
  sportGender: "male" | "female" | "unspecified";
  birthDate: string | null;
};

export type RegistrationEligibility = { eligible: true; age: number | null } | { eligible: false; code: string; age: number | null };

export function ageOnDate(birthDate: string | null, eventDate: string): number | null {
  if (!birthDate) return null;
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? birthDate.split("-").map(Number) : [];
  const event = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? eventDate.split("-").map(Number) : [];
  if (birth.length !== 3 || event.length !== 3) return null;
  const [by, bm, bd] = birth as [number, number, number];
  const [ey, em, ed] = event as [number, number, number];
  if (!by || !bm || !bd || !ey || !em || !ed) return null;
  let age = ey - by;
  if (em < bm || (em === bm && ed < bd)) age -= 1;
  return age >= 0 ? age : null;
}

export function evaluateRegistrationEligibility(
  category: RegistrationCategoryRule,
  profile: RegistrationProfile,
  eventDate: string,
): RegistrationEligibility {
  const age = ageOnDate(profile.birthDate, eventDate);
  if ((category.minAge !== null || category.maxAge !== null) && age === null) return { eligible: false, code: "BIRTH_DATE_REQUIRED", age };
  if (category.minAge !== null && age !== null && age < category.minAge) return { eligible: false, code: "BELOW_MIN_AGE", age };
  if (category.maxAge !== null && age !== null && age > category.maxAge) return { eligible: false, code: "ABOVE_MAX_AGE", age };

  if (["male", "female", "mixed"].includes(category.competitionGender ?? "") && profile.sportGender === "unspecified") {
    return { eligible: false, code: "SPORT_GENDER_REQUIRED", age };
  }
  if (category.competitionGender === "male" && profile.sportGender !== "male") return { eligible: false, code: "GENDER_NOT_ELIGIBLE", age };
  if (category.competitionGender === "female" && profile.sportGender !== "female") return { eligible: false, code: "GENDER_NOT_ELIGIBLE", age };
  return { eligible: true, age };
}

export function registrationPriceMinor(
  category: Pick<RegistrationCategoryRule, "priceScope" | "priceMinor">,
  participantCount: number,
): number {
  if (category.priceScope === "free") return 0;
  const price = Math.max(0, Math.trunc(category.priceMinor ?? 0));
  return category.priceScope === "per_person" ? price * Math.max(1, Math.trunc(participantCount)) : price;
}

export function resolveRegistrationPricing(input: {
  categoryPriceScope: RegistrationPriceScope;
  categoryPriceMinor: number | null;
  tournamentPaymentType: TournamentRegistrationPaymentType;
  tournamentEntryFeeMinor: number | null;
  tournamentBaseFeeMinor: number | null;
  tournamentExtraCategoryFeeMinor: number | null;
  priorActiveRegistrationCount: number;
}): RegistrationPricingResolution {
  // `priceMinor !== null` is the explicit category override marker.
  // This lets `free + 0` mean an intentional free category, while
  // the historical/default `free + null` cleanly inherits tournament pricing.
  if (input.categoryPriceMinor !== null) {
    return {
      priceScope: input.categoryPriceScope,
      priceMinor: Math.max(0, Math.trunc(input.categoryPriceMinor)),
      source: "category",
      tournamentPaymentType: null,
    };
  }

  if (input.tournamentPaymentType === "free") {
    return { priceScope: "free", priceMinor: 0, source: "tournament", tournamentPaymentType: "free" };
  }
  if (input.tournamentPaymentType === "per_category") {
    return {
      priceScope: "per_entry",
      priceMinor: Math.max(0, Math.trunc(input.tournamentEntryFeeMinor ?? 0)),
      source: "tournament",
      tournamentPaymentType: "per_category",
    };
  }

  const prior = Math.max(0, Math.trunc(input.priorActiveRegistrationCount));
  return {
    priceScope: "per_entry",
    priceMinor: Math.max(0, Math.trunc(prior === 0 ? input.tournamentBaseFeeMinor ?? 0 : input.tournamentExtraCategoryFeeMinor ?? 0)),
    source: "tournament",
    tournamentPaymentType: "base_plus_extra",
  };
}

export function categoryLimitReached(maxCategoriesPerPlayer: number | null, activeCategoryCount: number): boolean {
  if (maxCategoriesPerPlayer === null) return false;
  const limit = Math.max(0, Math.trunc(maxCategoriesPerPlayer));
  return Math.max(0, Math.trunc(activeCategoryCount)) >= limit;
}

export function capacityDecision(input: {
  maxEntries: number | null;
  occupiedEntries: number;
  registrationStatus: RegistrationCategoryRule["registrationStatus"];
}): "closed" | "confirmed_slot" | "waitlist" {
  if (input.registrationStatus === "closed") return "closed";
  if (input.registrationStatus === "waitlist_only") return "waitlist";
  if (input.maxEntries === null) return "confirmed_slot";
  return input.occupiedEntries < Math.max(0, input.maxEntries) ? "confirmed_slot" : "waitlist";
}

export function nextWaitlistPosition(positions: Array<number | null | undefined>): number {
  return positions.reduce<number>((max, value) => Math.max(max, Number(value ?? 0)), 0) + 1;
}

export function compactWaitlistPositions<T extends { waitlistPosition: number | null }>(rows: T[]): Array<T & { waitlistPosition: number }> {
  return rows
    .slice()
    .sort((a, b) => Number(a.waitlistPosition ?? Number.MAX_SAFE_INTEGER) - Number(b.waitlistPosition ?? Number.MAX_SAFE_INTEGER))
    .map((row, index) => ({ ...row, waitlistPosition: index + 1 }));
}
