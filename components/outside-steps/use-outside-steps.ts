"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useTenantDocuments, useTenantRecordsGeneration } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { autopayStudioState } from "@/features/billing/autopay";
import {
  OUTSIDE_STEP_IDS,
  outsideStepReminder,
  outsideStepStatus,
  type OutsideStepId,
  type OutsideStepRecord,
  type OutsideStepReminder,
  type OutsideStepStatus,
} from "@/features/outside-steps/registry";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Where every outside step stands for this studio, and which ones Today
 * should raise. One read of the signals each step is judged by — what the
 * studio told us, the QuickBooks connection, saved cards, and whether an
 * inquiry has arrived by capture — shared by Today, the settings hub and the
 * cards themselves. Owners and admins only: they are the ones who take these
 * steps, and inquiry capture's record is theirs to read.
 */
export function useOutsideSteps(): {
  statuses: Record<OutsideStepId, OutsideStepStatus> | null;
  reminders: OutsideStepReminder[];
} {
  const workspace = useWorkspace();
  const allowed = ["studio_owner", "studio_admin"].includes(String(workspace.role));
  const tenants = useTenantDocuments("tenants", { enabled: allowed });
  const connections = useTenantDocuments("integrationConnections", { enabled: allowed });
  const methods = useTenantDocuments("paymentMethods", { enabled: allowed });
  // Zoom sent a summary: the job StudioCue queues when one arrives.
  const providerJobs = useTenantDocuments("providerJobs", { enabled: allowed });
  const generation = useTenantRecordsGeneration();
  const [captured, setCaptured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!allowed || !dataIsLive || !workspace.tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "leadCaptureSettings", workspace.tenantId))
      .then((snapshot) => {
        if (!active) return;
        setCaptured(
          Boolean(text(snapshot.get("lastCaptureAt"))) ||
            Boolean(text(snapshot.get("lastTestCaptureAt"))),
        );
      })
      .catch(() => {
        if (active) setCaptured(false);
      });
    return () => {
      active = false;
    };
  }, [allowed, workspace.tenantId, generation]);

  return useMemo(() => {
    if (!allowed || !tenants.records) return { statuses: null, reminders: [] };
    const tenant = tenants.records.find((entry) => entry.id === workspace.tenantId);
    const recorded = (tenant?.outsideSteps ?? {}) as Record<string, OutsideStepRecord>;
    const quickbooks = (connections.records ?? []).find(
      (entry) => entry.provider === "quickbooks",
    );
    const autopay = autopayStudioState({
      connection: quickbooks ?? null,
      tenant: tenant ?? null,
      methods: methods.records ?? [],
    });
    const statuses = Object.fromEntries(
      OUTSIDE_STEP_IDS.map((id) => [
        id,
        outsideStepStatus(id, {
          record: recorded[id],
          activeCards: autopay.activeCards,
          paymentsRefused: autopay.paymentsRefused,
          paymentsGranted: autopay.step >= 3,
          captured: Boolean(captured),
          zoomSummaries: (providerJobs.records ?? []).some(
            (job) => job.type === "capture_zoom_meeting_summary",
          ),
        }),
      ]),
    ) as Record<OutsideStepId, OutsideStepStatus>;
    const now = new Date();
    const reminders = OUTSIDE_STEP_IDS.map((id) => outsideStepReminder(id, statuses[id], now)).filter(
      (reminder): reminder is OutsideStepReminder => reminder !== null,
    );
    return { statuses, reminders };
  }, [
    allowed,
    captured,
    connections.records,
    methods.records,
    providerJobs.records,
    tenants.records,
    workspace.tenantId,
  ]);
}
