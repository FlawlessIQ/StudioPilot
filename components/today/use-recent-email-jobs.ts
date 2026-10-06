"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";
import { handoffReadSince, type HandoffRecord } from "@/features/today/handoff";

/**
 * The studio's email jobs from the last two days, for the morning handoff.
 *
 * Not `useTenantDocuments("emailJobs")`: that reads any 100 of a studio's
 * jobs, in no order, so a busy studio's handoff would count whichever
 * hundred came back. This reads the newest by `createdAt` (the
 * tenantId + createdAt index in firestore.indexes.json), scoped to the tenant
 * as the rules require — an unscoped query is rejected whole.
 *
 * Owners and admins only: nobody else may read emailJobs across the studio.
 * Outside live data the demo records Today already has are used instead.
 */
export function useRecentEmailJobs(
  enabled: boolean,
  demoRecords: HandoffRecord[] | null,
): HandoffRecord[] {
  const workspace = useWorkspace();
  const [read, setRead] = useState<{ tenantId: string; records: HandoffRecord[] } | null>(null);
  const tenantId = workspace.tenantId;
  const live = dataIsLive && enabled && Boolean(tenantId) && !workspace.loading;

  useEffect(() => {
    if (!live || !tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void withTimeout(
      getDocs(
        query(
          collection(firestore, "emailJobs"),
          where("tenantId", "==", tenantId),
          where("createdAt", ">=", handoffReadSince(new Date())),
          orderBy("createdAt", "desc"),
          limit(300),
        ),
      ),
      15_000,
      "Recent email jobs could not be loaded.",
    )
      .then((snapshot) => {
        if (!active) return;
        setRead({
          tenantId,
          records: snapshot.docs
            .map((document) => ({ id: document.id, ...document.data() }) as HandoffRecord)
            .filter((document) => document.tenantId === tenantId),
        });
      })
      .catch(() => {
        // The handoff is a summary, not a queue: when it can't be read it
        // stays hidden rather than saying Cue did nothing.
        if (active) setRead({ tenantId, records: [] });
      });
    return () => {
      active = false;
    };
  }, [live, tenantId]);

  if (!enabled) return [];
  if (!dataIsLive) return demoRecords ?? [];
  return read && read.tenantId === tenantId ? read.records : [];
}
