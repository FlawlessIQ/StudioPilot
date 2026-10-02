import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { FinalInvoiceReconciliation } from "@/components/planning/final-invoice-reconciliation";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { AutopayHint } from "@/components/integrations/autopay-hint";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Invoices" };

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
        rowActions="invoice"
      />
      <AutopayHint />
      <FinalInvoiceReconciliation projectId={project} />
    </AppShell>
  );
}
