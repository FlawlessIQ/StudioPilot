/**
 * When a questionnaire is due, worked out as it is sent.
 *
 * A template says how many days before the event its form is due, and that
 * is the answer whenever the job has a date. A job that does not have one
 * yet — an inquiry the studio wants to send its event form to before the
 * consultation — used to fail the whole send: the due date was built from
 * `${eventDate}T12:00:00.000Z`, which for a missing date is an Invalid Date,
 * and `toISOString()` threw "Invalid time value" at the studio.
 *
 * Without a date the form is due a week after it is sent. A concrete date
 * rather than none, so the couple's portal still says when it is wanted and
 * the reminder scheduler (questionnaire-reminders.ts) still has something to
 * count back from. A date that arrives later does not move it; a booking
 * change that moves the wedding shifts it like any other due date
 * (booking/amendment-apply.ts).
 *
 * Pure, so tests/questionnaire-before-booking.test.ts can hold it.
 */

export const QUESTIONNAIRE_DUE_DAYS_WITHOUT_EVENT_DATE = 7;

const isoDay = /^(\d{4})-(\d{2})-(\d{2})/;

/** A real calendar day as YYYY-MM-DD, or null. "2026-02-30" is not one. */
export function calendarDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = isoDay.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  const normalised = date.toISOString().slice(0, 10);
  // Date rolls 2026-02-30 over to March; a day that does not survive the
  // round trip was never a day.
  return normalised === `${year}-${month}-${day}` ? normalised : null;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type QuestionnaireDue = {
  dueDate: string;
  /** What the date was counted from, so the studio can be told. */
  countedFrom: "event_date" | "sent_date";
};

export function questionnaireDueDate(input: {
  eventDate: unknown;
  dueDaysBeforeEvent: unknown;
  /** The day it is sent, YYYY-MM-DD (or a full ISO timestamp). */
  today: string;
}): QuestionnaireDue {
  const eventDay = calendarDay(input.eventDate);
  if (eventDay) {
    const before = Number(input.dueDaysBeforeEvent ?? 0);
    const days = Number.isFinite(before) && before > 0 ? Math.floor(before) : 0;
    return { dueDate: addDays(eventDay, -days), countedFrom: "event_date" };
  }
  const today =
    calendarDay(input.today) ?? new Date().toISOString().slice(0, 10);
  return {
    dueDate: addDays(today, QUESTIONNAIRE_DUE_DAYS_WITHOUT_EVENT_DATE),
    countedFrom: "sent_date",
  };
}
