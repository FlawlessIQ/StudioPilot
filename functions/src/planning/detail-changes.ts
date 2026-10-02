import { createHash } from "node:crypto";
import { finalDetailsLockApplies } from "../job-kinds/job-kinds.js";
import type { Firestore } from "firebase-admin/firestore";
import { answerText } from "./crew-brief.js";
import { lockingFieldIds } from "./details-lock.js";
import { detailsLocked, resolvePlanningTimeline } from "./planning-timeline.js";
import { detailSignoffId, finalDetailsHash, finalDetailsSnapshot } from "./final-details.js";


/**
 * A couple asking to change where or when, after their final details lock.
 *
 * GR Productions (2026-10-02): lock four weeks before; schedule changes cost
 * nothing — the studio just has to agree. So after the lock a change to a
 * locked answer (planning/details-lock.ts) isn't saved: it becomes a request
 * on the studio's Today. Accepting changes the answer on the form, records it
 * against the final details they confirmed, tells the couple, and — when a
 * timeline is already published — opens a task to update it. Declining
 * keeps the answer and tells them.
 *
 * `detailChangeRequests/{id}`: pending → accepted | declined | replaced.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const stableId = (scope: string, ...parts: string[]) =>
  `${scope}_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;

function fieldOf(templateSnapshot: unknown, fieldId: string): Row | null {
  for (const section of Array.isArray(record(templateSnapshot).sections) ? (record(templateSnapshot).sections as unknown[]) : [])
    for (const field of Array.isArray(record(section).fields) ? (record(section).fields as unknown[]) : [])
      if (text(record(field).id) === fieldId) return record(field);
  return null;
}

export async function requestDetailChange(
  db: Firestore,
  input: { tenantId: string; projectId: string; responseId: string; fieldId: string; value: unknown; note: string | null; actorId: string; now: string },
) {
  const [response, project, tenant] = await Promise.all([
    db.doc(`questionnaireResponses/${input.responseId}`).get(),
    db.doc(`projects/${input.projectId}`).get(),
    db.doc(`tenants/${input.tenantId}`).get(),
  ]);
  if (!response.exists || response.get("tenantId") !== input.tenantId || response.get("projectId") !== input.projectId)
    throw new Error("RESPONSE_NOT_FOUND");
  const field = fieldOf(response.get("templateSnapshot"), input.fieldId);
  if (!field || field.internalOnly === true || !lockingFieldIds(record(response.get("templateSnapshot")).sections).has(input.fieldId))
    throw new Error("FIELD_NOT_LOCKABLE");
  // Before the lock it's simply theirs to change: the form saves it.
  if (
    !finalDetailsLockApplies(project.data()) ||
    !detailsLocked(text(project.get("eventDate")), input.now.slice(0, 10), resolvePlanningTimeline(tenant.get("planningTimeline")))
  )
    throw new Error("DETAILS_NOT_LOCKED");
  const type = text(field.type);
  const from = record(response.get("answers"))[input.fieldId] ?? null;
  const to = typeof input.value === "string" ? input.value.trim().slice(0, 5000) : input.value ?? null;
  if (JSON.stringify(from) === JSON.stringify(to)) throw new Error("DETAIL_CHANGE_UNCHANGED");
  const id = stableId("detail_change", input.tenantId, input.responseId, input.fieldId, JSON.stringify(to));
  const earlier = await db
    .collection("detailChangeRequests")
    .where("tenantId", "==", input.tenantId)
    .where("responseId", "==", input.responseId)
    .limit(50)
    .get();
  const batch = db.batch();
  // One open request per question: asking again replaces the last ask.
  for (const request of earlier.docs)
    if (request.id !== id && request.get("fieldId") === input.fieldId && request.get("status") === "pending")
      batch.update(request.ref, { status: "replaced", updatedAt: input.now });
  batch.set(db.doc(`detailChangeRequests/${id}`), {
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    responseId: input.responseId,
    fieldId: input.fieldId,
    label: text(field.label) || input.fieldId,
    type,
    from,
    to,
    fromText: answerText(type, from),
    toText: answerText(type, to),
    note: input.note?.trim() || null,
    status: "pending",
    requestedBy: input.actorId,
    decidedAt: null,
    decidedBy: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
  await batch.commit();
  return { requestId: id, status: "pending" };
}

export async function decideDetailChange(
  db: Firestore,
  input: { tenantId: string; projectId: string; requestId: string; decision: "accept" | "decline"; actorId: string; now: string },
) {
  const requestReference = db.doc(`detailChangeRequests/${input.requestId}`);
  const signoffReference = db.doc(`detailSignoffs/${detailSignoffId(input.tenantId, input.projectId)}`);
  const outcome = await db.runTransaction(async (transaction) => {
    const request = await transaction.get(requestReference);
    if (!request.exists || request.get("tenantId") !== input.tenantId || request.get("projectId") !== input.projectId)
      throw new Error("DETAIL_CHANGE_NOT_FOUND");
    if (request.get("status") !== "pending") throw new Error("DETAIL_CHANGE_NOT_PENDING");
    const responseReference = db.doc(`questionnaireResponses/${text(request.get("responseId"))}`);
    const [response, signoff, schedules, project] = await Promise.all([
      transaction.get(responseReference),
      transaction.get(signoffReference),
      transaction.get(
        db.collection("schedules").where("tenantId", "==", input.tenantId).where("projectId", "==", input.projectId).orderBy("version", "desc").limit(1),
      ),
      transaction.get(db.doc(`projects/${input.projectId}`)),
    ]);
    if (!response.exists) throw new Error("RESPONSE_NOT_FOUND");
    const label = text(request.get("label"));
    const fromText = text(request.get("fromText")) || "(blank)";
    const toText = text(request.get("toText")) || "(blank)";
    const contactIds = Array.isArray(project.get("clientContactIds")) ? (project.get("clientContactIds") as unknown[]) : [];
    const emailId = `detail_change_${input.decision}_${input.requestId}`;
    const email = (subject: string, body: string) => ({
      id: emailId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      contactId: typeof contactIds[0] === "string" ? contactIds[0] : null,
      type: "manual_message",
      customSubject: subject,
      customBody: body,
      actionLabel: null,
      actionUrl: null,
      category: "planning",
      clientOutreachGuard: true,
      status: "queued",
      scheduledFor: null,
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });
    transaction.update(requestReference, { status: input.decision === "accept" ? "accepted" : "declined", decidedAt: input.now, decidedBy: input.actorId, updatedAt: input.now });
    if (input.decision === "decline") {
      transaction.create(
        db.doc(`emailJobs/${emailId}`),
        email(`About your change: ${label}`, `We've kept ${label} as ${fromText} for now. If you'd like to talk it through, just reply.`),
      );
      return { accepted: false, refreshSnapshot: false };
    }
    const fieldId = text(request.get("fieldId"));
    const answers = record(response.get("answers"));
    const before = answers[fieldId] ?? null;
    const to = request.get("to") ?? null;
    const changeHistory = Array.isArray(response.get("changeHistory")) ? (response.get("changeHistory") as unknown[]) : [];
    transaction.update(responseReference, {
      answers: { ...answers, [fieldId]: to },
      answerProvenance: {
        ...record(response.get("answerProvenance")),
        [fieldId]: {
          sourceType: "studio_answer",
          sourceId: fieldId,
          label: "Changed at the couple's request",
          verified: true,
          changedAt: input.now,
          changedFrom: before,
          requestId: input.requestId,
        },
      },
      changeHistory: [
        ...changeHistory,
        { fieldId, before, after: to, affectsPlanning: true, changedAt: input.now, changedBy: input.actorId, requestId: input.requestId },
      ].slice(-200),
      hasPlanningChanges: true,
      updatedAt: input.now,
      updatedBy: input.actorId,
    });
    // Confirmed details stay as they were signed; the change is recorded beside them.
    if (signoff.exists && signoff.get("status") === "confirmed")
      transaction.update(signoffReference, {
        changes: [...(Array.isArray(signoff.get("changes")) ? (signoff.get("changes") as unknown[]) : []), { at: input.now, label, from: fromText, to: toText, requestId: input.requestId, agreedBy: input.actorId }],
        updatedAt: input.now,
      });
    transaction.create(
      db.doc(`emailJobs/${emailId}`),
      email(`Your change is agreed: ${label}`, `We've updated ${label} to ${toText}. Nothing else changes.`),
    );
    const schedule = schedules.docs[0];
    if (schedule && !["superseded", "draft"].includes(text(schedule.get("status")))) {
      const taskId = `detail_change_timeline_${input.requestId}`;
      transaction.set(db.doc(`tasks/${taskId}`), {
        id: taskId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        workflowRunId: null,
        checkpointId: null,
        title: `Update the timeline: ${label} is now ${toText}`,
        description: `Agreed at the couple's request (was ${fromText}). The published timeline still has the old one.`,
        status: "not_started",
        priority: "high",
        assignedUserId: null,
        assignedRole: "studio_owner",
        dueDate: input.now.slice(0, 10),
        blocking: false,
        completedAt: null,
        completedBy: null,
        source: "detail_change",
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        archivedAt: null,
      });
    }
    return { accepted: true, refreshSnapshot: signoff.exists && signoff.get("status") === "awaiting_couple" };
  });
  // Still waiting for the couple: what they confirm is the details as they now stand.
  if (outcome.refreshSnapshot) {
    const snapshot = await finalDetailsSnapshot(db, input.tenantId, input.projectId);
    await signoffReference.update({ snapshot, snapshotHash: finalDetailsHash(snapshot), updatedAt: input.now });
  }
  return { requestId: input.requestId, decision: input.decision };
}
