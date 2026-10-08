/**
 * What a call in `consultations` is for.
 *
 * Every record there used to be the sales consultation: the call before the
 * proposal. The final details call (Gabe, Chuck and Albert, GR 2026-10-08:
 * "after the schedule is set 1 month out a zoom/phone call should be part of
 * the journey… the client and studio go over any final details and make
 * changes to the final schedule") is booked the same way and lives beside it,
 * so it shares the calendar, busy times, meeting links and emails. Everything
 * that means "the sales consultation" — the prep note, the brief and proposal
 * draft, the journey's consultation step, Log a call, the funnel — reads only
 * `isSalesConsultation`. Mirrored at functions/src/booking/consultation-purpose.ts (and back).
 */

export const FINAL_DETAILS_PURPOSE = "final_details";

/**
 * A makeup or hair trial (features/trades/trades.ts `trial`): a paid
 * appointment before the day, booked the same way, never a sales call.
 */
export const TRIAL_PURPOSE = "trial";

export type ConsultationPurpose = "consultation" | typeof FINAL_DETAILS_PURPOSE | typeof TRIAL_PURPOSE;

type Row = Record<string, unknown>;

export function consultationPurpose(record: Row | null | undefined): ConsultationPurpose {
  if (record?.purpose === FINAL_DETAILS_PURPOSE) return FINAL_DETAILS_PURPOSE;
  if (record?.purpose === TRIAL_PURPOSE) return TRIAL_PURPOSE;
  return "consultation";
}

/** The call before the proposal (every record from before purposes existed). */
export function isSalesConsultation(record: Row | null | undefined): boolean {
  return consultationPurpose(record) === "consultation";
}

export function isFinalDetailsCall(record: Row | null | undefined): boolean {
  return consultationPurpose(record) === FINAL_DETAILS_PURPOSE;
}

export function isTrial(record: Row | null | undefined): boolean {
  return consultationPurpose(record) === TRIAL_PURPOSE;
}
