/**
 * A couple's answers to the studio's own inquiry-form questions, as stored on
 * the lead (`customAnswers`, written by publicLeadIntake with each question's
 * wording at the time). Tolerant of anything malformed: a bad row is skipped.
 */
export type LeadAnswer = { question: string; answer: string };

export function leadAnswers(lead: object | null | undefined): LeadAnswer[] {
  const rows = (lead as { customAnswers?: unknown } | null | undefined)?.customAnswers;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    if (typeof row !== "object" || row === null) return [];
    const { question, answer } = row as { question?: unknown; answer?: unknown };
    return typeof question === "string" && question.trim() && typeof answer === "string" && answer.trim()
      ? [{ question: question.trim(), answer: answer.trim() }]
      : [];
  });
}
