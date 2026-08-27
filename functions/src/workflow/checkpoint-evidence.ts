/**
 * Checkpoint evidence — mirror.
 *
 * `functions/` is a separate package and cannot import from `features/`, so this
 * mirrors features/readiness/checkpoint-evidence.ts. That copy holds the tests
 * and is the source of truth; change both together. The two substance
 * predicates it depends on are inlined below for the same reason.
 */

const SETTLED_SCHEDULE = ["approved", "published"];
const SUBMITTED_QUESTIONNAIRE = ["submitted", "complete", "completed"];

/**
 * A schedule item is displayable when its start parses. Mirrors
 * features/schedules/item-clock.ts `scheduleItemClock` — an item whose startAt
 * is missing or unparseable rendered as "Invalid Date" in the couple's brief,
 * which is why an approved schedule made of those does not count as approved.
 */
const startParses = (item: Record<string, unknown>): boolean => {
  const value = item.startAt;
  if (typeof value !== "string" || !value.trim()) return false;
  return !Number.isNaN(new Date(value).valueOf());
};

function scheduleIsUsable(input: {
  status: string | null | undefined;
  items: readonly Record<string, unknown>[] | null | undefined;
}): boolean {
  if (!SETTLED_SCHEDULE.includes(String(input.status ?? ""))) return false;
  return (input.items ?? []).some(startParses);
}

/** Verbatim from features/journey/substance.ts — do not "simplify" it. */
function questionnaireHasAnswers(answers: unknown): boolean {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return false;
  }
  return Object.values(answers as Record<string, unknown>).some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return true;
  });
}

function questionnaireIsAnswered(input: {
  status: string | null | undefined;
  answers: unknown;
}): boolean {
  return (
    SUBMITTED_QUESTIONNAIRE.includes(String(input.status ?? "")) &&
    questionnaireHasAnswers(input.answers)
  );
}

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
