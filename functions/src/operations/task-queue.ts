import { createHash } from "node:crypto";
import { getFunctions } from "firebase-admin/functions";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { z } from "zod";
import {
  jobCollections,
  processJobDocument,
  type JobCollection,
} from "./jobs.js";
import { captureOperationalError } from "./observability.js";

const taskInputSchema = z.object({
  collectionName: z.enum(jobCollections),
  jobId: z.string().min(1).max(300),
  dispatchKey: z.string().length(40),
});

const dispatchableStatuses = new Set(["queued", "retry_scheduled"]);

function dispatchKey(
  collectionName: JobCollection,
  jobId: string,
  status: string,
  updatedAt: string,
): string {
  return createHash("sha256")
    .update(`${collectionName}:${jobId}:${status}:${updatedAt}`)
    .digest("hex")
    .slice(0, 40);
}

function scheduleTime(document: DocumentSnapshot): Date {
  const value = String(document.get("nextAttemptAt") ?? "");
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.valueOf()) || parsed < new Date()
    ? new Date()
    : parsed;
}

async function enqueue(
  document: DocumentSnapshot,
  collectionName: JobCollection,
) {
  const status = String(document.get("status") ?? "");
  if (!dispatchableStatuses.has(status)) return;
  const key = dispatchKey(
    collectionName,
    document.id,
    status,
    String(document.get("updatedAt") ?? document.get("createdAt") ?? ""),
  );
  if (document.get("taskDispatchKey") === key) return;

  try {
    await getFunctions()
      .taskQueue("locations/us-east4/functions/operationsTaskWorker")
      .enqueue(
        {
          collectionName,
          jobId: document.id,
          dispatchKey: key,
        },
        {
          scheduleTime: scheduleTime(document),
          dispatchDeadlineSeconds: 600,
        },
      );
    await document.ref.update({
      taskDispatchKey: key,
      taskEnqueuedAt: new Date().toISOString(),
      taskDispatchError: null,
      taskDispatchFailedAt: null,
      executionTransport: "cloud_tasks",
    });
  } catch (caught: unknown) {
    const message =
      caught instanceof Error ? caught.message : "TASK_ENQUEUE_FAILED";
    await document.ref.set(
      {
        taskDispatchError: message.slice(0, 500),
        taskDispatchFailedAt: new Date().toISOString(),
        executionTransport: "scheduler_fallback",
      },
      { merge: true },
    );
    await captureOperationalError("TASK_ENQUEUE_FAILED", {
      collection: collectionName,
      jobId: document.id,
    });
  }
}

function createDispatchTrigger(collectionName: JobCollection) {
  return onDocumentWritten(
    {
      document: `${collectionName}/{jobId}`,
      retry: true,
    },
    async (event) => {
      const document = event.data?.after;
      if (!document?.exists) return;
      await enqueue(document, collectionName);
    },
  );
}

export const providerJobTaskDispatch = createDispatchTrigger("providerJobs");
export const emailJobTaskDispatch = createDispatchTrigger("emailJobs");
export const aiJobTaskDispatch = createDispatchTrigger("aiJobs");
export const pdfJobTaskDispatch = createDispatchTrigger("pdfJobs");

export const operationsTaskWorker = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 30,
      maxBackoffSeconds: 3600,
      maxDoublings: 5,
    },
    rateLimits: {
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 10,
    },
    secrets: [
      "SENDGRID_API_KEY",
      "GOOGLE_CALENDAR_CLIENT_SECRET",
      "ZOOM_CLIENT_SECRET",
      "DROPBOX_CLIENT_SECRET",
      "DOCUSIGN_CLIENT_SECRET",
      "QUICKBOOKS_CLIENT_SECRET",
    ],
    timeoutSeconds: 600,
    memory: "1GiB",
  },
  async (request) => {
    const input = taskInputSchema.parse(request.data);
    const result = await processJobDocument(
      input.collectionName,
      input.jobId,
    );
    console.info(
      JSON.stringify({
        severity: "INFO",
        event: "operations.task.completed",
        collection: input.collectionName,
        jobId: input.jobId,
        dispatchKey: input.dispatchKey,
        claimed: result.claimed,
      }),
    );
  },
);
