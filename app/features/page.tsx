import type { Metadata } from "next";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";

export const metadata: Metadata = {
  title: "Features",
  description:
    "StudioCue refuses to mark a wedding booked on evidence it has not seen, and keeps working when a provider does not. What it will not do is the product.",
};

/**
 * Features, organised around what the system refuses.
 *
 * The previous version was four category names — "Booking without gaps",
 * "Event readiness" — which describe any photography CRM. What is actually
 * different is that six project transitions cannot be advanced by clicking,
 * that a missing provider degrades instead of stopping the job, and that the
 * browser cannot write the records that matter. Every claim below is a
 * behaviour with a mechanism behind it, not a category.
 */
export default function FeaturesPage() {
  return (
    <MarketingLayout
      eyebrow="Photography operations OS"
      title="Most of what matters is what it refuses to do."
      description="Software that tracks your work will believe whatever it is told. StudioCue is built the other way round: the moments that cost money — booked, ready, delivered — cannot be reached by clicking, only by evidence. Here is what that buys you."
    >
      <CapabilityGrid
        items={[
          {
            title: "A job cannot be marked booked by mistake",
            text: "Six points in a project's life will not move on a click. Booked, in particular, needs a signed agreement, a retainer that has cleared, a date nothing else is on, and complete client details — checked together, at the moment of booking. You can still take a job on with the retainer waived; the record then says it was waived, not that it was paid.",
            points: [
              "The gate names exactly what is missing",
              "Overrides exist, are permissioned, and are labelled as overrides",
              "Every check recorded with its result",
            ],
          },
          {
            title: "It keeps working when a provider does not",
            text: "No signing account? Send your own agreement and record the signature. Payments not set up? Record the transfer when it lands. The job books either way, and the record says a person vouched for it rather than pretending a provider confirmed it.",
            points: [
              "Signature recorded by the studio",
              "Retainer recorded by the studio",
              "Never filed as provider evidence",
            ],
          },
          {
            title: "Nothing is quietly overwritten",
            text: "The price a couple accepted, the terms they agreed, the schedule crew acknowledged: written once and kept. A change makes a new version and supersedes the old one — it does not edit history underneath the people who relied on it.",
            points: [
              "Immutable package and pricing snapshots",
              "Versioned schedules, acknowledged per person",
              "Superseded, never deleted",
            ],
          },
          {
            title: "The browser is never the authority",
            text: "Nothing important is decided in the page you are looking at. Bookings, invoices, permissions and the audit trail are written by the server after it checks who you are, what you are allowed to do, and whether the business rules hold.",
            points: [
              "The record collections reject browser writes outright",
              "Every check runs again server-side",
              "One tenant can never read another's",
            ],
          },
          {
            title: "The same instruction twice does the same thing once",
            text: "A double-tapped button, a retried request, a provider sending the same notification twice — none of it books a second job or raises a second invoice. Repeats return the original answer instead of doing the work again.",
            points: [
              "Every command carries an idempotency key",
              "Provider notifications recorded once",
              "Retries are free, by design",
            ],
          },
          {
            title: "When something fails, it says so",
            text: "A refused provider request is not left looking queued. The failure is shown where you are working, in words you can act on, with the way forward next to it — not discovered weeks later when a client asks.",
            points: [
              "The provider's own reason, translated",
              "Retry, or take the manual route",
              "Failed work never counts as done",
            ],
          },
        ]}
      />
      <CapabilityGrid
        items={[
          {
            title: "AI drafts. People decide.",
            text: "It will write the schedule, read the insurance certificate, and tell you what looks wrong. It will never record a payment, complete a signature, grant a permission or mark a readiness check passed — those are the four things it is structurally prevented from touching.",
            points: [
              "Extraction always leaves a human decision pending",
              "Drafts are proposals until you send them",
              "Charged against your plan before it runs, audited after",
            ],
          },
          {
            title: "Twelve things happen without you",
            text: "Album reminders, insurance chasing, crew offers expiring, final invoices, review requests, retries on anything a provider dropped. The work that gets forgotten in a busy season is the work nobody has to remember.",
            points: [
              "Runs on a schedule, not on your memory",
              "Every run recorded before it acts",
              "Nothing sent without your approval where it matters",
            ],
          },
        ]}
      />
    </MarketingLayout>
  );
}
