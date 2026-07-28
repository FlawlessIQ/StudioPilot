import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Action queue" };
export default function NotificationsPage() {
  return <AppShell active="Notifications"><StudioDomainPage domain="tasks" eyebrow="Recent activity" title="Notifications" description="See current tasks, deadlines, and project blockers that need your attention." /></AppShell>;
}
