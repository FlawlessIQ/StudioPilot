import Link from "next/link";
import { ArrowRight, Camera, Heart, Store } from "lucide-react";
import { TourLink } from "@/components/help/journey-film";
import { AnnotatedShot, PhoneShot } from "@/components/marketing/screen-shot";

/**
 * "Three people, one wedding": the same job from three sides, as stills — the
 * studio's job page in the middle, Ella's portal on one side and Jordan's day
 * sheet on the other (docs/marketing-visuals-plan-2026-10-03.md §3). The two
 * things that most set StudioCue apart from a CRM. Shared by the homepage and
 * /wedding-photographers. The phone tours are links that open in the film's
 * dialog, never players on the page.
 */
export function ThreePeople({ titleId }: { titleId: string }) {
  return (
    <section aria-labelledby={titleId} className="mk-section" id="people">
      <header className="mk-section-head">
        <span className="section-kicker">Three people, one wedding</span>
        <h2 id={titleId}>You, your couple and your crew, kept in step.</h2>
        <p>
          Each sees their own part of the same job. Nobody forwards an email, and nobody asks you
          what time to be there.
        </p>
      </header>
      <div className="mk-people">
        <article className="mk-people-you">
          <h3 className="mk-people-label">
            <Store aria-hidden="true" size={16} /> You
          </h3>
          <p>The whole job: where it is, the next move, and every step checked off.</p>
          <AnnotatedShot crop={{ bottom: 0.58 }} screen="job-page" />
        </article>
        <article className="mk-people-couple">
          <h3 className="mk-people-label">
            <Heart aria-hidden="true" size={16} /> Your couple
          </h3>
          <p>Their own portal, in your studio&rsquo;s name. Nothing to download.</p>
          <PhoneShot screen="portal-home" />
          <div className="mk-people-links">
            <TourLink
              arrow={false}
              blurb="the countdown, the one next step, and everything else in one place."
              title="The client portal"
              videoId="couple-tour"
              tour={{ watch: "Watch the couple's {min}-minute tour", see: "See the couple's tour" }}
            />
            <Link className="journey-film-page-link" href="/for-clients">
              What your couple sees <ArrowRight aria-hidden="true" size={14} />
            </Link>
          </div>
        </article>
        <article className="mk-people-crew">
          <h3 className="mk-people-label">
            <Camera aria-hidden="true" size={16} /> Your crew
          </h3>
          <p>The offer, the call time and the day sheet, on their phone.</p>
          <PhoneShot screen="crew-day-sheet" />
          <div className="mk-people-links">
            <TourLink
              arrow={false}
              blurb="an offer arrives with the date, the place and the fee, and one tap accepts it."
              title="The crew's side"
              videoId="crew-offer-accept"
              tour={{ watch: "Watch the crew's {min}-minute tour", see: "See the crew's tour" }}
            />
            <Link className="journey-film-page-link" href="/for-crew">
              What your crew sees <ArrowRight aria-hidden="true" size={14} />
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}
