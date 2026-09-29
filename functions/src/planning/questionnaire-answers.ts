/**
 * What a questionnaire save is allowed to change.
 *
 * A save used to replace the whole `answers` map with whatever the browser
 * sent, and the couple's form sent only the fields it was showing. So every
 * autosave deleted the studio's internal-only answers, and any answer behind
 * a condition the couple had since flipped. A save now merges: it can change
 * a field, never remove one it did not mention.
 *
 * A client may not write a field the studio marked internal-only or locked
 * (the form never offers them; this is the server saying so), and may not
 * touch a response once it is submitted: the studio reopens it by messaging.
 * Before this, the autosave that fired after Submit quietly set the status
 * back to in progress.
 */
export type QuestionnaireFieldRule = { internalOnly: boolean; locked: boolean };

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** internalOnly/locked per field id, read from a response's templateSnapshot. */
export function questionnaireFieldRules(
  templateSnapshot: unknown,
): Map<string, QuestionnaireFieldRule> {
  const rules = new Map<string, QuestionnaireFieldRule>();
  const sections = record(templateSnapshot).sections;
  for (const section of Array.isArray(sections) ? sections : []) {
    const fields = record(section).fields;
    for (const candidate of Array.isArray(fields) ? fields : []) {
      const field = record(candidate);
      const id = typeof field.id === "string" ? field.id : "";
      if (!id) continue;
      rules.set(id, {
        internalOnly: field.internalOnly === true,
        locked: field.locked === true,
      });
    }
  }
  return rules;
}

export function mergeQuestionnaireAnswers(input: {
  prior: Record<string, unknown>;
  incoming: Record<string, unknown>;
  rules: Map<string, QuestionnaireFieldRule>;
  byClient: boolean;
}): Record<string, unknown> {
  const merged = { ...input.prior };
  for (const [fieldId, value] of Object.entries(input.incoming)) {
    const rule = input.rules.get(fieldId);
    if (input.byClient && (rule?.internalOnly || rule?.locked)) continue;
    merged[fieldId] = value;
  }
  return merged;
}
