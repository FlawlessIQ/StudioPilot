import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Action queue · StudioHub" };
export default function NotificationsPage() {
  return <AppShell active="Tasks"><StudioDomainPage domain="tasks" eyebrow="Action queue" title="Notifications" description="Current tenant-scoped tasks and blockers. StudioHub does not display invented unread counts." /></AppShell>;
}
