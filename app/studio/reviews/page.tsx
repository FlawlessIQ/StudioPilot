import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Reviews">
      <StudioDomainPage
        domain="reviews"
        eyebrow="Reputation workflow"
        title="Review requests"
        description="Delivery-linked requests that stop only after explicit client or studio confirmation."
        projectId={project}
      />
    </AppShell>
  );
}
