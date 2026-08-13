export type BookingAutomationStep =
  | "wait_for_signature"
  | "create_retainer"
  | "wait_for_payment"
  | "complete_booking"
  | "needs_attention"
  | "completed";

type BookingAutomationState = {
  contractStatus: string | null;
  invoiceStatus: string | null;
  invoiceBalanceCents: number | null;
  gateBlockers?: string[];
  bookingComplete?: boolean;
};

/**
 * Pure representation of the evidence-led booking sequence. Provider webhooks
 * supply the state; this function never assumes that a signature or payment
 * happened merely because StudioCue requested it.
 */
export function nextBookingAutomationStep(
  state: BookingAutomationState,
): BookingAutomationStep {
  if (state.bookingComplete) return "completed";
  if (state.gateBlockers?.length) return "needs_attention";
  if (state.contractStatus !== "completed") return "wait_for_signature";
  if (!state.invoiceStatus) return "create_retainer";
  if (
    state.invoiceStatus !== "paid" ||
    state.invoiceBalanceCents !== 0
  ) {
    return "wait_for_payment";
  }
  return "complete_booking";
}
