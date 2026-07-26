import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ScheduleEditor } from "@/components/planning/schedule-editor";
import { StatusBadge } from "@/components/ui/status-badge";
export default function ScheduleDetailPage(){return <AppShell active="Schedules"><div className="planning-page"><Link className="back-link" href="/studio/schedules"><ArrowLeft size={15}/> All schedules</Link><header className="page-heading"><div><p className="eyebrow">Version 4 · Published July 26</p><h1>Maya &amp; Theo Johnson</h1><p>Saturday, August 15 · America/New_York</p></div><StatusBadge tone="warning">Client review</StatusBadge></header><div className="schedule-alert"><AlertTriangle/><span><strong>One renewed acknowledgement required</strong><small>Version 3 remains preserved. Crew acknowledgement reset when version 4 published.</small></span></div><ScheduleEditor/></div></AppShell>}
