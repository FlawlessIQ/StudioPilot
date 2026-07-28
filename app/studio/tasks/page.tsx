import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <AppShell active="Tasks">
      <StudioDomainPage
        domain="tasks"
        eyebrow="Execution queue"
        title="Tasks"
        description="See assigned work, deadlines, priorities, and which tasks affect event readiness."
        action={{ href: "/studio/tasks/new", label: "Create task" }}
      />
    </AppShell>
  );
}
