import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export default function PostProductionPage() {
  return (
    <AppShell active="Post-production">
      <StudioDomainPage
        domain="post_production"
        eyebrow="After the event"
        title="Post-production"
        description="Accountable evidence from protected backup through delivery and closeout."
      />
    </AppShell>
  );
}
