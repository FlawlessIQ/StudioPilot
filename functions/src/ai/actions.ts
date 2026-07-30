import { createHash } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { productEvent } from "../operations/product-events.js";
import { studioHubCors } from "../security/cors.js";

const commandSchema = z.object({
  tenantId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(240),
  type: z.enum([
    "decideAiAction",
    "snoozeAiAction",
    "decideAutomationApproval",
    "recordAiExecution",
    "cancelReceipt",
    "retryReceipt",
  ]),
  input: z.record(z.string(), z.unknown()),
});

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

async function requireReviewer(
  db: Firestore,
  tenantId: string,
  userId: string,
  projectId: string | null,
) {
  const membership = await db
    .doc(`memberships/${tenantId}_${userId}`)
    .get();
  if (
    !membership.exists ||
    membership.get("tenantId") !== tenantId ||
    membership.get("status") !== "active" ||
    !["studio_owner", "studio_admin", "studio_coordinator"].includes(
      text(membership.get("role")),
    )
  )
    throw new Error("FORBIDDEN");
  if (
    projectId &&
    membership.get("role") === "studio_coordinator" &&
    !(
      Array.isArray(membership.get("projectIds")) &&
      (membership.get("projectIds") as unknown[]).map(String).includes(projectId)
    )
  )
    throw new Error("FORBIDDEN");
}

function receipt(input: {
  id: string;
  tenantId: string;
  projectId: string | null;
  actorId: string;
  title: string;
  summary: string;
  status: "completed" | "cancelled" | "retry_scheduled";
  affectedEntityType: string;
  affectedEntityId: string;
  providerEvidence: unknown;
  reversible: boolean;
  retryable: boolean;
  now: string;
}) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    title: input.title,
    summary: input.summary,
    status: input.status,
    source: "ai_approval_queue",
    affectedEntityType: input.affectedEntityType,
    affectedEntityId: input.affectedEntityId,
    providerEvidence: input.providerEvidence ?? null,
    reversible: input.reversible,
    retryable: input.retryable,
    canCancel: false,
    canRetry: input.retryable,
    attempts: 1,
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: input.status === "completed" ? input.now : null,
    createdBy: input.actorId,
    updatedBy: input.actorId,
    archivedAt: null,
  };
}

export const aiActionCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    timeoutSeconds: 60,
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const parsed = commandSchema.parse(request.body);
      const db = getFirestore();
      const now = new Date().toISOString();
      const executionId = `ai_queue_${hash(
        `${parsed.tenantId}:${parsed.type}:${parsed.idempotencyKey}`,
      ).slice(0, 32)}`;
      const executionReference = db.doc(
        `commandExecutions/${executionId}`,
      );
      const prior = await executionReference.get();
      if (prior.exists) {
        response.status(200).json(prior.get("result"));
        return;
      }

      if (
        parsed.type === "decideAiAction" ||
        parsed.type === "snoozeAiAction"
      ) {
        const actionId = text(parsed.input.actionId);
        const actionReference = db.doc(`aiActions/${actionId}`);
        const action = await actionReference.get();
        if (!action.exists || action.get("tenantId") !== parsed.tenantId)
          throw new Error("AI_ACTION_NOT_FOUND");
        const projectId = text(action.get("projectId")) || null;
        await requireReviewer(db, parsed.tenantId, identity.uid, projectId);
        if (parsed.type === "snoozeAiAction") {
          const snoozedUntil = text(parsed.input.snoozedUntil);
          if (
            !snoozedUntil ||
            !Number.isFinite(Date.parse(snoozedUntil)) ||
            Date.parse(snoozedUntil) <= Date.parse(now)
          )
            throw new Error("INVALID_SNOOZE_TIME");
          const result = { actionId, status: "review_required", snoozedUntil };
          const batch = db.batch();
          batch.update(actionReference, {
            snoozedUntil,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          batch.create(executionReference, {
            id: executionId,
            tenantId: parsed.tenantId,
            type: parsed.type,
            status: "succeeded",
            result,
            createdAt: now,
            updatedAt: now,
          });
          await batch.commit();
          response.status(200).json(result);
          return;
        }

        const decision = z
          .enum(["approved", "rejected", "dismissed"])
          .parse(parsed.input.decision);
        const editDelta = record(parsed.input.editDelta);
        const validationIssues = Array.isArray(
          action.get("validation.issues"),
        )
          ? (action.get("validation.issues") as unknown[]).map(record)
          : [];
        const unresolvedBlocking = validationIssues.filter(
          (issue) =>
            issue.severity === "blocking" &&
            !(
              issue.code === "LOW_CONFIDENCE" &&
              Object.keys(editDelta).length > 0
            ),
        );
        if (decision === "approved" && unresolvedBlocking.length)
          throw new Error("AI_ACTION_HAS_BLOCKING_ISSUES");
        const structuredOutput = {
          ...record(action.get("structuredOutput")),
          ...editDelta,
        };
        const downstream = record(action.get("downstreamCommand"));
        const consequence = text(parsed.input.consequence) ||
          (decision === "approved"
            ? action.get("capability") === "inquiry_reply_draft"
              ? "Created an approved, unsent communication draft. No email was sent."
              : text(downstream.commandType)
              ? `Approved for deterministic command ${text(downstream.commandType)}.`
              : "Approved as a reusable draft. No provider action was executed."
            : decision === "rejected"
              ? "Rejected. No downstream record or provider action changed."
              : "Dismissed from the active queue. No downstream action ran.");
        const receiptId = `receipt_${executionId}`;
        const inquiryReply =
          decision === "approved" &&
          action.get("capability") === "inquiry_reply_draft";
        const communicationDraftId = inquiryReply
          ? `ai_reply_${actionId}`
          : null;
        const result = {
          actionId,
          status: decision,
          receiptId,
          downstreamConsequence: consequence,
        };
        const batch = db.batch();
        batch.update(actionReference, {
          status: decision,
          structuredOutput,
          decision: {
            actorId: identity.uid,
            action: decision,
            decidedAt: now,
            note: text(parsed.input.note) || null,
            editDelta:
              Object.keys(editDelta).length > 0 ? editDelta : null,
          },
          validation:
            decision === "approved"
              ? {
                  status: "passed",
                  issues: validationIssues.map((issue) =>
                    issue.code === "LOW_CONFIDENCE"
                      ? {
                          ...issue,
                          severity: "info",
                          message:
                            "Low-confidence fields were confirmed by the reviewer.",
                        }
                      : issue,
                  ),
                }
              : action.get("validation"),
          snoozedUntil: null,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        if (communicationDraftId) {
          const leadSource = Array.isArray(action.get("sourceReferences"))
            ? (action.get("sourceReferences") as unknown[])
                .map(record)
                .find((source) => source.entityType === "lead")
            : null;
          batch.set(
            db.doc(`communicationDrafts/${communicationDraftId}`),
            {
              id: communicationDraftId,
              tenantId: parsed.tenantId,
              projectId: null,
              leadId: leadSource ? text(leadSource.entityId) : null,
              contactId: null,
              recipient: structuredOutput.recipientEmail ?? null,
              recipientName: null,
              projectName: null,
              subject: structuredOutput.subject,
              body: structuredOutput.body,
              category: "general",
              actionLabel: null,
              actionUrl: null,
              scheduledFor: null,
              status: "approved_unsent",
              requestedBy: identity.uid,
              approvedBy: identity.uid,
              approvedAt: now,
              aiActionId: actionId,
              createdAt: now,
              updatedAt: now,
              createdBy: identity.uid,
              updatedBy: identity.uid,
            },
            { merge: true },
          );
        }
        batch.create(db.doc(`actionReceipts/${receiptId}`), receipt({
          id: receiptId,
          tenantId: parsed.tenantId,
          projectId,
          actorId: identity.uid,
          title: `${decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Dismissed"} ${text(action.get("capability")).replaceAll("_", " ")}`,
          summary: consequence,
          status: "completed",
          affectedEntityType: "aiAction",
          affectedEntityId: actionId,
          providerEvidence: downstream,
          reversible: decision === "dismissed",
          retryable: false,
          now,
        }));
        const eventName =
          decision === "approved"
            ? Object.keys(editDelta).length
              ? "ai_action.edited"
              : "ai_action.approved"
            : decision === "rejected"
              ? "ai_action.rejected"
              : "ai_action.dismissed";
        const event = productEvent({
          tenantId: parsed.tenantId,
          projectId,
          actorId: identity.uid,
          name: eventName,
          occurredAt: now,
          correlationId: executionId,
          sourceEntityType: "aiAction",
          sourceEntityId: actionId,
          properties: {
            capability: action.get("capability"),
            authorityBoundary: action.get("authorityBoundary"),
            editedFieldCount: Object.keys(editDelta).length,
          },
        });
        batch.create(db.doc(`productEvents/${event.id}`), event);
        batch.create(executionReference, {
          id: executionId,
          tenantId: parsed.tenantId,
          type: parsed.type,
          status: "succeeded",
          result,
          createdAt: now,
          updatedAt: now,
        });
        await batch.commit();
        response.status(200).json(result);
        return;
      }

      if (parsed.type === "decideAutomationApproval") {
        const approvalId = text(parsed.input.approvalId);
        const approvalReference = db.doc(
          `automationApprovals/${approvalId}`,
        );
        const approval = await approvalReference.get();
        if (!approval.exists || approval.get("tenantId") !== parsed.tenantId)
          throw new Error("AUTOMATION_APPROVAL_NOT_FOUND");
        const projectId = text(approval.get("projectId")) || null;
        await requireReviewer(db, parsed.tenantId, identity.uid, projectId);
        if (approval.get("status") !== "pending")
          throw new Error("AUTOMATION_APPROVAL_ALREADY_DECIDED");
        const decision = z
          .enum(["approved", "rejected"])
          .parse(parsed.input.decision);
        const summary =
          decision === "approved"
            ? `Approved ${text(approval.get("actionType")).replaceAll("_", " ")} for deterministic workflow execution.`
            : `Rejected ${text(approval.get("actionType")).replaceAll("_", " ")}. No downstream action ran.`;
        const receiptId = `receipt_${executionId}`;
        const result = {
          approvalId,
          status: decision,
          receiptId,
          downstreamConsequence: summary,
        };
        const batch = db.batch();
        batch.update(approvalReference, {
          status: decision,
          decidedAt: now,
          decidedBy: identity.uid,
          decisionReason: text(parsed.input.note) || null,
          updatedAt: now,
        });
        batch.create(db.doc(`actionReceipts/${receiptId}`), receipt({
          id: receiptId,
          tenantId: parsed.tenantId,
          projectId,
          actorId: identity.uid,
          title: `${decision === "approved" ? "Approved" : "Rejected"} workflow action`,
          summary,
          status: "completed",
          affectedEntityType: "automationApproval",
          affectedEntityId: approvalId,
          providerEvidence: null,
          reversible: false,
          retryable: false,
          now,
        }));
        batch.create(executionReference, {
          id: executionId,
          tenantId: parsed.tenantId,
          type: parsed.type,
          status: "succeeded",
          result,
          createdAt: now,
          updatedAt: now,
        });
        await batch.commit();
        response.status(200).json(result);
        return;
      }

      if (parsed.type === "recordAiExecution") {
        const actionId = text(parsed.input.actionId);
        const actionReference = db.doc(`aiActions/${actionId}`);
        const action = await actionReference.get();
        if (!action.exists || action.get("tenantId") !== parsed.tenantId)
          throw new Error("AI_ACTION_NOT_FOUND");
        const projectId = text(action.get("projectId")) || null;
        await requireReviewer(db, parsed.tenantId, identity.uid, projectId);
        if (action.get("status") !== "approved")
          throw new Error("AI_ACTION_NOT_APPROVED");
        const downstream = record(action.get("downstreamCommand"));
        if (!text(downstream.commandType))
          throw new Error("AI_ACTION_HAS_NO_DOWNSTREAM_COMMAND");
        const receiptId = `receipt_${executionId}`;
        const summary =
          text(parsed.input.summary) ||
          `Completed ${text(downstream.commandType).replaceAll("_", " ")} from the approved AI draft.`;
        const result = {
          actionId,
          status: "executed",
          receiptId,
          downstreamConsequence: summary,
        };
        const batch = db.batch();
        batch.update(actionReference, {
          status: "executed",
          downstreamCommand: {
            ...downstream,
            commandId:
              text(parsed.input.commandId) ||
              text(downstream.commandId),
            executedAt: now,
          },
          updatedAt: now,
          updatedBy: identity.uid,
        });
        batch.create(db.doc(`actionReceipts/${receiptId}`), receipt({
          id: receiptId,
          tenantId: parsed.tenantId,
          projectId,
          actorId: identity.uid,
          title: `Completed ${text(action.get("capability")).replaceAll("_", " ")}`,
          summary,
          status: "completed",
          affectedEntityType: "aiAction",
          affectedEntityId: actionId,
          providerEvidence: parsed.input.providerEvidence ?? null,
          reversible: false,
          retryable: false,
          now,
        }));
        const event = productEvent({
          tenantId: parsed.tenantId,
          projectId,
          actorId: identity.uid,
          name: "ai_action.executed",
          occurredAt: now,
          correlationId: executionId,
          sourceEntityType: "aiAction",
          sourceEntityId: actionId,
          properties: {
            capability: action.get("capability"),
            commandType: downstream.commandType,
            providerEvidencePresent:
              parsed.input.providerEvidence !== null &&
              parsed.input.providerEvidence !== undefined,
          },
        });
        batch.create(db.doc(`productEvents/${event.id}`), event);
        batch.create(executionReference, {
          id: executionId,
          tenantId: parsed.tenantId,
          type: parsed.type,
          status: "succeeded",
          result,
          createdAt: now,
          updatedAt: now,
        });
        await batch.commit();
        response.status(200).json(result);
        return;
      }

      const receiptId = text(parsed.input.receiptId);
      const receiptReference = db.doc(`actionReceipts/${receiptId}`);
      const actionReceipt = await receiptReference.get();
      if (
        !actionReceipt.exists ||
        actionReceipt.get("tenantId") !== parsed.tenantId
      )
        throw new Error("ACTION_RECEIPT_NOT_FOUND");
      await requireReviewer(
        db,
        parsed.tenantId,
        identity.uid,
        text(actionReceipt.get("projectId")) || null,
      );
      if (
        parsed.type === "cancelReceipt" &&
        (actionReceipt.get("canCancel") !== true ||
          !["queued", "retry_scheduled"].includes(
            text(actionReceipt.get("status")),
          ))
      )
        throw new Error("ACTION_RECEIPT_NOT_CANCELLABLE");
      if (
        parsed.type === "retryReceipt" &&
        (actionReceipt.get("retryable") !== true ||
          !["failed", "cancelled"].includes(
            text(actionReceipt.get("status")),
          ))
      )
        throw new Error("ACTION_RECEIPT_NOT_RETRYABLE");
      const nextStatus =
        parsed.type === "cancelReceipt" ? "cancelled" : "retry_scheduled";
      const result = { receiptId, status: nextStatus };
      const batch = db.batch();
      batch.update(receiptReference, {
        status: nextStatus,
        canCancel: nextStatus === "retry_scheduled",
        canRetry: false,
        attempts:
          Number(actionReceipt.get("attempts") ?? 0) +
          (nextStatus === "retry_scheduled" ? 1 : 0),
        updatedAt: now,
        updatedBy: identity.uid,
      });
      const event = productEvent({
        tenantId: parsed.tenantId,
        projectId: text(actionReceipt.get("projectId")) || null,
        actorId: identity.uid,
        name:
          nextStatus === "cancelled"
            ? "automation.cancelled"
            : "automation.retried",
        occurredAt: now,
        correlationId: executionId,
        sourceEntityType: "actionReceipt",
        sourceEntityId: receiptId,
        properties: {
          previousStatus: actionReceipt.get("status"),
          nextStatus,
          attempt:
            Number(actionReceipt.get("attempts") ?? 0) +
            (nextStatus === "retry_scheduled" ? 1 : 0),
        },
      });
      batch.create(db.doc(`productEvents/${event.id}`), event);
      batch.create(executionReference, {
        id: executionId,
        tenantId: parsed.tenantId,
        type: parsed.type,
        status: "succeeded",
        result,
        createdAt: now,
        updatedAt: now,
      });
      await batch.commit();
      response.status(200).json(result);
    } catch (caught: unknown) {
      const code =
        caught instanceof Error ? caught.message : "AI_ACTION_COMMAND_FAILED";
      response
        .status(
          code === "FORBIDDEN"
            ? 403
            : code.includes("NOT_FOUND")
              ? 404
              : 400,
        )
        .json({ error: code.split(":")[0] });
    }
  },
);
