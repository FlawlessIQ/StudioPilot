import { answerText } from "../planning/crew-brief.js";

/**
 * The couple's details-form answers as the rows a contract prints, in the
 * order the form asked them.
 *
 * Answers are stored as a map keyed by field id (`saveQuestionnaire`), and the
 * questions live on the response's `templateSnapshot.sections`. The contract
 * loader read `answers` as an array of {question, answer} rows, so it found
 * none on every real form and printed "[form.answers]" into the agreement —
 * the one place GR Productions said the answers had to be ("Studios need that
 * as part of their binding agreement", 2026-10-01).
 *
 * Studio-only notes and files stay out of a document the couple signs, and
 * an unanswered question is left out rather than printed blank. An older
 * array of {question, answer} rows is still read.
 */
export type ContractFormAnswer = { question: string; answer: string };

type FormField = {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  internalOnly?: unknown;
};

const LEFT_OUT = new Set(["file", "information"]);

export function contractFormAnswers(input: {
  sections: unknown;
  answers: unknown;
  limit?: number;
}): ContractFormAnswer[] {
  const limit = input.limit ?? 40;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  if (Array.isArray(input.answers)) {
    return input.answers
      .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : {}))
      .map((row) => ({
        question: text(row.question ?? row.label ?? row.prompt),
        answer: text(row.answer ?? row.value ?? row.response),
      }))
      .filter((row) => row.question && row.answer)
      .slice(0, limit);
  }
  const answers =
    input.answers && typeof input.answers === "object"
      ? (input.answers as Record<string, unknown>)
      : {};
  const rows: ContractFormAnswer[] = [];
  const sections = Array.isArray(input.sections) ? input.sections : [];
  for (const section of sections) {
    const fields = (section as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(fields)) continue;
    for (const raw of fields) {
      const field = (raw ?? {}) as FormField;
      const id = text(field.id);
      const type = text(field.type);
      if (!id || field.internalOnly === true || LEFT_OUT.has(type)) continue;
      const answer = answerText(type, answers[id]);
      const question = text(field.label) || id;
      if (!answer) continue;
      rows.push({ question, answer });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}
