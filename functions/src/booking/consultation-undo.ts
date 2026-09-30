/**
 * Correcting a consultation after the fact (wave 3). Pure, so tests hold the
 * rules directly; booking/commands.ts applies them in a transaction.
 *
 * Cancel and reschedule both require `scheduled`, so a consultation marked
 * held by mistake could never be put back, and a couple who simply didn't
 * turn up had no status at all: `no_show` was in the schema and nothing wrote
 * it.
 */

export type ConsultationCorrection = "no_show" | "reopen";

/** The stages a consultation belongs to. Past them, its notes are history. */
const CONSULTATION_STAGES = ["LEAD", "CONSULTATION"];

export function consultationCorrectionRefusal(input: {
  move: ConsultationCorrection;
  status: string;
  startsAt: string;
  now: string;
  projectState: string;
}): string | null {
  if (input.move === "no_show") {
    if (input.status !== "scheduled") return "CONSULTATION_NOT_MARKABLE";
    // Nobody can have missed a call that hasn't started.
    const starts = Date.parse(input.startsAt);
    if (Number.isFinite(starts) && starts > Date.parse(input.now)) return "CONSULTATION_NOT_STARTED";
    return null;
  }
  if (!["completed", "no_show"].includes(input.status)) return "CONSULTATION_NOT_REOPENABLE";
  // completeConsultation only records notes at CONSULTATION, and a job that
  // has moved to its proposal is past the point these notes decide anything.
  if (!CONSULTATION_STAGES.includes(input.projectState)) return "PROJECT_PAST_CONSULTATION";
  return null;
}

/**
 * Reopened, a consultation is `scheduled` again either way. One still to come
 * is simply on; one in the past is waiting for its notes, which is how the
 * booking workspace already reads a past `scheduled` consultation.
 */
export function reopenedConsultationNeedsNotes(startsAt: string, now: string): boolean {
  const starts = Date.parse(startsAt);
  return !Number.isFinite(starts) || starts <= Date.parse(now);
}
