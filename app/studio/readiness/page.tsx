import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { ReadinessCheckpoints } from "@/components/projects/readiness-checkpoints";

export const metadata: Metadata = { title: "Event Readiness" };

export default async function ReadinessPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Readiness">
      <StudioDomainPage
        domain="readiness"
        eyebrow="Event confidence"
        title="Event readiness"
        description="See what is complete, what is at risk, who owns each item, and what to do next."
        projectId={project}
      />
      {/* The page promised "what to do next" and had nowhere to do it. */}
      {project ? <ReadinessCheckpoints projectId={project} /> : null}
    </AppShell>
  );
}
