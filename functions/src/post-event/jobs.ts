import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

export const reviewRequestScheduler = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const due = await db.collection("reviewRequests")
      .where("status", "==", "scheduled")
      .where("scheduledAt", "<=", now)
      .orderBy("scheduledAt", "asc")
      .limit(100)
      .get();
    for (const request of due.docs) {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(request.ref);
        if (!current.exists || current.get("status") !== "scheduled") return;
        const jobReference = db.doc(`emailJobs/review_${current.id}`);
        const existingJob = await transaction.get(jobReference);
        if (existingJob.exists) return;
        transaction.create(jobReference, {
          tenantId: current.get("tenantId"),
          projectId: current.get("projectId"),
          type: "review_request",
          reviewRequestId: current.id,
          destinationUrl: current.get("destinationUrl"),
          sequence: current.get("sequence"),
          status: "queued",
          createdAt: now,
        });
      });
    }
  },
);
