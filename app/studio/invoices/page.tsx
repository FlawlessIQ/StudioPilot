import { AppShell } from "@/components/layout/app-shell";
import { FinalInvoiceReconciliation } from "@/components/planning/final-invoice-reconciliation";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Invoices">
      <StudioDomainPage
        domain="invoices"
        eyebrow="QuickBooks references"
        title="Invoices"
        description="See retainer and final invoice status synced from QuickBooks."
        projectId={project}
      />
      <FinalInvoiceReconciliation projectId={project} />
    </AppShell>
  );
}
