import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { TimelineAuthorityPanel } from "@/components/planning/timeline-authority-panel";

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Schedules">
      {project ? <TimelineAuthorityPanel projectId={project} /> : null}
      <StudioDomainPage
        domain="schedules"
        eyebrow="Run of show"
        title="Schedules"
        description="Build, review, publish, and track approval of each project’s run of show."
        action={{
          href: project
            ? `/studio/schedules/new?project=${encodeURIComponent(project)}`
            : "/studio/schedules/new",
          label: "Generate schedule",
        }}
        projectId={project}
      />
    </AppShell>
  );
}
