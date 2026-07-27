import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const step = z.enum([
  "backup_complete",
  "cull_complete",
  "editing_started",
  "editing_complete",
  "gallery_ready",
  "album_proof_ready",
  "delivery_sent",
  "client_downloaded",
  "project_archived",
]);
const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("completePostProductionStep"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      step,
      evidenceId: z.string().nullable(),
      notes: z.string().max(2000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("recordDelivery"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      provider: z.enum(["manual", "pixieset", "pic_time", "shootproof"]),
      galleryUrl: z.string().url(),
      accessCode: z.string().max(120).nullable(),
      expirationDate: z.string().date().nullable(),
      deliveryDate: z.string().date(),
      notes: z.string().max(3000).nullable(),
      reviewDestinationUrl: z.string().url(),
    }),
  }),
  z.object({
    type: z.literal("markDeliveryDownloaded"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string(), deliveryRecordId: z.string() }),
  }),
  z.object({
    type: z.literal("confirmReview"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string(), reviewRequestId: z.string() }),
  }),
  z.object({
    type: z.literal("closeProject"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string(), closeoutId: z.string() }),
  }),
  z.object({
    type: z.literal("exportReport"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      dateFrom: z.string().date(),
      dateTo: z.string().date(),
      projectType: z.string().nullable(),
      userId: z.string().nullable(),
    }),
  }),
]);
const internalRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
]);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const stable = (scope: string, tenantId: string, key: string) =>
  `${scope}_${hash(`${tenantId}:${key}`).slice(0, 32)}`;

export const postEventCommand = onRequest(
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
      const projectId =
        "projectId" in parsed.input ? parsed.input.projectId : null;
      const hasProject = (id: string) =>
        ["studio_owner", "studio_admin"].includes(role) ||
        (Array.isArray(projectIds) && projectIds.includes(id));
      if (projectId && !hasProject(projectId)) throw new Error("FORBIDDEN");
      const execution = db.doc(
        `commandExecutions/${stable("post_event", parsed.tenantId, parsed.idempotencyKey)}`,
      );
      const prior = await execution.get();
      if (prior.exists) {
        response.status(200).json(prior.get("result"));
        return;
      }
      const now = new Date().toISOString();
      let result: Record<string, unknown>;

      if (parsed.type === "completePostProductionStep") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const reference = db.doc(
          `postProductionRecords/${parsed.input.projectId}`,
        );
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(reference);
          if (!current.exists || current.get("tenantId") !== parsed.tenantId)
            throw new Error("POST_PRODUCTION_NOT_FOUND");
          const steps = current.get("steps") as Record<
            string,
            Record<string, unknown>
          >;
          const order = [
            "backup_complete",
            "cull_complete",
            "editing_started",
            "editing_complete",
            "gallery_ready",
            "album_proof_ready",
            "delivery_sent",
            "client_downloaded",
            "project_archived",
          ];
          const index = order.indexOf(parsed.input.step);
          const dependency =
            parsed.input.step === "album_proof_ready"
              ? "editing_complete"
              : index > 0
                ? order[index - 1]
                : null;
          if (dependency && steps[dependency]?.complete !== true)
            throw new Error(
              `POST_PRODUCTION_DEPENDENCY_INCOMPLETE:${dependency}`,
            );
          transaction.update(reference, {
            [`steps.${parsed.input.step}`]: {
              complete: true,
              completedAt: now,
              completedBy: identity.uid,
              evidenceId: parsed.input.evidenceId,
              notes: parsed.input.notes,
            },
            currentStep: order[Math.min(index + 1, order.length - 1)],
            updatedAt: now,
            updatedBy: identity.uid,
          });
        });
        result = {
          projectId: parsed.input.projectId,
          step: parsed.input.step,
          status: "complete",
        };
      } else if (parsed.type === "recordDelivery") {
        if (
          !["studio_owner", "studio_admin", "studio_coordinator"].includes(role)
        )
          throw new Error("FORBIDDEN");
        if (!parsed.input.galleryUrl.startsWith("https://"))
          throw new Error("DELIVERY_URL_MUST_USE_HTTPS");
        const production = await db
          .doc(`postProductionRecords/${parsed.input.projectId}`)
          .get();
        const steps = production.get("steps") as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (
          !production.exists ||
          production.get("tenantId") !== parsed.tenantId ||
          steps?.backup_complete?.complete !== true ||
          steps?.editing_complete?.complete !== true ||
          steps?.gallery_ready?.complete !== true
        )
          throw new Error("DELIVERY_GATE_BLOCKED");
        const deliveryId = stable(
          "delivery",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const deliveredAt = `${parsed.input.deliveryDate}T12:00:00.000Z`;
        const firstAt = new Date(
          new Date(deliveredAt).getTime() + 3 * 86400000,
        ).toISOString();
        const reminderAt = new Date(
          new Date(deliveredAt).getTime() + 10 * 86400000,
        ).toISOString();
        const projectReference = db.doc(`projects/${parsed.input.projectId}`);
        const project = await projectReference.get();
        if (
          !project.exists ||
          project.get("tenantId") !== parsed.tenantId ||
          project.get("state") !== "POST_PRODUCTION"
        )
          throw new Error("PROJECT_NOT_IN_POST_PRODUCTION");
        const batch = db.batch();
        batch.create(db.doc(`deliveryRecords/${deliveryId}`), {
          id: deliveryId,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          provider: parsed.input.provider,
          galleryUrl: parsed.input.galleryUrl,
          accessCode: parsed.input.accessCode,
          expirationDate: parsed.input.expirationDate,
          deliveryDate: parsed.input.deliveryDate,
          notes: parsed.input.notes,
          status: "sent",
          sentAt: now,
          viewedAt: null,
          downloadedAt: null,
          providerDeliveryId: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        });
        for (const [sequence, scheduledAt] of [
          [1, firstAt],
          [2, reminderAt],
        ] as const) {
          const reviewId = `review_${deliveryId}_${sequence}`;
          batch.create(db.doc(`reviewRequests/${reviewId}`), {
            id: reviewId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            deliveryRecordId: deliveryId,
            channel: "email",
            destinationLabel: "google",
            destinationUrl: parsed.input.reviewDestinationUrl,
            status: "scheduled",
            sequence,
            scheduledAt,
            sentAt: null,
            deliveredAt: null,
            openedAt: null,
            clickedAt: null,
            confirmedAt: null,
            confirmedBy: null,
            messageId: null,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
        }
        batch.update(projectReference, {
          state: "DELIVERED",
          stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
          nextAction: "Monitor delivery and review request",
          updatedAt: now,
          updatedBy: identity.uid,
        });
        batch.update(production.ref, {
          "steps.delivery_sent": {
            complete: true,
            completedAt: now,
            completedBy: identity.uid,
            evidenceId: deliveryId,
            notes: null,
          },
          currentStep: "client_downloaded",
          updatedAt: now,
          updatedBy: identity.uid,
        });
        await batch.commit();
        result = {
          deliveryRecordId: deliveryId,
          projectState: "DELIVERED",
          reviewRequestsScheduled: 2,
        };
      } else if (parsed.type === "markDeliveryDownloaded") {
        const reference = db.doc(
          `deliveryRecords/${parsed.input.deliveryRecordId}`,
        );
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("projectId") !== parsed.input.projectId
        )
          throw new Error("DELIVERY_NOT_FOUND");
        await reference.update({
          status: "downloaded",
          downloadedAt: now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          deliveryRecordId: parsed.input.deliveryRecordId,
          status: "downloaded",
        };
      } else if (parsed.type === "confirmReview") {
        const reference = db.doc(
          `reviewRequests/${parsed.input.reviewRequestId}`,
        );
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("projectId") !== parsed.input.projectId
        )
          throw new Error("REVIEW_REQUEST_NOT_FOUND");
        const client = role === "client";
        if (!client && !["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        await reference.update({
          status: client ? "client_confirmed" : "manually_confirmed",
          confirmedAt: now,
          confirmedBy: identity.uid,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        const pending = await db
          .collection("reviewRequests")
          .where("tenantId", "==", parsed.tenantId)
          .where("projectId", "==", parsed.input.projectId)
          .where("status", "==", "scheduled")
          .get();
        const batch = db.batch();
        for (const item of pending.docs)
          batch.update(item.ref, {
            status: "skipped",
            updatedAt: now,
            updatedBy: identity.uid,
          });
        await batch.commit();
        result = {
          reviewRequestId: parsed.input.reviewRequestId,
          status: client ? "client_confirmed" : "manually_confirmed",
          remainingRequestsStopped: true,
        };
      } else if (parsed.type === "closeProject") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const closeoutReference = db.doc(
          `projectCloseouts/${parsed.input.closeoutId}`,
        );
        const closeout = await closeoutReference.get();
        const requirements = closeout.get("requirements") as
          | Array<Record<string, unknown>>
          | undefined;
        if (
          !closeout.exists ||
          closeout.get("tenantId") !== parsed.tenantId ||
          closeout.get("projectId") !== parsed.input.projectId ||
          requirements?.some((item) => item.complete !== true)
        )
          throw new Error("CLOSEOUT_BLOCKED");
        const projectReference = db.doc(`projects/${parsed.input.projectId}`);
        const project = await projectReference.get();
        if (
          !project.exists ||
          !["DELIVERED", "REVIEW_REQUESTED"].includes(
            String(project.get("state")),
          )
        )
          throw new Error("PROJECT_NOT_CLOSEABLE");
        const batch = db.batch();
        batch.update(closeoutReference, {
          status: "completed",
          completedAt: now,
          completedBy: identity.uid,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        batch.update(projectReference, {
          state: "CLOSED",
          stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
          nextAction: "Archive after retention review",
          updatedAt: now,
          updatedBy: identity.uid,
        });
        batch.create(db.doc(`pdfJobs/closeout_${parsed.input.closeoutId}`), {
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          closeoutId: parsed.input.closeoutId,
          type: "closeout_pdf",
          status: "queued",
          createdAt: now,
        });
        await batch.commit();
        result = {
          projectId: parsed.input.projectId,
          state: "CLOSED",
          summaryQueued: true,
        };
      } else {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const jobId = stable(
          "report_export",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        await db
          .doc(`reportJobs/${jobId}`)
          .create({
            id: jobId,
            tenantId: parsed.tenantId,
            ...parsed.input,
            format: "csv",
            status: "queued",
            attempts: 0,
            createdAt: now,
            createdBy: identity.uid,
          });
        result = { reportJobId: jobId, status: "queued" };
      }
      const auditId = stable("audit", parsed.tenantId, parsed.idempotencyKey);
      await db
        .doc(`auditEvents/${auditId}`)
        .create({
          id: auditId,
          tenantId: parsed.tenantId,
          projectId,
          actorId: identity.uid,
          actorType: "user",
          action: `post_event.${parsed.type}`,
          entityType: parsed.type === "exportReport" ? "report" : "project",
          entityId: String(projectId ?? result.reportJobId ?? ""),
          timestamp: now,
          before: null,
          after: result,
          ipAddress: request.ip ?? null,
          userAgent: request.get("user-agent") ?? null,
          correlationId: parsed.idempotencyKey,
          automationRunId: null,
          providerEventId: null,
        });
      await execution.create({
        tenantId: parsed.tenantId,
        result,
        createdAt: now,
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "POST_EVENT_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
