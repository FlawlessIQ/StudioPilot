import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = {
  title: "For your clients",
  description:
    "Your couples get one link: the proposal, the agreement, what they have paid, the run of show, and the gallery — instead of hunting through eleven months of email.",
};

/**
 * The client portal, which the site had never mentioned either.
 *
 * Eleven routes a couple actually uses — proposal, contract, payments,
 * schedule, questionnaire, documents, delivery, reviews, messages — and the
 * marketing described it as "client portal and standard integrations" in a
 * bullet on the pricing page.
 */
export default function ForClientsPage() {
  return (
    <MarketingLayout
      eyebrow="For couples and commissioning clients"
      title="One link, for the eleven months between booking and the gallery."
      description="A wedding is booked a year out and discussed in forty emails. Your clients get a single place with the proposal they accepted, what they have paid, the schedule for the day, and the photographs at the end of it."
    >
      <CapabilityGrid
        items={[
          {
            title: "Decide without a phone call",
            text: "The proposal shows the coverage, the total, and what happens if they say yes. They accept it in the portal, and the acceptance is recorded against the project.",
            points: [
              "Package and price they were quoted",
              "Accept, or ask a question first",
              "Locked total once accepted",
            ],
          },
          {
            title: "Pay without handling card details",
            text: "Retainer and balance are paid on your accounting provider's own secure page. StudioCue tracks that it happened and never touches a card number.",
            points: [
              "Provider-hosted payment page",
              "Retainer and final balance",
              "Receipts stay with your accounts",
            ],
          },
          {
            title: "The day, as agreed",
            text: "The run of show they need — times, locations, who is where — published when you are ready and not before.",
            points: [
              "Only published versions are visible",
              "Locations and access notes",
              "Changes are versioned, not overwritten",
            ],
          },
          {
            title: "Everything you asked them for",
            text: "Questionnaires, family shot lists, venue details and documents in one place, so the answers arrive before the week of the wedding.",
            points: [
              "Questionnaires with saved progress",
              "Document upload",
              "Outstanding items shown to them",
            ],
          },
          {
            title: "Messages that stay on the job",
            text: "They write from the portal or reply to your email, and it lands on the project thread either way — not in a personal inbox nobody else can see.",
            points: [
              "Threaded per project",
              "Email replies route back automatically",
              "The whole exchange kept on the record",
            ],
          },
          {
            title: "The gallery, and after",
            text: "Delivery, download, album progress and the review request — the end of the job handled as deliberately as the start.",
            points: [
              "Secure gallery hand-off",
              "Album status they can follow",
              "Review requested at the right moment",
            ],
          },
        ]}
      />
      <CapabilityGrid
        items={[
          {
            title: "They never create an account they forget",
            text: "Access comes by invitation from you, tied to the project and to the email address you already have for them. Nobody signs themselves up, and nobody has to remember which address they used.",
            points: [
              "Invited per project",
              "Access you can revoke",
              "Archived cleanly when the job closes",
            ],
          },
          {
            title: "It is your studio they see",
            text: "Your name on every page and every email. StudioCue is the thing making it work, not the brand your clients are asked to trust.",
            points: [
              "Your studio name and colours",
              "Emails sent in your name",
              "Replies come back to you, on the job",
            ],
          },
        ]}
      />
    </MarketingLayout>
  );
}
