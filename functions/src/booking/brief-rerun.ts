/**
 * Preparing the booking brief again from changed consultation notes.
 *
 * The consultation analysis — brief, package suggestion, proposal draft — was
 * made once per consultation: completeConsultation and the Zoom capture both
 * create `aiJobs/consultation_<id>` only if it is not there, and the runner
 * wrote its three aiActions under ids derived from the consultation alone. A
 * studio that added what the couple said on a follow-up call kept the first
 * brief for good, built from notes it had since corrected.
 *
 * So each preparation is a numbered run. Run 1 keeps the ids it always had;
 * a rerun gets its own job and its own actions, and the open actions of the
 * run before are marked `superseded` — kept, not deleted, so what was
 * suggested and why is still on the record. The consultation's `briefRun`
 * says which run is current; the runner refuses to write for any other.
 *
 * Pure, so tests hold the rules directly; booking/commands.ts applies them in
 * a transaction and operations/ai-pdf.ts names its writes with them.
 */

/** The run a consultation, job or action belongs to. Absent means the first. */
export function briefRunOf(value: unknown): number {
  const run = Number(value ?? 1);
  return Number.isInteger(run) && run >= 1 ? run : 1;
}

const suffix = (run: number) => (run > 1 ? `_r${run}` : "");

/** The analysis job for one run of one consultation. */
export function briefJobId(consultationId: string, run: number): string {
  return `consultation_${consultationId}${suffix(run)}`;
}

/** The three actions one run writes. */
export function briefActionIds(consultationId: string, run: number) {
  return {
    summary: `ai_consultation_${consultationId}${suffix(run)}`,
    package: `ai_package_${consultationId}${suffix(run)}`,
    proposal: `ai_proposal_${consultationId}${suffix(run)}`,
  };
}

/**
 * Which of the previous run's actions a rerun sets aside: those still waiting
 * on a person, or still being written. A decided one (approved, dismissed,
 * executed) is a record of what the studio did and stays as it is.
 */
export const SUPERSEDABLE_BRIEF_STATUSES = ["queued", "running", "review_required", "failed"];

/** An analysis job in one of these has not finished; a rerun would race it. */
const PREPARING_JOB_STATUSES = ["queued", "running", "retry_scheduled"];

/** A proposal in one of these has reached the couple; the brief is moot. */
const PROPOSAL_OUT_STATUSES = ["sent", "viewed", "accepted"];

/**
 * Why the brief may not be prepared again, or null.
 *
 * - BOOKING_BRIEF_MOOT: a proposal has gone to the couple, or the job is past
 *   the consultation stage. The brief only feeds the first proposal draft;
 *   past that, what to change is the proposal.
 * - PROJECT_NOT_IN_CONSULTATION: not yet at the consultation stage.
 * - CONSULTATION_NOT_COMPLETED: there are no saved notes to prepare from.
 * - BOOKING_BRIEF_ALREADY_PREPARING: the current run has not landed yet. A
 *   second press would pay for a second run that the first then races.
 */
export function bookingBriefRerunRefusal(input: {
  consultationStatus: string;
  projectState: string;
  proposalStatuses: string[];
  currentJobStatus: string | null;
}): string | null {
  if (input.proposalStatuses.some((status) => PROPOSAL_OUT_STATUSES.includes(status)))
    return "BOOKING_BRIEF_MOOT";
  if (input.projectState !== "CONSULTATION")
    return ["LEAD", "LOST"].includes(input.projectState)
      ? "PROJECT_NOT_IN_CONSULTATION"
      : "BOOKING_BRIEF_MOOT";
  if (input.consultationStatus !== "completed") return "CONSULTATION_NOT_COMPLETED";
  if (input.currentJobStatus && PREPARING_JOB_STATUSES.includes(input.currentJobStatus))
    return "BOOKING_BRIEF_ALREADY_PREPARING";
  return null;
}
