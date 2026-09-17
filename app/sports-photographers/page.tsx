import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = {
  title: "For Sports Photographers",
  description:
    "Organiser-led sports coverage: the brief asks about minors and consent up front, crews share one schedule, and players never get accounts.",
};

/**
 * Sports, claimed only as far as the product goes.
 *
 * This page promised "parent-managed release references" and "organization
 * workflow" checkpoints, neither of which exists. What does: a sports brief
 * that asks the organiser about minors, consent, teams and the day; a workflow
 * without a client questionnaire step, because the organiser sets the terms; and
 * crew coverage on one versioned schedule. Participants never get accounts
 * and nothing identifies faces — true because nothing of the kind was built,
 * which is the point worth making to a club or school.
 */
export default function SportsPhotographersPage() {
  return (
    <MarketingLayout
      eyebrow="Sports photography"
      title="Minors, consent and the running order, settled with the organiser first."
      description="A club, league or school books the day; the players never deal with you. StudioCue's sports brief asks the organiser the questions that matter when children are in front of the camera, and your crew arrive on one schedule."
    >
      <CapabilityGrid
        items={[
          {
            title: "The organiser answers for the day",
            text: "The brief goes to the club, league or school: who's the primary contact, who meets you at the venue, when to arrive, the running order and the wet-weather plan.",
            points: [
              "One accountable organiser",
              "Venue, arrival and running order",
              "Wet-weather plan in writing",
            ],
          },
          {
            title: "Minors and consent, asked up front",
            text: "Before the day, the organiser says whether anyone under 18 will be photographed and confirms they hold photography consent for every participant — and lists anyone who must not appear.",
            points: [
              "Under-18s asked about, not assumed",
              "Consent confirmed by the organiser",
              "A do-not-photograph list, in writing",
            ],
          },
          {
            title: "Nothing about players you don't need",
            text: "Participants never get accounts, never receive messages from you, and nothing in StudioCue recognises faces. You deal with the organiser; the players are simply the people on the teams list.",
            points: [
              "No participant accounts",
              "No messaging to participants",
              "No facial recognition",
            ],
          },
          {
            title: "Teams and groups, planned for",
            text: "The brief takes a headcount and the teams or groups to photograph separately, so coverage is planned from the actual day rather than worked out at the venue.",
            points: [
              "Headcount up front",
              "Teams listed individually",
              "Coverage sized before you arrive",
            ],
          },
          {
            title: "A workflow for organiser-led jobs",
            text: "No couple, so no client questionnaire step: a sports job runs on the contract, confirmed contacts, an approved schedule, accepted crew and confirmed locations — and reads ready only when those are done.",
            points: [
              "Only the steps a sports job needs",
              "Each one shown with what it's waiting on",
              "Nothing marked ready on a click",
            ],
          },
          {
            title: "Several photographers, one schedule",
            text: "Offer coverage down your ranked crew list until each role is filled. Everyone shoots from the same current run of show and confirms they've read it; a change asks them again.",
            points: [
              "Offers that move on when someone passes",
              "One versioned schedule for every photographer",
              "Acknowledged per person",
            ],
          },
        ]}
      />
    </MarketingLayout>
  );
}
