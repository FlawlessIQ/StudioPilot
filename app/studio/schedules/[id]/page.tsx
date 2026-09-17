import { AppShell } from "@/components/layout/app-shell";
import { ScheduleImpactSummary } from "@/components/planning/schedule-impact-summary";
import { LiveRecordDetail } from "@/components/studio/live-record-detail";
import { TimelineAuthorityPanel } from "@/components/planning/timeline-authority-panel";
export default async function ScheduleDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AppShell active="Schedules"><div className="live-domain-page"><ScheduleImpactSummary scheduleId={id}/><TimelineAuthorityPanel scheduleId={id}/><LiveRecordDetail id={id} kind="schedule"/></div></AppShell>}
