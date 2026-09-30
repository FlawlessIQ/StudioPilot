import { createHash, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { requireActiveSubscription } from "../saas/entitlement-guard.js";
import { productEvent } from "../operations/product-events.js";
import { studioHubCors } from "../security/cors.js";
import {
  discardDeliveryDraft,
  markDeliveryComplete,
  recordDeliveryInputSchema,
  releaseDeliverables,
  replaceDeliveryLink,
  replaceDeliveryLinkInputSchema,
} from "./release.js";
import {
  closeoutStatusFrom,
  requirementIsSatisfied,
  requirementMayBeAttested,
  type CloseoutRequirement,
} from "./closeout-attestation.js";
import { postProductionUndoRefusal, previousAlbumStatus } from "./undo.js";

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
    input: recordDeliveryInputSchema,
  }),
  z.object({
    type: z.literal("markDeliveryComplete"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      reviewDestinationUrl: z.string().url().nullable().default(null),
      reviewDestinationLabel: z
        .enum(["google", "weddingwire", "the_knot", "facebook", "custom"])
        .default("google"),
    }),
  }),
  z.object({
    type: z.literal("discardDeliveryDraft"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string(), deliveryDraftId: z.string().min(1) }),
  }),
  z.object({
    /** A wrong gallery link taken back and put right (release.ts). */
    type: z.literal("replaceDeliveryLink"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: replaceDeliveryLinkInputSchema,
  }),
  z.object({
    /** "Don't ask this couple for a review": pending asks stop, none are scheduled. */
    type: z.literal("skipReviewRequests"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      reason: z.string().trim().max(500).nullable().default(null),
    }),
  }),
  z.object({
    /** Untick one post-production step ticked by mistake (./undo.ts). */
    type: z.literal("undoPostProductionStep"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      step,
      notes: z.string().max(2000).nullable().default(null),
    }),
  }),
  z.object({
    /** Put an album back one status (./undo.ts). */
    type: z.literal("revertAlbumStatus"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      albumWorkflowId: z.string(),
      notes: z.string().max(2000).nullable().default(null),
    }),
  }),
  z.object({
    type: z.literal("updateAlbumStatus"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      albumWorkflowId: z.string(),
      status: z.enum([
        "instructions_available",
        "instructions_viewed",
        "selections_pending",
        "selections_received",
        "design_sent",
        "revision_requested",
        "approved",
        "fulfilled",
      ]),
      evidenceUrl: z.string().url().nullable(),
      evidenceId: z.string().nullable(),
      notes: z.string().max(2000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("markDeliveryDownloaded"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string(), deliveryRecordId: z.string() }),
  }),
  z.object({
    type: z.literal("markReviewOpened"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string(), reviewRequestId: z.string() }),
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
    type: z.literal("prepareCloseout"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string() }),
  }),
  z.object({
    /**
     * A studio vouching for a closeout requirement that was satisfied somewhere
     * StudioCue cannot see — the couple confirmed the gallery by text, the COI
     * went to the venue from the photographer's own account, the second
     * shooter is finished but never filed a closeout.
     *
     * The note is required and has a floor, because "done" is not a reason and
     * this ends up in the audit log.
     */
    type: z.literal("attestCloseoutRequirement"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string(),
      closeoutId: z.string(),
      requirementKey: z.string().min(1).max(60),
      note: z.string().trim().min(8).max(500),
    }),
  }),
  z.object({
    type: z.literal("archiveProject"),
    tenantId: z.string(),
    idempotencyKey: z.string().min(8),
    input: z.object({ projectId: z.string(), closeoutId: z.string() }),
  }),
]);
const internalRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
  "staff_videographer",
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
      // Whole-product billing gate (studio commands require a live subscription).
      await requireActiveSubscription(db, parsed.tenantId);
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
        const galleryToken = randomBytes(24).toString("base64url");
        const galleryInboxReference = db.doc(
          `galleryInboxes/${parsed.input.projectId}`,
        );
        await db.runTransaction(async (transaction) => {
          const [current, galleryInbox] = await Promise.all([
            transaction.get(reference),
            transaction.get(galleryInboxReference),
          ]);
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
          // Only the backup is a gate (decided 2026-09-28, Q23). Cull, edit
          // and ready are progress, ticked in whatever order the work goes —
          // a film's edit and a gallery's are separate tracks, and one ladder
          // held both back.
          const dependency = index > 0 ? "backup_complete" : null;
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
          // Jobs that entered post-production before the opener created the
          // inbox get one on their first tick.
          if (!galleryInbox.exists) {
            const inboundDomain = process.env.SENDGRID_INBOUND_DOMAIN;
            transaction.create(galleryInboxReference, {
              id: parsed.input.projectId,
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              inboundAddress: inboundDomain
                ? `gallery+${galleryToken}@${inboundDomain}`
                : null,
              tokenHash: createHash("sha256").update(galleryToken).digest("hex"),
              status: inboundDomain ? "active" : "configuration_required",
              lastReceivedAt: null,
              createdAt: now,
              updatedAt: now,
              createdBy: identity.uid,
              updatedBy: identity.uid,
              archivedAt: null,
            });
          }
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
        // See post-event/release.ts: repeatable, one or more deliverables per
        // release, follow-ups once per job.
        try {
          result = await releaseDeliverables(
            db,
            {
              tenantId: parsed.tenantId,
              actorId: identity.uid,
              role,
              idempotencyKey: parsed.idempotencyKey,
              now,
            },
            parsed.input,
          );
        } catch (caught: unknown) {
          // A second release racing the first: the delivery ids are derived
          // from the idempotency key, so the loser's creates collide.
          if ((caught as { code?: unknown }).code === 6)
            throw new Error("DELIVERY_ALREADY_RECORDED");
          throw caught;
        }
      } else if (parsed.type === "markDeliveryComplete") {
        if (!["studio_owner", "studio_admin", "studio_coordinator"].includes(role))
          throw new Error("FORBIDDEN");
        result = await markDeliveryComplete(
          db,
          { tenantId: parsed.tenantId, actorId: identity.uid, now },
          parsed.input,
        );
      } else if (parsed.type === "discardDeliveryDraft") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        result = await discardDeliveryDraft(
          db,
          { tenantId: parsed.tenantId, actorId: identity.uid, now },
          parsed.input,
        );
      } else if (parsed.type === "replaceDeliveryLink") {
        // It writes to the couple and takes a link back out of their hands,
        // so it is owner-or-admin work, like confirming a review.
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        try {
          result = await replaceDeliveryLink(
            db,
            {
              tenantId: parsed.tenantId,
              actorId: identity.uid,
              idempotencyKey: parsed.idempotencyKey,
              now,
            },
            parsed.input,
          );
        } catch (caught: unknown) {
          // A double press: the new record's id comes from the idempotency key.
          if ((caught as { code?: unknown }).code === 6)
            throw new Error("DELIVERY_ALREADY_REPLACED");
          throw caught;
        }
      } else if (parsed.type === "skipReviewRequests") {
        /**
         * "Don't ask this couple for a review" (Wave 2).
         *
         * The only way to stop the asks was `confirmReview`, which records a
         * review that never happened — so a studio whose couple complained,
         * or who asks for reviews by hand, either lied to its own records or
         * let the asks go. This stops them honestly: every ask not yet sent is
         * `skipped`, an ask whose email is still queued is `skipped` too (the
         * email worker re-reads it and holds the send), and the job records
         * the decision so a later delivery schedules none and closeout does
         * not wait on one.
         */
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const projectReference = db.doc(`projects/${parsed.input.projectId}`);
        result = await db.runTransaction(async (transaction) => {
          const [project, asks] = await Promise.all([
            transaction.get(projectReference),
            transaction.get(
              db
                .collection("reviewRequests")
                .where("tenantId", "==", parsed.tenantId)
                .where("projectId", "==", parsed.input.projectId),
            ),
          ]);
          if (!project.exists || project.get("tenantId") !== parsed.tenantId)
            throw new Error("PROJECT_NOT_FOUND");
          const emailJobs = await Promise.all(
            asks.docs.map((ask) =>
              transaction.get(db.doc(`emailJobs/review_${ask.id}`)),
            ),
          );
          const stopped: string[] = [];
          asks.docs.forEach((ask, index) => {
            const status = String(ask.get("status"));
            const job = emailJobs[index]!;
            const emailPending =
              status === "sent" &&
              job.exists &&
              ["queued", "retry_scheduled"].includes(
                String(job.get("status")),
              );
            if (status !== "scheduled" && !emailPending) return;
            stopped.push(ask.id);
            transaction.update(ask.ref, {
              status: "skipped",
              skippedBy: identity.uid,
              skippedReason: parsed.input.reason,
              updatedAt: now,
              updatedBy: identity.uid,
            });
          });
          transaction.update(projectReference, {
            reviewRequestsSkippedAt: now,
            reviewRequestsSkippedBy: identity.uid,
            reviewRequestsSkippedReason: parsed.input.reason ?? "studio_skipped",
            ...(project.get("nextAction") === "Confirm the couple's review" ||
            project.get("nextAction") === "Monitor delivery and review request"
              ? { nextAction: "Close out the job" }
              : {}),
            updatedAt: now,
            updatedBy: identity.uid,
          });
          return {
            projectId: parsed.input.projectId,
            reviewRequestsStopped: stopped.length,
            reviewRequestIds: stopped,
            status: "skipped",
          };
        });
      } else if (parsed.type === "undoPostProductionStep") {
        if (!internalRoles.has(role)) throw new Error("FORBIDDEN");
        const reference = db.doc(
          `postProductionRecords/${parsed.input.projectId}`,
        );
        result = await db.runTransaction(async (transaction) => {
          const current = await transaction.get(reference);
          if (!current.exists || current.get("tenantId") !== parsed.tenantId)
            throw new Error("POST_PRODUCTION_NOT_FOUND");
          const steps = (current.get("steps") ?? {}) as Record<
            string,
            Record<string, unknown> | undefined
          >;
          const refusal = postProductionUndoRefusal(steps, parsed.input.step);
          if (refusal) throw new Error(refusal);
          const previous = steps[parsed.input.step] ?? null;
          transaction.update(reference, {
            [`steps.${parsed.input.step}`]: {
              complete: false,
              completedAt: null,
              completedBy: null,
              evidenceId: null,
              notes: parsed.input.notes,
              undoneAt: now,
              undoneBy: identity.uid,
            },
            updatedAt: now,
            updatedBy: identity.uid,
          });
          // What was undone, in the audit event every command writes below.
          return {
            projectId: parsed.input.projectId,
            step: parsed.input.step,
            status: "undone",
            previous,
          };
        });
      } else if (parsed.type === "revertAlbumStatus") {
        // The same bar as releasing a proof or recording fulfilment.
        if (
          !["studio_owner", "studio_admin", "studio_coordinator"].includes(role)
        )
          throw new Error("FORBIDDEN");
        const reference = db.doc(
          `albumWorkflows/${parsed.input.albumWorkflowId}`,
        );
        result = await db.runTransaction(async (transaction) => {
          const current = await transaction.get(reference);
          if (
            !current.exists ||
            current.get("tenantId") !== parsed.tenantId ||
            current.get("projectId") !== parsed.input.projectId
          )
            throw new Error("ALBUM_WORKFLOW_NOT_FOUND");
          const from = String(current.get("status"));
          const history = Array.isArray(current.get("statusHistory"))
            ? (current.get("statusHistory") as unknown[])
            : [];
          const to = previousAlbumStatus(from, history);
          if (!to) throw new Error("ALBUM_NOTHING_TO_UNDO");
          /**
           * Reminders the forward step stopped are not re-armed: a nudge the
           * couple may already have had, sent again after a correction, is
           * worse than none. Fulfilment evidence goes with the fulfilment.
           */
          transaction.update(reference, {
            status: to,
            ...(from === "fulfilled" ? { fulfillmentEvidenceId: null } : {}),
            statusHistory: [
              ...history,
              {
                status: to,
                occurredAt: now,
                actorId: identity.uid,
                notes: parsed.input.notes ?? `Put back from ${from}.`,
                undoneFrom: from,
              },
            ].slice(-100),
            updatedAt: now,
            updatedBy: identity.uid,
          });
          return {
            albumWorkflowId: reference.id,
            status: to,
            undoneFrom: from,
          };
        });
      } else if (parsed.type === "updateAlbumStatus") {
        const reference = db.doc(
          `albumWorkflows/${parsed.input.albumWorkflowId}`,
        );
        const current = await reference.get();
        if (
          !current.exists ||
          current.get("tenantId") !== parsed.tenantId ||
          current.get("projectId") !== parsed.input.projectId
        )
          throw new Error("ALBUM_WORKFLOW_NOT_FOUND");
        const clientAllowed = new Set([
          "instructions_viewed",
          "selections_received",
          "revision_requested",
          "approved",
        ]);
        if (role === "client" && !clientAllowed.has(parsed.input.status))
          throw new Error("FORBIDDEN");
        // A couple takes the step in front of them, not any step later than
        // where they are: approving before a design was sent, or asking to
        // revise one that was already approved, used to be accepted.
        const clientFrom: Record<string, string[]> = {
          instructions_viewed: ["instructions_available"],
          selections_received: [
            "instructions_available",
            "instructions_viewed",
            "selections_pending",
          ],
          revision_requested: ["design_sent"],
          approved: ["design_sent"],
        };
        if (
          role === "client" &&
          !clientFrom[parsed.input.status]?.includes(String(current.get("status")))
        )
          throw new Error("ALBUM_STEP_NOT_AVAILABLE");
        if (role !== "client" && !internalRoles.has(role))
          throw new Error("FORBIDDEN");
        const order = [
          "instructions_available",
          "instructions_viewed",
          "selections_pending",
          "selections_received",
          "design_sent",
          "revision_requested",
          "approved",
          "fulfilled",
        ];
        const currentIndex = order.indexOf(String(current.get("status")));
        const nextIndex = order.indexOf(parsed.input.status);
        if (
          nextIndex < 0 ||
          (parsed.input.status !== "revision_requested" &&
            nextIndex < currentIndex)
        )
          throw new Error("ALBUM_STATUS_REGRESSION");
        if (
          ["design_sent", "fulfilled"].includes(parsed.input.status) &&
          !["studio_owner", "studio_admin", "studio_coordinator"].includes(role)
        )
          throw new Error("ALBUM_CREATIVE_AUTHORITY_REQUIRED");
        const history = Array.isArray(current.get("statusHistory"))
          ? (current.get("statusHistory") as unknown[])
          : [];
        const batch = db.batch();
        batch.update(reference, {
          status: parsed.input.status,
          selectionUrl:
            parsed.input.status === "selections_received"
              ? parsed.input.evidenceUrl
              : current.get("selectionUrl") ?? null,
          designProofUrl:
            parsed.input.status === "design_sent"
              ? parsed.input.evidenceUrl
              : current.get("designProofUrl") ?? null,
          fulfillmentEvidenceId:
            parsed.input.status === "fulfilled"
              ? parsed.input.evidenceId
              : current.get("fulfillmentEvidenceId") ?? null,
          statusHistory: [
            ...history,
            {
              status: parsed.input.status,
              occurredAt: now,
              actorId: identity.uid,
              notes: parsed.input.notes,
            },
          ].slice(-100),
          updatedAt: now,
          updatedBy: identity.uid,
        });
        if (
          [
            "selections_received",
            "design_sent",
            "revision_requested",
            "approved",
            "fulfilled",
          ].includes(parsed.input.status)
        ) {
          const reminders = await db
            .collection("albumReminders")
            .where("tenantId", "==", parsed.tenantId)
            .where("albumWorkflowId", "==", reference.id)
            .where("status", "==", "scheduled")
            .get();
          for (const reminder of reminders.docs)
            batch.update(reminder.ref, {
              status: "skipped",
              stoppedByStatus: parsed.input.status,
              updatedAt: now,
            });
        }
        if (parsed.input.status === "approved") {
          const event = productEvent({
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            actorId: identity.uid,
            actorType: role === "client" ? "client" : "user",
            name: "lifecycle.album_approved",
            occurredAt: now,
            correlationId: parsed.idempotencyKey,
            sourceEntityType: "albumWorkflow",
            sourceEntityId: reference.id,
            properties: {
              creativeAuthority: "studio_human",
            },
          });
          batch.create(db.doc(`productEvents/${event.id}`), event);
        }
        await batch.commit();
        result = {
          albumWorkflowId: reference.id,
          status: parsed.input.status,
          remindersStopped: [
            "selections_received",
            "design_sent",
            "revision_requested",
            "approved",
            "fulfilled",
          ].includes(parsed.input.status),
          creativeAuthority: "studio_human",
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
      } else if (parsed.type === "markReviewOpened") {
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
        const status = String(current.get("status"));
        const confirmed = ["client_confirmed", "manually_confirmed"].includes(status);
        await reference.update({
          ...(!confirmed ? { status: "opened" } : {}),
          openedAt: current.get("openedAt") ?? now,
          clickedAt: now,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        result = {
          reviewRequestId: parsed.input.reviewRequestId,
          status: confirmed ? status : "opened",
          reviewCompletionClaimed: false,
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
        // A couple's own confirmation is the stronger record; a studio's
        // "they reviewed us" afterwards (Cue's card offered it on
        // client_confirmed asks) must not overwrite who confirmed it.
        const alreadyConfirmed = ["client_confirmed", "manually_confirmed"].includes(
          String(current.get("status")),
        );
        if (!alreadyConfirmed)
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
          status: alreadyConfirmed
            ? String(current.get("status"))
            : client
              ? "client_confirmed"
              : "manually_confirmed",
          remainingRequestsStopped: true,
        };
      } else if (parsed.type === "prepareCloseout") {
        if (
          !["studio_owner", "studio_admin", "studio_coordinator"].includes(role)
        )
          throw new Error("FORBIDDEN");
        const [
          project,
          contracts,
          invoices,
          schedules,
          deliveries,
          albums,
          reviews,
          crewAssignments,
          insuranceRequests,
        ] = await Promise.all([
          db.doc(`projects/${parsed.input.projectId}`).get(),
          db
            .collection("contracts")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
          db
            .collection("invoiceReferences")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
          db
            .collection("schedules")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
          db
            .collection("deliveryRecords")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
          db
            .collection("albumWorkflows")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
          db
            .collection("reviewRequests")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
          db
            .collection("crewAssignments")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
          db
            .collection("insuranceRequests")
            .where("tenantId", "==", parsed.tenantId)
            .where("projectId", "==", parsed.input.projectId)
            .get(),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== parsed.tenantId ||
          !["DELIVERED", "REVIEW_REQUESTED", "CLOSED"].includes(
            String(project.get("state")),
          )
        )
          throw new Error("PROJECT_NOT_READY_FOR_CLOSEOUT");
        const signedContract = contracts.docs.find((item) =>
          ["completed", "signed"].includes(String(item.get("status"))),
        );
        const finalInvoice = invoices.docs.find(
          (item) => item.get("kind") === "final",
        );
        const currentSchedule = schedules.docs
          .filter((item) =>
            ["approved", "published"].includes(String(item.get("status"))),
          )
          .sort(
            (left, right) =>
              Number(right.get("version")) - Number(left.get("version")),
          )[0];
        const delivery = deliveries.docs.find((item) =>
          ["downloaded", "viewed"].includes(String(item.get("status"))),
        );
        const unfinishedAlbum = albums.docs.find(
          (item) => item.get("status") !== "fulfilled",
        );
        const reviewAsk = reviews.docs.find((item) =>
          [
            "sent",
            "delivered",
            "opened",
            "clicked",
            "client_confirmed",
            "manually_confirmed",
          ].includes(String(item.get("status"))),
        );
        const incompleteCrew = crewAssignments.docs.find(
          (item) =>
            !["completed", "cancelled", "reassigned", "declined", "expired"].includes(
              String(item.get("status")),
            ),
        );
        const undeliveredCoi = insuranceRequests.docs.find(
          (item) =>
            !["sent_to_venue", "venue_acknowledged"].includes(
              String(item.get("status")),
            ),
        );
        const requirements = [
          {
            key: "contract",
            label: "Signed contract recorded",
            complete: Boolean(signedContract),
            evidenceId: signedContract?.id ?? null,
          },
          {
            key: "final_balance",
            label: "Final QuickBooks balance settled",
            complete:
              Boolean(finalInvoice) &&
              Number(finalInvoice?.get("balanceCents") ?? 1) === 0 &&
              finalInvoice?.get("status") === "paid",
            evidenceId: finalInvoice?.id ?? null,
            // An imported or legacy job with no package: nothing to record a
            // payment against, so it may be vouched for (closeout-attestation.ts).
            noAgreedBalance: !String(project.get("packageSnapshotId") ?? ""),
          },
          {
            key: "schedule",
            label: "Final schedule published",
            complete: Boolean(currentSchedule),
            evidenceId: currentSchedule?.id ?? null,
          },
          {
            key: "delivery",
            label: "Gallery delivered and accessed",
            complete: Boolean(delivery),
            evidenceId: delivery?.id ?? null,
          },
          {
            key: "album",
            label: "Album fulfilled or not included",
            complete: albums.empty || !unfinishedAlbum,
            evidenceId:
              albums.docs.find((item) => item.get("status") === "fulfilled")
                ?.id ?? null,
          },
          {
            key: "review_request",
            label: "Review request sent",
            // The studio chose not to ask (or delivered with no review link):
            // a decision, recorded on the job, not a gap to vouch around.
            complete:
              Boolean(reviewAsk) ||
              typeof project.get("reviewRequestsSkippedAt") === "string",
            evidenceId:
              reviewAsk?.id ??
              (typeof project.get("reviewRequestsSkippedAt") === "string"
                ? "review_requests_skipped"
                : null),
          },
          {
            key: "crew",
            label: "Crew assignments closed",
            complete: !incompleteCrew,
            evidenceId: incompleteCrew ? null : "crew_assignments_complete",
          },
          {
            key: "insurance",
            label: "Required COI delivered",
            complete: insuranceRequests.empty || !undeliveredCoi,
            evidenceId:
              insuranceRequests.docs.find((item) =>
                ["sent_to_venue", "venue_acknowledged"].includes(
                  String(item.get("status")),
                ),
              )?.id ?? null,
          },
        ];
        const closeoutId = `closeout_${parsed.input.projectId}`;
        const reference = db.doc(`projectCloseouts/${closeoutId}`);
        const current = await reference.get();
        /**
         * Carry forward what a studio has already vouched for.
         *
         * The requirements above are recomputed from the records on every
         * reconcile, so without this a studio that vouched for the gallery on
         * Monday would find it outstanding again on Tuesday, and the job would
         * never close. An attestation is a decision someone recorded; only a
         * new decision should remove it.
         */
        const priorAttestations = new Map(
          ((current.get("requirements") as CloseoutRequirement[] | undefined) ??
            [])
            .filter((item) => item?.attestation)
            .map((item) => [item.key, item.attestation ?? null]),
        );
        const withAttestations: CloseoutRequirement[] = requirements.map(
          (item) => {
            const attestation = priorAttestations.get(item.key) ?? null;
            // An attestation is redundant once the records prove it, and
            // keeping it would misreport how the job actually closed.
            return item.complete || !attestation
              ? { ...item, attestation: null }
              : { ...item, attestation };
          },
        );
        const status = closeoutStatusFrom(withAttestations);
        await reference.set(
          {
            id: closeoutId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            status,
            requirements: withAttestations,
            completedAt: current.get("completedAt") ?? null,
            completedBy: current.get("completedBy") ?? null,
            summaryDocumentId: current.get("summaryDocumentId") ?? null,
            createdAt: current.get("createdAt") ?? now,
            updatedAt: now,
            createdBy: current.get("createdBy") ?? identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          },
          { merge: true },
        );
        result = {
          closeoutId,
          status,
          // Attested requirements are not blockers; that is the point of
          // attesting them.
          blockers: withAttestations
            .filter((item) => !item.complete && !item.attestation)
            .map((item) => item.label),
          requirements: withAttestations,
        };
      } else if (parsed.type === "attestCloseoutRequirement") {
        /**
         * Closing a job is consequential, so vouching for a piece of its
         * evidence is owner-or-admin work, the same bar as closeProject below.
         */
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("CLOSEOUT_ATTESTATION_PERMISSION_REQUIRED");
        const reference = db.doc(`projectCloseouts/${parsed.input.closeoutId}`);
        result = await db.runTransaction(async (transaction) => {
          const closeout = await transaction.get(reference);
          if (
            !closeout.exists ||
            closeout.get("tenantId") !== parsed.tenantId ||
            closeout.get("projectId") !== parsed.input.projectId
          )
            throw new Error("CLOSEOUT_NOT_FOUND");
          if (closeout.get("status") === "completed")
            throw new Error("CLOSEOUT_ALREADY_COMPLETED");
          const existing =
            (closeout.get("requirements") as CloseoutRequirement[] | undefined) ??
            [];
          const target = existing.find(
            (item) => item.key === parsed.input.requirementKey,
          );
          if (!target) throw new Error("CLOSEOUT_REQUIREMENT_NOT_FOUND");
          // Read off the stored requirement, not the key alone: the final
          // balance is vouchable only when the reconciler found no agreed
          // price to record a payment against.
          if (!requirementMayBeAttested(target))
            throw new Error("CLOSEOUT_REQUIREMENT_NEEDS_EVIDENCE");
          // Already proven by the records, so there is nothing to vouch for.
          if (target.complete === true)
            throw new Error("CLOSEOUT_REQUIREMENT_ALREADY_MET");
          const attestation = {
            attestedBy: identity.uid,
            attestedAt: now,
            note: parsed.input.note,
          };
          const updated = existing.map((item) =>
            item.key === parsed.input.requirementKey
              ? { ...item, attestation }
              : item,
          );
          const status = closeoutStatusFrom(updated);
          transaction.update(reference, {
            requirements: updated,
            status,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          const auditId = `audit_closeout_attested_${parsed.input.closeoutId}_${parsed.input.requirementKey}`;
          transaction.set(db.doc(`auditEvents/${auditId}`), {
            id: auditId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            actorId: identity.uid,
            // A person vouching, never a provider confirming.
            actorType: "user",
            action: "closeout.requirement_attested",
            entityType: "projectCloseout",
            entityId: parsed.input.closeoutId,
            timestamp: now,
            before: { requirementKey: parsed.input.requirementKey, complete: false },
            after: {
              requirementKey: parsed.input.requirementKey,
              label: target.label,
              attestedBy: identity.uid,
              note: parsed.input.note,
              closeoutStatus: status,
            },
            ipAddress: null,
            userAgent: null,
            correlationId: parsed.idempotencyKey,
            automationRunId: null,
            providerEventId: null,
          });
          return {
            closeoutId: parsed.input.closeoutId,
            requirementKey: parsed.input.requirementKey,
            status,
            requirements: updated,
          };
        });
      } else if (parsed.type === "closeProject") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const closeoutReference = db.doc(
          `projectCloseouts/${parsed.input.closeoutId}`,
        );
        const closeout = await closeoutReference.get();
        const requirements =
          (closeout.get("requirements") as CloseoutRequirement[] | undefined) ??
          [];
        /**
         * The same predicate the reconciler uses.
         *
         * This read `item.complete !== true` and so ignored attestations
         * entirely: the reconciler would mark a closeout `ready` and this would
         * refuse it as blocked, with the Approve button visible and useless.
         * One rule, in one place — see ./closeout-attestation.ts.
         */
        if (
          !closeout.exists ||
          closeout.get("tenantId") !== parsed.tenantId ||
          closeout.get("projectId") !== parsed.input.projectId
        )
          throw new Error("CLOSEOUT_BLOCKED");
        /**
         * Name what is open, rather than "something".
         *
         * The reconciler checks eight requirements and the refusal reported
         * none of them, so the studio was told to go and reconcile the evidence
         * to discover what this function had already worked out. The names are
         * the studio's own requirement labels; `friendlyError` reads the text
         * after the colon.
         */
        const unmet = requirements
          .filter((requirement) => !requirementIsSatisfied(requirement))
          .map((requirement) =>
            typeof requirement.label === "string" && requirement.label
              ? requirement.label
              : String(requirement.key ?? "a closeout requirement"),
          );
        if (unmet.length)
          throw new Error(`CLOSEOUT_BLOCKED:${unmet.slice(0, 3).join(", ")}`);
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
        // `set`, not `create`: a job reopened after closing (crm reopenJob)
        // closes again, and its summary is rendered again rather than the
        // second close failing on the first summary's job.
        batch.set(db.doc(`pdfJobs/closeout_${parsed.input.closeoutId}`), {
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          closeoutId: parsed.input.closeoutId,
          type: "closeout_pdf",
          status: "queued",
          createdAt: now,
        });
        const event = productEvent({
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          name: "lifecycle.project_closed",
          occurredAt: now,
          correlationId: parsed.idempotencyKey,
          sourceEntityType: "projectCloseout",
          sourceEntityId: parsed.input.closeoutId,
          properties: {
            requirementCount: requirements?.length ?? 0,
            closeoutSummaryQueued: true,
          },
        });
        batch.create(db.doc(`productEvents/${event.id}`), event);
        await batch.commit();
        result = {
          projectId: parsed.input.projectId,
          state: "CLOSED",
          summaryQueued: true,
        };
      } else if (parsed.type === "archiveProject") {
        if (!["studio_owner", "studio_admin"].includes(role))
          throw new Error("FORBIDDEN");
        const [project, closeout] = await Promise.all([
          db.doc(`projects/${parsed.input.projectId}`).get(),
          db.doc(`projectCloseouts/${parsed.input.closeoutId}`).get(),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== parsed.tenantId ||
          project.get("state") !== "CLOSED" ||
          !closeout.exists ||
          closeout.get("tenantId") !== parsed.tenantId ||
          closeout.get("projectId") !== parsed.input.projectId ||
          closeout.get("status") !== "completed"
        )
          throw new Error("ARCHIVE_HANDOFF_BLOCKED");
        const productionReference = db.doc(
          `postProductionRecords/${parsed.input.projectId}`,
        );
        const batch = db.batch();
        batch.update(project.ref, {
          archivedAt: now,
          nextAction: "Archived",
          updatedAt: now,
          updatedBy: identity.uid,
        });
        batch.set(
          productionReference,
          {
            "steps.project_archived": {
              complete: true,
              completedAt: now,
              completedBy: identity.uid,
              evidenceId: parsed.input.closeoutId,
              notes: "Archive handoff completed after deterministic closeout.",
            },
            currentStep: "project_archived",
            updatedAt: now,
            updatedBy: identity.uid,
          },
          { merge: true },
        );
        batch.create(
          db.doc(`archiveHandoffs/${parsed.input.closeoutId}`),
          {
            id: parsed.input.closeoutId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            closeoutId: parsed.input.closeoutId,
            status: "completed",
            retentionReviewRequired: true,
            completedAt: now,
            completedBy: identity.uid,
            createdAt: now,
            updatedAt: now,
          },
        );
        await batch.commit();
        result = {
          projectId: parsed.input.projectId,
          archivedAt: now,
          retentionReviewRequired: true,
        };
      } else {
        /**
         * Unreachable, and typed so it stays that way.
         *
         * This chain used to end in a bare `else` that handled `exportReport`.
         * That command queued a `reportJobs` document and nothing anywhere
         * consumed the collection, so a caller would have got `status:
         * "queued"` and waited forever; the reports page builds its CSV in the
         * browser from live data instead. Removing it left the chain with no
         * final branch, which is the right shape — a command added to the union
         * without a handler should fail the build here rather than fall into
         * whatever the last branch happened to be.
         */
        const unhandled: never = parsed;
        throw new Error(
          `POST_EVENT_COMMAND_UNHANDLED:${(unhandled as { type: string }).type}`,
        );
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
          entityType: "project",
          entityId: String(projectId ?? ""),
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
