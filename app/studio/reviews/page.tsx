import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

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
