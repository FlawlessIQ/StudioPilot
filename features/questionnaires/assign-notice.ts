/**
 * What the studio is told after sending a questionnaire.
 *
 * Both assign surfaces (the quick-send button and the picker in
 * components/planning/) said the due date "was calculated from the project
 * date" and that the couple could "fill it in from their portal". Neither is
 * true for an inquiry: it may have no date yet (the form is then due a week
 * after it goes out — functions/src/planning/questionnaire-due.ts), and the
 * couple has no portal until they accept the invitation the email now carries
 * (functions/src/planning/questionnaire-link.ts). The command's result says
 * which happened; this turns it into a sentence.
 */

export type AssignResult = {
  resent?: unknown;
  invited?: unknown;
  dueDate?: unknown;
  dueCountedFrom?: unknown;
};

function day(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function questionnaireAssignNotice(result: AssignResult): string {
  const invited = result.invited === true;
  if (result.resent === true)
    return invited
      ? "They already have this questionnaire, so they were emailed a reminder about it instead of a second copy — with an invitation to their portal, since they haven't opened it yet."
      : "They already have this questionnaire, so they were emailed a reminder about it instead of a second copy.";
  const due = day(result.dueDate);
  const when =
    result.dueCountedFrom === "sent_date"
      ? `There's no date on the job yet, so it's due a week from today${due ? ` (${due})` : ""}.`
      : result.dueCountedFrom === "soonest"
        ? `Counted back from the event date it would already be due, so it's due ${due ?? "a week from today"}.`
        : due
          ? `It's due ${due}, counted back from the event date.`
          : "Its due date was counted back from the event date.";
  const where = invited
    ? "The email carries an invitation to their portal, where they fill it in."
    : "They fill it in from their portal.";
  return `Questionnaire sent. ${when} ${where}`;
}
