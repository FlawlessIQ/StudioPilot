/**
 * When a couple's planning starts, and when their details lock.
 *
 * GR Productions (2026-10-02): couples get nervous — send the planning form
 * and timeline six months before, or let each studio pick; lock the final
 * details four weeks before; schedule changes cost nothing. Before this the
 * form went out whenever someone pressed "Send the form" (Today offered it
 * from the day of booking), and nothing ever locked.
 *
 * Stored at `tenants/{id}.planningTimeline`. Pure; duplicated at
 * functions/src/planning/planning-timeline.ts — the test fails on drift.
 */

export type PlanningFormSend = "remind" | "auto";

export type PlanningTimeline = {
  /** How many months before the date the planning form goes out (1–12). */
  formMonthsBefore: number;
  /** "remind": Today offers "Send the form" from then. "auto": StudioCue sends it. */
  formSend: PlanningFormSend;
  /** Which form goes out — the studio's planning questionnaire. Null: the newest for the event type. */
  formTemplateId: string | null;
  /** How many days before the date the final details lock (7–90). */
  lockDaysBefore: number;
  /**
   * Also send the form the moment the booking is confirmed (GR, 2026-10-05:
   * "sent after contract signed, and then again 6 months out").
   */
  formAtBooking: boolean;
  /**
   * At the form date, a couple who already filled it in is asked to review
   * and update the same answers rather than sent a second copy.
   */
  reviewAtFormDate: boolean;
  /**
   * The shot list, sent with the planning form and due when the details lock
   * (GR, 2026-10-05: "its own form", 4 weeks out, crew must have it). Null:
   * none is sent.
   */
  shotListTemplateId: string | null;
};

export const DEFAULT_PLANNING_TIMELINE: PlanningTimeline = {
  formMonthsBefore: 6,
  formSend: "remind",
  formTemplateId: null,
  lockDaysBefore: 28,
  formAtBooking: false,
  reviewAtFormDate: false,
  shotListTemplateId: null,
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function resolvePlanningTimeline(raw: unknown): PlanningTimeline {
  const value = record(raw);
  const months = Number(value.formMonthsBefore);
  const lock = Number(value.lockDaysBefore);
  return {
    formMonthsBefore: Number.isInteger(months) && months >= 1 && months <= 12 ? months : DEFAULT_PLANNING_TIMELINE.formMonthsBefore,
    formSend: value.formSend === "auto" ? "auto" : "remind",
    formTemplateId: typeof value.formTemplateId === "string" && value.formTemplateId.trim() ? value.formTemplateId.trim() : null,
    lockDaysBefore: Number.isInteger(lock) && lock >= 7 && lock <= 90 ? lock : DEFAULT_PLANNING_TIMELINE.lockDaysBefore,
    formAtBooking: value.formAtBooking === true,
    reviewAtFormDate: value.reviewAtFormDate === true,
    shotListTemplateId:
      typeof value.shotListTemplateId === "string" && value.shotListTemplateId.trim() ? value.shotListTemplateId.trim() : null,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The day the planning form goes out: `formMonthsBefore` calendar months before. Null for an undated job. */
export function planningFormOpensOn(eventDate: string | null | undefined, timeline: PlanningTimeline): string | null {
  const date = String(eventDate ?? "").slice(0, 10);
  if (!ISO.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 - timeline.formMonthsBefore, 1));
  // The same day of the month, or its last day (31 August → 28 February).
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** The day the final details lock. Null for an undated job. */
export function detailsLockOn(eventDate: string | null | undefined, timeline: PlanningTimeline): string | null {
  const date = String(eventDate ?? "").slice(0, 10);
  if (!ISO.test(date)) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return new Date(parsed - timeline.lockDaysBefore * 86_400_000).toISOString().slice(0, 10);
}

/** Locked from the lock day through the wedding itself. */
export function detailsLocked(eventDate: string | null | undefined, today: string, timeline: PlanningTimeline): boolean {
  const lockOn = detailsLockOn(eventDate, timeline);
  return Boolean(lockOn && today >= lockOn);
}
