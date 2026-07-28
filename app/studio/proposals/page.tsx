import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function ProposalsPage() {
  return (
    <AppShell active="Proposals">
      <StudioDomainPage
        domain="proposals"
        eyebrow="Sales documents"
        title="Proposals"
        description="Prepare, send, and track client proposals while preserving every accepted version."
      />
    </AppShell>
  );
}
