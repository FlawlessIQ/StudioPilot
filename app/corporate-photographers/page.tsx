import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = { title: "For Corporate Photographers" };

export default function CorporatePhotographersPage() {
  return (
    <MarketingLayout eyebrow="Corporate photography operations" title="Control scope, approvals, usage, and delivery." description="Coordinate company contacts, purchase orders, legal review, brand requirements, crews, locations, and final deliverables.">
      <CapabilityGrid items={[
        { title: "Commercial scope", text: "Preserve the deal that was approved.", points: ["Usage-right references", "Package and pricing snapshots", "Purchase-order checkpoints"] },
        { title: "Stakeholder approval", text: "Keep legal, brand, and location decisions visible.", points: ["Company and approver contacts", "Brand guidelines", "Shot-list approval"] },
        { title: "Reliable delivery", text: "Track production through accountable handoff.", points: ["Crew assignments", "Post-production stages", "Delivery evidence"] },
      ]} />
    </MarketingLayout>
  );
}
