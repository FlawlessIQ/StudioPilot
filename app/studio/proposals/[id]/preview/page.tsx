import { AppShell } from "@/components/layout/app-shell";
import { LiveProposalPreview } from "@/components/proposals/live-proposal-preview";

export default async function ProposalPreviewPage({params}:{params:Promise<{id:string}>}) {
  const { id } = await params;
  return <AppShell active="Proposals"><LiveProposalPreview id={id} /></AppShell>;
}
