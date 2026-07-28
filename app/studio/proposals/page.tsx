import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function ProposalsPage() {
  return (
    <AppShell active="Proposals">
      <StudioDomainPage
        domain="proposals"
        eyebrow="Sales documents"
        title="Proposals"
        description="Every revision preserves its package, price, terms, and client snapshots."
      />
    </AppShell>
  );
}
