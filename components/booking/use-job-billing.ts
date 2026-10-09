"use client";

import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { jobBillingFromRecords } from "@/features/billing/job-billing-from-records";
import type { JobBilling } from "@/features/billing/job-billing";

/**
 * How this job is billed — QuickBooks, or the studio itself
 * (features/billing/job-billing.ts) — from the studio's shared records.
 *
 * Every control that would send a bill through QuickBooks reads this first
 * and stands aside on a job the studio bills itself, so nothing offers a
 * button the server can only refuse. Null while the records load.
 */
export function useJobBilling(projectId: string | null | undefined): JobBilling | null {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: invoices } = useTenantDocuments("invoiceReferences");
  const { records: connections } = useTenantDocuments("integrationConnections");
  const { records: settings } = useTenantDocuments("billingSettings");
  if (!projectId || !projects || !invoices || !connections) return null;
  return jobBillingFromRecords({
    projectId,
    project: projects.find((project) => project.id === projectId),
    connections,
    invoices,
    billingSettings: settings?.find((record) => record.tenantId === workspace.tenantId) ?? null,
  });
}
