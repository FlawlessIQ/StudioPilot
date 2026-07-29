import { AppShell } from "@/components/layout/app-shell";
import { StudioProposalCenter } from "@/components/proposals/studio-proposal-workspace";

export default function ProposalsPage() {
  return (
    <AppShell active="Proposals">
      <StudioProposalCenter />
    </AppShell>
  );
}
