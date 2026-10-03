import "@/app/app-styles";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CalendarCheck2,
  Check,
  CircleCheck,
  Heart,
  Play,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { planCards } from "@/config/saas-plans";
import { JourneyFilmButton } from "@/components/help/journey-film";
import { HomeFaq } from "@/components/marketing/home-faq";
import { HomeJourney } from "@/components/marketing/home-journey";
import { LoopVideo } from "@/components/marketing/loop-video";
import { MarketingFooter, MarketingNav } from "@/components/marketing/marketing-layout";
import { PaymentTrack } from "@/components/marketing/payment-track";
import { AnnotatedShot, PhoneShot } from "@/components/marketing/screen-shot";
import { StudioProof } from "@/components/marketing/studio-proof";
import { ThreePeople } from "@/components/marketing/three-people";
import { helpVideo, helpVideoLength } from "@/features/help/videos";
import { JOURNEY_FILM_ID, JOURNEY_PAGE, journeyStageHref } from "@/features/journey/expected-timeline";
import { marketingMetadata } from "@/features/marketing/metadata";
import { setupQuestionCount } from "@/features/today/setup-gaps";

/**
 * The homepage, rebuilt around the journey film
 * (docs/marketing-video-onboarding-plan-2026-10-02.md §4): wedding-led, selling
 * the whole wedding — inquiry to album, prepared for you, approved by you —
 * with the couple's and the crew's side shown, and a band for the other kinds
 * of work StudioCue now runs.
 *
 * One moving thing, up front: the hero loop and the film it opens. The six
 * chapter stops are its index — stills that open the film, never players.
 * Every other section makes its claim with one still: a real screen of the
 * same wedding with numbered pins, phone screens, or a diagram built in the
 * page (docs/marketing-visuals-plan-2026-10-03.md; held there by
 * tests/marketing-media-budget.test.ts). Claims that depend on the code are
 * held to it by tests/marketing-claims.test.ts.
 */
export const metadata = marketingMetadata({
  title: "StudioCue · Every wedding, inquiry to album, already prepared",
  socialTitle: "Every wedding, inquiry to album — already prepared.",
  description:
    "StudioCue drafts every next step of a wedding — the reply, the proposal, the agreement, the timeline, the crew offer — and waits for your yes. Your couple and your crew each get their own app.",
  path: "/",
  og: "home",
  absoluteTitle: true,
});

const posterOf = (id: string) => helpVideo(id)?.posterSrc ?? null;

const otherWork = [
  {
    icon: Heart,
    title: "Family & portraits",
    text: "Paid in full to book, no agreement unless you add one, and a short details form two weeks out.",
    href: null,
  },
  {
    icon: Briefcase,
    title: "Corporate & events",
    text: "A brief that asks who signs off and how you get in, a run of show, and your crew on it.",
    href: "/corporate-photographers",
  },
  {
    icon: Trophy,
    title: "Sports",
    text: "Paid on the day, a game-day plan, and every photographer on one schedule.",
    href: "/sports-photographers",
  },
];

export default function MarketingHome() {
  // "6 min" once the film is published here; without it the buttons are
  // plain links to the written page, and say "See" rather than "Watch".
  const filmLength = helpVideoLength(JOURNEY_FILM_ID);
  const watchLabel = filmLength
    ? `Watch a wedding, start to finish · ${filmLength}`
    : "See a wedding, start to finish";
  return (
    <div className="ds-root marketing-page" data-ds-theme="emerald">
      <MarketingNav />

      <main>
        <section className="hero mk-hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-copy">
            <p className="hero-eyebrow">For wedding photographers</p>
            {/* A/B later (plan §4 Test): "Run every wedding without the admin eating your week." */}
            <h1>Every wedding, inquiry to album — already prepared.</h1>
            <p>
              StudioCue drafts every next step — the reply, the proposal, the agreement, the
              timeline, the crew offer — and waits for your yes. Your couple and your crew each
              get their own app.
            </p>
            <div className="hero-actions">
              <Link className="button button-dark" href="/auth/register">
                Start your free trial <ArrowRight size={17} />
              </Link>
              {/* Opens the film in a dialog, with sound; without JavaScript
                  it is a link to the page the film sits on. */}
              <JourneyFilmButton className="button button-light" href={JOURNEY_PAGE}>
                {filmLength ? <Play aria-hidden="true" size={16} /> : null}
                {watchLabel}
              </JourneyFilmButton>
            </div>
            <div className="hero-proof">
              <span>
                <Check size={15} /> 14-day trial
              </span>
              <span>
                <Check size={15} /> Card required, nothing charged for 14 days
              </span>
              <span>
                <Check size={15} /> {`Setup is ${setupQuestionCount()} questions`}
              </span>
            </div>
          </div>

          {/* The real product, not a mock: Ella's inquiry → the drafted reply
              → Send → her phone. Phones and reduced motion get the still,
              and the play button opens the film instead. */}
          <div className="mk-hero-media">
            <LoopVideo
              className="mk-frame-screen"
              fallbackPoster={posterOf(JOURNEY_FILM_ID)}
              id="hero-loop"
              still="phones"
            />
            {filmLength ? (
              <JourneyFilmButton className="mk-hero-play" href={JOURNEY_PAGE} label={watchLabel}>
                <span aria-hidden="true" className="mk-hero-play-icon">
                  <Play size={18} />
                </span>
                <span>{`Watch the film · ${filmLength}`}</span>
              </JourneyFilmButton>
            ) : null}
          </div>
        </section>

        <section className="mk-section" aria-labelledby="journey-title" id="journey">
          <header className="mk-section-head">
            <span className="section-kicker">The whole year, not just the booking</span>
            <h2 id="journey-title">One wedding, start to finish.</h2>
            <p>
              Inquiry to album is a year or more and a hundred small steps. This is what StudioCue
              does at each stop. Press one to watch that part of the film.
            </p>
          </header>
          <HomeJourney />
          <div className="mk-section-actions">
            <JourneyFilmButton className="button button-dark" href={JOURNEY_PAGE}>
              {filmLength ? <Play aria-hidden="true" size={16} /> : null}
              {filmLength ? `Watch the whole film · ${filmLength}` : "See every stage"}
            </JourneyFilmButton>
            <Link className="journey-film-page-link" href={JOURNEY_PAGE}>
              Read it stage by stage <ArrowRight aria-hidden="true" size={14} />
            </Link>
          </div>
        </section>

        <ThreePeople titleId="people-title" />

        <section className="readiness-story readiness-story--dark mk-story" id="cue">
          <div className="story-copy">
            <span className="section-kicker">Meet Cue</span>
            <h2>It prepares. You approve.</h2>
            <p>
              Cue is the assistant inside StudioCue. It writes the reply in your voice, turns the
              couple&rsquo;s answers into a run of show, and tells you plainly what isn&rsquo;t
              ready and why. Ask it about any job.
            </p>
            <p className="mk-stat">
              <strong>17 emails to Ella and Jordan. StudioCue wrote every one.</strong>
              <small>The wedding in the film, start to finish.</small>
            </p>
          </div>
          <div className="mk-story-media">
            {/* Today, the week of the Harts' wedding: what Cue has prepared. */}
            <AnnotatedShot
              pins={[
                {
                  x: 53,
                  y: 37,
                  label: "Drafted in your voice",
                  text: "Ella's day-before note, her final invoice notice, the schedule confirmation.",
                },
                { x: 66, y: 42, label: "One tap to send", text: "Or open it and change a word first." },
                {
                  x: 40.5,
                  y: 70,
                  label: "Waits for you",
                  text: "It never records a payment, a signature or a permission.",
                },
              ]}
              screen="today-prepared"
            />
          </div>
        </section>

        <section className="mk-section" aria-labelledby="paid-title" id="getting-paid">
          <div className="mk-split">
            <div>
              <header className="mk-section-head mk-section-head--left">
                <span className="section-kicker">Getting paid</span>
                <h2 id="paid-title">From yes to paid in full, without chasing.</h2>
                <p>
                  Invoices go out from your own QuickBooks, and payments land there.
                  StudioCue never takes a cut of client payments.
                </p>
              </header>
              <PaymentTrack />
            </div>
            <PhoneShot
              caption="What Ella sees: her next payment, the retainer already paid, and Pay securely in QuickBooks."
              className="mk-paid-phone"
              screen="portal-payment"
            />
          </div>
        </section>

        <section className="readiness-story mk-story" id="readiness">
          <div className="story-copy">
            <span className="section-kicker">The readiness engine</span>
            <h2>&ldquo;Booked&rdquo; isn&rsquo;t ready.</h2>
            <p>
              StudioCue checks the facts your team defines: signed agreements, reconciled payments,
              approved schedules, accepted crew, confirmed locations, insurance, and every blocking
              checkpoint.
            </p>
            <ul>
              <li>
                <ShieldCheck size={18} /> Fixed rules, never an AI guess
              </li>
              <li>
                <Users size={18} /> A clear owner for every blocker
              </li>
              <li>
                <CalendarCheck2 size={18} /> The week before the day, handled
              </li>
            </ul>
            <Link className="button button-dark" href={journeyStageHref("wedding-week")}>
              See the week before the day <ArrowRight size={17} />
            </Link>
          </div>
          <div className="mk-story-media">
            {/* The event-day brief for the Harts' wedding, the week of. */}
            <AnnotatedShot
              crop={{ top: 0.03, bottom: 0.7 }}
              pins={[
                { x: 22.5, y: 7, label: "Where and when", text: "Willow Creek Barn, and what's next on the day." },
                { x: 41, y: 7, label: "The run of show, version 1", text: "Published, and the same one your crew reads." },
                { x: 66.5, y: 7, label: "Who's coming", text: "Jordan, accepted." },
              ]}
              screen="wedding-week"
            />
          </div>
        </section>

        <section className="mk-section" aria-labelledby="other-title" id="not-just-weddings">
          <header className="mk-section-head">
            <span className="section-kicker">Not just weddings</span>
            <h2 id="other-title">The rest of your calendar runs the same way.</h2>
            <p>
              Each kind of job books, bills and plans the way its work does, with its own words.
              No &ldquo;your wedding&rdquo; for a family session.
            </p>
          </header>
          <div className="mk-other-grid">
            {otherWork.map((kind) => {
              const Icon = kind.icon;
              return (
                <article key={kind.title}>
                  <span aria-hidden="true" className="mk-other-icon">
                    <Icon size={19} />
                  </span>
                  <h3>{kind.title}</h3>
                  <p>{kind.text}</p>
                  {kind.href ? (
                    <Link className="journey-film-page-link" href={kind.href}>
                      {`More on ${kind.title.toLowerCase()}`} <ArrowRight aria-hidden="true" size={14} />
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <StudioProof />

        <section className="integration-band" id="integrations">
          <p>Works with the tools your studio already trusts</p>
          <div>
            {/* Only what a studio can connect today (features/integrations/schema.ts
                offeredProviders, and NEXT_PUBLIC_ENABLED_OAUTH_PROVIDERS for the
                OAuth ones). Outlook waits on Microsoft's app approval. */}
            {["QuickBooks", "Google Calendar", "Apple Calendar", "Zoom", "Dropbox"].map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <Link className="journey-film-page-link" href="/integrations">
            See every integration <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </section>

        <section className="marketing-pricing" id="pricing">
          <header>
            <span className="section-kicker">Simple, serious software</span>
            <h2>Price the operation—not every client.</h2>
            <p>
              Every plan includes unlimited clients and projects. Annual plans include
              two months free.
            </p>
          </header>
          <div className="marketing-pricing-grid">
            {planCards.map((plan) => (
              <article
                className={`marketing-price-card ${plan.highlight ? "is-featured" : ""}`}
                key={plan.key}
              >
                <div className="marketing-plan-heading">
                  <span>
                    {/* No "Most popular" or "Best for teams": there are no
                        customers yet to make either true (config/saas-plans.ts). */}
                    <small>StudioCue</small>
                    <h3>{plan.name}</h3>
                  </span>
                </div>
                <p>{plan.description}</p>
                <div className="marketing-plan-price">
                  <strong>{plan.monthly}</strong>
                  <span>/month</span>
                </div>
                <small className="marketing-annual-price">
                  {plan.yearly}/year · two months free
                </small>
                <ul>
                  <li><CircleCheck size={16} /> {plan.users}</li>
                  <li><CircleCheck size={16} /> {plan.ai}</li>
                  {plan.features.map((feature) => (
                    <li key={feature}><CircleCheck size={16} /> {feature}</li>
                  ))}
                </ul>
                <Link
                  className={`button ${plan.highlight ? "button-dark" : "button-light"}`}
                  href={`/auth/register?plan=${plan.key}`}
                >
                  Start with {plan.name} <ArrowRight size={16} />
                </Link>
              </article>
            ))}
          </div>
          <p className="marketing-pricing-note">
            Provider subscriptions, assisted migration, and implementation
            services are billed separately. StudioCue does not charge a percentage of
            client payments.
          </p>
        </section>

        <HomeFaq />

        <section className="closing-cta" aria-label="Get started">
          <div className="closing-inner">
            <h2>Your next wedding is already being prepared.</h2>
            <p>
              Start free today. Cue drafts the first move before you&rsquo;ve finished
              your coffee&mdash;you decide whether it sends.
            </p>
            <div className="closing-actions">
              <Link className="button button-dark" href="/auth/register">
                Start your free trial <ArrowRight size={17} />
              </Link>
              <JourneyFilmButton className="button button-ghost" href={JOURNEY_PAGE}>
                {watchLabel}
              </JourneyFilmButton>
            </div>
            <div className="closing-proof">
              <span>
                <Check size={15} /> 14-day trial
              </span>
              <span>
                <Check size={15} /> Card required, nothing charged for 14 days
              </span>
              <span>
                <Check size={15} /> {`Setup is ${setupQuestionCount()} questions`}
              </span>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
