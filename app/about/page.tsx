import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";
import { StudioProof } from "@/components/marketing/studio-proof";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "About StudioCue",
  absoluteTitle: true,
  description:
    "StudioCue (Studio Cue) is software for photography studios that runs every wedding and event from inquiry to gallery, built with a working wedding studio in New Jersey.",
  path: "/about",
  og: "home",
});

/**
 * What StudioCue is, said plainly, at the address a search for the name
 * expects (docs/seo — brand searches land on an About page as often as on
 * the home page). Facts only: what it does, who it's for, how it was built,
 * how to reach us.
 */
export default function AboutPage() {
  return (
    <MarketingLayout
      eyebrow="About"
      title="About StudioCue"
      description="StudioCue — sometimes written Studio Cue — is software for photography studios. It runs every wedding and event from the first inquiry to the final gallery, and drafts each next step for the studio to approve."
    >
      <CapabilityGrid
        items={[
          {
            title: "What it does",
            text: "A wedding is booked a year out and takes a hundred small steps to get to. StudioCue prepares each one — the reply, the proposal, the agreement, the payments, the run of show, the crew offer, the gallery — and waits for the studio's yes.",
            points: [
              "Inquiries, proposals and agreements signed online",
              "Invoices and payments through QuickBooks",
              "Planning forms, the run of show and readiness",
              "Crew offers, day sheets and closeout",
              "Gallery delivery, review asks and album reminders",
            ],
          },
          {
            title: "Who it's for",
            text: "Wedding photographers first, and the studios around them: family and portrait sessions, corporate events and sports. Couples and crew get their own app in the studio's name, on any phone, with nothing to download.",
            points: [
              "Photography studios and their teams",
              "Their clients, through a portal in the studio's name",
              "Their second shooters and assistants",
            ],
          },
          {
            title: "How it was built",
            text: "Alongside a working wedding studio, and shaped by how real weddings run — the story is below. The rule it was built on: StudioCue does the preparing, the studio does the deciding.",
            points: [
              "Cue, the assistant inside StudioCue, prepares; the studio approves",
              "It never records a payment, a signature or a permission on its own",
              "StudioCue never takes a cut of client payments",
            ],
          },
          {
            title: "Talk to us",
            text: "Questions, help with a workspace, or a studio that wants to try it: support is at studio-cue.com/support, and every screen in the product has a How to button with a guide.",
            points: ["Guides at studio-cue.com/how-to", "Support at studio-cue.com/support", "A 14-day trial, nothing charged for 14 days"],
          },
        ]}
      />
      <StudioProof />
    </MarketingLayout>
  );
}
