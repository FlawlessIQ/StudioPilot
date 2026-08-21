import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = { title: "Features" };

export default function FeaturesPage() {
  return (
    <MarketingLayout eyebrow="Photography operations OS" title="A connected system from inquiry to closeout." description="StudioCue coordinates the people, evidence, provider state, and next actions behind every photography project.">
      <CapabilityGrid items={[
        { title: "Booking without gaps", text: "Move from the consultation to a booking that is checked before it counts.", points: ["Immutable package snapshots", "Dropbox Sign completion evidence", "QuickBooks payment references"] },
        { title: "Event readiness", text: "Know whether the project can actually execute.", points: ["Blocking checkpoints", "COI human approval", "Crew and schedule acknowledgement"] },
        { title: "AI with guardrails", text: "Draft and explain without replacing authoritative systems.", points: ["Structured schedule drafts", "Permission-aware Copilot", "No invented payments or signatures"] },
        { title: "Post-event control", text: "Protect delivery quality and finish the client lifecycle.", points: ["Post-production gates", "Secure delivery references", "Review and closeout workflows"] },
      ]} />
    </MarketingLayout>
  );
}
