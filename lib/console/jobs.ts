"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query, where, type DocumentData } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

/**
 * Failed background jobs across every queue (docs/console.md, "Jobs").
 *
 * Queried by status on the server. The old page read 100 arbitrary documents
 * per queue and filtered them afterwards, so a failure outside that hundred
 * was never shown.
 */
export const JOB_QUEUES = [
  { collection: "providerJobs", label: "Provider", field: "status", failed: ["dead_letter", "failed"], retrying: ["retry_scheduled"] },
  { collection: "emailJobs", label: "Email", field: "status", failed: ["dead_letter", "failed"], retrying: ["retry_scheduled"] },
  { collection: "aiJobs", label: "AI", field: "status", failed: ["dead_letter", "failed"], retrying: ["retry_scheduled"] },
  { collection: "pdfJobs", label: "PDF", field: "status", failed: ["dead_letter", "failed"], retrying: ["retry_scheduled"] },
  { collection: "automationRuns", label: "Automation", field: "status", failed: ["dead_letter", "failed"], retrying: ["retry_scheduled"] },
  { collection: "domainEvents", label: "Event", field: "processingStatus", failed: ["processing_failed"], retrying: ["publish_retry"] },
] as const;

export type JobQueue = (typeof JOB_QUEUES)[number]["collection"];

export type JobRow = {
  key: string;
  collection: JobQueue;
  queueLabel: string;
  id: string;
  tenantId: string | null;
  projectId: string | null;
  type: string;
  status: string;
  attempts: number;
  errorCode: string;
  errorMessage: string;
  failedAt: string | null;
  createdAt: string | null;
  dismissedAt: string | null;
  dismissReason: string | null;
  recipient: string | null;
  raw: Record<string, unknown>;
};

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

export function toJobRow(collectionName: JobQueue, id: string, data: DocumentData): JobRow {
  const queue = JOB_QUEUES.find((item) => item.collection === collectionName)!;
  const error = data.error && typeof data.error === "object" ? (data.error as Record<string, unknown>) : null;
  const message =
    text(error?.message) ?? text(data.error) ?? text(data.publishError) ?? text(data.lastError) ?? text(data.failureReason) ?? "";
  const code = text(error?.code) ?? (message.split(":")[0] || "UNKNOWN");
  return {
    key: `${collectionName}/${id}`,
    collection: collectionName,
    queueLabel: queue.label,
    id,
    tenantId: text(data.tenantId),
    projectId: text(data.projectId),
    type: text(data.type) ?? text(data.eventType) ?? text(data.workflowKey) ?? text(data.name) ?? collectionName,
    status: text(data[queue.field]) ?? "unknown",
    attempts: Number(data.attempts ?? 0) || 0,
    errorCode: code,
    errorMessage: message,
    failedAt: text(data.completedAt) ?? text(data.updatedAt),
    createdAt: text(data.createdAt) ?? text(data.occurredAt),
    dismissedAt: text(data.dismissedAt),
    dismissReason: text(data.dismissReason),
    recipient: text(data.recipient),
    raw: { id, ...data },
  };
}

/** Live failed (and optionally retrying) jobs in every queue. */
export function useJobs(kind: "failed" | "retrying" = "failed"): { rows: JobRow[] | null; error: string | null } {
  // Keyed by `kind`, so switching views reads as loading without resetting
  // state inside the effect.
  const [state, setState] = useState<{ kind: string; byQueue: Partial<Record<JobQueue, JobRow[]>>; error: string | null }>({ kind: "", byQueue: {}, error: null });
  useEffect(() => {
    if (!dataIsLive) return;
    const { firestore } = getFirebaseClient();
    const put = (collectionName: JobQueue, rows: JobRow[], error: string | null) =>
      setState((current) => {
        const base = current.kind === kind ? current : { kind, byQueue: {}, error: null };
        return { kind, byQueue: { ...base.byQueue, [collectionName]: rows }, error: error ?? base.error };
      });
    const unsubscribes = JOB_QUEUES.map((queue) =>
      onSnapshot(
        query(collection(firestore, queue.collection), where(queue.field, "in", [...queue[kind]]), limit(300)),
        (snapshot) => put(queue.collection, snapshot.docs.map((item) => toJobRow(queue.collection, item.id, item.data())), null),
        () => put(queue.collection, [], "Some job queues couldn't be read."),
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [kind]);
  const rows = useMemo(() => {
    if (!dataIsLive) return [];
    if (state.kind !== kind || JOB_QUEUES.some((queue) => state.byQueue[queue.collection] === undefined)) return null;
    return JOB_QUEUES.flatMap((queue) => state.byQueue[queue.collection] ?? []).sort((a, b) =>
      (b.failedAt ?? "").localeCompare(a.failedAt ?? ""),
    );
  }, [state, kind]);
  return { rows, error: state.kind === kind ? state.error : null };
}
