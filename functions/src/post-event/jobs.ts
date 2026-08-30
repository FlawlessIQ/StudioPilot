import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { productEvent } from "../operations/product-events.js";

export const reviewRequestScheduler = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const due = await db
      .collection("reviewRequests")
      .where("status", "==", "scheduled")
      .where("scheduledAt", "<=", now)
      .orderBy("scheduledAt", "asc")
      .limit(100)
      .get();
    for (const request of due.docs) {
      /**
       * Every read before every write, which this did not do.
       *
       * `transaction.create(productEvents/...)` ran first and both later
       * branches then called `transaction.get` — for the portal notification
       * and for the email job. Firestore refuses a read after a write, so the
       * transaction threw and *every* due review request failed, on both
       * channels. The scheduler swallowed it as a failed run, which is why the
       * only visible symptom was review requests that never went out.
       *
       * Same class as the two signing webhooks, found by the same sweep.
       * tests/transaction-read-before-write.test.ts fails on a third.
       */
      const notificationReference = db.doc(`notifications/review_${request.id}`);
      const jobReference = db.doc(`emailJobs/review_${request.id}`);
      await db.runTransaction(async (transaction) => {
        const [current, prior, existingJob] = await Promise.all([
          transaction.get(request.ref),
          transaction.get(notificationReference),
          transaction.get(jobReference),
        ]);
        if (!current.exists || current.get("status") !== "scheduled") return;
        const event = productEvent({
          tenantId: String(current.get("tenantId")),
          projectId: String(current.get("projectId")),
          actorId: "review-request-scheduler",
          actorType: "system",
          name: "lifecycle.review_requested",
          occurredAt: now,
          correlationId: current.id,
          sourceEntityType: "reviewRequest",
          sourceEntityId: current.id,
          properties: {
            channel: current.get("channel"),
            sequence: current.get("sequence"),
          },
        });
        transaction.create(db.doc(`productEvents/${event.id}`), event);
        if (current.get("channel") === "portal") {
          if (!prior.exists) {
            transaction.create(notificationReference, {
              id: notificationReference.id,
              tenantId: current.get("tenantId"),
              projectId: current.get("projectId"),
              audience: ["client"],
              title: "How was your photography experience?",
              body: "Your studio has shared a review destination in your project portal.",
              severity: "info",
              href: "/client/reviews",
              readBy: [],
              createdAt: now,
              updatedAt: now,
            });
          }
          transaction.update(current.ref, {
            status: "sent",
            sentAt: now,
            messageId: notificationReference.id,
            updatedAt: now,
            updatedBy: "review-request-scheduler",
          });
          return;
        }
        if (!existingJob.exists) {
          transaction.create(jobReference, {
            id: jobReference.id,
            tenantId: current.get("tenantId"),
            projectId: current.get("projectId"),
            type: "review_request",
            reviewRequestId: current.id,
            destinationUrl: current.get("destinationUrl"),
            sequence: current.get("sequence"),
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        transaction.update(current.ref, {
          status: "sent",
          sentAt: now,
          messageId: jobReference.id,
          updatedAt: now,
          updatedBy: "review-request-scheduler",
        });
      });
    }
  },
);

export const albumReminderScheduler = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const due = await db
      .collection("albumReminders")
      .where("status", "==", "scheduled")
      .where("scheduledAt", "<=", now)
      .orderBy("scheduledAt", "asc")
      .limit(100)
      .get();
    for (const reminder of due.docs) {
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(reminder.ref);
        if (!current.exists || current.get("status") !== "scheduled") return;
        const workflow = await transaction.get(
          db.doc(
            `albumWorkflows/${String(current.get("albumWorkflowId"))}`,
          ),
        );
        if (!workflow.exists) {
          transaction.update(current.ref, {
            status: "failed",
            failureCode: "ALBUM_WORKFLOW_NOT_FOUND",
            updatedAt: now,
          });
          return;
        }
        const stopStatuses = Array.isArray(current.get("stopOnStatuses"))
          ? (current.get("stopOnStatuses") as unknown[]).map(String)
          : [];
        if (stopStatuses.includes(String(workflow.get("status")))) {
          transaction.update(current.ref, {
            status: "skipped",
            stoppedByStatus: workflow.get("status"),
            updatedAt: now,
          });
          return;
        }
        const jobReference = db.doc(`emailJobs/${current.id}`);
        const prior = await transaction.get(jobReference);
        if (!prior.exists) {
          transaction.create(jobReference, {
            id: jobReference.id,
            tenantId: current.get("tenantId"),
            projectId: current.get("projectId"),
            type: "album_selection_reminder",
            albumWorkflowId: workflow.id,
            sequence: current.get("sequence"),
            instructionsUrl: workflow.get("instructionsUrl"),
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        transaction.update(current.ref, {
          status: "sent",
          sentAt: now,
          updatedAt: now,
        });
      });
    }
  },
);
