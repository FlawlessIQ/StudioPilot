import { createHash, randomBytes } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { productEvent } from "../operations/product-events.js";
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
      reviewDestinationLabel: z
        .enum(["google", "weddingwire", "the_knot", "facebook", "custom"])
        .default("google"),
      albumIncluded: z.boolean().default(false),
      albumInstructionsUrl: z.string().url().nullable().default(null),
      saveStudioDefaults: z.boolean().default(false),
      deliveryDraftId: z.string().min(1).nullable().default(null),
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
    type: z.literal("archiveProject"),
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
          if (parsed.input.step === "gallery_ready" && !galleryInbox.exists) {
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
        const [project, deliveryDraft] = await Promise.all([
          projectReference.get(),
          parsed.input.deliveryDraftId
            ? db.doc(`deliveryDrafts/${parsed.input.deliveryDraftId}`).get()
            : Promise.resolve(null),
        ]);
        if (
          !project.exists ||
          project.get("tenantId") !== parsed.tenantId ||
          project.get("state") !== "POST_PRODUCTION"
        )
          throw new Error("PROJECT_NOT_IN_POST_PRODUCTION");
        if (
          deliveryDraft &&
          (!deliveryDraft.exists ||
            deliveryDraft.get("tenantId") !== parsed.tenantId ||
            deliveryDraft.get("projectId") !== parsed.input.projectId ||
            deliveryDraft.get("status") !== "review_required")
        ) throw new Error("DELIVERY_DRAFT_INVALID");
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
        batch.create(db.doc(`emailJobs/delivery_${deliveryId}`), {
          id: `delivery_${deliveryId}`,
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          type: "delivery",
          deliveryRecordId: deliveryId,
          galleryUrl: parsed.input.galleryUrl,
          accessCode: parsed.input.accessCode,
          expirationDate: parsed.input.expirationDate,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        for (const [sequence, scheduledAt, channel] of [
          [1, firstAt, "portal"],
          [2, reminderAt, "email"],
        ] as const) {
          const reviewId = `review_${deliveryId}_${sequence}`;
          batch.create(db.doc(`reviewRequests/${reviewId}`), {
            id: reviewId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            deliveryRecordId: deliveryId,
            channel,
            destinationLabel: parsed.input.reviewDestinationLabel,
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
        if (parsed.input.albumIncluded) {
          const albumId = `album_${deliveryId}`;
          batch.create(db.doc(`albumWorkflows/${albumId}`), {
            id: albumId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            deliveryRecordId: deliveryId,
            status: "instructions_available",
            instructionsUrl: parsed.input.albumInstructionsUrl,
            selectionUrl: null,
            designProofUrl: null,
            fulfillmentEvidenceId: null,
            creativeAuthority: "studio_human",
            statusHistory: [
              {
                status: "instructions_available",
                occurredAt: now,
                actorId: identity.uid,
                notes: "Album workflow created with gallery delivery.",
              },
            ],
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          for (const [sequence, daysAfter] of [
            [1, 7],
            [2, 14],
          ] as const) {
            const scheduledAt = new Date(
              new Date(deliveredAt).getTime() + daysAfter * 86400000,
            ).toISOString();
            const reminderId = `album_reminder_${deliveryId}_${sequence}`;
            batch.create(db.doc(`albumReminders/${reminderId}`), {
              id: reminderId,
              tenantId: parsed.tenantId,
              projectId: parsed.input.projectId,
              albumWorkflowId: albumId,
              deliveryRecordId: deliveryId,
              sequence,
              scheduledAt,
              status: "scheduled",
              stopOnStatuses: [
                "selections_received",
                "design_sent",
                "revision_requested",
                "approved",
                "fulfilled",
              ],
              createdAt: now,
              updatedAt: now,
            });
          }
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
        if (parsed.input.deliveryDraftId) {
          batch.update(db.doc(`deliveryDrafts/${parsed.input.deliveryDraftId}`), {
            status: "released",
            deliveryRecordId: deliveryId,
            releasedAt: now,
            updatedAt: now,
            updatedBy: identity.uid,
          });
        }
        if (
          parsed.input.saveStudioDefaults &&
          ["studio_owner", "studio_admin"].includes(role)
        ) {
          const reviewKey =
            parsed.input.reviewDestinationLabel === "the_knot"
              ? "theKnot"
              : parsed.input.reviewDestinationLabel;
          const expirationDays = parsed.input.expirationDate
            ? Math.max(
                0,
                Math.round(
                  (Date.parse(`${parsed.input.expirationDate}T12:00:00.000Z`) -
                    Date.parse(deliveredAt)) /
                    86400000,
                ),
              )
            : 90;
          batch.update(db.doc(`tenants/${parsed.tenantId}`), {
            [`reviewLinks.${reviewKey}`]:
              parsed.input.reviewDestinationUrl,
            "deliveryDefaults.galleryProvider": parsed.input.provider,
            "deliveryDefaults.galleryExpirationDays": expirationDays,
            ...(parsed.input.albumInstructionsUrl
              ? {
                  "deliveryDefaults.albumInstructionsUrl":
                    parsed.input.albumInstructionsUrl,
                }
              : {}),
            updatedAt: now,
            updatedBy: identity.uid,
          });
        }
        const deliveryEvent = productEvent({
          tenantId: parsed.tenantId,
          projectId: parsed.input.projectId,
          actorId: identity.uid,
          name: "lifecycle.gallery_delivered",
          occurredAt: now,
          correlationId: parsed.idempotencyKey,
          sourceEntityType: "deliveryRecord",
          sourceEntityId: deliveryId,
          properties: {
            provider: parsed.input.provider,
            albumIncluded: parsed.input.albumIncluded,
          },
        });
        batch.create(
          db.doc(`productEvents/${deliveryEvent.id}`),
          deliveryEvent,
        );
        await batch.commit();
        result = {
          deliveryRecordId: deliveryId,
          projectState: "DELIVERED",
          reviewRequestsScheduled: 2,
          albumWorkflowCreated: parsed.input.albumIncluded,
        };
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
            complete: Boolean(reviewAsk),
            evidenceId: reviewAsk?.id ?? null,
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
        const status = requirements.every((item) => item.complete)
          ? "ready"
          : "blocked";
        await reference.set(
          {
            id: closeoutId,
            tenantId: parsed.tenantId,
            projectId: parsed.input.projectId,
            status,
            requirements,
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
          blockers: requirements
            .filter((item) => !item.complete)
            .map((item) => item.label),
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
