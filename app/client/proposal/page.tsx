import { LiveClientProposal } from "@/components/client/live-client-views";
import { PortalShell } from "@/components/layout/portal-shell";

export default function ClientProposalPage() {
  return (
    <PortalShell active="Proposal">
      <LiveClientProposal />
    </PortalShell>
  );
}
