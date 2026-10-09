import { AppShell } from "@/components/layout/app-shell";
import { LiveRecordDetail } from "@/components/studio/live-record-detail";
import { DeliveryOnly } from "@/components/post-event/nothing-delivered";

// A studio that delivers nothing has no post-production records (trades.ts).
export default async function PostProductionDetailPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <AppShell active="Post-production"><DeliveryOnly><LiveRecordDetail id={id} kind="post-production"/></DeliveryOnly></AppShell>}
