/**
 * A consultation that is on, or that happened.
 *
 * Cancelling a consultation leaves its record (with `status: "cancelled"`),
 * and a couple moving theirs leaves the old one as `"rescheduled"`. Every
 * reader that asked "is there a consultation?" counted those too, so the
 * journey said "Meeting booked" about a call that had been called off, and
 * the booking workspace and "Log a call" picked up the newest record whatever
 * had become of it.
 */
export const LIVE_CONSULTATION_STATUSES: ReadonlySet<string> = new Set(["scheduled", "completed"]);

// Any record: the readers hold consultations as loose rows.
type ConsultationLike = Record<string, unknown>;

export function isLiveConsultation(consultation: ConsultationLike): boolean {
  return LIVE_CONSULTATION_STATUSES.has(String(consultation.status ?? "")) && !consultation.archivedAt;
}

/** The latest consultation that is on or happened, or null. */
export function currentConsultation<T extends ConsultationLike>(consultations: readonly T[]): T | null {
  return (
    consultations
      .filter(isLiveConsultation)
      .sort((left, right) => String(right.startsAt ?? "").localeCompare(String(left.startsAt ?? "")))[0] ?? null
  );
}

/**
 * The latest sales consultation that is on or happened, or null — never the
 * final details call a month out (features/consultations/purpose.ts).
 */
export function currentSalesConsultation<T extends ConsultationLike>(consultations: readonly T[]): T | null {
  // Never the final details call or a makeup or hair trial (purpose.ts).
  return currentConsultation(consultations.filter((consultation) => consultation.purpose !== "final_details" && consultation.purpose !== "trial"));
}
