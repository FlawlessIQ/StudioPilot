import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function ContractsPage() {
  return (
    <AppShell active="Contracts">
      <StudioDomainPage
        domain="contracts"
        eyebrow="Docusign evidence"
        title="Contracts"
        description="Track agreements from draft through signature. A contract is complete only when every required signer has finished."
      />
    </AppShell>
  );
}
