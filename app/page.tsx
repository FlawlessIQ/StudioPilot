import "@/app/app-styles";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CalendarCheck2,
  Check,
  CircleCheck,
  FileCheck2,
  FileSignature,
  HandCoins,
  Heart,
  Play,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import { planCards } from "@/config/saas-plans";
import { JourneyFilmButton } from "@/components/help/journey-film";
import { HomeFaq } from "@/components/marketing/home-faq";
import { HomeJourney } from "@/components/marketing/home-journey";
import { LoopVideo } from "@/components/marketing/loop-video";
import { MarketingFooter, MarketingNav } from "@/components/marketing/marketing-layout";
import { StudioProof } from "@/components/marketing/studio-proof";
import { ThreePeople } from "@/components/marketing/three-people";
import { helpVideo, helpVideoLength } from "@/features/help/videos";
import { JOURNEY_FILM_ID, JOURNEY_PAGE, SCHEDULE, journeyStageHref } from "@/features/journey/expected-timeline";
import { marketingMetadata } from "@/features/marketing/metadata";
import { setupQuestionCount } from "@/features/today/setup-gaps";

/**
 * The homepage, rebuilt around the journey film
 * (docs/marketing-video-onboarding-plan-2026-10-02.md §4): wedding-led, selling
 * the whole wedding — inquiry to album, prepared for you, approved by you —
 * with the couple's and the crew's side shown, and a band for the other kinds
 * of work StudioCue now runs.
 *
 * Every claim sits next to a clip or a real screen, and the ones that depend
 * on the code are held to it by tests/marketing-claims.test.ts. Clips come
 * from features/marketing/media.ts; each one falls back to a still of the
 * film, or to nothing, if it hasn't been uploaded.
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

const paidSteps = [
  { icon: FileCheck2, title: "Proposal", text: "Priced from your packages. They accept it online." },
  { icon: FileSignature, title: "Agreement", text: "Written from the proposal and signed online in StudioCue." },
  { icon: Receipt, title: "Retainer", text: "Invoiced from your QuickBooks the moment they sign." },
  {
    icon: HandCoins,
    title: "Final balance",
    text: `Invoiced ${SCHEDULE.finalInvoiceRaisedDaysBefore / 7} weeks before the wedding, due ${SCHEDULE.finalInvoiceDueDaysBefore / 7} weeks before.`,
  },
  { icon: RefreshCw, title: "Autopay", text: "With QuickBooks Payments, a saved card pays the balance when it's due." },
];

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
            <ul>
              <li>
                <Sparkles size={18} /> Drafts your next step, in your voice
              </li>
              <li>
                <ShieldCheck size={18} /> Never records a payment, signature, permission, or
                readiness check
              </li>
              <li>
                <Check size={18} /> Nothing it writes sends until you approve
              </li>
            </ul>
            <p className="mk-stat">
              <strong>17 emails to Ella and Jordan. StudioCue wrote every one.</strong>
              <small>The wedding in the film, start to finish.</small>
            </p>
          </div>
          <div className="mk-story-media">
            <LoopVideo className="mk-frame-screen" fallbackPoster={posterOf("proposal")} id="proposal" />
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
              <ol className="mk-paid-steps">
                {paidSteps.map((step) => {
                  const Icon = step.icon;
                  return (
                    <li key={step.title}>
                      <span aria-hidden="true" className="mk-paid-icon">
                        <Icon size={17} />
                      </span>
                      <span>
                        <strong>{step.title}</strong>
                        <small>{step.text}</small>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <LoopVideo className="mk-frame-screen" fallbackPoster={posterOf("journey-3")} id="sign" />
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
            <LoopVideo className="mk-frame-screen" fallbackPoster={posterOf("journey-7")} id="timeline" />
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
