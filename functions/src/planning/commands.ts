import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const item = z.object({
  id: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  title: z.string().min(1),
  description: z.string(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  travelMinutes: z.number().int().nonnegative(),
  photographerIds: z.array(z.string()),
  participants: z.array(z.string()),
  vendorContactIds: z.array(z.string()),
  equipment: z.array(z.string()),
  notes: z.string().nullable(),
  visibility: z.enum(["studio", "client", "crew", "shared"]),
  blockingIssues: z.array(z.string()),
});
const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("saveQuestionnaire"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      responseId: z.string(),
      projectId: z.string(),
      answers: z.record(z.string(), z.unknown()),
      submit: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("createVendor"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      company: z.string().min(1),
      contactName: z.string(),
      email: z.string().email().nullable(),
      type: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("decideCoi"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      requestId: z.string(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().min(5),
    }),
  }),
  z.object({
    type: z.literal("publishSchedule"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      timezone: z.string(),
      items: z.array(item).min(1),
      coverageMinutes: z.number().int().positive(),
    }),
  }),
  z.object({
    type: z.literal("approveSchedule"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      scheduleId: z.string(),
      decision: z.enum(["approved", "changes_requested"]),
      notes: z.string().max(2000),
    }),
  }),
]);
const internalRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
]);
function stable(scope: string, tenantId: string, key: string) {
  return `${scope}_${createHash("sha256").update(`${tenantId}:${key}`).digest("hex").slice(0, 32)}`;
}

export const planningCommand = onRequest(
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
      const parsed = command.parse(request.body);
      const db = getFirestore();
      const membership = await db
        .doc(`memberships/${parsed.tenantId}_${identity.uid}`)
        .get();
      if (!membership.exists || membership.get("status") !== "active")
        throw new Error("FORBIDDEN");
      const role = String(membership.get("role"));
      const projectIds = membership.get("projectIds") as unknown;
      if (
        !["studio_owner", "studio_admin"].includes(role) &&
        (!Array.isArray(projectIds) ||
          !projectIds.includes(parsed.input.projectId))
      )
        throw new Error("FORBIDDEN");
      const execution = db.doc(
        `commandExecutions/${stable("planning", parsed.tenantId, parsed.idempotencyKey)}`,
      );
      const prior = await execution.get();
      if (prior.exists) {
        response.status(200).json(prior.get("result"));
        return;
      }
      const now = new Date().toISOString();
      let result: Record<string, unknown>;
      if (parsed.type === "saveQuestionnaire") {
        const reference = db.doc(
          `questionnaireResponses/${parsed.input.responseId}`,
        );
        const snapshot = await reference.get();
        if (
          !snapshot.exists ||
          snapshot.get("tenantId") !== parsed.tenantId ||
          snapshot.get("projectId") !== parsed.input.projectId
        )
          throw new Error("RESPONSE_NOT_FOUND");
        await reference.update({
          answers: parsed.input.answers,
          status: parsed.input.submit ? "submitted" : "in_progress",
          completionPercent: parsed.input.submit
            ? 100
            : snapshot.get("completionPercent"),
          submittedAt: parsed.input.submit ? now : null,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          responseId: parsed.input.responseId,
          status: parsed.input.submit ? "submitted" : "in_progress",
        };
      } else if (parsed.type === "createVendor") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const id = stable("vendor", parsed.tenantId, parsed.idempotencyKey);
        await db
          .doc(`vendors/${id}`)
          .create({
            id,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            projectIds: [parsed.input.projectId],
            company: parsed.input.company,
            contactName: parsed.input.contactName,
            email: parsed.input.email,
            phone: null,
            type: parsed.input.type,
            website: null,
            address: null,
            notes: null,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
        result = { vendorId: id };
      } else if (parsed.type === "decideCoi") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const reference = db.doc(`insuranceRequests/${parsed.input.requestId}`);
        await db.runTransaction(async (tx) => {
          const current = await tx.get(reference);
          if (
            !current.exists ||
            current.get("tenantId") !== parsed.tenantId ||
            current.get("projectId") !== parsed.input.projectId ||
            !["under_review", "correction_required"].includes(
              String(current.get("status")),
            )
          )
            throw new Error("COI_NOT_REVIEWABLE");
          tx.update(reference, {
            status:
              parsed.input.decision === "approved"
                ? "approved"
                : "correction_required",
            humanDecision: parsed.input.decision,
            decisionReason: parsed.input.reason,
            decidedAt: now,
            decidedBy: identity.uid,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        });
        result = {
          requestId: parsed.input.requestId,
          decision: parsed.input.decision,
        };
      } else if (parsed.type === "publishSchedule") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const schedules = await db
          .collection("schedules")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .orderBy("version", "desc")
          .limit(1)
          .get();
        const priorSchedule = schedules.docs[0];
        const version = Number(priorSchedule?.get("version") ?? 0) + 1;
        const id = stable("schedule", parsed.tenantId, parsed.idempotencyKey);
        const acceptedAssignments = await db
          .collection("crewAssignments")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .where("status", "==", "accepted")
          .get();
        const batch = db.batch();
        if (priorSchedule)
          batch.update(priorSchedule.ref, {
            status: "superseded",
            updatedAt: now,
            updatedBy: identity.uid,
          });
        batch.create(db.doc(`schedules/${id}`), {
          id,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          version,
          status: "published",
          timezone: parsed.input.timezone,
          items: parsed.input.items,
          approvalState: "client_pending",
          publishedAt: now,
          approvedBy: null,
          pdfDocumentId: null,
          dropboxDocumentId: null,
          supersedesId: priorSchedule?.id ?? null,
          immutable: true,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        batch.create(db.doc(`pdfJobs/schedule_${id}`), {
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          scheduleId: id,
          type: "schedule_pdf",
          status: "queued",
          createdAt: now,
        });
        for (const assignment of acceptedAssignments.docs) {
          batch.update(assignment.ref, {
            currentScheduleId: id,
            currentScheduleVersion: version,
            acknowledgedScheduleVersion: null,
            scheduleAcknowledgedAt: null,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        }
        await batch.commit();
        result = {
          scheduleId: id,
          version,
          acknowledgementReset: true,
          crewNotified: acceptedAssignments.size,
        };
      } else {
        const reference = db.doc(`schedules/${parsed.input.scheduleId}`);
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("projectId") !== parsed.input.projectId
        )
          throw new Error("SCHEDULE_NOT_FOUND");
        await reference.update({
          approvalState:
            parsed.input.decision === "approved"
              ? "client_approved"
              : "changes_requested",
          status: parsed.input.decision,
          approvedBy:
            parsed.input.decision === "approved" ? identity.uid : null,
          approvalNotes: parsed.input.notes,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          scheduleId: parsed.input.scheduleId,
          decision: parsed.input.decision,
        };
      }
      await execution.create({
        tenantId: parsed.tenantId,
        result,
        createdAt: now,
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "PLANNING_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
