import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
const replayCollection = z.enum([
  "providerJobs",
  "emailJobs",
  "aiJobs",
  "pdfJobs",
  "automationRuns",
  "domainEvents",
]);
const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setFeatureFlag"),
    input: z.object({
      key: z.string().min(1),
      enabled: z.boolean(),
      tenantIds: z.array(z.string()),
      description: z.string().max(1000),
    }),
  }),
  z.object({
    type: z.literal("suspendTenant"),
    input: z.object({ tenantId: z.string(), reason: z.string().min(10) }),
  }),
  z.object({
    type: z.literal("repairOwnerMembership"),
    input: z.object({ tenantId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("grantSupportAccess"),
    input: z.object({
      tenantId: z.string(),
      reason: z.string().min(10),
      durationMinutes: z.number().int().min(5).max(60),
    }),
  }),
  z.object({
    type: z.literal("rerunJob"),
    input: z.object({
      collectionName: replayCollection,
      jobId: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("revokeSupportAccess"),
    input: z.object({
      supportAccessId: z.string().min(1),
      reason: z.string().min(10),
    }),
  }),
  z.object({
    type: z.literal("approveDeletion"),
    input: z.object({
      requestId: z.string().min(1),
      reason: z.string().min(10),
    }),
  }),
]);
export const saasAdminCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      if (identity.platformAdmin !== true) throw new Error("FORBIDDEN");
      const parsed = command.parse(request.body);
      const db = getFirestore();
      const now = new Date().toISOString();
      let result: Record<string, unknown>;
      if (parsed.type === "setFeatureFlag") {
        await db
          .doc(`featureFlags/${parsed.input.key}`)
          .set(
            {
              id: parsed.input.key,
              ...parsed.input,
              createdAt: now,
              updatedAt: now,
              createdBy: identity.uid,
              updatedBy: identity.uid,
              archivedAt: null,
            },
            { merge: true },
          );
        result = { key: parsed.input.key, enabled: parsed.input.enabled };
      } else if (parsed.type === "suspendTenant") {
        await db
          .doc(`tenants/${parsed.input.tenantId}`)
          .update({
            status: "suspended",
            suspensionReason: parsed.input.reason,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        result = { tenantId: parsed.input.tenantId, status: "suspended" };
      } else if (parsed.type === "repairOwnerMembership") {
        const tenantReference = db.doc(`tenants/${parsed.input.tenantId}`);
        const membershipReference = db.doc(
          `memberships/${parsed.input.tenantId}_${identity.uid}`,
        );
        const [tenant, membership] = await Promise.all([
          tenantReference.get(),
          membershipReference.get(),
        ]);
        if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");
        if (tenant.get("createdBy") !== identity.uid)
          throw new Error("OWNER_RECOVERY_NOT_ALLOWED");
        if (membership.exists) {
          if (
            membership.get("tenantId") !== parsed.input.tenantId ||
            membership.get("userId") !== identity.uid
          )
            throw new Error("MEMBERSHIP_IDENTITY_MISMATCH");
          if (
            membership.get("role") !== "studio_owner" ||
            membership.get("status") !== "active"
          )
            throw new Error("MEMBERSHIP_REQUIRES_MANUAL_REVIEW");
          result = {
            tenantId: parsed.input.tenantId,
            membershipId: membership.id,
            repaired: false,
          };
        } else {
          await membershipReference.create({
            id: membershipReference.id,
            tenantId: parsed.input.tenantId,
            userId: identity.uid,
            role: "studio_owner",
            explicitPermissions: [],
            projectIds: [],
            status: "active",
            recoverySource: "platform_owner_self_recovery",
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          result = {
            tenantId: parsed.input.tenantId,
            membershipId: membershipReference.id,
            repaired: true,
          };
        }
      } else if (parsed.type === "grantSupportAccess") {
        const id = `support_${parsed.input.tenantId}_${Date.now()}`;
        const expiresAt = new Date(
          Date.now() + parsed.input.durationMinutes * 60000,
        ).toISOString();
        await db
          .doc(`supportAccess/${id}`)
          .create({
            id,
            tenantId: parsed.input.tenantId,
            platformUserId: identity.uid,
            reason: parsed.input.reason,
            status: "active",
            expiresAt,
            revokedAt: null,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
          });
        result = {
          tenantId: parsed.input.tenantId,
          supportAccessId: id,
          expiresAt,
        };
      } else if (parsed.type === "rerunJob") {
        const jobReference = db.doc(
          `${parsed.input.collectionName}/${parsed.input.jobId}`,
        );
        const job = await jobReference.get();
        if (!job.exists) throw new Error("JOB_NOT_FOUND");
        const previousStatus =
          parsed.input.collectionName === "domainEvents"
            ? String(job.get("processingStatus"))
            : String(job.get("status"));
        if (
          ![
            "dead_letter",
            "failed",
            "publish_retry",
            "processing_failed",
          ].includes(previousStatus)
        )
          throw new Error("JOB_NOT_RERUNNABLE");
        const replayId = randomUUID();
        if (parsed.input.collectionName === "domainEvents") {
          await jobReference.update({
            processingStatus: "publish_retry",
            publishError: null,
            manualReplayId: replayId,
            manualRerunBy: identity.uid,
            updatedAt: now,
          });
        } else if (parsed.input.collectionName === "automationRuns") {
          await jobReference.update({
            status: "retry_scheduled",
            nextAttemptAt: now,
            error: null,
            manualReplayId: replayId,
            manualRerunBy: identity.uid,
            updatedAt: now,
          });
        } else {
          await jobReference.update({
            status: "queued",
            nextAttemptAt: now,
            error: null,
            manualReplayId: replayId,
            manualRerunBy: identity.uid,
            updatedAt: now,
          });
        }
        result = {
          tenantId: String(job.get("tenantId")),
          jobId: parsed.input.jobId,
          collectionName: parsed.input.collectionName,
          previousStatus,
          replayId,
          status:
            parsed.input.collectionName === "domainEvents"
              ? "publish_retry"
              : parsed.input.collectionName === "automationRuns"
                ? "retry_scheduled"
                : "queued",
        };
      } else if (parsed.type === "revokeSupportAccess") {
        const reference = db.doc(
          `supportAccess/${parsed.input.supportAccessId}`,
        );
        const access = await reference.get();
        if (!access.exists || access.get("status") !== "active")
          throw new Error("SUPPORT_ACCESS_NOT_ACTIVE");
        await reference.update({
          status: "revoked",
          revokedAt: now,
          revokedBy: identity.uid,
          revocationReason: parsed.input.reason,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          tenantId: String(access.get("tenantId")),
          supportAccessId: parsed.input.supportAccessId,
          status: "revoked",
        };
      } else {
        const reference = db.doc(`deletionRequests/${parsed.input.requestId}`);
        const deletion = await reference.get();
        if (!deletion.exists || deletion.get("status") !== "cooling_off")
          throw new Error("DELETION_REQUEST_NOT_APPROVABLE");
        const tenantId = String(deletion.get("tenantId"));
        const exports = await db
          .collection("exportJobs")
          .where("tenantId", "==", tenantId)
          .where("status", "==", "complete")
          .limit(1)
          .get();
        if (exports.empty) throw new Error("COMPLETED_EXPORT_REQUIRED");
        await reference.update({
          status: "platform_approved",
          platformApprovedAt: now,
          platformApprovedBy: identity.uid,
          approvalReason: parsed.input.reason,
          updatedAt: now,
        });
        result = {
          tenantId,
          requestId: parsed.input.requestId,
          status: "platform_approved",
        };
      }
      await db
        .collection("auditEvents")
        .add({
          tenantId: String(result.tenantId ?? "platform"),
          projectId: null,
          actorId: identity.uid,
          actorType: "platform_admin",
          action: `platform.${parsed.type}`,
          entityType: "platform_operation",
          entityId: String(
            result.tenantId ??
              result.key ??
              result.supportAccessId ??
              result.jobId,
          ),
          timestamp: now,
          before: null,
          after: result,
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: request.get("x-correlation-id") ?? randomUUID(),
          automationRunId: null,
          providerEventId: null,
        });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "ADMIN_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
