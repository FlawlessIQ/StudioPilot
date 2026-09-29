import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { productEvent } from "../operations/product-events.js";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { COI_DEFAULTS, readCoiSettings, sweepCoiAutoRequests, type CoiSettings } from "../coi/automation.js";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const DAY_MS = 86_400_000;

/**
 * When the next chase is due, and whether it is time to stop chasing and
 * tell the studio instead (H3 chasing v2, docs/coi-automation-plan-2026-09-28.md).
 *
 * Every `chaseEveryDays` (3 by default), and every day in the week before the
 * certificate is due. After `maxChases`, or once the due date is five days
 * away, emailing the agent again helps nobody: the studio gets a card with the
 * agent's phone number.
 */
export function chaseDecision(input: {
  now: number;
  lastActivity: number;
  dueDate: string;
  chaseCount: number;
  chaseEveryDays: number;
  maxChases: number;
}): "wait" | "chase" | "escalate" {
  const due = Date.parse(`${input.dueDate}T12:00:00.000Z`);
  const daysToDue = Number.isFinite(due) ? (due - input.now) / DAY_MS : Infinity;
  if (input.chaseCount >= input.maxChases || daysToDue <= 5) return "escalate";
  const interval = daysToDue <= 7 ? 1 : input.chaseEveryDays;
  return input.now - input.lastActivity >= interval * DAY_MS ? "chase" : "wait";
}

/**
 * COI autopilot — the daily run.
 *
 * First, ask for the certificates that are now due to be asked for (the
 * automatic request, functions/src/coi/automation.ts). Then chase what is
 * outstanding: a new request, or a correction the agent hasn't sent. Chase N
 * of a request has a stable job id, so retries never duplicate email; a
 * certificate that arrives moves the request out of these states and the
 * chasing stops by itself.
 */
export const coiChaseScheduler = onSchedule(
  { schedule: "every day 14:00", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const swept = await sweepCoiAutoRequests(db, now);
    console.info("coi auto requests", swept);

    const outstanding = await db
      .collection("insuranceRequests")
      .where("status", "in", ["requested", "correction_required"])
      .limit(300)
      .get();
    const settingsByTenant = new Map<string, CoiSettings | null>();

    for (const request of outstanding.docs) {
      const tenantId = text(request.get("tenantId"));
      const requestedAt = Date.parse(text(request.get("requestedAt")));
      if (!tenantId || !Number.isFinite(requestedAt)) continue;
      if (request.get("escalatedAt")) continue;
      if (!settingsByTenant.has(tenantId)) {
        settingsByTenant.set(tenantId, readCoiSettings(await db.doc(`coiSettings/${tenantId}`).get()));
      }
      const settings = settingsByTenant.get(tenantId);
      // Chasing is part of the automation: a studio that turned it off asks
      // for its own certificates.
      if (settings?.dial === "off") continue;
      const project = await db.doc(`projects/${text(request.get("projectId"))}`).get();
      if (!project.exists || clientOutreachStop(project.data())) continue;

      const chaseCount = Number(request.get("chaseCount") ?? 0);
      const correcting = request.get("status") === "correction_required";
      const lastActivity = Date.parse(
        text(request.get("lastChasedAt")) ||
          (correcting ? text(request.get("decidedAt")) : "") ||
          text(request.get("requestedAt")),
      );
      const decision = chaseDecision({
        now: Date.now(),
        lastActivity: Number.isFinite(lastActivity) ? lastActivity : requestedAt,
        dueDate: text(request.get("dueDate")),
        chaseCount,
        chaseEveryDays: settings?.chaseEveryDays ?? COI_DEFAULTS.chaseEveryDays,
        maxChases: settings?.maxChases ?? COI_DEFAULTS.maxChases,
      });
      if (decision === "wait") continue;

      if (decision === "escalate") {
        // Stop emailing; the studio picks up the phone. Today shows the card.
        await request.ref.update({
          escalatedAt: now,
          escalationReason: chaseCount >= (settings?.maxChases ?? COI_DEFAULTS.maxChases) ? "max_chases" : "due_soon",
          updatedAt: now,
          updatedBy: "coi-chase-scheduler",
        });
        continue;
      }

      const originalJob = await db
        .doc(`emailJobs/${correcting ? "coi_correction" : "coi_request"}_${request.id}`)
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
        // The template words a chase as a follow-up, not a fresh request.
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
        properties: { chaseNumber, correcting },
      });
      batch.set(db.doc(`productEvents/${event.id}`), event);
      await batch.commit();
    }
  },
);
