import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { FinalInvoiceReconciliation } from "@/components/planning/final-invoice-reconciliation";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { AutopayHint } from "@/components/integrations/autopay-hint";
import { InvoiceLedger } from "@/components/billing/invoice-ledger";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Invoices">
      <StudioDomainPage
        domain="invoices"
        eyebrow="Billing"
        title="Invoices"
        description="Every bill on every job — the invoices you send yourself and any raised in QuickBooks — with what's owed, what's late and what hasn't gone out."
        projectId={project}
        rowActions="invoice"
        beforeContent={<InvoiceLedger projectId={project} />}
      />
      <AutopayHint />
      <FinalInvoiceReconciliation projectId={project} />
    </AppShell>
  );
}
