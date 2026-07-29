import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { emailTemplateKeys } from "./email-templates.js";

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

const templateContent = z.object({
  key: z.enum(emailTemplateKeys),
  name: z.string().trim().min(2).max(80),
  subject: z.string().trim().min(2).max(180),
  preheader: z.string().trim().max(160),
  eyebrow: z.string().trim().min(2).max(80),
  heading: z.string().trim().min(2).max(180),
  paragraphs: z.array(z.string().trim().min(1).max(2_000)).min(1).max(8),
  actionLabel: z.string().trim().min(1).max(80).nullable(),
  note: z.string().trim().min(1).max(500).nullable(),
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
  z.object({
    type: z.literal("saveTemplateVersion"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: templateContent,
  }),
  z.object({
    type: z.literal("activateTemplateVersion"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ templateId: z.string().min(1).max(200) }),
  }),
  z.object({
    type: z.literal("sendTemplateTest"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      templateId: z.string().min(1).max(200),
      recipient: z.string().email(),
    }),
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
      } else if (command.type === "approveMessage") {
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
      } else if (command.type === "saveTemplateVersion") {
        if (!canApprove(role)) throw new Error("APPROVAL_PERMISSION_REQUIRED");
        const pointerReference = db.doc(
          `messageTemplatePointers/${command.tenantId}_${command.input.key}`,
        );
        result = await db.runTransaction(async (transaction) => {
          const pointer = await transaction.get(pointerReference);
          const latestVersion = Number(pointer.get("latestVersion") ?? 0);
          const version = Number.isSafeInteger(latestVersion)
            ? latestVersion + 1
            : 1;
          const templateId = `${command.tenantId}_${command.input.key}_v${version}`;
          const templateReference = db.doc(`messageTemplates/${templateId}`);
          const templateRecord = {
            id: templateId,
            tenantId: command.tenantId,
            ...command.input,
            version,
            status: "draft",
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
          };
          transaction.create(templateReference, templateRecord);
          transaction.set(
            pointerReference,
            {
              id: pointerReference.id,
              tenantId: command.tenantId,
              key: command.input.key,
              latestVersion: version,
              latestTemplateId: templateId,
              activeTemplateId: pointer.get("activeTemplateId") ?? null,
              activeVersion: pointer.get("activeVersion") ?? null,
              createdAt: pointer.get("createdAt") ?? now,
              createdBy: pointer.get("createdBy") ?? identity.uid,
              updatedAt: now,
              updatedBy: identity.uid,
            },
            { merge: true },
          );
          transaction.create(executionReference, {
            tenantId: command.tenantId,
            userId: identity.uid,
            commandType: command.type,
            idempotencyKey: command.idempotencyKey,
            result: { templateId, version, status: "draft" },
            createdAt: now,
          });
          transaction.create(db.doc(`auditEvents/template_${templateId}`), {
            id: `template_${templateId}`,
            tenantId: command.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "message_template.version_created",
            entityType: "messageTemplate",
            entityId: templateId,
            timestamp: now,
            before: null,
            after: {
              key: command.input.key,
              version,
              status: "draft",
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId: command.idempotencyKey,
            automationRunId: null,
            providerEventId: null,
          });
          return { templateId, version, status: "draft" };
        });
      } else {
        if (!canApprove(role)) throw new Error("APPROVAL_PERMISSION_REQUIRED");
        const templateReference = db.doc(
          `messageTemplates/${command.input.templateId}`,
        );
        const template = await templateReference.get();
        if (
          !template.exists ||
          template.get("tenantId") !== command.tenantId
        ) {
          throw new Error("TEMPLATE_NOT_FOUND");
        }
        const key = z.enum(emailTemplateKeys).parse(template.get("key"));
        const version = Number(template.get("version"));
        const pointerReference = db.doc(
          `messageTemplatePointers/${command.tenantId}_${key}`,
        );
        const batch = db.batch();

        if (command.type === "activateTemplateVersion") {
          const pointer = await pointerReference.get();
          const previousTemplateId = String(
            pointer.get("activeTemplateId") ?? "",
          );
          if (previousTemplateId && previousTemplateId !== template.id) {
            batch.update(db.doc(`messageTemplates/${previousTemplateId}`), {
              status: "superseded",
              updatedAt: now,
              updatedBy: identity.uid,
            });
          }
          batch.update(templateReference, {
            status: "active",
            activatedAt: now,
            activatedBy: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          batch.set(
            pointerReference,
            {
              id: pointerReference.id,
              tenantId: command.tenantId,
              key,
              activeTemplateId: template.id,
              activeVersion: version,
              updatedAt: now,
              updatedBy: identity.uid,
            },
            { merge: true },
          );
          result = {
            templateId: template.id,
            version,
            status: "active",
          };
          batch.create(
            db.doc(`auditEvents/template_activation_${template.id}_${version}`),
            {
              id: `template_activation_${template.id}_${version}`,
              tenantId: command.tenantId,
              projectId: null,
              actorId: identity.uid,
              actorType: "user",
              action: "message_template.activated",
              entityType: "messageTemplate",
              entityId: template.id,
              timestamp: now,
              before: previousTemplateId
                ? { activeTemplateId: previousTemplateId }
                : null,
              after: { activeTemplateId: template.id, version },
              ipAddress: null,
              userAgent: request.header("user-agent") ?? null,
              correlationId: command.idempotencyKey,
              automationRunId: null,
              providerEventId: null,
            },
          );
        } else {
          const jobId = stableId(
            "template_test",
            command.tenantId,
            command.idempotencyKey,
          );
          batch.create(db.doc(`emailJobs/${jobId}`), {
            id: jobId,
            tenantId: command.tenantId,
            projectId: null,
            recipient: command.input.recipient,
            recipientName: "Studio team",
            projectName: "Sample photography project",
            type: key,
            templateSnapshot: template.data(),
            values: {
              inviteUrl: "https://example.com/secure-invitation",
              actionUrl: "https://example.com/next-step",
              destinationUrl: "https://example.com/project",
              portalUrl: "https://example.com/client",
              invoiceUrl: "https://example.com/invoice",
              scheduleUrl: "https://example.com/schedule",
              galleryUrl: "https://example.com/gallery",
            },
            status: "queued",
            attempts: 0,
            maxAttempts: 5,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
          });
          result = {
            templateId: template.id,
            testQueued: true,
            recipient: command.input.recipient,
          };
        }
        batch.create(executionReference, {
          tenantId: command.tenantId,
          userId: identity.uid,
          commandType: command.type,
          idempotencyKey: command.idempotencyKey,
          result,
          createdAt: now,
        });
        await batch.commit();
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
