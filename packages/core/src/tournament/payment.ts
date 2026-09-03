export type PaymentCoverageStatus = "free" | "pending" | "partial" | "paid" | "overpaid";
export type PaymentOrderStatus = "draft" | "awaiting_payment" | "pending_review" | "paid" | "cancelled" | "partially_refunded" | "refunded";

export function netPaidMinor(input: { paidAmountMinor: number; refundedAmountMinor: number }): number {
  return Math.max(0, Math.trunc(input.paidAmountMinor) - Math.max(0, Math.trunc(input.refundedAmountMinor)));
}

export function paymentCoverageStatus(input: {
  finalAmountMinor: number;
  paidAmountMinor: number;
  refundedAmountMinor: number;
}): PaymentCoverageStatus {
  const due = Math.max(0, Math.trunc(input.finalAmountMinor));
  if (due === 0) return "free";
  const paid = netPaidMinor(input);
  if (paid === 0) return "pending";
  if (paid < due) return "partial";
  if (paid === due) return "paid";
  return "overpaid";
}

export function paymentOrderStatus(input: {
  totalAmountMinor: number;
  amountPaidMinor: number;
  amountRefundedMinor: number;
  pendingReview?: boolean;
  cancelled?: boolean;
}): PaymentOrderStatus {
  if (input.cancelled && input.amountPaidMinor <= 0) return "cancelled";
  const total = Math.max(0, Math.trunc(input.totalAmountMinor));
  const paid = Math.max(0, Math.trunc(input.amountPaidMinor));
  const refunded = Math.max(0, Math.trunc(input.amountRefundedMinor));
  if (paid > 0 && refunded >= paid) return "refunded";
  if (refunded > 0) return "partially_refunded";
  if (paid >= total && total > 0) return "paid";
  if (input.pendingReview) return "pending_review";
  return "awaiting_payment";
}

export function paidRegistrationNeedsCancellationReview(input: {
  paidAmountMinor: number;
  refundedAmountMinor: number;
}): boolean {
  return netPaidMinor(input) > 0;
}

export function clampRefundMinor(input: {
  requestedMinor: number;
  paidAmountMinor: number;
  refundedAmountMinor: number;
}): number {
  return Math.min(
    Math.max(0, Math.trunc(input.requestedMinor)),
    netPaidMinor({ paidAmountMinor: input.paidAmountMinor, refundedAmountMinor: input.refundedAmountMinor }),
  );
}
