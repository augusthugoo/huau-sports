import { describe, expect, it } from "vitest";
import { canMarkOrganizerPaid, canOfferOrganizerCourtesy, formatOrganizerMoney } from "./TournamentOrganizerConsole";

describe("HUAU organizer C — UI business boundaries", () => {
  const registration = {
    entryType: "individual" as const, status: "awaiting_payment", finalAmountMinor: 140000,
    paidAmountMinor: 0, refundedAmountMinor: 0, covered: false,
  };
  it("allows an unpaid individual courtesy", () => {
    expect(canOfferOrganizerCourtesy(registration)).toBe(true);
  });
  it("does not offer team courtesies", () => {
    expect(canOfferOrganizerCourtesy({ ...registration, entryType: "team" })).toBe(false);
  });
  it("does not offer courtesies to already paid or refunded registrations", () => {
    expect(canOfferOrganizerCourtesy({ ...registration, paidAmountMinor: 140000 })).toBe(false);
    expect(canOfferOrganizerCourtesy({ ...registration, refundedAmountMinor: 500 })).toBe(false);
  });
  it("does not offer courtesies to covered, cancelled or free registrations", () => {
    expect(canOfferOrganizerCourtesy({ ...registration, covered: true })).toBe(false);
    expect(canOfferOrganizerCourtesy({ ...registration, status: "cancelled" })).toBe(false);
    expect(canOfferOrganizerCourtesy({ ...registration, status: "confirmed" })).toBe(false);
    expect(canOfferOrganizerCourtesy({ ...registration, finalAmountMinor: 0 })).toBe(false);
  });
  it("only offers manual settlement for open orders", () => {
    expect(canMarkOrganizerPaid({ status: "awaiting_payment", totalAmountMinor: 140000 })).toBe(true);
    expect(canMarkOrganizerPaid({ status: "pending_review", totalAmountMinor: 140000 })).toBe(true);
    expect(canMarkOrganizerPaid({ status: "paid", totalAmountMinor: 140000 })).toBe(false);
    expect(canMarkOrganizerPaid({ status: "refunded", totalAmountMinor: 140000 })).toBe(false);
    expect(canMarkOrganizerPaid({ status: "awaiting_payment", totalAmountMinor: 0 })).toBe(false);
  });
  it("renders money from minor units and preserves currency", () => {
    expect(formatOrganizerMoney(140000, "UYU")).toMatch(/1[.,]400[.,]00 UYU/);
    expect(formatOrganizerMoney(2050, "USD")).toMatch(/20[.,]50 USD/);
  });
});
