/**
 * What makes a questionnaire template hold together once a studio can move
 * questions around.
 *
 * Two kinds of link run between questions: "show only when" (`conditionalOn`,
 * features/questionnaires/client-form.ts) and a suggested time
 * (`suggestedFrom`, field-extras.ts). Both read an answer the couple has
 * already given, so both must point at a question that comes earlier in the
 * form — and a suggested time only runs from a time to a time. Moving or
 * deleting a question can break either; the editor repairs (clears) what
 * broke and says so, and the server refuses a template that still breaks them
 * (planning commands, createQuestionnaireTemplate / updateQuestionnaireTemplate).
 *
 * Pure. Duplicated at functions/src/planning/template-rules.ts; the test fails
 * on drift.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type TemplateLinkProblem = {
  fieldId: string;
  kind: "duplicate" | "condition" | "suggestion";
};

/** Every question, in the order the couple meets them. */
function questionsInOrder(sections: unknown): Row[] {
  return list(sections).flatMap((section) => list(record(section).fields).map(record));
}

/** Pure: what's wrong with a template's links, in form order. Empty when it holds. */
export function templateLinkProblems(sections: unknown): TemplateLinkProblem[] {
  const problems: TemplateLinkProblem[] = [];
  const seen = new Map<string, string>();
  for (const field of questionsInOrder(sections)) {
    const fieldId = text(field.id);
    if (!fieldId || seen.has(fieldId)) {
      problems.push({ fieldId, kind: "duplicate" });
      continue;
    }
    const condition = record(field.conditionalOn);
    if (field.conditionalOn && !seen.has(text(condition.fieldId))) problems.push({ fieldId, kind: "condition" });
    if (field.suggestedFrom !== undefined && field.suggestedFrom !== null) {
      const from = record(field.suggestedFrom);
      const minutes = Number(from.minutes);
      const fine =
        text(field.type) === "time" &&
        seen.get(text(from.fieldId)) === "time" &&
        Number.isInteger(minutes) &&
        Math.abs(minutes) <= 720;
      if (!fine) problems.push({ fieldId, kind: "suggestion" });
    }
    seen.set(fieldId, text(field.type));
  }
  return problems;
}

type Linkable = {
  id: string;
  type: string;
  conditionalOn?: { fieldId: string; equals: unknown } | null;
  suggestedFrom?: { fieldId: string; minutes: number } | null;
};

/**
 * Pure: the template with every broken link cleared, and which were. A
 * condition goes back to "always show"; a suggestion goes. Duplicate ids are
 * left to the caller, which mints them.
 */
export function repairTemplateLinks<F extends Linkable, S extends { fields: F[] }>(
  sections: readonly S[],
): { sections: S[]; cleared: TemplateLinkProblem[] } {
  const broken = templateLinkProblems(sections).filter((problem) => problem.kind !== "duplicate");
  if (!broken.length) return { sections: [...sections], cleared: [] };
  const condition = new Set(broken.filter((problem) => problem.kind === "condition").map((problem) => problem.fieldId));
  const suggestion = new Set(broken.filter((problem) => problem.kind === "suggestion").map((problem) => problem.fieldId));
  return {
    sections: sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (!condition.has(field.id) && !suggestion.has(field.id)) return field;
        const next = { ...field };
        if (condition.has(field.id)) next.conditionalOn = null;
        if (suggestion.has(field.id)) delete next.suggestedFrom;
        return next;
      }),
    })),
    cleared: broken,
  };
}
