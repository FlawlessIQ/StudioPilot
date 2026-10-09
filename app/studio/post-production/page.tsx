import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";
import { PostProductionChecklist } from "@/components/post-event/post-production-checklist";
import { DeliveryOnly } from "@/components/post-event/nothing-delivered";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Post-production" };

export default async function PostProductionPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Post-production">
      {/* Nothing is made after the day by a DJ, makeup artist or hair stylist
          (trades.ts): their jobs never reach post-production, so a typed URL
          gets the plain answer rather than a backup-and-edit ladder. */}
      <DeliveryOnly page projectId={project}>
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
      </DeliveryOnly>
    </AppShell>
  );
}
