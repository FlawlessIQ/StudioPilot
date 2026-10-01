import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { FEEDBACK_NOTIFYING_STATUSES, type FeedbackStatus } from "./model.js";

/**
 * Move a piece of feedback to a studio-facing status, and tell the person who
 * sent it when that's news (planned, shipped).
 *
 * One email per status, ever: moving Planned → Received → Planned doesn't tell
 * them twice, because the email job's id is fixed per status and created only
 * if absent. Shared by the feedback command (one item) and the Console's issue
 * status (every item linked to the issue), so the rule can't differ.
 */
export async function applyFeedbackStatus(
  db: Firestore,
  input: {
    feedbackId: string;
    status: FeedbackStatus;
    note: string | null;
    actorUid: string;
    correlationId: string;
    userAgent: string | null;
    /** Set by the Console when the change comes from an issue. */
    issueId?: string | null;
  },
): Promise<{ before: FeedbackStatus; notified: boolean }> {
  const reference = db.doc(`feedback/${input.feedbackId}`);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    if (!current.exists) throw new Error("FEEDBACK_NOT_FOUND");
    const before = String(current.get("status")) as FeedbackStatus;
    const notifyType = input.status === "shipped" ? "feedback_shipped" : "feedback_planned";
    const jobReference = db.doc(`emailJobs/feedback_${input.status}_${input.feedbackId}`);
    // Reads before writes: a transaction takes all its reads first.
    const notify =
      input.status !== before &&
      FEEDBACK_NOTIFYING_STATUSES.includes(input.status) &&
      current.get("followUpOk") === true &&
      typeof current.get("userEmail") === "string" &&
      !(await transaction.get(jobReference)).exists;

    const now = new Date().toISOString();
    const history = Array.isArray(current.get("statusHistory")) ? current.get("statusHistory") : [];
    transaction.update(reference, {
      status: input.status,
      statusNote: input.note,
      statusHistory: [...history, { status: input.status, at: now, by: input.actorUid, note: input.note }].slice(-20),
      updatedAt: now,
      ...(input.status === "shipped" ? { shippedAt: now } : {}),
    });
    const auditId = randomUUID();
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: String(current.get("tenantId")),
      projectId: null,
      actorId: input.actorUid,
      actorType: "platform_admin",
      action: "feedback.status_changed",
      entityType: "feedback",
      entityId: input.feedbackId,
      timestamp: now,
      before: { status: before },
      after: { status: input.status, note: input.note, notified: notify, issueId: input.issueId ?? null },
      ipAddress: null,
      userAgent: input.userAgent,
      correlationId: input.correlationId,
      automationRunId: null,
      providerEventId: null,
    });
    if (notify) {
      transaction.create(jobReference, {
        id: jobReference.id,
        tenantId: "platform",
        projectId: null,
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        type: notifyType,
        recipient: String(current.get("userEmail")),
        recipientName: current.get("userName") ?? null,
        replyAddress: process.env.FEEDBACK_REPLY_TO?.trim() || "support@studio-cue.com",
        feedbackId: input.feedbackId,
        feedbackKind: current.get("kind"),
        feedbackMessage: current.get("message"),
        statusNote: input.note,
        actionUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com"}/studio/help#feedback`,
      });
    }
    return { before, notified: notify };
  });
}
