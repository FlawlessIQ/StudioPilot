import { AppShell } from "@/components/layout/app-shell";
import { StudioProposalWorkspace } from "@/components/proposals/studio-proposal-workspace";

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell active="Proposals"><StudioProposalWorkspace id={id} /></AppShell>;
}
