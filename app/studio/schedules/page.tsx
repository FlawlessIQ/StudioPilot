import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Schedules">
      <StudioDomainPage
        domain="schedules"
        eyebrow="Run of show"
        title="Schedules"
        description="Build, review, publish, and track approval of each project’s run of show."
        action={{ href: "/studio/schedules/new", label: "Generate schedule" }}
        projectId={project}
      />
    </AppShell>
  );
}
