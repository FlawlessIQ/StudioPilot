import type { Metadata } from "next";
import Link from "next/link";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = {
  title: "For Wedding Photographers",
  description:
    "StudioCue runs the whole wedding — inquiry to delivered gallery — and Cue drafts each next step for you to approve.",
};

export default function WeddingPhotographersPage() {
  return (
    <MarketingLayout
      eyebrow="For wedding photographers"
      title="Be ready for the day no one can reschedule."
      description="From the first inquiry to the delivered gallery, StudioCue runs the whole wedding, and Cue drafts each next step for you to approve. You keep every decision — you just stop being the bottleneck between the couple, the crew, and the day."
    >
      <CapabilityGrid
        items={[
          {
            title: "Inquiry → consultation",
            text: "A couple submits your inquiry form and books a consultation from slots checked against your real calendar — never a date you are already shooting. Cue drafts the reply in your voice.",
            points: [
              "One inquiry link, your branding",
              "Consultations booked against live availability",
              "Reply drafted for you to send",
            ],
          },
          {
            title: "Proposal → booked",
            text: "Send a proposal built from your own package and pricing. Booking only turns real on a signed agreement and a cleared retainer — or a signature you record yourself. Nothing books by accident.",
            points: [
              "Proposal priced from your package",
              "Signed-contract + retainer booking gate",
              "Record a signature taken any other way",
            ],
          },
          {
            title: "Planning that converges",
            text: "The planning questionnaire, vendor and venue details, the run of show — Cue turns the couple's answers into a draft timeline you review, and flags what is still missing.",
            points: [
              "Planning questionnaire with saved progress",
              "Cue-drafted run of show",
              "Insurance certificate collected and reviewed",
            ],
          },
          {
            title: "A crew that is current",
            text: "Offer a second shooter the rate, call time and location in one tap. If they pass, it cascades to the next person on your list without waiting on you. Everyone sees only their own job.",
            points: [
              "One-tap crew offers with the terms on them",
              "Automatic cascade on decline or expiry",
              "Per-person schedule acknowledgement",
            ],
          },
          {
            title: "Ready before the day",
            text: "Readiness tracks what has to be true before the wedding — contract, deposit, crew accepted, questionnaire complete — and names who owns every open item, so nothing is a surprise on Friday.",
            points: [
              "Live readiness checklist per wedding",
              "A clear owner for every blocker",
              "Offline event-day brief for the crew",
            ],
          },
          {
            title: "Delivery → review → closeout",
            text: "Hand off the gallery, request the review at the right moment, and close the job cleanly. The album reminders stop when they should, not forever.",
            points: [
              "Secure gallery hand-off",
              "Review requested automatically",
              "Closeout without the chase",
            ],
          },
        ]}
      />
      <p className="marketing-pricing-note">
        Also built for other event work — the same accountable workflow, tuned
        to each: <Link href="/corporate-photographers">corporate</Link> and{" "}
        <Link href="/sports-photographers">sports</Link> photography.
      </p>
    </MarketingLayout>
  );
}
