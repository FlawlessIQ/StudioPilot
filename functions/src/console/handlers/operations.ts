import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { REASON_MIN, consoleHandler, fail } from "../command-kit.js";

export const JOB_QUEUES = ["providerJobs", "emailJobs", "aiJobs", "pdfJobs", "automationRuns", "domainEvents"] as const;
const queue = z.enum(JOB_QUEUES);
type Queue = z.infer<typeof queue>;

const RERUNNABLE = ["dead_letter", "failed", "publish_retry", "processing_failed"];

/**
 * Put one failed job back in its queue as a fresh run. Never fakes provider
 * success: the job runs again for real, and fails again if the cause is still
 * there (docs/saas-operations.md).
 */
async function rerun(db: Firestore, collection: Queue, jobId: string, uid: string, now: string) {
  const reference = db.doc(`${collection}/${jobId}`);
  const job = await reference.get();
  if (!job.exists) fail("JOB_NOT_FOUND");
  const previousStatus = String(collection === "domainEvents" ? job.get("processingStatus") : job.get("status"));
  if (!RERUNNABLE.includes(previousStatus)) fail("JOB_NOT_RERUNNABLE");
  const replayId = randomUUID();
  const replay = { manualReplayId: replayId, manualRerunBy: uid, dismissedAt: null, updatedAt: now };
  let status: string;
  if (collection === "domainEvents") {
    status = "publish_retry";
    await reference.update({ processingStatus: status, publishError: null, ...replay });
  } else if (collection === "automationRuns") {
    status = "retry_scheduled";
    await reference.update({ status, nextAttemptAt: now, error: null, ...replay });
  } else {
    status = "queued";
    await reference.update({
      status,
      nextAttemptAt: now,
      error: null,
      // A rerun is a fresh run. Left at the old count, the worker saw a job
      // already at maxAttempts, so one more transient failure sent it straight
      // back to dead_letter with no retry at all.
      attempts: 0,
      completedAt: null,
      // A rerun email is re-checked against the job's contact rules as it
      // sends (operations/jobs.ts): the job may have been archived or paused
      // since it first failed.
      ...(collection === "emailJobs" ? { clientOutreachGuard: true } : {}),
      ...replay,
    });
  }
  return { tenantId: String(job.get("tenantId") ?? "platform"), jobId, collectionName: collection, previousStatus, replayId, status };
}

export const operationsHandlers = {
  rerunJob: consoleHandler({
    capability: "ops.write",
    input: z.object({ collectionName: queue, jobId: z.string().min(1).max(300) }),
    async run({ db, identity, now }, input) {
      const outcome = await rerun(db, input.collectionName, input.jobId, identity.uid, now);
      return {
        result: outcome,
        audit: { tenantId: outcome.tenantId, entityType: input.collectionName, entityId: input.jobId, before: { status: outcome.previousStatus }, after: { status: outcome.status, replayId: outcome.replayId } },
      };
    },
  }),

  bulkRerun: consoleHandler({
    capability: "ops.write",
    input: z.object({
      jobs: z.array(z.object({ collectionName: queue, jobId: z.string().min(1).max(300) })).min(1).max(50),
    }),
    async run({ db, identity, now }, input) {
      const rerun_: string[] = [];
      const refused: { jobId: string; error: string }[] = [];
      for (const job of input.jobs) {
        try {
          await rerun(db, job.collectionName, job.jobId, identity.uid, now);
          rerun_.push(job.jobId);
        } catch (caught) {
          refused.push({ jobId: job.jobId, error: caught instanceof Error ? caught.message : "RERUN_FAILED" });
        }
      }
      return {
        result: { rerun: rerun_.length, refused },
        audit: { tenantId: null, entityType: "jobs", entityId: "bulk", after: { rerun: rerun_, refused } },
      };
    },
  }),

  /**
   * Take a failed job off "Needs attention" without running it. The job and
   * its error stay exactly as they were; the dismissal is a note beside them.
   */
  dismissJob: consoleHandler({
    capability: "ops.write",
    input: z.object({
      jobs: z.array(z.object({ collectionName: queue, jobId: z.string().min(1).max(300) })).min(1).max(50),
      reason: z.string().trim().min(REASON_MIN).max(1000),
    }),
    async run({ db, identity, now }, input) {
      const batch = db.batch();
      const references = input.jobs.map((job) => db.doc(`${job.collectionName}/${job.jobId}`));
      const snapshots = await db.getAll(...references);
      for (const snapshot of snapshots) {
        if (!snapshot.exists) fail("JOB_NOT_FOUND");
        batch.update(snapshot.ref, { dismissedAt: now, dismissedBy: identity.uid, dismissReason: input.reason });
      }
      await batch.commit();
      const tenants = [...new Set(snapshots.map((snapshot) => String(snapshot.get("tenantId") ?? "platform")))];
      return {
        result: { dismissed: snapshots.length },
        audit: { tenantId: tenants.length === 1 ? (tenants[0] ?? null) : null, entityType: "jobs", entityId: input.jobs.map((job) => job.jobId).join(",").slice(0, 400), after: { dismissed: snapshots.length }, reason: input.reason },
      };
    },
  }),

  approveDeletion: consoleHandler({
    capability: "deletion.approve",
    input: z.object({ requestId: z.string().min(1).max(300), reason: z.string().trim().min(REASON_MIN).max(1000), confirmName: z.string().trim().min(1) }),
    async run({ db, identity, now }, input) {
      const reference = db.doc(`deletionRequests/${input.requestId}`);
      const deletion = await reference.get();
      if (!deletion.exists || deletion.get("status") !== "cooling_off") fail("DELETION_REQUEST_NOT_APPROVABLE");
      const tenantId = String(deletion.get("tenantId"));
      const tenant = await db.doc(`tenants/${tenantId}`).get();
      const names = [tenant.get("brandName"), tenant.get("businessName"), tenant.get("legalName")];
      const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
      if (!names.some((name) => typeof name === "string" && clean(name) === clean(input.confirmName)))
        fail("CONFIRMATION_NAME_MISMATCH");
      const exports = await db
        .collection("exportJobs")
        .where("tenantId", "==", tenantId)
        .where("status", "==", "complete")
        .limit(1)
        .get();
      if (exports.empty) fail("COMPLETED_EXPORT_REQUIRED");
      await reference.update({
        status: "platform_approved",
        platformApprovedAt: now,
        platformApprovedBy: identity.uid,
        approvalReason: input.reason,
        updatedAt: now,
      });
      return {
        result: { tenantId, requestId: input.requestId, status: "platform_approved" },
        audit: { tenantId, entityType: "deletion_request", entityId: input.requestId, before: { status: "cooling_off" }, after: { status: "platform_approved" }, reason: input.reason },
      };
    },
  }),
};
