import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Event Readiness · StudioHub" };

export default function ReadinessPage() {
  return (
    <AppShell active="Readiness">
      <StudioDomainPage
        domain="readiness"
        eyebrow="Deterministic event gate"
        title="Event readiness"
        description="Blocking checkpoints, responsible parties, deadlines, and the recommended next action."
      />
    </AppShell>
  );
}
