import { AppShell } from "@/components/layout/app-shell";
import { LiveRecordDetail } from "@/components/studio/live-record-detail";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell active="Workflows"><LiveRecordDetail id={id} kind="workflow"/></AppShell>;
}
