import { describe, expect, it } from "vitest";
import {
  clampRefundMinor,
  paidRegistrationNeedsCancellationReview,
  paymentCoverageStatus,
  paymentOrderStatus,
} from "./payment";

describe("Phase 7 payment domain", () => {
  it("separates financial coverage from participation state", () => {
    expect(paymentCoverageStatus({ finalAmountMinor: 1000, paidAmountMinor: 0, refundedAmountMinor: 0 })).toBe("pending");
    expect(paymentCoverageStatus({ finalAmountMinor: 1000, paidAmountMinor: 500, refundedAmountMinor: 0 })).toBe("partial");
    expect(paymentCoverageStatus({ finalAmountMinor: 1000, paidAmountMinor: 1000, refundedAmountMinor: 0 })).toBe("paid");
    expect(paymentCoverageStatus({ finalAmountMinor: 1000, paidAmountMinor: 1200, refundedAmountMinor: 0 })).toBe("overpaid");
    expect(paymentCoverageStatus({ finalAmountMinor: 0, paidAmountMinor: 0, refundedAmountMinor: 0 })).toBe("free");
  });

  it("moves paid orders through partial and full refunds", () => {
    expect(paymentOrderStatus({ totalAmountMinor: 1000, amountPaidMinor: 1000, amountRefundedMinor: 0 })).toBe("paid");
    expect(paymentOrderStatus({ totalAmountMinor: 1000, amountPaidMinor: 1000, amountRefundedMinor: 300 })).toBe("partially_refunded");
    expect(paymentOrderStatus({ totalAmountMinor: 1000, amountPaidMinor: 1000, amountRefundedMinor: 1000 })).toBe("refunded");
  });

  it("requires review instead of instant cancellation when net money exists", () => {
    expect(paidRegistrationNeedsCancellationReview({ paidAmountMinor: 1000, refundedAmountMinor: 0 })).toBe(true);
    expect(paidRegistrationNeedsCancellationReview({ paidAmountMinor: 1000, refundedAmountMinor: 1000 })).toBe(false);
  });

  it("never refunds more than the remaining paid amount", () => {
    expect(clampRefundMinor({ requestedMinor: 800, paidAmountMinor: 1000, refundedAmountMinor: 400 })).toBe(600);
  });
});
