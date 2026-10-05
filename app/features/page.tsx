import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";
import { CueDoesCueNever } from "@/components/marketing/cue-does-cue-never";
import { AnnotatedShot } from "@/components/marketing/screen-shot";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "Features",
  description:
    "StudioCue refuses to mark a wedding booked on evidence it has not seen, and keeps working when a provider does not. What it will not do is the product.",
  path: "/features",
  og: "features",
});

/**
 * Features, organised around what the system refuses.
 *
 * The previous version was four category names — "Booking without gaps",
 * "Event readiness" — which describe any photography CRM. What is actually
 * different is that six project transitions cannot be advanced by clicking,
 * that a missing provider degrades instead of stopping the job, and that the
 * browser cannot write the records that matter. Every claim below is a
 * behaviour with a mechanism behind it, not a category.
 *
 * No clips (docs/marketing-visuals-plan-2026-10-03.md): two stills carry the
 * two claims a picture proves — the booking gate, and what Cue may and may
 * not do — and the rest is words.
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
            text: "The points in a project's life that cost money will not move on a click. Booked, in particular, needs a signed agreement, a retainer that has cleared, a date nothing else is on, and complete client details — checked together, at the moment of booking. You can still take a job on with the retainer waived; the record then says it was waived, not that it was paid.",
            points: [
              "The gate names exactly what is missing",
              "Overrides exist, are permissioned, and are labeled as overrides",
              "Every check recorded with its result",
            ],
            visual: {
              layout: "below",
              node: (
                <AnnotatedShot
                  caption="A real booking: the contract signed, the retainer paid, then the final check books it."
                  pins={[
                    { x: 15.5, y: 13.5, label: "Signed", text: "The agreement, signed online or recorded by you." },
                    { x: 46.5, y: 13.5, label: "Paid", text: "The retainer, cleared in QuickBooks or recorded by you." },
                    { x: 89, y: 38.5, label: "Booked", text: "Only once both are true, and the date is free." },
                  ]}
                  screen="booking-gate"
                />
              ),
            },
          },
          {
            title: "It keeps working when a provider does not",
            text: "Agreement signed on paper, or somewhere else? Record the signature. Payments not set up? Record the transfer when it lands. The job books either way, and the record says a person vouched for it rather than pretending a provider confirmed it.",
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
        ]}
      />
      <section aria-labelledby="cue-title" className="mk-section mk-cue-section">
        <header className="mk-section-head">
          <span className="section-kicker">Cue, the assistant</span>
          <h2 id="cue-title">Cue drafts. You decide.</h2>
          <p>
            Cue writes the schedule, reads the insurance certificate, and tells you what looks wrong.
            Four things it is structurally prevented from touching: payments, signatures,
            permissions and readiness. Every AI task is charged against your plan before it runs,
            and recorded after.
          </p>
        </header>
        <CueDoesCueNever />
      </section>
      <CapabilityGrid
        items={[
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
