import { ClientProposal } from "@/components/client/kit/client-proposal";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientProposalPage() {
  return (
    <PortalShell active="Proposal">
      <ClientProposal />
    </PortalShell>
  );
}
