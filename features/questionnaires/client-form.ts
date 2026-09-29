/**
 * The couple's questionnaire, as data: which sections and questions they see.
 *
 * Pure, so the one-section-per-screen form and its tests agree on what is
 * visible. Visibility decides what is *shown*, never what is *saved*: a save
 * carries every answer the response holds (see
 * functions/src/planning/questionnaire-answers.ts for why that matters).
 */

export type QuestionnaireField = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  locked: boolean;
  internalOnly: boolean;
  options: string[];
  conditionalOn: { fieldId: string; equals: unknown } | null;
};
export type QuestionnaireSection = {
  id: string;
  title: string;
  fields: QuestionnaireField[];
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const field = (
  id: string,
  label: string,
  type: string,
  required: boolean,
): QuestionnaireField => ({
  id,
  label,
  type,
  required,
  locked: false,
  internalOnly: false,
  options: [],
  conditionalOn: null,
});

/** Responses assigned before templates carried a snapshot. */
export const legacyQuestionnaireSections: QuestionnaireSection[] = [
  {
    id: "planning",
    title: "Project details",
    fields: [
      field("planner", "Planner", "contact", false),
      field("ceremonyTime", "Ceremony time", "time", true),
      field("familyPhotoList", "Family photo list", "long_text", true),
      field("accessibilityNeeds", "Accessibility needs", "long_text", false),
    ],
  },
];

export function parseQuestionnaireSections(value: unknown): QuestionnaireSection[] {
  if (!Array.isArray(value)) return legacyQuestionnaireSections;
  return value.flatMap((sectionValue, sectionIndex) => {
    const section = record(sectionValue);
    if (!Array.isArray(section.fields)) return [];
    return [
      {
        id: String(section.id ?? `section-${sectionIndex}`),
        title: String(section.title ?? "Project details"),
        fields: section.fields.map((fieldValue) => {
          const item = record(fieldValue);
          const condition = record(item.conditionalOn);
          return {
            id: String(item.id),
            label: String(item.label),
            type: String(item.type ?? "text"),
            required: item.required === true,
            locked: item.locked === true,
            internalOnly: item.internalOnly === true,
            options: Array.isArray(item.options) ? item.options.map(String) : [],
            conditionalOn: item.conditionalOn
              ? { fieldId: String(condition.fieldId), equals: condition.equals }
              : null,
          };
        }),
      },
    ];
  });
}

/**
 * What the couple sees: no internal-only questions, conditional ones only
 * when their condition holds, and no section left empty by either.
 */
export function visibleQuestionnaireSections(
  sections: readonly QuestionnaireSection[],
  answers: Record<string, unknown>,
): QuestionnaireSection[] {
  return sections
    .map((section) => ({
      ...section,
      fields: section.fields.filter(
        (item) =>
          !item.internalOnly &&
          (!item.conditionalOn ||
            JSON.stringify(answers[item.conditionalOn.fieldId]) ===
              JSON.stringify(item.conditionalOn.equals)),
      ),
    }))
    .filter((section) => section.fields.length > 0);
}
