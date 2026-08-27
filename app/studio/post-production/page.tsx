import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { PostProductionChecklist } from "@/components/post-event/post-production-checklist";

export default async function PostProductionPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Post-production">
      <StudioDomainPage
        domain="post_production"
        eyebrow="After the event"
        title="Post-production"
        description="Accountable evidence from protected backup through delivery and closeout."
        projectId={project}
      />
      {/* The checklist itself, not only the record summarising it. This page
          listed a job's current post-production step with nothing on it to
          act on, while the only working controls lived on /studio/delivery
          and nothing here linked there — the same dead-end the readiness page
          had before it grew buttons. */}
      {project ? <PostProductionChecklist projectId={project} /> : null}
    </AppShell>
  );
}
