import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const messageInput = z.object({
  projectId: z.string().min(1),
  contactId: z.string().min(1),
  subject: z.string().trim().min(2).max(180),
  body: z.string().trim().min(2).max(8_000),
  category: z.enum(["general", "financial", "contract", "insurance"]),
  actionLabel: z.string().trim().max(80).nullable(),
  actionUrl: z.string().url().max(2_000).nullable(),
  scheduledFor: z.string().datetime().nullable(),
});

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sendMessage"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: messageInput,
  }),
  z.object({
    type: z.literal("approveMessage"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ draftId: z.string().min(1) }),
  }),
]);

const allowedRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
]);

function stableId(scope: string, tenantId: string, key: string) {
  return `${scope}_${createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 30)}`;
}

function canApprove(role: string) {
  return role === "studio_owner" || role === "studio_admin";
}

export const communicationsCommand = onRequest(
  { cors: studioHubCors, invoker: "private" },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const command = commandSchema.parse(request.body);
      const db = getFirestore();
      const membership = await db
        .doc(`memberships/${command.tenantId}_${identity.uid}`)
        .get();
      const role = String(membership.get("role") ?? "");
      if (
        !membership.exists ||
        membership.get("status") !== "active" ||
        !allowedRoles.has(role)
      ) {
        throw new Error("FORBIDDEN");
      }
      const executionId = stableId(
        "communications",
        command.tenantId,
        command.idempotencyKey,
      );
      const executionReference = db.doc(`commandExecutions/${executionId}`);
      const previous = await executionReference.get();
      if (previous.exists) {
        response.status(200).json(previous.get("result"));
        return;
      }
      const now = new Date().toISOString();
      let result: Record<string, unknown>;

      if (command.type === "sendMessage") {
        const [project, contact] = await Promise.all([
          db.doc(`projects/${command.input.projectId}`).get(),
          db.doc(`contacts/${command.input.contactId}`).get(),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== command.tenantId
        ) {
          throw new Error("PROJECT_NOT_FOUND");
        }
        if (
          !contact.exists ||
          contact.get("tenantId") !== command.tenantId ||
          !Array.isArray(project.get("clientContactIds")) ||
          !(project.get("clientContactIds") as unknown[]).includes(contact.id)
        ) {
          throw new Error("PROJECT_CONTACT_REQUIRED");
        }
        if (
          role === "studio_coordinator" &&
          Array.isArray(membership.get("projectIds")) &&
          !(membership.get("projectIds") as unknown[]).includes(project.id)
        ) {
          throw new Error("FORBIDDEN");
        }
        const sensitive = command.input.category !== "general";
        const draftId = stableId(
          "message_draft",
          command.tenantId,
          command.idempotencyKey,
        );
        const requiresApproval = sensitive && !canApprove(role);
        const batch = db.batch();
        batch.create(db.doc(`communicationDrafts/${draftId}`), {
          id: draftId,
          tenantId: command.tenantId,
          ...command.input,
          projectId: project.id,
          contactId: contact.id,
          recipient: contact.get("email"),
          recipientName: contact.get("displayName") ?? null,
          projectName: project.get("name"),
          status: requiresApproval ? "needs_approval" : "approved",
          requestedBy: identity.uid,
          approvedBy: requiresApproval ? null : identity.uid,
          approvedAt: requiresApproval ? null : now,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
        });
        if (!requiresApproval) {
          const emailJobId = `manual_${draftId}`;
          batch.create(db.doc(`emailJobs/${emailJobId}`), {
            id: emailJobId,
            tenantId: command.tenantId,
            projectId: project.id,
            contactId: contact.id,
            recipient: contact.get("email"),
            recipientName: contact.get("displayName") ?? null,
            projectName: project.get("name"),
            type: "manual_message",
            customSubject: command.input.subject,
            customBody: command.input.body,
            actionLabel: command.input.actionLabel,
            actionUrl: command.input.actionUrl,
            category: command.input.category,
            communicationDraftId: draftId,
            status:
              command.input.scheduledFor &&
              command.input.scheduledFor > now
                ? "scheduled"
                : "queued",
            scheduledFor: command.input.scheduledFor,
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        const auditReference = db.doc(`auditEvents/message_${draftId}`);
        batch.create(auditReference, {
          id: auditReference.id,
          tenantId: command.tenantId,
          projectId: project.id,
          actorId: identity.uid,
          actorType: "user",
          action: requiresApproval
            ? "message.approval_requested"
            : "message.queued",
          entityType: "communicationDraft",
          entityId: draftId,
          timestamp: now,
          before: null,
          after: {
            category: command.input.category,
            status: requiresApproval ? "needs_approval" : "approved",
          },
          ipAddress: null,
          userAgent: request.header("user-agent") ?? null,
          correlationId: command.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
        batch.create(executionReference, {
          tenantId: command.tenantId,
          userId: identity.uid,
          commandType: command.type,
          idempotencyKey: command.idempotencyKey,
          result: { draftId, requiresApproval },
          createdAt: now,
        });
        await batch.commit();
        result = { draftId, requiresApproval };
      } else {
        if (!canApprove(role)) throw new Error("APPROVAL_PERMISSION_REQUIRED");
        const draftReference = db.doc(
          `communicationDrafts/${command.input.draftId}`,
        );
        result = await db.runTransaction(async (transaction) => {
          const draft = await transaction.get(draftReference);
          if (
            !draft.exists ||
            draft.get("tenantId") !== command.tenantId
          ) {
            throw new Error("DRAFT_NOT_FOUND");
          }
          if (draft.get("status") === "approved") {
            return { draftId: draft.id, approved: true };
          }
          if (draft.get("status") !== "needs_approval") {
            throw new Error("DRAFT_NOT_APPROVABLE");
          }
          const emailJobId = `manual_${draft.id}`;
          transaction.update(draftReference, {
            status: "approved",
            approvedBy: identity.uid,
            approvedAt: now,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          transaction.create(db.doc(`emailJobs/${emailJobId}`), {
            id: emailJobId,
            tenantId: command.tenantId,
            projectId: draft.get("projectId"),
            contactId: draft.get("contactId"),
            recipient: draft.get("recipient"),
            recipientName: draft.get("recipientName"),
            projectName: draft.get("projectName"),
            type: "manual_message",
            customSubject: draft.get("subject"),
            customBody: draft.get("body"),
            actionLabel: draft.get("actionLabel"),
            actionUrl: draft.get("actionUrl"),
            category: draft.get("category"),
            communicationDraftId: draft.id,
            status:
              draft.get("scheduledFor") &&
              draft.get("scheduledFor") > now
                ? "scheduled"
                : "queued",
            scheduledFor: draft.get("scheduledFor") ?? null,
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
          transaction.create(executionReference, {
            tenantId: command.tenantId,
            userId: identity.uid,
            commandType: command.type,
            idempotencyKey: command.idempotencyKey,
            result: { draftId: draft.id, approved: true },
            createdAt: now,
          });
          return { draftId: draft.id, approved: true };
        });
      }
      response.status(200).json(result);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "COMMUNICATION_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);

export const scheduledEmailRelease = onSchedule(
  { schedule: "every 5 minutes", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const jobs = await db
      .collection("emailJobs")
      .where("status", "==", "scheduled")
      .where("scheduledFor", "<=", now)
      .limit(100)
      .get();
    if (jobs.empty) return;
    const batch = db.batch();
    for (const job of jobs.docs) {
      batch.update(job.ref, { status: "queued", updatedAt: now });
    }
    await batch.commit();
  },
);
