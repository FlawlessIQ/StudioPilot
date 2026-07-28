import { AppShell } from "@/components/layout/app-shell";
import { LiveRecordDetail } from "@/components/studio/live-record-detail";

export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell active="Proposals"><LiveRecordDetail id={id} kind="proposal" /></AppShell>;
}
