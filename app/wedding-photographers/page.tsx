import { TourLink } from "@/components/help/journey-film";
import Link from "next/link";
import { CapabilityGrid, MarketingLayout } from "@/components/marketing/marketing-layout";
import { AnnotatedShot } from "@/components/marketing/screen-shot";
import { StudioProof } from "@/components/marketing/studio-proof";
import { ThreePeople } from "@/components/marketing/three-people";
import { HelpVideoPlayer } from "@/components/help/video-player";
import { JOURNEY_FILM_ID } from "@/features/journey/expected-timeline";
import { marketingMetadata } from "@/features/marketing/metadata";

export const metadata = marketingMetadata({
  title: "For Wedding Photographers",
  description:
    "StudioCue runs the whole wedding — inquiry to delivered gallery — and Cue drafts each next step for you to approve.",
  path: "/wedding-photographers",
  og: "wedding-photographers",
});

/**
 * The wedding page: the film is its one moving thing (decision D1,
 * docs/marketing-visuals-plan-2026-10-03.md), then three people as stills,
 * then the six stages — two of them with a real screen, the rest text, so
 * picture and words alternate rather than stack.
 */
export default function WeddingPhotographersPage() {
  return (
    <MarketingLayout
      eyebrow="For wedding photographers"
      title="Be ready for the day no one can reschedule."
      description="From the first inquiry to the delivered gallery, StudioCue runs the whole wedding, and Cue drafts each next step for you to approve. You keep every decision — you just stop being the bottleneck between the couple, the crew, and the day."
    >
      {/* The film, high on the page: the most relevant place for it. It
          renders nothing where the film isn't published. */}
      <section aria-label="A wedding, start to finish" className="marketing-film">
        <HelpVideoPlayer id={JOURNEY_FILM_ID} />
      </section>
      <ThreePeople titleId="studio-people-title" />
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
            wide: true,
          },
          {
            title: "Proposal → booked",
            text: "Send a proposal built from your own package and pricing. When they accept, StudioCue writes the agreement from it and they sign online in StudioCue. Booking only turns real on a signed agreement and a cleared retainer. Nothing books by accident.",
            points: [
              "Proposal priced from your package",
              "Agreement written from the proposal, signed online",
              "Signed another way? Record it yourself",
            ],
            visual: {
              layout: "below",
              node: (
                <AnnotatedShot
                  caption="The Harts' booking: contract signed, retainer paid, then — and only then — booked."
                  screen="booking-gate"
                />
              ),
            },
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
              "Per-person schedule acknowledgment",
            ],
          },
          {
            title: "Ready before the day",
            text: "Readiness tracks what has to be true before the wedding — contract, deposit, crew accepted, questionnaire complete, the venue's certificate of insurance — and names who owns every open item, so nothing is a surprise on Friday.",
            points: [
              "The venue's certificate of insurance asked for, checked and sent",
              "Live readiness checklist per wedding",
              "A clear owner for every blocker",
              "Offline event-day brief for the crew",
            ],
            visual: {
              layout: "side",
              flip: true,
              node: (
                <>
                  <AnnotatedShot
                    caption="The Harts' brief, the week of: the venue, the crew who accepted, readiness, and the run of show."
                    crop={{ top: 0.03, bottom: 0.62 }}
                    screen="wedding-week"
                  />
                  <TourLink
                    blurb="your agent, the check, the venue, in one place."
                    title="Certificates of insurance, handled"
                    tour={{ watch: "Watch: certificates of insurance, handled · {min} min", see: "See how certificates of insurance work" }}
                    videoId="coi"
                  />
                </>
              ),
            },
          },
          {
            title: "Delivery → review → closeout",
            text: "Hand off the gallery, request the review at the right moment, and close the job cleanly. The album reminders stop when they should, not forever.",
            points: [
              "Secure gallery hand-off",
              "Review requested automatically",
              "Closeout without the chase",
            ],
            wide: true,
          },
        ]}
      />
      <StudioProof />
      <p className="marketing-pricing-note">
        Also built for other event work — the same accountable workflow, tuned
        to each: <Link href="/corporate-photographers">corporate</Link> and{" "}
        <Link href="/sports-photographers">sports</Link>{" "}photography.
      </p>
    </MarketingLayout>
  );
}
