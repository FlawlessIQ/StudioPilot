import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

// One name for the bell's page. It was "Notifications" on the page, "Action
// queue" on the browser tab and "Today" in the sidebar (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Open tasks" };
export default function NotificationsPage() {
  return (
    <AppShell active="Open tasks">
      <StudioDomainPage
        domain="tasks"
        eyebrow="Waiting on you"
        title="Open tasks"
        description="Every task still open across your jobs, soonest due first. Finished ones are on each job."
        openOnly
      />
    </AppShell>
  );
}
