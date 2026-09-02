export type RegistrationEntryType = "individual" | "pair" | "team";
export type RegistrationGender = "male" | "female" | "mixed" | "open" | null;
export type RegistrationPriceScope = "free" | "per_entry" | "per_person";

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

  if (category.competitionGender === "male" && profile.sportGender !== "male") return { eligible: false, code: "GENDER_NOT_ELIGIBLE", age };
  if (category.competitionGender === "female" && profile.sportGender !== "female") return { eligible: false, code: "GENDER_NOT_ELIGIBLE", age };
  if (category.competitionGender === "mixed" && category.entryType === "individual" && profile.sportGender === "unspecified") {
    return { eligible: false, code: "SPORT_GENDER_REQUIRED", age };
  }
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
