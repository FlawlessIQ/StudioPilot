/**
 * Which questionnaire reminder is due today, if any.
 *
 * Every questionnaire template stores the days before its due date on which to
 * remind the client — the starter briefs say 14 and 3, or 7 and 2 — and nothing
 * ever sent one. The couple got the first request and then silence, and the
 * form a studio needs three weeks before the wedding arrived late or not at
 * all.
 *
 * The rules are about not nagging:
 * - Nothing for a form already submitted, or past its due date.
 * - At most one reminder a run, and only the most recent one due. A form
 *   assigned late, or a scheduler that missed days, sends the latest reminder
 *   rather than every one it skipped.
 * - Never a reminder the client couldn't have needed yet: a reminder point that
 *   fell on or before the day the form was sent is skipped, so assigning a
 *   form two days before its due date doesn't follow the request with a
 *   "reminder" the same afternoon.
 *
 * Pure. Duplicated at functions/src/planning/questionnaire-reminders.ts;
 * tests/questionnaire-reminders.test.ts keeps the copies equal.
 */

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function daysBefore(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function questionnaireReminderDue(input: {
  status: string;
  dueDate: string | null;
  /** The template's reminder days, e.g. [14, 3]. */
  reminderDaysBeforeDue: readonly number[];
  /** Offsets already sent for this response. */
  sentOffsets: readonly number[];
  /** YYYY-MM-DD the form was sent to the client. */
  assignedOn: string;
  today: string;
}): number | null {
  if (!["not_started", "in_progress"].includes(input.status)) return null;
  if (!input.dueDate || !isoDay.test(input.dueDate)) return null;
  if (input.today > input.dueDate) return null;
  const offsets = [...new Set(input.reminderDaysBeforeDue)]
    .filter((days) => Number.isInteger(days) && days >= 0)
    .map((days) => ({ days, on: daysBefore(input.dueDate!, days) }))
    // Only reminder points after the form went out, and already reached.
    .filter((offset) => offset.on > input.assignedOn && offset.on <= input.today)
    .sort((left, right) => left.days - right.days);
  const latest = offsets[0];
  if (!latest) return null;
  // Anything at or after this point was already covered by a later reminder.
  if (input.sentOffsets.some((sent) => sent <= latest.days)) return null;
  return latest.days;
}
