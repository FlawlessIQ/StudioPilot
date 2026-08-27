/**
 * Which readiness checkpoints a studio may settle by hand.
 *
 * `resolveCheckpoint` has existed with a full evidence schema — `complete` or
 * `waived`, a reason, a waiver expiry, typed evidence references — and **no
 * screen ever called it.** The re-audit of 2026-08-27 found the consequence:
 * readiness climbed on its own to 38% and stopped, because the remaining
 * blockers were judgements no interface could record. `PLANNING → READY` had a
 * performer and an occasion and could still never fire.
 *
 * The line drawn here is the same one the closeout attestation draws: a person
 * may vouch for what happened somewhere StudioCue cannot see, and may never
 * vouch for something the product is supposed to *know*. A checkpoint whose
 * `completionMethod` names a record — a signed contract, a paid invoice, an
 * answered form, an approved schedule, an accepted assignment, a COI that
 * reached the venue — is settled by that record arriving, not by a sentence.
 * Offering a tick beside those would let a studio mark the retainer paid from
 * the readiness page, which is precisely the hole the booking commands are
 * careful to avoid.
 *
 * Pure functions, no I/O.
 */

/** Methods that mean "a record decides this", so a person may not. */
const EVIDENCE_METHODS: readonly string[] = [
  "form_submitted",
  "file_uploaded",
  "contract_completed",
  "invoice_paid",
  "schedule_approved",
  "assignment_accepted",
  "webhook_event",
  "system_rule",
];

export type ResolvableCheckpoint = {
  id: string;
  name: string;
  status: string;
  blocking: boolean;
  completionMethod: string;
  ownerType?: string;
  resolvedDueDate?: string | null;
};

/** Settled already, one way or another. */
export function checkpointIsSettled(
  checkpoint: Pick<ResolvableCheckpoint, "status">,
): boolean {
  return ["complete", "waived"].includes(checkpoint.status);
}

/**
 * Whether a studio may mark this one done by hand.
 *
 * `manual` only. Anything an unrecognised template invents is treated as
 * evidence-backed and therefore not resolvable: refusing to guess is the safe
 * direction, and a studio can still see the row and chase the record.
 */
export function checkpointIsResolvable(
  checkpoint: Pick<ResolvableCheckpoint, "status" | "completionMethod">,
): boolean {
  if (checkpointIsSettled(checkpoint)) return false;
  if (EVIDENCE_METHODS.includes(checkpoint.completionMethod)) return false;
  return checkpoint.completionMethod === "manual";
}

/**
 * Why a row offers no button, in words a photographer can act on.
 *
 * Silence is what made `/studio/readiness` frustrating: it listed what was
 * outstanding and gave no hint whether to chase a person, a provider or a
 * record.
 */
export function checkpointWaitingReason(
  checkpoint: Pick<ResolvableCheckpoint, "status" | "completionMethod">,
): string | null {
  if (checkpointIsSettled(checkpoint)) return null;
  switch (checkpoint.completionMethod) {
    case "manual":
      return null;
    case "contract_completed":
      return "Completes when the signed agreement is recorded.";
    case "invoice_paid":
      return "Completes when the invoice is paid.";
    case "form_submitted":
      return "Completes when the couple submits the form with answers.";
    case "schedule_approved":
      return "Completes when the couple approves the run of show.";
    case "assignment_accepted":
      return "Completes when the crew accept and acknowledge the schedule.";
    case "system_rule":
      return "Completes when StudioCue sends the certificate to the venue.";
    case "file_uploaded":
      return "Completes when the file is uploaded.";
    case "webhook_event":
      return "Completes when the provider confirms it.";
    default:
      return "Completes from its own record.";
  }
}

export type CheckpointResolution = "complete" | "waived";

/**
 * The shortest note worth keeping. "Done" is not a reason.
 *
 * Ten, not eight, because `resolveCheckpoint` refuses a waiver whose reason is
 * under ten characters — `(command.input.reason?.length ?? 0) < 10`. A client
 * floor below the server's lets a photographer type something the form accepts
 * and the command rejects.
 */
export const MINIMUM_CHECKPOINT_REASON = 10;

export function checkpointReasonIsUsable(reason: string): boolean {
  return reason.trim().length >= MINIMUM_CHECKPOINT_REASON;
}
