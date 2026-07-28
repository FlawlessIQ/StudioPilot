import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function InvoicesPage() {
  return (
    <AppShell active="Invoices">
      <StudioDomainPage
        domain="invoices"
        eyebrow="QuickBooks references"
        title="Invoices"
        description="Synced accounting references; QuickBooks remains the payment system of record."
      />
    </AppShell>
  );
}
