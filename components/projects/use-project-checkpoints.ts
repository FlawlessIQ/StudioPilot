"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import {
  useTenantDocuments,
  useTenantRecordsGeneration,
} from "@/components/live/tenant-records";

type CheckpointRecord = Record<string, unknown> & { id: string };

/**
 * One job's live checkpoints, read for that job.
 *
 * The readiness panel and the job bar read the tenant-wide cache, which the
 * records API caps at 250 documents per collection. A studio with more
 * checkpoints than that — FlawlessIQ, by 2026-10 — got an arbitrary subset, so
 * Smith Wedding's panel listed seven checkpoints while the header, reading the
 * job's own query, counted eight open (UI audit, 2026-10-02). Scoped to the
 * job, there is no cap to fall under.
 *
 * Live means `archivedAt === null`, the server's rule
 * (`where("archivedAt", "==", null)` in functions/src/workflow).
 * Re-reads whenever a write anywhere calls refreshTenantRecords.
 */
export function useProjectCheckpoints(projectId: string): CheckpointRecord[] | null {
  const workspace = useWorkspace();
  const generation = useTenantRecordsGeneration();
  // Demo/preview mode has no Firestore: the shared demo records stand in.
  const demo = useTenantDocuments("checkpoints", { enabled: !dataIsLive });
  const [records, setRecords] = useState<CheckpointRecord[] | null>(null);

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId || !projectId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDocs(
      query(
        collection(firestore, "checkpoints"),
        where("tenantId", "==", workspace.tenantId),
        where("projectId", "==", projectId),
      ),
    )
      .then((snapshot) => {
        if (!active) return;
        setRecords(
          snapshot.docs
            .filter((document) => document.get("archivedAt") === null)
            .map((document) => ({ id: document.id, ...document.data() })),
        );
      })
      .catch(() => {
        if (active) setRecords([]);
      });
    return () => {
      active = false;
    };
  }, [generation, projectId, workspace.loading, workspace.tenantId]);

  if (!dataIsLive) {
    return (demo.records ?? []).filter(
      (record) => record.projectId === projectId && record.archivedAt === null,
    );
  }
  return records;
}
