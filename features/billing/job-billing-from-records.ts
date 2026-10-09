import { integrationProviderSchema } from "@/features/integrations/schema";
import { resolveActiveProvider, type RoutableConnection } from "@/features/integrations/routing";
import { isQuickBooksBill, jobBilling, type JobBilling } from "@/features/billing/job-billing";

type Row = Readonly<Record<string, unknown>>;

/**
 * Whether QuickBooks resolves as the studio's invoicing provider, from its
 * integration connections: what the server's quickBooksReady
 * (functions/src/billing/job-billing-reader.ts) answers.
 */
export function quickBooksReadyFrom(connections: ReadonlyArray<Row> | null | undefined): boolean {
  const routable = (connections ?? []).flatMap((connection): RoutableConnection[] => {
    const parsed = integrationProviderSchema.safeParse(connection.provider);
    if (!parsed.success) return [];
    const status = connection.status;
    return [
      {
        provider: parsed.data,
        status: status === "connected" || status === "degraded" || status === "disconnected" ? status : "error",
        archivedAt: typeof connection.archivedAt === "string" && connection.archivedAt ? connection.archivedAt : null,
      },
    ];
  });
  const resolution = resolveActiveProvider({ capability: "invoicing", routing: null, connections: routable });
  return resolution.outcome === "resolved" && resolution.provider === "quickbooks";
}

/**
 * How a job is billed, from the records a studio screen already holds — the
 * same answer the server reaches in jobBillingFor, so a screen never offers
 * a QuickBooks bill the server would refuse (BILLING_STUDIO_JOB).
 */
export function jobBillingFromRecords(input: {
  projectId: string;
  project: Row | null | undefined;
  connections: ReadonlyArray<Row> | null | undefined;
  invoices: ReadonlyArray<Row> | null | undefined;
  billingSettings: Row | null | undefined;
}): JobBilling {
  return jobBilling({
    project: input.project ?? null,
    quickbooksReady: quickBooksReadyFrom(input.connections),
    hasQuickBooksBills: (input.invoices ?? []).some(
      (invoice) => invoice.projectId === input.projectId && isQuickBooksBill(invoice),
    ),
    lastChoice: input.billingSettings?.lastJobBillingMethod,
  });
}
