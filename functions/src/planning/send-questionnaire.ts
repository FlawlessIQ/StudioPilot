import { createHash } from "node:crypto";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { questionnaireDueDate } from "./questionnaire-due.js";
import { questionnaireLinkFor } from "./questionnaire-link.js";
import { queuePartnerSends } from "../client/partner-invitations.js";
import { jobPrefill } from "./job-prefill.js";

const plainRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function stable(scope: string, tenantId: string, key: string) {
  return `${scope}_${createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 32)}`;
}

/**
 * A form the couple doesn't have yet: the response, prefilled from the job,
 * and the email that sends it (or the portal invitation that lands on it).
 *
 * Moved out of planningCommand's assignQuestionnaire so the planning-form
 * scheduler (planning-form-scheduler.ts) sends exactly what the studio's
 * "Send the form" sends. The caller has already checked who may send it and
 * that the job has no live copy (questionnaire-lifecycle.ts, liveAssignmentFor).
 */
export async function sendNewQuestionnaire(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    project: DocumentSnapshot;
    template: DocumentSnapshot;
    idempotencyKey: string;
    actorId: string;
    now: string;
    /** The studio sending it may spend AI on reading the form; a scheduler doesn't. */
    allowAi: boolean;
    /** When this send has its own due date, not the template's (the shot list). */
    dueDaysBeforeEvent?: number;
  },
) {
  const { project, template, now } = input;
  // An inquiry may have no date yet; that used to throw "Invalid time
  // value" here (questionnaire-due.ts).
  const due = questionnaireDueDate({
    eventDate: project.get("eventDate"),
    dueDaysBeforeEvent: input.dueDaysBeforeEvent ?? template.get("dueDaysBeforeEvent"),
    today: now,
  });
  const id = stable(
    "questionnaire_response",
    input.tenantId,
    input.idempotencyKey,
  );
  const sections = template.get("sections");
  // Everything the job already knows that the form asks (job-facts.ts).
  const prefill = await jobPrefill(db, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    project: project.data() ?? null,
    templateId: input.template.id,
    templateVersion: template.get("version"),
    sections,
    allowAi: input.allowAi,
    actorId: input.actorId,
  });
  const fieldValues = Array.isArray(sections)
    ? sections.flatMap((section) => {
        const fields = plainRecord(section).fields;
        return Array.isArray(fields) ? fields : [];
      })
    : [];
  const requiredFieldIds = fieldValues
    .map(plainRecord)
    .filter((field) => field.required === true)
    .map((field) => String(field.id));
  const completedRequired = requiredFieldIds.filter((fieldId) =>
    Object.prototype.hasOwnProperty.call(prefill.answers, fieldId),
  ).length;
  const completionPercent = requiredFieldIds.length
    ? Math.round((completedRequired / requiredFieldIds.length) * 100)
    : 0;
  const emailJobId = `questionnaire_request_${id}`;
  const link = await questionnaireLinkFor(db, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    clientContactIds: project.get("clientContactIds"),
    emailJobId,
    actorId: input.actorId,
    now,
  });
  const batch = db.batch();
  batch.create(db.doc(`questionnaireResponses/${id}`), {
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    templateId: input.template.id,
    templateVersion: Number(template.get("version")),
    templateName: String(template.get("name")),
    templateSnapshot: {
      name: String(template.get("name")),
      sections,
    },
    status: "not_started",
    answers: prefill.answers,
    answerProvenance: prefill.answerProvenance,
    changeHistory: [],
    hasPlanningChanges: false,
    completionPercent,
    dueDate: due.dueDate,
    // Snapshotted like the sections, so editing the template later
    // doesn't change when this client is reminded.
    reminderDaysBeforeDue: Array.isArray(template.get("reminderDaysBeforeDue"))
      ? (template.get("reminderDaysBeforeDue") as unknown[]).map(Number)
      : [],
    remindersSent: [],
    submittedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actorId,
    updatedBy: input.actorId,
    archivedAt: null,
  });
  // P17: assigning the details form must actually send it. This command
  // previously created the response record but queued no email, so the
  // couple was never told a form was waiting ("Send the form" sent
  // nothing). The worker resolves the client recipient from the project;
  // actionUrl drives the "Complete questionnaire" button: the portal
  // for a couple who has it, otherwise a portal invitation that lands
  // on the form (questionnaire-link.ts) — an inquiry has not been
  // invited yet, and the bare portal link sent them to a sign-in page.
  const requestJob = {
    id: emailJobId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    type: "questionnaire_request",
    actionUrl: link.actionUrl,
    // The partner's own copy and link go beside it when anyone's link
    // is an invitation (client/partner-invitations.ts).
    soleRecipient: link.partnerSends.length > 0,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  batch.create(db.doc(`emailJobs/questionnaire_request_${id}`), requestJob);
  queuePartnerSends(db, batch, requestJob, link.partnerSends);
  if (link.invitationWrite)
    batch.set(link.invitationWrite.reference, link.invitationWrite.data, {
      merge: true,
    });
  await batch.commit();

  return {
    responseId: id,
    status: "not_started",
    resent: false,
    prefilledFieldCount: Object.keys(prefill.answers).length,
    dueDate: due.dueDate,
    dueCountedFrom: due.countedFrom,
    invited: Boolean(link.invitationWrite),
  };
}
