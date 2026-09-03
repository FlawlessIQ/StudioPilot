/**
 * Which required questions a couple still owes, from their answers.
 *
 * The questionnaire told a couple, after submitting: "The ones marked required
 * are the ones your studio is still missing." But `required` is a static
 * template attribute — the badge marks a field that *must* be answered, not
 * one that *has not* been. Ceremony time was marked REQUIRED and already read
 * 16:30; only the family photo list was actually empty. She was pointed at two
 * fields, one already filled, and could edit neither, because everything is
 * disabled once submitted.
 *
 * Pure, so the form and its notice derive "still needed" from the same rule
 * and cannot disagree — the class that gave readiness three percentages.
 */

export type RequiredField = {
  id: string;
  label: string;
  required: boolean;
};

/** The one definition of "answered", shared by completion and by the badge. */
export function answerIsPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return String(value ?? "").trim().length > 0;
}

/** Required fields with nothing in them, in template order. */
export function outstandingRequired<T extends RequiredField>(
  fields: readonly T[],
  answers: Record<string, unknown>,
): T[] {
  return fields.filter(
    (field) => field.required && !answerIsPresent(answers[field.id]),
  );
}

/**
 * The sentence under a submitted-but-incomplete form.
 *
 * Names what is missing instead of pointing at a badge that means something
 * else. Three or fewer are listed; more than that and "the highlighted
 * questions" reads better than a list nobody finishes.
 */
export function outstandingNotice(labels: readonly string[]): string {
  if (!labels.length) return "Submitted. Message your studio if an answer needs to be reopened.";
  const named =
    labels.length > 3
      ? "the questions marked still needed"
      : labels.length === 1
        ? labels[0]!
        : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `Submitted — your studio is still missing ${named}. Message them to reopen the form and add it.`;
}
