import { AppShell } from "@/components/layout/app-shell";
import { LiveRecordDetail } from "@/components/studio/live-record-detail";

export default async function CrewAssignmentDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AppShell active="Crew"><LiveRecordDetail id={id} kind="crew"/></AppShell>}
