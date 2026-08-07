import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { productEvent } from "../operations/product-events.js";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const CHASE_INTERVAL_DAYS = 7;
const MAX_CHASES = 3;
const DAY_MS = 86_400_000;

/**
 * COI autopilot — the chase half.
 *
 * Certificates of insurance rot in inboxes. Once a day, any outstanding COI
 * request that hasn't heard back in a week gets its original branded request
 * re-queued to the insurance contact (up to three chases). Deterministic and
 * idempotent: chase N of a request has a stable job ID, so retries never
 * duplicate email. Received certificates stop the chase automatically because
 * the request status leaves "requested".
 */
export const coiChaseScheduler = onSchedule(
  { schedule: "every day 14:00", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const outstanding = await db
      .collection("insuranceRequests")
      .where("status", "==", "requested")
      .limit(300)
      .get();

    for (const request of outstanding.docs) {
      const tenantId = text(request.get("tenantId"));
      const requestedAt = Date.parse(text(request.get("requestedAt")));
      if (!tenantId || !Number.isFinite(requestedAt)) continue;
      const chaseCount = Number(request.get("chaseCount") ?? 0);
      if (chaseCount >= MAX_CHASES) continue;
      const lastActivity = Date.parse(
        text(request.get("lastChasedAt")) || text(request.get("requestedAt")),
      );
      if (Date.now() - lastActivity < CHASE_INTERVAL_DAYS * DAY_MS) continue;

      const originalJob = await db
        .doc(`emailJobs/coi_request_${request.id}`)
        .get();
      if (!originalJob.exists) continue;
      const chaseNumber = chaseCount + 1;
      const chaseJobReference = db.doc(
        `emailJobs/coi_chase_${chaseNumber}_${request.id}`,
      );
      const existingChase = await chaseJobReference.get();
      if (existingChase.exists) continue;

      const batch = db.batch();
      batch.set(chaseJobReference, {
        ...originalJob.data(),
        id: chaseJobReference.id,
        status: "queued",
        attempts: 0,
        chaseNumber,
        createdAt: now,
        updatedAt: now,
      });
      batch.update(request.ref, {
        chaseCount: chaseNumber,
        lastChasedAt: now,
        updatedAt: now,
        updatedBy: "coi-chase-scheduler",
      });
      const auditId = `coi_chase_${chaseNumber}_${request.id}`;
      batch.set(db.doc(`auditEvents/${auditId}`), {
        id: auditId,
        tenantId,
        projectId: request.get("projectId") ?? null,
        actorId: "coi-chase-scheduler",
        actorType: "system",
        action: "coi.chase_sent",
        entityType: "insuranceRequest",
        entityId: request.id,
        timestamp: now,
        before: { chaseCount },
        after: { chaseCount: chaseNumber },
        ipAddress: null,
        userAgent: null,
        correlationId: auditId,
        automationRunId: null,
        providerEventId: null,
      });
      const event = productEvent({
        tenantId,
        projectId: text(request.get("projectId")) || null,
        actorId: "coi-chase-scheduler",
        actorType: "system",
        name: "lifecycle.coi_chased",
        occurredAt: now,
        correlationId: auditId,
        sourceEntityType: "insuranceRequest",
        sourceEntityId: request.id,
        properties: { chaseNumber },
      });
      batch.set(db.doc(`productEvents/${event.id}`), event);
      await batch.commit();
    }
  },
);
