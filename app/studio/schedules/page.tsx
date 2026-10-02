import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { TimelineAuthorityPanel } from "@/components/planning/timeline-authority-panel";
import { VendorReshareBanner } from "@/components/planning/vendor-reshare-banner";
import { RecordTimelineAnswer } from "@/components/planning/record-timeline-answer";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Run of show" };

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Schedules">
      {project ? <TimelineAuthorityPanel projectId={project} /> : null}
      {/* A republished timeline has to reach the vendors too; this appears
          only while one of them holds an older version. */}
      {project ? <VendorReshareBanner projectId={project} /> : null}
      {project ? <RecordTimelineAnswer projectId={project} /> : null}
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
