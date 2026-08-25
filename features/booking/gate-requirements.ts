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
    retainerInvoiceCreated:
      evidence.retainerInvoiceCreated || evidence.retainerAttestedManually,
    retainerSatisfied:
      evidence.retainerSatisfied ||
      evidence.retainerAttestedManually ||
      evidence.retainerExceptionApproved,
    eventDateAvailable: evidence.eventDateAvailable,
    requiredContactsComplete: evidence.requiredContactsComplete,
  };
}
