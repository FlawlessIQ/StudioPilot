import { AppShell } from "@/components/layout/app-shell";
import { LiveRecordDetail } from "@/components/studio/live-record-detail";
export default async function ScheduleDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AppShell active="Schedules"><LiveRecordDetail id={id} kind="schedule"/></AppShell>}
