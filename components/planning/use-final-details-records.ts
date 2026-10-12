"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import {
  useTenantDocuments,
  useTenantRecordsGeneration,
} from "@/components/live/tenant-records";

type Row = Record<string, unknown> & { id: string };

/** One job's final-details sign-off, if one is open, and its forms. */
export type FinalDetailsRecords = { signoff: Row | null; responses: Row[] };

/** At most this many jobs are read; a studio has a handful inside their lock windows. */
const MAX_JOBS = 25;

/**
 * Jobs' own final-details sign-offs and forms, read for each job alone.
 *
 * Whether the final details have gone, and whether a makeup or hair client's
 * party list is back, is read from what is *missing*: no sign-off, no list.
 * The tenant-wide reads stop at 100 documents in no particular order
 * (tenant-records.tsx `tenantReadLimit`), so a busy studio's confirmed
 * sign-off and returned form can both be cut off — and Today then told the
 * studio a client "haven't been sent their party list", with "Send the form",
 * on a job whose headcount was already confirmed. Scoped to the job there is
 * no cap to fall under, and only a few jobs are ever asked about.
 *
 * A job is in the result once both its reads are back; until then, or if one
 * fails, it is absent, and absent means "not known" — never "none".
 * Re-reads whenever a write anywhere calls refreshTenantRecords.
 */
export function useFinalDetailsRecords(projectIds: readonly string[]): Record<string, FinalDetailsRecords> {
  const workspace = useWorkspace();
  const generation = useTenantRecordsGeneration();
  // Demo/preview mode has no Firestore: the shared demo records are the whole set.
  const demoSignoffs = useTenantDocuments("detailSignoffs", { enabled: !dataIsLive });
  const demoResponses = useTenantDocuments("questionnaireResponses", { enabled: !dataIsLive });
  const ids = [...new Set(projectIds.filter(Boolean))].sort().slice(0, MAX_JOBS);
  const key = ids.join(",");
  const [records, setRecords] = useState<Record<string, FinalDetailsRecords>>({});

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId || !key) return;
    const tenantId = workspace.tenantId;
    let active = true;
    const { firestore } = getFirebaseClient();
    void Promise.all(
      key.split(",").map(async (projectId) => {
        try {
          const [signoffs, responses] = await Promise.all([
            getDocs(query(collection(firestore, "detailSignoffs"), where("tenantId", "==", tenantId), where("projectId", "==", projectId), limit(1))),
            getDocs(query(collection(firestore, "questionnaireResponses"), where("tenantId", "==", tenantId), where("projectId", "==", projectId), limit(20))),
          ]);
          const signoff = signoffs.docs[0];
          const entry: FinalDetailsRecords = {
            signoff: signoff ? { id: signoff.id, ...signoff.data() } : null,
            responses: responses.docs.map((document) => ({ id: document.id, ...document.data() })),
          };
          return [projectId, entry] as const;
        } catch {
          // Not known: the reader says nothing it can't stand behind.
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setRecords(Object.fromEntries(entries.filter((entry) => entry !== null)));
    });
    return () => {
      active = false;
    };
  }, [generation, key, workspace.loading, workspace.tenantId]);

  if (!dataIsLive)
    return Object.fromEntries(
      ids.map((projectId) => [
        projectId,
        {
          signoff: (demoSignoffs.records ?? []).find((record) => record.projectId === projectId) ?? null,
          responses: (demoResponses.records ?? []).filter((record) => record.projectId === projectId),
        },
      ]),
    );
  // Each entry is one job's own read, good for that job whichever set it was read with.
  return Object.fromEntries(Object.entries(records).filter(([projectId]) => ids.includes(projectId)));
}
