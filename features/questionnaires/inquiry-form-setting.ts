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
      recommendedId: typeof (template as { recommendedId?: unknown }).recommendedId === "string"
        ? String((template as { recommendedId?: unknown }).recommendedId)
        : null,
    }))
    .sort((left, right) => Number(right.forWeddings) - Number(left.forWeddings) || left.name.localeCompare(right.name));
}

/**
 * What the picker opens on for a studio that hasn't chosen: their copy of the
 * recommended Event details form, else a wedding form that isn't the final
 * schedule or the shot list — both are for after booking. The first wedding
 * form by name was the old planning questionnaire on the production walk of
 * 2026-10-06, with the Event details copy sitting right under it.
 *
 * A vendor's own form (the music planner, the party list) is after booking
 * too: it is their client's one form, sent when they book. A DJ, makeup
 * artist or hair stylist with only that opens on "don't send a form".
 */
export function suggestedInquiryForm(
  choices: ReadonlyArray<{ id: string; name: string; forWeddings: boolean; recommendedId: string | null }>,
): string {
  const afterBooking = new Set(["wedding-final-schedule", "wedding-shot-list"]);
  const clientsOneForm = new Set(["dj-music-planner", "makeup-party-list", "hair-party-list"]);
  const offered = choices.filter((item) => !clientsOneForm.has(item.recommendedId ?? ""));
  return (
    offered.find((item) => item.recommendedId === "wedding-event-details")?.id ??
    offered.find(
      (item) =>
        item.forWeddings &&
        !afterBooking.has(item.recommendedId ?? "") &&
        !/\b(planning|final schedule|shot list)\b/i.test(item.name),
    )?.id ??
    offered.find((item) => item.forWeddings)?.id ??
    ""
  );
}
