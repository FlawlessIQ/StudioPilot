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

/**
 * Is a running sequence actually driving the contract on screen?
 *
 * A plan watches one named contract. When a signature arrives on a different
 * one — the studio records it by hand after a provider send fails — the plan
 * waits forever on a contract that will never complete. Every panel that
 * promises StudioCue will take the next step keyed off `status === "active"`
 * alone, so a stranded plan left the studio reading "Waiting for verified
 * signature" on a booking whose contract was signed and complete, with no
 * button to press and nothing to do about it.
 *
 * A plan pointed somewhere else makes no promises about this booking, and the
 * manual controls take over. A plan with no contract yet is still ours.
 */
export function bookingAutomationDrivesContract(input: {
  status: string | null | undefined;
  planContractId: string | null | undefined;
  contractId: string | null | undefined;
}): boolean {
  if (input.status !== "active" && input.status !== "completed") return false;
  if (!input.planContractId) return true;
  return input.planContractId === input.contractId;
}

/**
 * Is the plan still owed an event that has not happened?
 *
 * The booking workspace replaced its only forward control — "Check and
 * confirm" — with "StudioCue will run the evidence check as soon as the
 * connected provider reports the retainer paid" for as long as a plan was
 * driving. When the retainer is recorded by hand (a transfer, a cheque, a card
 * reader) no provider reports anything, so that described a wait that could
 * not end, and the studio was left on a screen that said "Confirm the booking
 * to finish" with nothing to press.
 *
 * A plan is only owed a provider event while a step is genuinely outstanding.
 * Once the agreement is complete and the retainer is settled there is nothing
 * left to report, and the person takes over.
 *
 * Revealing the control weakens no guarantee: it runs the same booking gate
 * the automation would, which refuses on its own evidence. Hiding it never
 * protected the gate, it only removed the human's ability to ask for it.
 */
export function bookingAutomationAwaitsProvider(input: {
  driving: boolean;
  contractComplete: boolean;
  retainerPaid: boolean;
}): boolean {
  if (!input.driving) return false;
  return !input.contractComplete || !input.retainerPaid;
}
