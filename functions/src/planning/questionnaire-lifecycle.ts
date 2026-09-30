/**
 * Where a questionnaire response goes after each thing that can happen to it.
 *
 * Pure, so the rules are tested directly (tests/wave1-planning.test.ts) rather
 * than through the command handler.
 *
 * The statuses: `not_started` and `in_progress` belong to the couple;
 * `submitted` (and the older `locked`) means the studio has it and the crew
 * brief is built from it; `reopened` is a submitted form the studio has handed
 * back to the couple to change; `withdrawn` is a form the studio took back
 * before the couple sent it.
 *
 * Why `reopened` is its own status rather than `in_progress`: the crew brief
 * (crew-brief-trigger.ts) is deleted the moment a response stops being
 * submitted. Reopening must not strip the crew of the do-not-photograph list
 * three weeks before the wedding because the couple wanted to fix a typo; the
 * brief stays as it was until they send the form again.
 */

export const RETURNED_STATUSES: readonly string[] = ["submitted", "locked"];

export const isReturned = (status: unknown) =>
  RETURNED_STATUSES.includes(String(status));

/** The status a `saveQuestionnaire` leaves a response in. */
export function statusAfterSave(input: {
  prior: string;
  submit: boolean;
  byClient: boolean;
}): string {
  if (input.prior === "withdrawn") throw new Error("QUESTIONNAIRE_WITHDRAWN");
  if (input.submit) {
    // The studio correcting a locked form keeps it locked.
    return input.prior === "locked" && !input.byClient ? "locked" : "submitted";
  }
  /**
   * The studio saving a submitted form never reopens it.
   *
   * This used to write `in_progress` whenever `submit` was false, whoever
   * saved. A studio correcting one answer on a submitted form would have
   * silently handed the form back to the couple and deleted the crew brief.
   * Handing it back is `reopenQuestionnaire`, a deliberate act that tells them.
   */
  if (!input.byClient && isReturned(input.prior)) return input.prior;
  if (input.prior === "reopened") return "reopened";
  return "in_progress";
}

/**
 * When the response counts as sent back.
 *
 * A studio's correction to a form the couple sent on the 3rd must not make it
 * read "sent back on the 20th", so a studio save keeps the couple's date. A
 * reopened form keeps the date of the submission the crew brief still shows.
 */
export function submittedAtAfterSave(input: {
  nextStatus: string;
  priorSubmittedAt: unknown;
  byClient: boolean;
  now: string;
}): string | null {
  const prior =
    typeof input.priorSubmittedAt === "string" && input.priorSubmittedAt
      ? input.priorSubmittedAt
      : null;
  if (isReturned(input.nextStatus)) return input.byClient ? input.now : (prior ?? input.now);
  if (input.nextStatus === "reopened") return prior;
  return null;
}

/** Hand a sent-back form to the couple again. */
export function assertReopenable(status: unknown) {
  if (String(status) === "reopened") throw new Error("QUESTIONNAIRE_ALREADY_REOPENED");
  if (!isReturned(status)) throw new Error("QUESTIONNAIRE_NOT_RETURNED");
}

/**
 * Take back a form the couple has not sent.
 *
 * Only one they have not answered in full: a form that was submitted, even
 * one reopened since, holds answers the crew brief and the timeline were
 * built from, and withdrawing it would take those with it.
 */
export function assertWithdrawable(status: unknown) {
  if (!["not_started", "in_progress"].includes(String(status)))
    throw new Error("QUESTIONNAIRE_NOT_WITHDRAWABLE");
}

/** Remind the couple about a form that is theirs to fill in. */
export function assertResendable(status: unknown) {
  if (String(status) === "withdrawn") throw new Error("QUESTIONNAIRE_WITHDRAWN");
  if (isReturned(status)) throw new Error("QUESTIONNAIRE_ALREADY_RETURNED");
}

type ResponseLike = {
  id: string;
  status?: unknown;
  archivedAt?: unknown;
  templateId?: unknown;
  templateName?: unknown;
};

/**
 * The response already on this job for the form being sent, if any.
 *
 * "Send the form" pressed twice — or pressed from Cue after the job page — made
 * a second response and a second email, and the couple had two copies of the
 * same questionnaire to fill in. The same form is matched by template id or by
 * name, because editing a template makes a new version with a new id.
 */
export function liveAssignmentFor(
  responses: readonly ResponseLike[],
  template: { id: string; name: string },
): ResponseLike | null {
  return (
    responses.find(
      (response) =>
        !response.archivedAt &&
        String(response.status) !== "withdrawn" &&
        (response.templateId === template.id ||
          (typeof response.templateName === "string" &&
            response.templateName === template.name)),
    ) ?? null
  );
}
