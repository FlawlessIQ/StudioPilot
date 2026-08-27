import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Tasks">
      <StudioDomainPage
        domain="tasks"
        eyebrow="Execution queue"
        title="Tasks"
        description="See assigned work, deadlines, priorities, and which tasks affect event readiness."
        action={{ href: "/studio/tasks/new", label: "Create task" }}
        rowActions="task"
        projectId={project}
      />
    </AppShell>
  );
}
