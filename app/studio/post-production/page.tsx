import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

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
    </AppShell>
  );
}
