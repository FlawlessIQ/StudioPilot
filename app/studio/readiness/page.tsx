import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { StudioDomainPage } from "@/components/studio/live-domain-view";

export const metadata: Metadata = { title: "Event Readiness" };

export default function ReadinessPage() {
  return (
    <AppShell active="Readiness">
      <StudioDomainPage
        domain="readiness"
        eyebrow="Event confidence"
        title="Event readiness"
        description="See what is complete, what is at risk, who owns each item, and what to do next."
      />
    </AppShell>
  );
}
