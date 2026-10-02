import type { Firestore } from "firebase-admin/firestore";
import { coupleRoleChoices, loadJobFactSheet, prefillFromFacts, type CoupleRoleChoices } from "./job-facts.js";
import { templateFactMap } from "./questionnaire-fact-map.js";

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};

/** Statuses a couple can still fill in: blanks there may be filled for them. */
export const PREFILLABLE_STATUSES = ["not_started", "in_progress", "reopened"];

/** Fields somebody has already answered or cleared (the response's changeHistory). */
export function touchedFields(changeHistory: unknown): Set<string> {
  return new Set(
    (Array.isArray(changeHistory) ? changeHistory : [])
      .map((entry) => String(record(entry).fieldId ?? ""))
      .filter(Boolean),
  );
}

/**
 * A form's answers from what the job knows (job-facts.ts): the fact sheet,
 * the form version's AI map when the caller may make one, and only the
 * blanks nobody has touched.
 */
export async function jobPrefill(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string | null;
    project?: Row | null;
    leadId?: string | null;
    lead?: Row | null;
    templateId: string | null;
    templateVersion: unknown;
    sections: unknown;
    existing?: Record<string, unknown> | null;
    changeHistory?: unknown;
    excludeResponseId?: string | null;
    /** Only the studio sending a form may spend AI on reading it. */
    allowAi: boolean;
    actorId?: string | null;
  },
) {
  const [sheet, factMap] = await Promise.all([
    loadJobFactSheet(db, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      project: input.project,
      leadId: input.leadId,
      lead: input.lead,
      excludeResponseId: input.excludeResponseId,
    }),
    templateFactMap(db, {
      tenantId: input.tenantId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      sections: input.sections,
      allowAi: input.allowAi,
      actorId: input.actorId,
    }).catch(() => ({})),
  ]);
  const touched = touchedFields(input.changeHistory);
  const prefill = prefillFromFacts({
    sheet,
    sections: input.sections,
    factMap,
    existing: input.existing,
    touched,
  });
  // "I'm the bride / I'm the groom": what's still blank after the prefill.
  const roleChoices = coupleRoleChoices({
    sheet,
    sections: input.sections,
    existing: { ...(input.existing ?? {}), ...prefill.answers },
    touched,
  });
  return { ...prefill, roleChoices };
}

/**
 * Fill a sent form's blanks from what the job knows now — a venue added since,
 * a run of show built since. Writes only when something new fits; never a
 * submitted form, never a field anybody touched. Returns how many it filled.
 */
export async function refreshResponsePrefill(
  db: Firestore,
  input: { tenantId: string; responseId: string; projectId: string; allowAi: boolean; actorId?: string | null },
): Promise<number> {
  return (await refreshResponsePrefillWithChoices(db, input)).filled;
}

/** The same, and what "I'm the bride / I'm the groom" would fill now. */
export async function refreshResponsePrefillWithChoices(
  db: Firestore,
  input: { tenantId: string; responseId: string; projectId: string; allowAi: boolean; actorId?: string | null },
): Promise<{ filled: number; roleChoices: CoupleRoleChoices | null }> {
  const reference = db.doc(`questionnaireResponses/${input.responseId}`);
  const response = await reference.get();
  const data = response.data() ?? {};
  if (!response.exists || data.tenantId !== input.tenantId || data.projectId !== input.projectId) throw new Error("RESPONSE_NOT_FOUND");
  if (data.archivedAt || !PREFILLABLE_STATUSES.includes(String(data.status ?? "not_started"))) return { filled: 0, roleChoices: null };
  const prefill = await jobPrefill(db, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    templateId: typeof data.templateId === "string" ? data.templateId : null,
    templateVersion: data.templateVersion,
    sections: record(data.templateSnapshot).sections,
    existing: record(data.answers),
    changeHistory: data.changeHistory,
    excludeResponseId: input.responseId,
    allowAi: input.allowAi,
    actorId: input.actorId,
  });
  const filled = Object.keys(prefill.answers);
  if (!filled.length) return { filled: 0, roleChoices: prefill.roleChoices };
  await db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(reference);
    const current = fresh.data() ?? {};
    if (!PREFILLABLE_STATUSES.includes(String(current.status ?? "not_started"))) return;
    const answers = record(current.answers);
    const touched = touchedFields(current.changeHistory);
    // Only what is still blank and untouched now: the couple may have typed since.
    const still = filled.filter((fieldId) => (answers[fieldId] === undefined || answers[fieldId] === "" || answers[fieldId] === null) && !touched.has(fieldId));
    if (!still.length) return;
    transaction.update(reference, {
      answers: { ...answers, ...Object.fromEntries(still.map((fieldId) => [fieldId, prefill.answers[fieldId]])) },
      answerProvenance: {
        ...record(current.answerProvenance),
        ...Object.fromEntries(still.map((fieldId) => [fieldId, prefill.answerProvenance[fieldId]])),
      },
      updatedAt: new Date().toISOString(),
    });
  });
  return { filled: filled.length, roleChoices: prefill.roleChoices };
}
