import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = { title: "For Wedding Photographers · StudioHub" };

export default function WeddingPhotographersPage() {
  return (
    <MarketingLayout eyebrow="Wedding photography operations" title="Be ready for the day no one can reschedule." description="Coordinate couples, planners, venues, insurance agents, second shooters, payments, and the final run of show in one accountable workflow.">
      <CapabilityGrid items={[
        { title: "From inquiry to booked", text: "A guided sales and booking lifecycle.", points: ["Lead summaries", "Consultations", "Proposal, contract, and retainer gates"] },
        { title: "Planning that converges", text: "Turn client details into a publishable plan.", points: ["Questionnaires", "Vendor coordination", "AI-assisted run of show"] },
        { title: "A crew that is current", text: "Every photographer gets the right job brief.", points: ["Invitation and acceptance", "Mobile schedule", "Version acknowledgement"] },
      ]} />
    </MarketingLayout>
  );
}
