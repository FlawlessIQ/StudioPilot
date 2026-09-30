import type { QuestionnaireField, QuestionnaireSection } from "@/features/questionnaires/client-form";

/**
 * What the studio can do with a couple's questionnaire, and how an edit saves.
 *
 * Display logic only: every one of these is refused by the server when it
 * does not apply (functions/src/planning/questionnaire-lifecycle.ts). It
 * exists so the studio is offered the right control rather than a refusal.
 */

export type StudioQuestionnaireAction = "edit" | "reopen" | "resend" | "withdraw";

const RETURNED = ["submitted", "locked"];

export function studioQuestionnaireActions(
  status: unknown,
  ownerOrAdmin: boolean,
): StudioQuestionnaireAction[] {
  const value = String(status ?? "");
  if (value === "withdrawn") return [];
  if (RETURNED.includes(value)) return ownerOrAdmin ? ["edit", "reopen"] : ["edit"];
  if (value === "reopened") return ["edit", "resend"];
  return ["resend", "withdraw"];
}

/**
 * How a studio edit is saved.
 *
 * `submit: true` on a form the couple sent back: it stays sent back, the
 * analysis and the crew brief are rebuilt from the corrected answers. Never
 * `submit: false` there — that is the save that used to reopen the form and
 * delete the crew brief. A reopened form is the couple's to send, so the
 * studio's change saves without sending it for them.
 */
export function studioSaveSubmits(status: unknown): boolean {
  return RETURNED.includes(String(status ?? ""));
}

/** Answer types the studio can correct in place. Files and people are not. */
const EDITABLE = new Set([
  "text",
  "long_text",
  "email",
  "phone",
  "date",
  "time",
  "address",
  "dropdown",
  "radio",
  "multi_select",
  "checkbox",
  "acknowledgement",
]);

export function studioEditableFields(sections: readonly QuestionnaireSection[]): QuestionnaireField[] {
  return sections.flatMap((section) => section.fields.filter((field) => EDITABLE.has(field.type)));
}

/**
 * The questionnaire that stands for the job, when a job has several.
 *
 * Readers took the first record on the job, so a withdrawn form could stand in
 * for the live one and the job read "form withdrawn" while the couple was
 * filling in its replacement. Withdrawn forms are out; one they sent back
 * wins. Mirrors functions/src/workflow/readiness-evidence-loader.ts.
 */
export function currentQuestionnaire<T extends object>(responses: readonly T[]): T | undefined {
  const field = (response: T, key: "status" | "archivedAt") => (response as Record<string, unknown>)[key];
  const live = responses.filter(
    (response) => !field(response, "archivedAt") && field(response, "status") !== "withdrawn",
  );
  return live.find((response) => RETURNED.includes(String(field(response, "status") ?? ""))) ?? live[0];
}

/** Only what changed, so the change history names what the studio touched. */
export function changedAnswers(
  prior: Record<string, unknown>,
  edited: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(edited).filter(
      ([fieldId, value]) => JSON.stringify(prior[fieldId] ?? null) !== JSON.stringify(value ?? null),
    ),
  );
}
