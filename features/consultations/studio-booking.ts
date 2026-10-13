import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { CONSULTATION_PURPOSES, type ConsultationPurpose } from "@/features/consultations/purpose";

/**
 * Which call the studio is booking from its calendar (Conor, 2026-10-13).
 *
 * The journey's call steps (the consultation, the final details call, a
 * trial, a planner's walkthrough) all open the calendar. It used to book every
 * one of them as a sales consultation, so a final details call booked by the
 * studio never ticked its own step, and the page said "Scheduling a
 * consultation" for a wedding booked months ago. Each step's link now says
 * which call (`?call=`), the page names it, and the booking carries it.
 *
 * Pure: the calendar, the journey and the tests read it.
 */

export type BookableCall = { purpose: ConsultationPurpose; label: string };

/** The calls this trade's studio books, in the order a job meets them. */
export function bookableCalls(trade: unknown): BookableCall[] {
  const profile = tradeProfile(trade);
  const words = tradeVocab(trade);
  const calls: BookableCall[] = [];
  if (profile.consultation) calls.push({ purpose: "consultation", label: words.consultation });
  if (words.trial) calls.push({ purpose: "trial", label: words.trial });
  if (profile.journey.walkthrough) calls.push({ purpose: "walkthrough", label: "Venue walkthrough" });
  // Priced per person, the lock asks for a headcount instead of a call.
  if (!profile.perPersonPricing) calls.push({ purpose: "final_details", label: words.finalCall });
  return calls;
}

const BOOKED = ["RETAINER_PENDING", "BOOKED", "PLANNING", "READY"];

/**
 * The call a visit to the calendar is booking: the one its link named, else
 * the job's likely next call. A job still being sold is on its consultation;
 * a booked one is past it, so it's on its trial (makeup, hair), or its final
 * details call.
 */
export function callForJob(input: { param: string | null | undefined; projectState: unknown; trade: unknown }): BookableCall {
  const calls = bookableCalls(input.trade);
  const named = calls.find((call) => call.purpose === input.param);
  if (named) return named;
  const booked = BOOKED.includes(String(input.projectState ?? ""));
  const pick = (purpose: ConsultationPurpose) => calls.find((call) => call.purpose === purpose);
  const fallback = calls[0] ?? { purpose: "consultation" as const, label: tradeVocab(input.trade).consultation };
  if (!booked) return pick("consultation") ?? fallback;
  return pick("trial") ?? pick("final_details") ?? pick("walkthrough") ?? fallback;
}

export function isConsultationPurpose(value: unknown): value is ConsultationPurpose {
  return (CONSULTATION_PURPOSES as readonly unknown[]).includes(value);
}

/** The calendar, opened to book this call for this job. */
export function bookCallHref(projectId: string, purpose: ConsultationPurpose): string {
  return `/studio/calendar?project=${encodeURIComponent(projectId)}&call=${purpose}`;
}
