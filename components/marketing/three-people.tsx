import Link from "next/link";
import { ArrowRight, Camera, Heart, Store } from "lucide-react";
import { LoopVideo } from "@/components/marketing/loop-video";
import { PhoneVideo } from "@/components/marketing/phone-video";
import { helpVideo } from "@/features/help/videos";

/**
 * "Three people, one wedding": the studio on Today, the couple's portal and
 * the crew's phone, side by side. The two things that most set StudioCue apart
 * from a CRM, and the homepage never showed either (plan §0). Shared by the
 * homepage and /wedding-photographers.
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
      <div className="mk-people-grid">
        <article className="mk-person mk-person-you">
          <h3>
            <Store aria-hidden="true" size={16} /> You
          </h3>
          <p>Today: every job&rsquo;s next step, prepared and waiting for your yes.</p>
          <LoopVideo className="mk-frame-screen" fallbackPoster={helpVideo("today")?.posterSrc ?? null} id="today" />
        </article>
        <article className="mk-person">
          <h3>
            <Heart aria-hidden="true" size={16} /> Your couple
          </h3>
          <p>
            Their own portal in your studio&rsquo;s name: proposal, agreement, payments, the plan for
            the day, then the gallery. Nothing to download.
          </p>
          <PhoneVideo id="couple-tour" />
          <Link className="journey-film-page-link" href="/for-clients">
            What your couple sees <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </article>
        <article className="mk-person">
          <h3>
            <Camera aria-hidden="true" size={16} /> Your crew
          </h3>
          <p>
            The offer with the rate on it, one tap to accept, then call times and the day sheet on
            their phone.
          </p>
          <PhoneVideo id="crew-offer-accept" />
          <Link className="journey-film-page-link" href="/for-crew">
            What your crew sees <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </article>
      </div>
    </section>
  );
}
