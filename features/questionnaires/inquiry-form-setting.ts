/**
 * The studio's "send this form with new wedding inquiries" choice, as the
 * Questionnaires page shows it.
 *
 * Display only. The server decides who gets the form and follows the same
 * chain (functions/src/intake/inquiry-form.ts, resolveInquiryFormTemplate);
 * functions/ can't be imported here, so the rule is mirrored and
 * tests/inquiry-event-form.test.ts holds the two to the same answers.
 */

type TemplateRow = {
  id: string;
  status?: unknown;
  name?: unknown;
  supersedesTemplateId?: unknown;
  archivedAt?: unknown;
};

/**
 * The template the setting points at, as it stands now.
 *
 * Editing a template makes a new version with a new id, so the saved id goes
 * stale on the first edit; the live version is found by following
 * `supersedesTemplateId` forward. Nothing active at the end means the form
 * was archived, and the setting is effectively off.
 */
export function currentInquiryFormTemplate<T extends TemplateRow>(
  templates: readonly T[],
  chosenId: string | null | undefined,
): T | null {
  if (!chosenId) return null;
  let current = templates.find((template) => template.id === chosenId) ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.status === "active" && !current.archivedAt) return current;
    seen.add(current.id);
    const from: string = current.id;
    current = templates.find((template) => String(template.supersedesTemplateId ?? "") === from) ?? null;
  }
  return null;
}

/** Active templates a studio could pick, wedding forms first. */
export function inquiryFormChoices<T extends TemplateRow & { eventTypeId?: unknown }>(templates: readonly T[]) {
  return templates
    .filter((template) => template.status === "active" && !template.archivedAt)
    .map((template) => ({
      id: template.id,
      name: String(template.name ?? "Untitled questionnaire"),
      forWeddings: String(template.eventTypeId ?? "wedding") === "wedding",
    }))
    .sort((left, right) => Number(right.forWeddings) - Number(left.forWeddings) || left.name.localeCompare(right.name));
}
