import {
  getFirestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  evaluateQueueHealth,
  queueObjectives,
  runtimeCapacityProfiles,
} from "../operations/service-objectives.js";

type QueueName = keyof typeof queueObjectives;

function createdAt(document: QueryDocumentSnapshot): string {
  return String(
    document.get("createdAt") ??
      document.get("occurredAt") ??
      document.get("updatedAt") ??
      "",
  );
}

async function queueSnapshot(queueName: QueueName) {
  const db = getFirestore();
  const statusField =
    queueName === "domainEvents" ? "processingStatus" : "status";
  const pendingStatuses =
    queueName === "domainEvents"
      ? ["pending", "published", "publish_retry"]
      : ["queued", "retry_scheduled", "running"];
  const deadStatuses =
    queueName === "domainEvents"
      ? ["processing_failed"]
      : ["dead_letter", "failed"];
  const [pending, dead] = await Promise.all([
    db
      .collection(queueName)
      .where(statusField, "in", pendingStatuses)
      .limit(500)
      .get(),
    db
      .collection(queueName)
      .where(statusField, "in", deadStatuses)
      .limit(100)
      .get(),
  ]);
  const oldestCreatedAt =
    pending.docs
      .map(createdAt)
      .filter(Boolean)
      .sort()[0] ?? null;
  return {
    backlog: pending.size,
    deadLetters: dead.size,
    oldestCreatedAt,
  };
}

export const operationsHealthScheduler = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const db = getFirestore();
    const now = new Date();
    const checkedAt = now.toISOString();
    const [connections, activeSupport, oauthStates, ...queueSnapshots] =
      await Promise.all([
        db
          .collection("integrationConnections")
          .where("archivedAt", "==", null)
          .limit(200)
          .get(),
        db
          .collection("supportAccess")
          .where("status", "==", "active")
          .limit(100)
          .get(),
        db
          .collection("oauthStates")
          .where("expiresAt", "<=", checkedAt)
          .limit(100)
          .get(),
        ...Object.keys(queueObjectives).map((queueName) =>
          queueSnapshot(queueName as QueueName),
        ),
      ]);
    const batch = db.batch();

    for (const connection of connections.docs) {
      const status =
        connection.get("status") === "connected" ? "healthy" : "degraded";
      batch.set(
        db.doc(`systemHealth/integration_${connection.id}`),
        {
          id: `integration_${connection.id}`,
          tenantId: connection.get("tenantId"),
          category: "integration",
          component: String(connection.get("provider")),
          status,
          checkedAt,
          latencyMs: connection.get("lastHealthLatencyMs") ?? null,
          message:
            status === "healthy" ? null : "Connection requires attention",
          failureCount: status === "healthy" ? 0 : 1,
          diagnostics: connection.get("diagnostics") ?? null,
          createdAt: checkedAt,
          updatedAt: checkedAt,
          createdBy: "scheduler",
          updatedBy: "scheduler",
        },
        { merge: true },
      );
    }

    for (const access of activeSupport.docs) {
      if (new Date(String(access.get("expiresAt"))) <= now) {
        batch.update(access.ref, {
          status: "expired",
          updatedAt: checkedAt,
          updatedBy: "scheduler",
        });
      }
    }
    for (const state of oauthStates.docs) batch.delete(state.ref);

    const queueNames = Object.keys(queueObjectives) as QueueName[];
    queueNames.forEach((queueName, index) => {
      const snapshot = queueSnapshots[index];
      if (!snapshot) return;
      const objective = queueObjectives[queueName];
      const health = evaluateQueueHealth({
        ...snapshot,
        now,
        objective,
      });
      batch.set(
        db.doc(`systemHealth/platform_${queueName}`),
        {
          id: `platform_${queueName}`,
          tenantId: null,
          category: "background_queue",
          component: queueName,
          status: health.status,
          checkedAt,
          message: health.objectiveBreached
            ? `${snapshot.backlog} waiting, ${snapshot.deadLetters} dead-letter, oldest ${health.oldestAgeSeconds}s`
            : null,
          failureCount: snapshot.deadLetters,
          backlog: snapshot.backlog,
          deadLetters: snapshot.deadLetters,
          oldestAgeSeconds: health.oldestAgeSeconds,
          objective,
          executionTransport:
            ["providerJobs", "emailJobs", "aiJobs", "pdfJobs"].includes(
              queueName,
            )
              ? "cloud_tasks"
              : queueName === "domainEvents"
                ? "pubsub"
                : "event_runtime",
          createdAt: checkedAt,
          updatedAt: checkedAt,
          createdBy: "scheduler",
          updatedBy: "scheduler",
        },
        { merge: true },
      );
    });

    batch.set(
      db.doc("systemHealth/platform_capacity_profile"),
      {
        id: "platform_capacity_profile",
        tenantId: null,
        category: "capacity",
        component: "runtime_capacity",
        status: "healthy",
        checkedAt,
        failureCount: 0,
        profiles: runtimeCapacityProfiles,
        message: null,
        createdAt: checkedAt,
        updatedAt: checkedAt,
        createdBy: "scheduler",
        updatedBy: "scheduler",
      },
      { merge: true },
    );
    await batch.commit();
    console.info(
      JSON.stringify({
        severity: "INFO",
        event: "operations.health.completed",
        checkedAt,
        connections: connections.size,
        queues: Object.fromEntries(
          queueNames.map((queueName, index) => [
            queueName,
            queueSnapshots[index],
          ]),
        ),
      }),
    );
  },
);
