"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { useTenantRecordsGeneration } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

export type TeamRecord = Record<string, unknown> & { id: string };

export type VendorTeamData = {
  loading: boolean;
  error: string | null;
  entries: TeamRecord[];
  shares: TeamRecord[];
  /** The published run of show the timeline sends read, or null before one is published. */
  currentVersion: number | null;
  currentScheduleId: string | null;
  project: TeamRecord | null;
  refresh: () => void;
};

/**
 * A preview studio's vendor team (mock mode), so the panel, the printed sheet
 * and the layout audit have something real-shaped to show.
 */
function demoTeam(projectId: string): Omit<VendorTeamData, "refresh"> {
  const base = { tenantId: "demo-tenant", projectId, contractReceived: true, coiReceived: false, notes: null, archivedAt: null, strikeTime: null, balanceDueDate: null };
  const entries: TeamRecord[] = [
    { ...base, id: `${projectId}_demo_venue`, entryId: "demo_venue", vendorId: "demo_vendor_venue", category: "venue", roleLabel: null, status: "booked", company: "The Barn at Hope Farm", contactName: "Dana Whitfield", email: "events@barnathope.example.test", phone: "+1 908 555 0141", arrivalTime: "12:00", loadInTime: null, costCents: 1_250_000, balanceDueCents: 0, tipCents: null, coiReceived: true },
    { ...base, id: `${projectId}_demo_florist`, entryId: "demo_florist", vendorId: "demo_vendor_florist", category: "florist", roleLabel: null, status: "booked", company: "Petal & Stem", contactName: "Rosa Diaz", email: "rosa@petalandstem.example.test", phone: "+1 908 555 0117", arrivalTime: "13:30", loadInTime: "14:00", costCents: 420_000, balanceDueCents: 120_000, balanceDueDate: "2026-10-31", tipCents: 10_000 },
    { ...base, id: `${projectId}_demo_dj`, entryId: "demo_dj", vendorId: "demo_vendor_dj", category: "dj", roleLabel: "Dinner and dancing", status: "booked", company: "Spin Theory DJs", contactName: "Jay Okafor", email: "jay@spintheory.example.test", phone: "+1 973 555 0190", arrivalTime: null, loadInTime: "15:00", costCents: 170_000, balanceDueCents: 85_000, tipCents: 15_000 },
    { ...base, id: `${projectId}_demo_cake`, entryId: "demo_cake", vendorId: null, category: "bakery", roleLabel: null, status: "needed", company: null, contactName: null, email: null, phone: null, arrivalTime: null, loadInTime: null, costCents: null, balanceDueCents: null, tipCents: null, contractReceived: false },
  ];
  const shares: TeamRecord[] = [
    { id: "demo_share_venue", projectId, vendorContactId: "demo_vendor_venue", status: "acknowledged", sharedVersion: 2, acknowledgedVersion: 2, revokedAt: null },
    { id: "demo_share_florist", projectId, vendorContactId: "demo_vendor_florist", status: "viewed", sharedVersion: 1, acknowledgedVersion: null, revokedAt: null },
  ];
  return {
    loading: false,
    error: null,
    entries,
    shares,
    currentVersion: 2,
    currentScheduleId: "demo-schedule",
    project: { id: projectId, budgetCents: 3_500_000 },
  };
}

const empty = { loading: true, error: null, entries: [], shares: [], currentVersion: null, currentScheduleId: null, project: null };

/**
 * One job's vendor team, its timeline links and the version they are read
 * against, loaded together. Every query names the tenant: the rules decide a
 * list by what it asks for, and an unscoped one is refused whole.
 */
export function useVendorTeam(projectId: string): VendorTeamData {
  const workspace = useWorkspace();
  const generation = useTenantRecordsGeneration();
  const [own, setOwn] = useState(0);
  const [state, setState] = useState<Omit<VendorTeamData, "refresh">>(() => (dataIsLive ? empty : demoTeam(projectId)));
  const refresh = useCallback(() => setOwn((value) => value + 1), []);

  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId || !projectId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    const scoped = (name: string) =>
      getDocs(query(collection(firestore, name), where("tenantId", "==", workspace.tenantId), where("projectId", "==", projectId)));
    void Promise.all([scoped("projectVendors"), scoped("scheduleShares"), scoped("schedules"), getDoc(doc(firestore, "projects", projectId))])
      .then(([entries, shares, schedules, project]) => {
        if (!active) return;
        const latest = schedules.docs
          .map((schedule) => ({ id: schedule.id, ...schedule.data() }) as TeamRecord)
          .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
        const published = latest && latest.status === "published";
        setState({
          loading: false,
          error: null,
          entries: entries.docs
            .map((entry) => ({ id: entry.id, ...entry.data() }) as TeamRecord)
            .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""))),
          shares: shares.docs.map((share) => ({ id: share.id, ...share.data() }) as TeamRecord),
          currentVersion: published ? Number(latest.version) : null,
          currentScheduleId: published ? latest.id : null,
          project: project.exists() && project.get("tenantId") === workspace.tenantId ? ({ id: project.id, ...project.data() } as TeamRecord) : null,
        });
      })
      .catch((caught: unknown) => {
        // Said, not swallowed: an empty team is a claim, and a refused read is not one.
        console.warn("vendor team could not be loaded", caught);
        if (active) setState({ ...empty, loading: false, error: "The vendor team couldn't be loaded." });
      });
    return () => {
      active = false;
    };
  }, [generation, own, projectId, workspace.loading, workspace.tenantId]);

  return { ...state, refresh };
}
