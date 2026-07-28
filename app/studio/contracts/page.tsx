import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function ContractsPage() {
  return (
    <AppShell active="Contracts">
      <StudioDomainPage
        domain="contracts"
        eyebrow="Docusign evidence"
        title="Contracts"
        description="Provider-reported envelope state; only completion satisfies contractual checkpoints."
      />
    </AppShell>
  );
}
