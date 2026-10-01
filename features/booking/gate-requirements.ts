/**
 * Evidence is not the same shape as requirements.
 *
 * Gate evidence records which authorities actually spoke, and several of
 * its fields are alternatives rather than additions: a signature is either
 * verified by a provider or attested by the studio, and a retainer is
 * either cleared through a provider, attested by the studio, or waived by
 * an approved exception. Ask "is every field true?" and no booking passes —
 * a provider-signed contract blocks for want of an attestation and an
 * attested one blocks for want of a provider. That shipped, briefly, and is
 * why this fold is one function in one place instead of an expression
 * written out wherever a gate is evaluated.
 *
 * Duplicated at functions/src/booking/gate-requirements.ts, which cannot
 * import from features/. `tests/booking-gate.test.ts` fails on a drift.
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
