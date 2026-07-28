import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = { title: "For Sports Photographers · StudioHub" };

export default function SportsPhotographersPage() {
  return (
    <MarketingLayout eyebrow="Sports photography operations" title="Coordinate organizations, teams, crews, and delivery safely." description="StudioHub supports event-based sports workflows while minimizing player data and keeping parent or guardian relationships in control.">
      <CapabilityGrid items={[
        { title: "Organization workflow", text: "Track the accountable adult and event requirements.", points: ["Organization contacts", "Venue and team schedules", "Approval checkpoints"] },
        { title: "Minor-safety defaults", text: "Avoid child-directed account and messaging patterns.", points: ["No child accounts", "No facial recognition", "Parent-managed release references"] },
        { title: "Multi-crew execution", text: "Assign coverage and publish one current schedule.", points: ["Photographer assignments", "Mobile job briefs", "Secure delivery links"] },
      ]} />
    </MarketingLayout>
  );
}
