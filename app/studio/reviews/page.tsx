import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioReviewsPage } from "@/components/reviews/studio-reviews-page";

// Every studio page names itself on its tab; these fell back to
// "StudioCue · Photography Operations OS" (UI audit, 2026-10-02).
export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <AppShell active="Reviews">
      <StudioReviewsPage projectId={project} />
    </AppShell>
  );
}
