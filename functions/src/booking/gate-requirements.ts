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
