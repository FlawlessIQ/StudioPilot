import { displayableScheduleItems } from "../schedules/item-clock.ts";

/**
 * Does the record behind a checkpoint actually contain anything?
 *
 * The audit of 2026-08-26 found the same defect five times: a status field said
 * a step was done, the payload it referred to was empty or unreadable, and every
 * summary surface reported health.
 *
 *   schedules.status "approved"        items were `{time,label}`   → "Run of show ✓"
 *   no schedule at all                 —                          → "Coverage plan complete"
 *   questionnaire "submitted"          answers `{}`               → "Wedding details form ✓"
 *   schedules list "Items 6"           24 em-dashes rendered      → all green
 *   crewAssignment "accepted"          no schedule version        → "Ready"
 *
 * A wedding three days out reported 100% readiness with no run of show, no crew
 * brief and an empty questionnaire. Nobody caught it by clicking around, because
 * the screens that summarise are the screens that were wrong.
 *
 * So completion needs two things: a settled status *and* a payload worth having.
 * These predicates are the second half. Pure, no I/O.
 */

const SETTLED_SCHEDULE = ["approved", "published"];
const SUBMITTED_QUESTIONNAIRE = ["submitted", "locked"];

/**
 * A run of show is usable when it is settled **and** at least one item can
 * actually be shown to someone. An approved schedule whose items no reader
 * understands is not a plan; it is a record that a plan was expected.
 */
export function scheduleIsUsable(input: {
  status: string | null | undefined;
  items: readonly Record<string, unknown>[] | null | undefined;
}): boolean {
  if (!SETTLED_SCHEDULE.includes(String(input.status ?? ""))) return false;
  return displayableScheduleItems(input.items ?? []).length > 0;
}

/**
 * A schedule that claims to be settled while holding nothing displayable. This
 * is the state that must never read as complete *or* as "not started" — the
 * studio believes it did the work, so it needs telling that the work is empty.
 */
export function scheduleIsEmptyButSettled(input: {
  status: string | null | undefined;
  items: readonly Record<string, unknown>[] | null | undefined;
}): boolean {
  return (
    SETTLED_SCHEDULE.includes(String(input.status ?? "")) &&
    displayableScheduleItems(input.items ?? []).length === 0
  );
}

/** Are there any real answers on this questionnaire response? */
export function questionnaireHasAnswers(
  answers: unknown,
): boolean {
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

/**
 * A details form is answered when it is submitted **and** carries answers. A
 * submitted response with `answers: {}` is what the production data actually
 * held, while the journey ticked the step and the client portal showed
 * "0% complete" beside "Submitted to your studio".
 */
export function questionnaireIsAnswered(input: {
  status: string | null | undefined;
  answers: unknown;
}): boolean {
  return (
    SUBMITTED_QUESTIONNAIRE.includes(String(input.status ?? "")) &&
    questionnaireHasAnswers(input.answers)
  );
}

/** Submitted, but with nothing in it — an error state worth naming. */
export function questionnaireIsEmptyButSubmitted(input: {
  status: string | null | undefined;
  answers: unknown;
}): boolean {
  return (
    SUBMITTED_QUESTIONNAIRE.includes(String(input.status ?? "")) &&
    !questionnaireHasAnswers(input.answers)
  );
}
