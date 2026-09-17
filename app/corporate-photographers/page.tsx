import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = {
  title: "For Corporate Photographers",
  description:
    "The brief asks who signs off, how you get in, where the images will run and who must not appear — before the day, not on it.",
};

/**
 * Corporate, claimed only as far as the product goes.
 *
 * This page listed purchase-order checkpoints, usage-right references and
 * shot-list approval. None of those exist: there is no purchase order and no
 * usage-rights record anywhere in StudioCue, and the readiness code notes that
 * no shot list exists in the product. What a corporate job does get is a brief
 * built for it, a trimmed workflow, a price that can't drift, and the same
 * crew and booking machinery a wedding runs on. Every line below is one of
 * those.
 */
export default function CorporatePhotographersPage() {
  return (
    <MarketingLayout
      eyebrow="Corporate photography"
      title="The questions that sink a corporate shoot, asked before the day."
      description="Who signs off on the selects. Whether security has your name. Where the images will run, and who must not be in them. StudioCue's corporate brief gets those answers in writing weeks ahead, and the job doesn't read ready until it has them."
    >
      <CapabilityGrid
        items={[
          {
            title: "A brief built for a corporate job",
            text: "Not a wedding questionnaire with the word changed. It asks for the company, the billing contact, who meets you on the day and — the one that matters — who signs off on the final selection.",
            points: [
              "Building access, security and passes",
              "Load-in time, and whether there's power",
              "Due three weeks before the shoot",
            ],
          },
          {
            title: "What the images are for, in their words",
            text: "Website, social, print, press or internal — chosen by the client, with the shots that matter most and any brand references, so the brief you shoot from is the one they agreed to.",
            points: [
              "Usage chosen by the client",
              "Shot priorities in writing",
              "Brand references attached to the job",
            ],
          },
          {
            title: "Consent before the camera comes out",
            text: "The client confirms everyone has agreed to be photographed, says how many people you'll be shooting, and lists anyone who must not appear, so you know before you set up.",
            points: [
              "Consent acknowledged by the client",
              "A do-not-photograph list",
              "Headcount for planning coverage",
            ],
          },
          {
            title: "Ready means ready",
            text: "A corporate job has its own workflow: contract signed, brief complete, contacts confirmed, run of show approved, crew accepted, locations confirmed. Until those are done, it doesn't read ready — however close the date is.",
            points: [
              "Only the steps a corporate job needs",
              "Each one shown with what it's waiting on",
              "Nothing marked ready on a click",
            ],
          },
          {
            title: "The price that was agreed stays agreed",
            text: "The package and price the client accepted are written once and kept. Change the package later and existing jobs keep what they signed for; invoices bill that, not today's list price.",
            points: [
              "Pricing locked when accepted",
              "Invoices through QuickBooks",
              "Payments recorded when they land another way",
            ],
          },
          {
            title: "Crew who know the plan",
            text: "Offer the job down your ranked list until someone accepts, then share the run of show. Each person confirms they've read the version they'll shoot from, and a change asks them again.",
            points: [
              "Offers that move on when someone passes",
              "One current schedule, versioned",
              "Acknowledged per person",
            ],
          },
        ]}
      />
    </MarketingLayout>
  );
}
