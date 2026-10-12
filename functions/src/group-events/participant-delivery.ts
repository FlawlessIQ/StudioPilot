import { FieldValue, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import {
  GROUP_REVIEW_EMAIL,
  groupReviewJobId,
  participantDeliveryPlan,
  participantReviewDecision,
  participantReviewPlan,
  type GroupMailPlan,
} from "./participant-delivery-core.js";

/**
 * Each parent's delivery and review ask at a group event — the Firestore half
 * (rules in participant-delivery-core.ts).
 *
 * The review asks run inside the hourly review-request sweep
 * (post-event/jobs.ts reviewRequestScheduler), so there's no new function and
 * no invoker change. A released place carries `reviewAskDueAt` — a top-level
 * field, so one range read across every studio finds what's due without a
 * new index — and loses it once the ask is queued or held.
 */

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const ACTOR = "review-request-scheduler";
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");

/** Parents' review asks that are due: queued once each, or held with the reason. */
export async function sweepParticipantReviewAsks(db: Firestore, now: string): Promise<Record<string, number>> {
  const tally: Record<string, number> = {};
  const count = (key: string) => (tally[key] = (tally[key] ?? 0) + 1);
  const due = await db.collection("eventParticipants").where("reviewAskDueAt", "<=", now).orderBy("reviewAskDueAt", "asc").limit(100).get();
  for (const found of due.docs) {
    const tenantId = text(found.get("tenantId"));
    const projectReference = db.doc(`projects/${text(found.get("projectId"))}`);
    const tenantReference = db.doc(`tenants/${tenantId}`);
    const jobReference = db.doc(`emailJobs/${groupReviewJobId(found.id)}`);
    try {
      const outcome = await db.runTransaction(async (transaction) => {
        const [participant, project, tenant, job] = await Promise.all([
          transaction.get(found.ref),
          transaction.get(projectReference),
          transaction.get(tenantReference),
          transaction.get(jobReference),
        ]);
        if (!participant.exists || !participant.get("reviewAskDueAt")) return "gone";
        const own = (snapshot: DocumentSnapshot) =>
          snapshot.exists && snapshot.get("tenantId") === tenantId ? ((snapshot.data() ?? null) as Row | null) : null;
        const projectData = own(project);
        const decision = job.exists
          ? ({ send: false, reason: "already_asked" } as const)
          : participantReviewDecision({
              project: projectData,
              participant: (participant.data() ?? null) as Row | null,
              tenant: tenant.exists ? ((tenant.data() ?? null) as Row | null) : null,
              now,
            });
        if (!decision.send) {
          // Not yet due (a moved due date) leaves it for a later run.
          if (decision.reason === "not_yet") return "not_yet";
          transaction.update(found.ref, {
            reviewAskDueAt: FieldValue.delete(),
            "reviewAsk.state": "held",
            "reviewAsk.reason": decision.reason,
            "reviewAsk.updatedAt": now,
            updatedAt: now,
          });
          return `held_${decision.reason}`;
        }
        const orderToken = text(participant.get("orderToken"));
        transaction.create(jobReference, {
          id: jobReference.id,
          tenantId,
          projectId: projectReference.id,
          participantId: found.id,
          type: GROUP_REVIEW_EMAIL,
          recipient: text(participant.get("email")),
          recipientName: text(participant.get("parentName")) || null,
          // The parent alone: the job's client is the organiser.
          soleRecipient: true,
          audience: "parent",
          destinationUrl: decision.destinationUrl,
          destinationLabel: decision.destinationLabel,
          athleteName: text(participant.get("athleteName")) || null,
          actionUrl: orderToken ? `${appUrl()}/e/order/${orderToken}` : null,
          status: "queued",
          attempts: 0,
          maxAttempts: 5,
          createdAt: now,
          updatedAt: now,
          createdBy: ACTOR,
        });
        transaction.update(found.ref, {
          reviewAskDueAt: FieldValue.delete(),
          "reviewAsk.state": "queued",
          "reviewAsk.queuedAt": now,
          "reviewAsk.reason": null,
          "reviewAsk.updatedAt": now,
          updatedAt: now,
        });
        return "queued";
      });
      count(`group_review_${outcome}`);
    } catch (caught) {
      count("group_review_failed");
      console.error("group review ask failed", { participantId: found.id, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }
  return tally;
}

async function planInputs(db: Firestore, job: DocumentSnapshot) {
  const tenantId = text(job.get("tenantId"));
  const [project, participant] = await Promise.all([
    db.doc(`projects/${text(job.get("projectId"))}`).get(),
    db.doc(`eventParticipants/${text(job.get("participantId"))}`).get(),
  ]);
  const own = (snapshot: DocumentSnapshot) =>
    snapshot.exists && snapshot.get("tenantId") === tenantId ? ((snapshot.data() ?? null) as Row | null) : null;
  return { job: (job.data() ?? {}) as Row, project: own(project), participant: own(participant) };
}

/** At send time (operations/jobs.ts): a parent's delivery — hold, or the link as it stands. */
export async function participantDeliveryPlanFor(db: Firestore, job: DocumentSnapshot): Promise<GroupMailPlan> {
  return participantDeliveryPlan(await planInputs(db, job));
}

/** At send time (operations/jobs.ts): a parent's review ask — hold, or send. */
export async function participantReviewPlanFor(db: Firestore, job: DocumentSnapshot): Promise<GroupMailPlan> {
  return participantReviewPlan(await planInputs(db, job));
}
