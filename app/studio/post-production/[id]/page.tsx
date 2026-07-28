import { AppShell } from "@/components/layout/app-shell";
import { LiveRecordDetail } from "@/components/studio/live-record-detail";

export default async function PostProductionDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AppShell active="Post-production"><LiveRecordDetail id={id} kind="post-production"/></AppShell>}
