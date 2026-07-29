import { AppShell } from "@/components/layout/app-shell";
import { StudioProposalComposer } from "@/components/proposals/studio-proposal-workspace";

export default function NewProposalPage() {
  return (
    <AppShell active="Proposals">
      <StudioProposalComposer />
    </AppShell>
  );
}
