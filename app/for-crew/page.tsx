import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = {
  title: "For your crew",
  description:
    "Every second shooter and assistant gets their own StudioCue workspace: the offer, the call time, the locations, and the closeout — and nothing about jobs they are not on.",
};

/**
 * The subcontractor workspace, which the site had never mentioned.
 *
 * Twenty-one commands of built product — offers, schedules, prep,
 * requirements, closeout, availability — and a prospect could read every
 * marketing page without learning it existed. Claims here are drawn from what
 * the portal actually does, including the privacy line, which is the product's
 * own copy.
 */
export default function ForCrewPage() {
  return (
    <MarketingLayout
      eyebrow="For second shooters and assistants"
      title="Your crew stop asking you what time to be there."
      description="Everyone you hire gets their own workspace: the offer with the rate on it, the call time, the addresses, what they are covering, and where to send their hours afterwards. You stop being the group chat."
    >
      <CapabilityGrid
        items={[
          {
            title: "An offer they can answer",
            text: "Rate, call time, location and responsibilities in the offer itself — not a text message asking if they are free on the 14th.",
            points: [
              "Accept or decline in one tap",
              "Response deadline shown, and enforced",
              "Expired offers say so instead of going quiet",
            ],
          },
          {
            title: "Nobody chases a decline",
            text: "When someone turns a job down, StudioCue offers it to the next person on your list without waiting for you to notice.",
            points: [
              "Ordered fallback list",
              "Automatic re-offer on decline or expiry",
              "You are told when it runs out of people",
            ],
          },
          {
            title: "The schedule they actually need",
            text: "Their assigned segments, not the whole run of show. Published versions, and a record of who has seen the latest one.",
            points: [
              "Only the segments they are on",
              "Version numbers, not “latest final v3”",
              "Acknowledgement recorded per person",
            ],
          },
          {
            title: "Ready before the day",
            text: "Insurance certificates, signed paperwork and anything else you require, requested and tracked per person.",
            points: [
              "Requirements listed per assignment",
              "Secure document upload",
              "Outstanding items chased for you",
            ],
          },
          {
            title: "Works where the signal does not",
            text: "The event-day brief — timeline, locations, contacts — is cached on their device. Venues with no reception are the normal case, not the exception.",
            points: [
              "Offline event-day brief",
              "Addresses with directions",
              "Contacts only when you share them",
            ],
          },
          {
            title: "Closeout without the chase",
            text: "Hours, expenses and deliverables submitted by the person who did the work, reviewed by you, and settled against the assignment.",
            points: [
              "Submitted from their own portal",
              "You review before it counts",
              "Payment status visible to both sides",
            ],
          },
        ]}
      />
      <CapabilityGrid
        items={[
          {
            title: "They see their jobs. Nothing else.",
            text: "In the product's own words: you only see the jobs, contacts, files, and schedule details shared with you. A second shooter on one wedding cannot see your other couples, your rates, or your client list.",
            points: [
              "Scoped to their assignments",
              "Client contacts shared deliberately",
              "No access to your studio workspace",
            ],
          },
          {
            title: "No licence per freelancer",
            text: "Your crew are not billed seats. Bring in whoever the job needs — the people you hire for one Saturday do not cost you a subscription.",
            points: [
              "Unlimited subcontractors",
              "Seats are for your own team",
              "Invite by email, no account admin",
            ],
          },
        ]}
      />
    </MarketingLayout>
  );
}
