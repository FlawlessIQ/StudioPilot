"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { jobPackageSnapshotIds } from "@/features/crew/staffing-plan";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";

type Row = Record<string, unknown> & { id: string };

/** Booked jobs, the ones Today's trial card asks about. */
const BOOKED = new Set(["BOOKED", "PLANNING", "READY"]);
/** Enough for any studio's booked season; each is one small read. */
const MOST = 100;

/**
 * The studio's package snapshots, with every booked job's own added by id.
 *
 * `useTenantDocuments("packageSnapshots")` reads a hundred of a studio's
 * snapshots in no order. On a busy studio a booked job's own could be missing,
 * and Today then couldn't see the "Bridal hair trial" the client bought, so it
 * never asked the studio to invite them to it (features/today/inbox.ts; review
 * of the hair walk, Jess Styles Bridal, 2026-10-10). This reads the missing
 * ones by id and adds them to the sample.
 *
 * Only where it is `enabled`: a trade with a trial. Anywhere else, and outside
 * live data, the sample comes back as it was read.
 */
export function useJobPackageSnapshots(input: {
  enabled: boolean;
  projects: readonly Row[] | null;
  sampled: Row[] | null;
}): Row[] | null {
  const workspace = useWorkspace();
  const tenantId = workspace.tenantId;
  const live = dataIsLive && input.enabled && Boolean(tenantId) && !workspace.loading;
  const { projects, sampled } = input;
  // Waits for the sample, so only what it lacks is read.
  const missing = useMemo(() => {
    if (!live || !projects || !sampled) return "";
    const have = new Set(sampled.map((snapshot) => snapshot.id));
    const ids = projects
      .filter((project) => BOOKED.has(String(project.state ?? "")))
      .flatMap((project) => jobPackageSnapshotIds(project))
      .filter((id) => !have.has(id));
    return [...new Set(ids)].sort().slice(0, MOST).join(",");
  }, [live, projects, sampled]);
  const [read, setRead] = useState<{ tenantId: string; records: Row[] } | null>(null);

  useEffect(() => {
    if (!missing || !tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    // One by one, and each may fail alone: a coordinator may read only the
    // snapshots of jobs they are on (firestore.rules).
    void withTimeout(
      Promise.allSettled(missing.split(",").map((id) => getDoc(doc(firestore, "packageSnapshots", id)))),
      15_000,
      "Package snapshots could not be loaded.",
    )
      .then((results) => {
        if (!active) return;
        const records = results.flatMap((result) =>
          result.status === "fulfilled" && result.value.exists()
            ? [{ id: result.value.id, ...result.value.data() } as Row]
            : [],
        );
        setRead((previous) => {
          const byId = new Map((previous?.tenantId === tenantId ? previous.records : []).map((record) => [record.id, record]));
          for (const record of records) if (record.tenantId === tenantId) byId.set(record.id, record);
          return { tenantId, records: [...byId.values()] };
        });
      })
      // Nothing more than the sample: the card waits for the next read.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [missing, tenantId]);

  return useMemo(() => {
    if (!sampled || !read || read.tenantId !== tenantId || !read.records.length) return sampled;
    const have = new Set(sampled.map((snapshot) => snapshot.id));
    return [...sampled, ...read.records.filter((record) => !have.has(record.id))];
  }, [sampled, read, tenantId]);
}
