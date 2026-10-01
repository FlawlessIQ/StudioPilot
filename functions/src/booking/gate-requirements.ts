/**
 * The functions copy of the booking gate's evidence fold.
 *
 * features/booking/gate-requirements.ts is the source of truth; functions/
 * is a separate package with no "@/features" path, so the fold is
 * duplicated here. `tests/booking-gate.test.ts` compares the two and fails
 * on a drift, because the two disagreeing means the gate a studio sees and
 * the gate that books the job are different gates.
 */
export type BookingGateEvidenceFlags = {
  contractCompleted: boolean;
  contractAttestedManually: boolean;
  retainerInvoiceCreated: boolean;
  retainerAttestedManually: boolean;
  retainerSatisfied: boolean;
  retainerExceptionApproved: boolean;
  eventDateAvailable: boolean;
  requiredContactsComplete: boolean;
};

export type BookingGateRequirements = {
  contractCompleted: boolean;
  retainerInvoiceCreated: boolean;
  retainerSatisfied: boolean;
  eventDateAvailable: boolean;
  requiredContactsComplete: boolean;
};

export function bookingGateRequirements(
  evidence: BookingGateEvidenceFlags,
): BookingGateRequirements {
  return {
    contractCompleted:
      evidence.contractCompleted || evidence.contractAttestedManually,
    // An approved exception is the decision to book without the retainer, so
    // it stands in for the invoice as well as the payment. It used to satisfy
    // only the payment — and with no retainer invoice ever raised, a studio
    // that approved one still could not pass the gate.
    retainerInvoiceCreated:
      evidence.retainerInvoiceCreated ||
      evidence.retainerAttestedManually ||
      evidence.retainerExceptionApproved,
    retainerSatisfied:
      evidence.retainerSatisfied ||
      evidence.retainerAttestedManually ||
      evidence.retainerExceptionApproved,
    eventDateAvailable: evidence.eventDateAvailable,
    requiredContactsComplete: evidence.requiredContactsComplete,
  };
}

/**
 * What a booking-check blocker means, in the studio's words.
 *
 * Today printed the stored code through a provider-name formatter, so a job
 * read "Booking stopped for a reason · ContractAttestedManually" (prod walk,
 * 2026-09-30). Older plans stored the raw evidence flags rather than the
 * folded requirements, so both sets are named here; anything else is spelled
 * out from its camelCase rather than shown as a code.
 */
const BLOCKER_LABELS: Record<string, string> = {
  contractCompleted: "the agreement isn't signed",
  contractAttestedManually: "the agreement isn't signed",
  retainerInvoiceCreated: "no retainer invoice yet",
  retainerAttestedManually: "the retainer isn't recorded",
  retainerSatisfied: "the retainer isn't paid",
  retainerExceptionApproved: "the retainer isn't paid or waived",
  eventDateAvailable: "the date clashes with another booking",
  requiredContactsComplete: "the couple's contact details are incomplete",
};

export function bookingBlockerLabel(code: unknown): string {
  const text = typeof code === "string" ? code.trim() : "";
  if (!text) return "something needs checking";
  if (BLOCKER_LABELS[text]) return BLOCKER_LABELS[text];
  return text
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}
