import { randomBytes, createHash } from "node:crypto";
import type { Firestore, Transaction, DocumentSnapshot } from "firebase-admin/firestore";
import { z } from "zod";
import { productEvent } from "../operations/product-events.js";
import { coverageCount, resolveCoverage } from "../packages/coverage.js";
import {
  DELIVERABLE_KINDS,
  defaultKindFor,
  deliveryProgress,
  expectedDeliverables,
  kindDefaults,
  type DeliverableKind,
  type ExpectedDeliverable,
} from "./deliverables.js";
import { linkHost } from "./link-host.js";

/**
 * Releasing deliverables to the couple (H4, docs/delivery-plan-2026-09-28.md).
 *
 * A job was delivered once, with one link: `recordDelivery` required
 * POST_PRODUCTION and moved the job to DELIVERED, so the highlight film that
 * follows the gallery was refused. Now a release carries one or more
 * deliverables — photos and a film can go in the same click — and works for as
 * long as the job is in post-production or delivered.
 *
 * - The job becomes DELIVERED when every *final* deliverable it expects has
 *   gone out (decided 2026-09-28, Q20), or when the studio says it is done.
 * - Review requests and the album workflow start once per job, at that moment
 *   (Q21): films arrive weeks after photos, and asking for a review before the
 *   film lands hurts a video-led studio. Their dates come from that moment, so
 *   a backdated delivery date no longer fires them on the next hourly run.
 * - The one gate is "cards backed up" (Q23): the step that protects the files.
 * - Every link goes to the couple through /d/{token}, so "viewed" is real (Q24).
 */

const KINDS = DELIVERABLE_KINDS as unknown as [DeliverableKind, ...DeliverableKind[]];

export const deliveryItemSchema = z.object({
  kind: z.enum(KINDS),
  mediaType: z.enum(["photo", "video", "album", "files", "other"]).nullable().default(null),
  label: z.string().trim().max(80).nullable().default(null),
  galleryUrl: z.string().url(),
  accessCode: z.string().max(120).nullable().default(null),
  expirationDate: z.string().date().nullable().default(null),
  deliveryDraftId: z.string().min(1).nullable().default(null),
});

export const recordDeliveryInputSchema = z.object({
  projectId: z.string(),
  /** One or more deliverables in this release. */
  items: z.array(deliveryItemSchema).min(1).max(4).optional(),
  // The one-link shape older clients still send, read as a single item.
  provider: z.string().max(40).optional(),
  galleryUrl: z.string().url().optional(),
  accessCode: z.string().max(120).nullable().optional(),
  expirationDate: z.string().date().nullable().optional(),
  deliveryDraftId: z.string().min(1).nullable().default(null),
  deliveryDate: z.string().date(),
  notes: z.string().max(3000).nullable().default(null),
  /** A personal line for the couple, shown in the email (the release is the approval, Q22). */
  messageToCouple: z.string().trim().max(1200).nullable().default(null),
  reviewDestinationUrl: z.string().url().nullable().default(null),
  reviewDestinationLabel: z
    .enum(["google", "weddingwire", "the_knot", "facebook", "custom"])
    .default("google"),
  albumIncluded: z.boolean().default(false),
  albumInstructionsUrl: z.string().url().nullable().default(null),
  saveStudioDefaults: z.boolean().default(false),
  /** Deliver the job now even though a final deliverable is still expected. */
  completeDelivery: z.boolean().default(false),
});

export type RecordDeliveryInput = z.infer<typeof recordDeliveryInputSchema>;
type DeliveryItem = z.infer<typeof deliveryItemSchema>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const stableId = (scope: string, tenantId: string, key: string) =>
  `${scope}_${hash(`${tenantId}:${key}`).slice(0, 32)}`;

/** The items of a release, whichever shape the client sent. */
export function releaseItems(input: RecordDeliveryInput): DeliveryItem[] {
  if (input.items?.length) return input.items;
  if (!input.galleryUrl) throw new Error("DELIVERY_ITEMS_REQUIRED");
  const media = linkHost(input.galleryUrl).mediaType;
  return [
    {
      kind: defaultKindFor(media),
      mediaType: null,
      label: null,
      galleryUrl: input.galleryUrl,
      accessCode: input.accessCode ?? null,
      expirationDate: input.expirationDate ?? null,
      deliveryDraftId: input.deliveryDraftId,
    },
  ];
}

/** What this job expects to deliver, from its booked package. */
export function jobExpectations(snapshot: DocumentSnapshot | null): ExpectedDeliverable[] {
  if (!snapshot?.exists) return expectedDeliverables({ coverage: null });
  const data = snapshot.data() ?? {};
  const coverage = resolveCoverage(data);
  return expectedDeliverables({
    deliverables: data.deliverables,
    includedDeliverables: data.includedDeliverables,
    coverage: {
      photographers: coverageCount(coverage, "photographer"),
      videographers: coverageCount(coverage, "videographer"),
    },
  });
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
}

/** The link a couple is sent: StudioCue's redirect, which stamps "viewed". */
export function viewUrl(token: string): string {
  return `${appUrl()}/d/${token}`;
}

type FollowUps = {
  reviewDestinationUrl: string | null;
  reviewDestinationLabel: string;
  albumIncluded: boolean;
  albumInstructionsUrl: string | null;
};

/**
 * Review requests and the album workflow, once per job.
 *
 * Keyed by the project, not by a delivery, so a second call writes nothing:
 * the ids already exist and are read first.
 */
async function followUpWrites(
  db: Firestore,
  transaction: Transaction,
  input: {
    tenantId: string;
    projectId: string;
    actorId: string;
    now: string;
    deliveryRecordId: string;
    followUps: FollowUps;
  },
): Promise<{ reviewRequestsScheduled: number; albumWorkflowCreated: boolean; writes: Array<() => void> }> {
  const writes: Array<() => void> = [];
  const reviewRefs = [1, 2].map((sequence) => db.doc(`reviewRequests/review_${input.projectId}_${sequence}`));
  const albumRef = db.doc(`albumWorkflows/album_${input.projectId}`);
  // Deliveries released before this change keyed their follow-ups by delivery.
  const [reviewDocs, album, legacyReviews, legacyAlbums] = await Promise.all([
    Promise.all(reviewRefs.map((reference) => transaction.get(reference))),
    transaction.get(albumRef),
    transaction.get(
      db.collection("reviewRequests").where("tenantId", "==", input.tenantId).where("projectId", "==", input.projectId).limit(1),
    ),
    transaction.get(
      db.collection("albumWorkflows").where("tenantId", "==", input.tenantId).where("projectId", "==", input.projectId).limit(1),
    ),
  ]);
  const start = Date.parse(input.now);
  let reviewRequestsScheduled = 0;
  const reviewUrl = input.followUps.reviewDestinationUrl;
  if (reviewUrl && legacyReviews.empty && reviewDocs.every((doc) => !doc.exists)) {
    for (const [index, [days, channel]] of ([[3, "portal"], [10, "email"]] as const).entries()) {
      const reference = reviewRefs[index]!;
      reviewRequestsScheduled += 1;
      writes.push(() =>
        transaction.create(reference, {
          id: reference.id,
          tenantId: input.tenantId,
          projectId: input.projectId,
          deliveryRecordId: input.deliveryRecordId,
          channel,
          destinationLabel: input.followUps.reviewDestinationLabel,
          destinationUrl: reviewUrl,
          status: "scheduled",
          sequence: index + 1,
          scheduledAt: new Date(start + days * 86400000).toISOString(),
          sentAt: null,
          deliveredAt: null,
          openedAt: null,
          clickedAt: null,
          confirmedAt: null,
          confirmedBy: null,
          messageId: null,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          archivedAt: null,
        }),
      );
    }
  }
  let albumWorkflowCreated = false;
  if (input.followUps.albumIncluded && !album.exists && legacyAlbums.empty) {
    albumWorkflowCreated = true;
    writes.push(() =>
      transaction.create(albumRef, {
        id: albumRef.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        deliveryRecordId: input.deliveryRecordId,
        status: "instructions_available",
        instructionsUrl: input.followUps.albumInstructionsUrl,
        selectionUrl: null,
        designProofUrl: null,
        fulfillmentEvidenceId: null,
        creativeAuthority: "studio_human",
        statusHistory: [
          {
            status: "instructions_available",
            occurredAt: input.now,
            actorId: input.actorId,
            notes: "Album workflow created when the job was delivered.",
          },
        ],
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        archivedAt: null,
      }),
    );
    for (const [sequence, days] of [[1, 7], [2, 14]] as const) {
      const reminderRef = db.doc(`albumReminders/album_reminder_${input.projectId}_${sequence}`);
      writes.push(() =>
        transaction.set(reminderRef, {
          id: reminderRef.id,
          tenantId: input.tenantId,
          projectId: input.projectId,
          albumWorkflowId: albumRef.id,
          deliveryRecordId: input.deliveryRecordId,
          sequence,
          scheduledAt: new Date(start + days * 86400000).toISOString(),
          status: "scheduled",
          stopOnStatuses: ["selections_received", "design_sent", "revision_requested", "approved", "fulfilled"],
          createdAt: input.now,
          updatedAt: input.now,
        }),
      );
    }
  }
  return { reviewRequestsScheduled, albumWorkflowCreated, writes };
}

const RELEASABLE_STATES = ["POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED"];

export async function releaseDeliverables(
  db: Firestore,
  context: { tenantId: string; actorId: string; role: string; idempotencyKey: string; now: string },
  input: RecordDeliveryInput,
): Promise<Record<string, unknown>> {
  const items = releaseItems(input);
  for (const item of items) {
    if (!item.galleryUrl.startsWith("https://")) throw new Error("DELIVERY_URL_MUST_USE_HTTPS");
  }
  const { tenantId, actorId, now } = context;
  const projectRef = db.doc(`projects/${input.projectId}`);
  const productionRef = db.doc(`postProductionRecords/${input.projectId}`);
  const releaseId = stableId("release", tenantId, context.idempotencyKey);
  const deliveryIds = items.map((_, index) =>
    index === 0 ? stableId("delivery", tenantId, context.idempotencyKey) : stableId("delivery", tenantId, `${context.idempotencyKey}:${index}`),
  );
  const tokens = items.map(() => randomBytes(18).toString("base64url"));
  const draftIds = Array.from(
    new Set([input.deliveryDraftId, ...items.map((item) => item.deliveryDraftId)].filter((id): id is string => Boolean(id))),
  );

  return db.runTransaction(async (transaction) => {
    const [project, production, existing, drafts, pendingDrafts] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(productionRef),
      transaction.get(
        db.collection("deliveryRecords").where("tenantId", "==", tenantId).where("projectId", "==", input.projectId),
      ),
      Promise.all(draftIds.map((id) => transaction.get(db.doc(`deliveryDrafts/${id}`)))),
      transaction.get(
        db
          .collection("deliveryDrafts")
          .where("tenantId", "==", tenantId)
          .where("projectId", "==", input.projectId)
          .where("status", "==", "review_required"),
      ),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
    const state = text(project.get("state"));
    if (!RELEASABLE_STATES.includes(state)) throw new Error("PROJECT_NOT_IN_POST_PRODUCTION");
    const steps = (production.get("steps") ?? {}) as Record<string, { complete?: boolean } | undefined>;
    if (!production.exists || production.get("tenantId") !== tenantId || steps.backup_complete?.complete !== true) {
      throw new Error("DELIVERY_GATE_BLOCKED");
    }
    for (const draft of drafts) {
      if (
        !draft.exists ||
        draft.get("tenantId") !== tenantId ||
        draft.get("projectId") !== input.projectId ||
        draft.get("status") !== "review_required"
      )
        throw new Error("DELIVERY_DRAFT_INVALID");
    }
    // The same link twice is a double click, never a second deliverable.
    // Two presses used to send two deliveries, two emails and four review
    // asks (D1). This transaction read the job's deliveries, so a racing
    // second release is retried against the first one's write and lands here.
    const alreadySent = new Set(
      existing.docs
        .filter((doc) => !["revoked", "draft"].includes(text(doc.get("status"))))
        .map((doc) => text(doc.get("galleryUrl"))),
    );
    if (items.some((item) => alreadySent.has(item.galleryUrl))) throw new Error("DELIVERY_ALREADY_RECORDED");
    const snapshotId = text(project.get("packageSnapshotId"));
    const snapshot = snapshotId ? await transaction.get(db.doc(`packageSnapshots/${snapshotId}`)) : null;
    const expected = jobExpectations(snapshot && snapshot.get("tenantId") === tenantId ? snapshot : null);

    const records = items.map((item, index) => {
      const host = linkHost(item.galleryUrl);
      const defaults = kindDefaults(item.kind);
      const mediaType = item.mediaType ?? (host.mediaType !== "other" ? host.mediaType : defaults.mediaType);
      const expectedLabel = expected.find((entry) => entry.kind === item.kind)?.label;
      return {
        id: deliveryIds[index]!,
        tenantId,
        projectId: input.projectId,
        releaseId,
        provider: host.host === "other" ? "manual" : host.host,
        mediaType,
        kind: item.kind,
        label: item.label || expectedLabel || defaults.label,
        final: expected.find((entry) => entry.kind === item.kind)?.final ?? defaults.final,
        galleryUrl: item.galleryUrl,
        viewToken: tokens[index]!,
        accessCode: item.accessCode,
        expirationDate: item.expirationDate,
        deliveryDate: input.deliveryDate,
        notes: input.notes,
        status: "sent",
        sentAt: now,
        viewedAt: null,
        downloadedAt: null,
        providerDeliveryId: null,
        deliveryDraftId: item.deliveryDraftId ?? (index === 0 ? input.deliveryDraftId : null),
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
        archivedAt: null,
      };
    });
    const before = deliveryProgress(expected, existing.docs.map((doc) => doc.data()));
    const after = deliveryProgress(expected, [...existing.docs.map((doc) => doc.data()), ...records]);
    const becomesDelivered = state === "POST_PRODUCTION" && (after.complete || input.completeDelivery);

    const priorFollowUps = (production.get("followUps") ?? {}) as Partial<FollowUps>;
    const followUps: FollowUps = {
      reviewDestinationUrl: input.reviewDestinationUrl ?? priorFollowUps.reviewDestinationUrl ?? null,
      reviewDestinationLabel: input.reviewDestinationUrl
        ? input.reviewDestinationLabel
        : priorFollowUps.reviewDestinationLabel ?? input.reviewDestinationLabel,
      albumIncluded: input.albumIncluded || priorFollowUps.albumIncluded === true,
      albumInstructionsUrl: input.albumInstructionsUrl ?? priorFollowUps.albumInstructionsUrl ?? null,
    };
    if (becomesDelivered && !followUps.reviewDestinationUrl) throw new Error("REVIEW_DESTINATION_REQUIRED");
    const followUp = becomesDelivered
      ? await followUpWrites(db, transaction, {
          tenantId,
          projectId: input.projectId,
          actorId,
          now,
          deliveryRecordId: records[records.length - 1]!.id,
          followUps,
        })
      : { reviewRequestsScheduled: 0, albumWorkflowCreated: false, writes: [] };

    // ── Writes ──────────────────────────────────────────────────────────
    for (const item of records) transaction.create(db.doc(`deliveryRecords/${item.id}`), item);
    // Two weeks before a gallery's downloads end, a reminder to the couple
    // (Q25). Couples lose galleries to a date they forgot; many studios sell
    // prints from this email. Only when there are at least two weeks to wait,
    // and the scheduler re-reads the job and the delivery before it sends.
    for (const item of records) {
      if (!item.expirationDate || !["photo", "files"].includes(item.mediaType)) continue;
      const remindAt = Date.parse(`${item.expirationDate}T15:00:00.000Z`) - 14 * 86400000;
      if (!Number.isFinite(remindAt) || remindAt < Date.parse(now) + 86400000) continue;
      transaction.set(db.doc(`deliveryReminders/expiry_${item.id}`), {
        id: `expiry_${item.id}`,
        tenantId,
        projectId: input.projectId,
        deliveryRecordId: item.id,
        type: "delivery_expiry_reminder",
        expirationDate: item.expirationDate,
        scheduledAt: new Date(remindAt).toISOString(),
        status: "scheduled",
        createdAt: now,
        updatedAt: now,
      });
    }
    transaction.create(db.doc(`emailJobs/delivery_${records[0]!.id}`), {
      id: `delivery_${records[0]!.id}`,
      tenantId,
      projectId: input.projectId,
      type: "delivery",
      deliveryRecordId: records[0]!.id,
      releaseId,
      items: records.map((item) => ({
        deliveryRecordId: item.id,
        mediaType: item.mediaType,
        kind: item.kind,
        label: item.label,
        openUrl: viewUrl(item.viewToken),
        accessCode: item.accessCode,
        expirationDate: item.expirationDate,
      })),
      note: input.messageToCouple,
      // The first item's link, for a render worker a deploy behind.
      galleryUrl: viewUrl(records[0]!.viewToken),
      accessCode: records[0]!.accessCode,
      expirationDate: records[0]!.expirationDate,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    for (const write of followUp.writes) write();
    transaction.update(productionRef, {
      ...(steps.delivery_sent?.complete === true
        ? {}
        : {
            "steps.delivery_sent": {
              complete: true,
              completedAt: now,
              completedBy: actorId,
              evidenceId: records[0]!.id,
              notes: null,
            },
            currentStep: "client_downloaded",
          }),
      followUps,
      updatedAt: now,
      updatedBy: actorId,
    });
    if (becomesDelivered) {
      transaction.update(projectRef, {
        state: "DELIVERED",
        stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
        nextAction: "Monitor delivery and review request",
        deliveredAt: now,
        updatedAt: now,
        updatedBy: actorId,
      });
    } else if (state === "POST_PRODUCTION") {
      transaction.update(projectRef, {
        nextAction: after.outstanding.filter((entry) => entry.final).length
          ? `Deliver the ${after.outstanding.filter((entry) => entry.final).map((entry) => entry.label.toLowerCase()).join(" and ")}`
          : "Deliver the rest",
        updatedAt: now,
        updatedBy: actorId,
      });
    }
    // Released drafts, and any other draft for a deliverable that just went
    // out: "Approve the gallery delivery" sat on Today forever for drafts that
    // could never be released (D5).
    const releasedKinds = new Set(records.map((item) => item.kind));
    const draftRecord = new Map(records.filter((item) => item.deliveryDraftId).map((item) => [item.deliveryDraftId, item.id]));
    for (const draft of pendingDrafts.docs) {
      const releasedAs = draftRecord.get(draft.id);
      if (releasedAs) {
        transaction.update(draft.ref, {
          status: "released",
          deliveryRecordId: releasedAs,
          releasedAt: now,
          updatedAt: now,
          updatedBy: actorId,
        });
      } else if (releasedKinds.has((text(draft.get("kind")) || "gallery") as DeliverableKind)) {
        transaction.update(draft.ref, {
          status: "superseded",
          supersededBy: records[0]!.id,
          updatedAt: now,
          updatedBy: actorId,
        });
      }
    }
    if (input.saveStudioDefaults && ["studio_owner", "studio_admin"].includes(context.role)) {
      const expiring = records.find((item) => item.expirationDate && item.mediaType === "photo");
      const expirationDays = expiring?.expirationDate
        ? Math.max(
            0,
            Math.round(
              (Date.parse(`${expiring.expirationDate}T12:00:00.000Z`) - Date.parse(`${input.deliveryDate}T12:00:00.000Z`)) /
                86400000,
            ),
          )
        : null;
      const reviewKey = input.reviewDestinationLabel === "the_knot" ? "theKnot" : input.reviewDestinationLabel;
      transaction.update(db.doc(`tenants/${tenantId}`), {
        ...(input.reviewDestinationUrl ? { [`reviewLinks.${reviewKey}`]: input.reviewDestinationUrl } : {}),
        ...(expirationDays !== null ? { "deliveryDefaults.galleryExpirationDays": expirationDays } : {}),
        ...(input.albumInstructionsUrl ? { "deliveryDefaults.albumInstructionsUrl": input.albumInstructionsUrl } : {}),
        updatedAt: now,
        updatedBy: actorId,
      });
    }
    const event = productEvent({
      tenantId,
      projectId: input.projectId,
      actorId,
      name: "lifecycle.gallery_delivered",
      occurredAt: now,
      correlationId: context.idempotencyKey,
      sourceEntityType: "deliveryRecord",
      sourceEntityId: records[0]!.id,
      properties: {
        kinds: records.map((item) => item.kind),
        mediaTypes: records.map((item) => item.mediaType),
        jobDelivered: becomesDelivered,
        albumIncluded: followUps.albumIncluded,
      },
    });
    transaction.create(db.doc(`productEvents/${event.id}`), event);

    return {
      deliveryRecordIds: records.map((item) => item.id),
      projectState: becomesDelivered ? "DELIVERED" : state,
      jobDelivered: becomesDelivered || state !== "POST_PRODUCTION",
      outstanding: after.outstanding.filter((entry) => entry.final).map((entry) => entry.label),
      alreadySentBefore: before.sent.map((entry) => entry.label),
      reviewRequestsScheduled: followUp.reviewRequestsScheduled,
      albumWorkflowCreated: followUp.albumWorkflowCreated,
    };
  });
}

/**
 * "Mark delivery complete": the studio closes delivery with a final
 * deliverable still expected — the film was cancelled, or went out another
 * way. The same once-per-job follow-ups start from here.
 */
export async function markDeliveryComplete(
  db: Firestore,
  context: { tenantId: string; actorId: string; now: string },
  input: { projectId: string; reviewDestinationUrl: string | null; reviewDestinationLabel: string },
): Promise<Record<string, unknown>> {
  const { tenantId, actorId, now } = context;
  const projectRef = db.doc(`projects/${input.projectId}`);
  const productionRef = db.doc(`postProductionRecords/${input.projectId}`);
  return db.runTransaction(async (transaction) => {
    const [project, production, existing] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(productionRef),
      transaction.get(
        db.collection("deliveryRecords").where("tenantId", "==", tenantId).where("projectId", "==", input.projectId),
      ),
    ]);
    if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
    if (project.get("state") !== "POST_PRODUCTION") throw new Error("PROJECT_NOT_IN_POST_PRODUCTION");
    const live = existing.docs.filter((doc) => !["revoked", "draft"].includes(text(doc.get("status"))));
    if (!live.length) throw new Error("NOTHING_DELIVERED_YET");
    const prior = (production.get("followUps") ?? {}) as Partial<FollowUps>;
    const followUps: FollowUps = {
      reviewDestinationUrl: input.reviewDestinationUrl ?? prior.reviewDestinationUrl ?? null,
      reviewDestinationLabel: input.reviewDestinationUrl ? input.reviewDestinationLabel : prior.reviewDestinationLabel ?? "google",
      albumIncluded: prior.albumIncluded === true,
      albumInstructionsUrl: prior.albumInstructionsUrl ?? null,
    };
    if (!followUps.reviewDestinationUrl) throw new Error("REVIEW_DESTINATION_REQUIRED");
    const latest = [...live].sort((left, right) => text(right.get("sentAt")).localeCompare(text(left.get("sentAt"))))[0]!;
    const followUp = await followUpWrites(db, transaction, {
      tenantId,
      projectId: input.projectId,
      actorId,
      now,
      deliveryRecordId: latest.id,
      followUps,
    });
    for (const write of followUp.writes) write();
    transaction.update(projectRef, {
      state: "DELIVERED",
      stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
      nextAction: "Monitor delivery and review request",
      deliveredAt: now,
      deliveryClosedEarly: true,
      updatedAt: now,
      updatedBy: actorId,
    });
    if (production.exists) {
      transaction.update(productionRef, { followUps, updatedAt: now, updatedBy: actorId });
    }
    return {
      projectState: "DELIVERED",
      reviewRequestsScheduled: followUp.reviewRequestsScheduled,
      albumWorkflowCreated: followUp.albumWorkflowCreated,
    };
  });
}

/** A gallery-inbox draft the studio won't release: a duplicate, a test, a teaser they skip (D5). */
export async function discardDeliveryDraft(
  db: Firestore,
  context: { tenantId: string; actorId: string; now: string },
  input: { projectId: string; deliveryDraftId: string },
): Promise<Record<string, unknown>> {
  const reference = db.doc(`deliveryDrafts/${input.deliveryDraftId}`);
  const draft = await reference.get();
  if (!draft.exists || draft.get("tenantId") !== context.tenantId || draft.get("projectId") !== input.projectId) {
    throw new Error("DELIVERY_DRAFT_INVALID");
  }
  if (draft.get("status") !== "review_required") return { deliveryDraftId: draft.id, status: draft.get("status") };
  await reference.update({
    status: "discarded",
    discardedAt: context.now,
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  return { deliveryDraftId: draft.id, status: "discarded" };
}
