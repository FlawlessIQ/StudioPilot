/**
 * Which readiness checkpoints the project's own records already satisfy.
 *
 * The walk of 2026-08-26 ended with a booked wedding reading **0% ready and 13
 * blockers** while the journey rail beside it read 9/15 with three of four
 * preparation steps ticked. The contract was completed, the retainer paid, the
 * questionnaire answered, the run of show client-approved and the crew accepted
 * — and the checkpoints for all five sat at `not_started`, because checkpoints
 * are only ever completed by workflow automation and nothing derives them from
 * the records. Since `PLANNING → READY` is evidence-controlled by readiness, the
 * lifecycle could not be completed at all.
 *
 * The link was already declared and never used: every checkpoint carries a
 * `completionMethod` naming the evidence that finishes it —
 * `contract_completed`, `invoice_paid`, `form_submitted`, `schedule_approved`,
 * `assignment_accepted`, or `manual`. This reads that declaration.
 *
 * Two rules, both learned the hard way:
 *
 * 1. **Adjacent evidence is not evidence.** `shot-list-approved` and
 *    `questionnaire-complete` share `form_submitted`; `crew-acknowledged` and
 *    `crew-accepted` share `assignment_accepted`. A shot list is not a details
 *    form, and accepting a booking is not reading the schedule you will shoot
 *    from. Ticking either on its neighbour's evidence is exactly the class of
 *    defect the 2026-08-20 audit found — 100% readiness on a wedding with no
 *    run of show. Each is matched by `templateKey`, and anything unrecognised
 *    stays a blocker.
 * 2. **`manual` means a person.** Venue confirmed, primary contacts, COI,
 *    locations and travel are judgements, not records. They are never inferred.
 *
 * Pure function, no I/O.
 */

export type ReadinessEvidence = {
  /** A contract record with status "completed". */
  contractCompleted: boolean;
  /** The retainer invoice is paid with a zero balance. */
  retainerPaid: boolean;
  /** The final balance invoice is paid with a zero balance. */
  finalBalancePaid: boolean;
  /**
   * The details form is submitted **and carries answers**. Compute with
   * `questionnaireIsAnswered` — "submitted" with `answers: {}` used to tick
   * this, which is how a wedding three days out reported itself ready with an
   * empty questionnaire.
   */
  questionnaireAnswered: boolean;
  /**
   * The run of show is client-approved **and holds items a person could read**.
   * Compute with `scheduleIsUsable` for the same reason.
   */
  scheduleApproved: boolean;
  /** Every required crew role has an accepted assignment. */
  crewAccepted: boolean;
  /**
   * The crew have acknowledged the *current* schedule version. Separate from
   * `crewAccepted` on purpose: a second photographer who accepted the job in
   * March has not thereby read the timeline approved in June.
   */
  crewAcknowledgedSchedule: boolean;
  /** A shot list record exists and is approved. Not the details form. */
  shotListApproved: boolean;
};

/** Nothing proven yet — the safe default for every field. */
export const noReadinessEvidence: ReadinessEvidence = {
  contractCompleted: false,
  retainerPaid: false,
  finalBalancePaid: false,
  questionnaireAnswered: false,
  scheduleApproved: false,
  crewAccepted: false,
  crewAcknowledgedSchedule: false,
  shotListApproved: false,
};

import {
  questionnaireIsAnswered,
  scheduleIsUsable,
} from "@/features/journey/substance";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Whether the records finish this checkpoint.
 *
 * Returns false for `manual`, for an unknown completion method, and for any
 * templateKey this does not recognise — a checkpoint a studio wrote itself must
 * not be ticked by a rule that has never heard of it.
 */
export function checkpointSatisfiedByEvidence(
  checkpoint: Record<string, unknown>,
  evidence: ReadinessEvidence,
): boolean {
  const method = text(checkpoint.completionMethod);
  const key = text(checkpoint.templateKey);
  switch (method) {
    case "contract_completed":
      return key === "contract-completed" && evidence.contractCompleted;
    case "invoice_paid":
      if (key === "retainer-paid") return evidence.retainerPaid;
      if (key === "final-balance") return evidence.finalBalancePaid;
      return false;
    case "form_submitted":
      if (key === "questionnaire-complete") return evidence.questionnaireAnswered;
      if (key === "shot-list-approved") return evidence.shotListApproved;
      return false;
    case "schedule_approved":
      return key === "schedule-approved" && evidence.scheduleApproved;
    case "assignment_accepted":
      if (key === "crew-accepted") return evidence.crewAccepted;
      if (key === "crew-acknowledged") return evidence.crewAcknowledgedSchedule;
      return false;
    default:
      // "manual", and anything a future template invents.
      return false;
  }
}

/**
 * Build the evidence from a project's records.
 *
 * Takes the facts the journey has already derived, deliberately: the two
 * systems disagreeing about the same five facts is the defect this exists to
 * close, and the surest way to keep them agreeing is to feed them from one
 * derivation. `questionnaireAnswered` and `scheduleApproved` are the substance
 * predicates, not the status strings, for the reasons recorded in
 * features/journey/substance.ts.
 *
 * `crewRequired` matters: zero accepted assignments out of zero required roles
 * is a solo wedding with nothing outstanding, not an unmet checkpoint. A studio
 * shooting alone should not be held at 92% forever by a crew role that does not
 * exist.
 */
export function readinessEvidenceFromFacts(input: {
  contractStatus: string | null;
  retainerInvoiceStatus: string | null;
  finalInvoiceStatus: string | null;
  questionnaireStatus: string | null;
  questionnaireAnswers: unknown;
  scheduleStatus: string | null;
  scheduleItems: readonly Record<string, unknown>[] | null | undefined;
  crewAccepted: number;
  crewRequired: number;
  crewAcknowledgedSchedule?: boolean;
  shotListApproved?: boolean;
}): ReadinessEvidence {
  const paid = (status: string | null) => status === "paid";
  return {
    contractCompleted: input.contractStatus === "completed",
    retainerPaid: paid(input.retainerInvoiceStatus),
    finalBalancePaid: paid(input.finalInvoiceStatus),
    questionnaireAnswered: questionnaireIsAnswered({
      status: input.questionnaireStatus,
      answers: input.questionnaireAnswers,
    }),
    scheduleApproved: scheduleIsUsable({
      status: input.scheduleStatus,
      items: input.scheduleItems,
    }),
    // Vacuously satisfied when no role is required. `crewRequired` must be the
    // number of roles the studio actually needs filled — count the roles
    // offered, not a guess — so that zero means "shooting this one alone"
    // rather than "we have not worked out the crew yet".
    crewAccepted:
      input.crewRequired > 0
        ? input.crewAccepted >= input.crewRequired
        : true,
    crewAcknowledgedSchedule: input.crewAcknowledgedSchedule ?? false,
    shotListApproved: input.shotListApproved ?? false,
  };
}
