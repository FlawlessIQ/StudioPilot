import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { JOURNEY_PAGE } from "@/features/journey/expected-timeline";

/**
 * The one proof point StudioCue has: GR Productions, the studio it was built
 * around. Shared by the homepage and /wedding-photographers.
 *
 * Every line here is a fact Conor confirmed on 2026-10-02, and the quote is
 * the one verbatim line we may use. Nothing else — no rating, no logo, no
 * second quote, no number that isn't Gabriel's own estimate. The film the
 * link opens is a fictional couple, so it says "a wedding", never "theirs".
 *
 * Internal: a longer quote and the GR Productions logo can replace this once
 * Gabriel approves them (plan D3, docs/marketing-video-onboarding-plan-2026-10-02.md).
 * Until then the studio's name is text, and the quote stays exactly as said.
 */
export function StudioProof() {
  return (
    <section aria-labelledby="studio-proof-title" className="studio-proof">
      <div className="studio-proof-inner">
        <figure className="studio-proof-quote">
          <span className="section-kicker">Built with a working studio</span>
          <blockquote>
            <p>&ldquo;I review it and send it.&rdquo;</p>
          </blockquote>
          <figcaption>
            <strong>Gabriel Rhodes</strong>
            <span>GR Productions, Madison, New Jersey</span>
          </figcaption>
        </figure>
        <div className="studio-proof-facts">
          <h2 id="studio-proof-title">Built around how one studio runs its weddings.</h2>
          <p>
            GR Productions is a wedding photography studio in Madison, New Jersey. StudioCue was built
            around the way it works: its inquiry form, its run-of-show rules, its night-before
            checklist. Its own wedding forms ship in StudioCue as recommended templates.
          </p>
          <p>
            Before StudioCue, GR ran each wedding across eight separate tools: about 5&ndash;6 hours of
            mechanical admin per couple, and 1&ndash;2 hours staffing each event, by Gabriel&rsquo;s own
            estimate.
          </p>
          <Link className="button button-light" href={JOURNEY_PAGE}>
            Watch a wedding run, start to finish <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}
