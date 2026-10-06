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
import { HireComparison } from "@/components/marketing/hire-comparison";
import { HomeJourney } from "@/components/marketing/home-journey";
import { JobDescription } from "@/components/marketing/job-description";
import { LoopVideo } from "@/components/marketing/loop-video";
import { MarketingFooter, MarketingNav } from "@/components/marketing/marketing-layout";
import { BrandSchema } from "@/components/seo/brand-schema";
import { PaymentTrack } from "@/components/marketing/payment-track";
import { SaturdayLog } from "@/components/marketing/saturday-log";
import { AnnotatedShot, PhoneShot } from "@/components/marketing/screen-shot";
import { TourLink } from "@/components/help/journey-film";
import { StudioProof } from "@/components/marketing/studio-proof";
import { ThreePeople } from "@/components/marketing/three-people";
import { helpVideo, helpVideoLength } from "@/features/help/videos";
import { JOURNEY_FILM_ID, JOURNEY_PAGE, journeyStageHref } from "@/features/journey/expected-timeline";
import { assistantHoursFor } from "@/features/marketing/cue-duties";
import { marketingMetadata } from "@/features/marketing/metadata";
import { setupQuestionCount } from "@/features/today/setup-gaps";

/**
 * The homepage. Since 2026-10-06 it sells Cue as the studio's office manager
 * (docs/positioning-office-manager-plan-2026-10-06.md): a hire that works
 * every hour and waits for the photographer on what matters. What Cue does on
 * its own and what it prepares comes from features/marketing/cue-duties.ts.
 * Couples and crew never hear of Cue, so the sections about them speak of the
 * studio. Before that it was rebuilt around the journey film
 * (docs/marketing-video-onboarding-plan-2026-10-02.md §4), which it still
 * carries: wedding-led, the couple's and the crew's side shown, and a band
 * for the other kinds of work StudioCue runs.
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
  title: "StudioCue · Meet Cue, the office manager for photography studios",
  socialTitle: "Meet Cue, your studio's office manager.",
  description:
    "Cue answers new inquiries, sends the paperwork, chases the insurance certificate, lines up your crew and keeps your couples on schedule, at any hour. Anything that matters waits for your yes.",
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
      <BrandSchema />
      <MarketingNav />

      <main>
        <section className="hero mk-hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-copy">
            <p className="hero-eyebrow">For wedding photographers</p>
            {/* A/B later: "You shoot. Cue runs the office." */}
            <h1>Meet Cue, your studio&rsquo;s office manager.</h1>
            <p>
              Cue answers new inquiries, sends the paperwork, chases the insurance certificate,
              lines up your crew and keeps your couples on schedule, day and night. Anything that
              matters waits for your yes.
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

        <section className="readiness-story readiness-story--dark mk-story" id="cue">
          <div className="story-copy">
            <span className="section-kicker">While you were shooting</span>
            <h2>Cue ran the office.</h2>
            <p>
              You were at a wedding all day. Cue answered the inquiry that came in at breakfast,
              found a second shooter when yours dropped out, and caught a certificate that would
              have kept you out of the venue. On Monday, five things are waiting for you, each
              ready to send.
            </p>
            <p className="mk-stat">
              <strong>Works around the clock. Waits for you on what matters.</strong>
              <small>Routine notices and reminders go out on their own. Anything Cue writes for you, and anything about money or signatures, waits for your yes.</small>
            </p>
          </div>
          <div className="mk-story-media">
            <SaturdayLog />
          </div>
        </section>

        <section className="mk-section" aria-labelledby="journey-title" id="journey">
          <header className="mk-section-head">
            <span className="section-kicker">The whole year, not just the booking</span>
            <h2 id="journey-title">Watch Cue run one wedding, start to finish.</h2>
            <p>
              Inquiry to album is a year or more and a hundred small steps. This is what Cue
              handles at each stop. Press one to watch that part of the film.
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

        <section className="mk-section" aria-labelledby="role-title" id="job-description">
          <header className="mk-section-head">
            <span className="section-kicker">The job description</span>
            <h2 id="role-title">Everything an office manager does, except the coffee runs.</h2>
            <p>
              Cue does the routine work on its own and prepares the rest for one tap. It learns
              your studio from your own agreement, packages and forms.
            </p>
          </header>
          <JobDescription perArea={2} />
        </section>

        <section className="readiness-story readiness-story--dark mk-story" id="trust">
          <div className="story-copy">
            <span className="section-kicker">Like any new hire</span>
            <h2>It starts by asking. It earns the keys.</h2>
            <p>
              On day one, the messages that sound like you wait for you: the schedule confirmation,
              the day-before checklist, the balance notice. Approve the same kind three times
              without changing a word and Cue offers to send it on its own from then on. Money,
              signatures and anything Cue writes itself always wait.
            </p>
            <p className="mk-stat">
              <strong>17 emails to Ella and Jordan. Cue wrote every one.</strong>
              <small>The wedding in the film, start to finish. Every one went out in the studio&rsquo;s name.</small>
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
                <h2 id="paid-title">From yes to paid in full, without the chasing.</h2>
                <p>
                  Cue sends each invoice from your own QuickBooks at the right moment. When a
                  payment runs late, it drafts the reminder and you send it with one tap.
                  Payments land in QuickBooks, and StudioCue never takes a cut of client payments.
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

        <section className="mk-section" aria-labelledby="coi-title" id="certificates">
          <div className="mk-split">
            <div>
              <header className="mk-section-head mk-section-head--left">
                <span className="section-kicker">Certificates of insurance</span>
                <h2 id="coi-title">Cue gets the certificate the venue asks for.</h2>
                <p>
                  Most venues won&rsquo;t let you shoot without a certificate naming them. Cue gets the
                  request to your agent ready, chases until it&rsquo;s back, checks it against what the venue
                  requires, and sends it on once you approve.
                </p>
              </header>
              <ul className="mk-coi-points">
                <li>
                  <CalendarCheck2 size={18} /> Asked for 60 days out, chased until it&rsquo;s back
                </li>
                <li>
                  <ShieldCheck size={18} /> Checked against the venue&rsquo;s requirements, problems flagged
                </li>
                <li>
                  <Users size={18} /> You approve it, the venue gets it, and the venue is remembered next time
                </li>
              </ul>
              <TourLink
                blurb="your agent, the check, the venue, in one place."
                title="Certificates of insurance, handled"
                tour={{ watch: "Watch: certificates of insurance, handled · {min} min", see: "See how certificates of insurance work" }}
                videoId="coi"
              />
            </div>
            {/* A certificate back from the agent for the Harts' venue, caught short. */}
            <AnnotatedShot
              pins={[
                { x: 46, y: 32, label: "Checked for you", text: "$500,000 of cover where the venue requires $1,000,000." },
                { x: 44, y: 45, label: "Straight from your agent", text: "Their reply comes back to this job by itself." },
                { x: 49, y: 87, label: "You decide", text: "Send it to the venue, or ask your agent to correct it." },
              ]}
              screen="coi-flagged"
            />
          </div>
        </section>

        <section className="readiness-story mk-story" id="readiness">
          <div className="story-copy">
            <span className="section-kicker">The readiness engine</span>
            <h2>&ldquo;Booked&rdquo; isn&rsquo;t ready.</h2>
            <p>
              Cue checks the facts you define: signed agreements, reconciled payments,
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

        <section className="mk-section" aria-labelledby="compare-title" id="compare">
          <header className="mk-section-head">
            <span className="section-kicker">Hire, software, or Cue</span>
            <h2 id="compare-title">Works like an assistant. Costs like software.</h2>
            <p>
              A CRM keeps the records and leaves the work to you. An assistant does the work, once
              you&rsquo;ve trained them, during their hours. Cue does the work from day one, at any hour.
            </p>
          </header>
          <HireComparison />
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
            <span className="section-kicker">What Cue costs</span>
            <h2>Less than a day of an assistant&rsquo;s time.</h2>
            <p>
              {`${planCards[0].monthly} a month buys about ${assistantHoursFor(planCards[0].monthlyCents / 100)} of an administrative assistant at the US median wage. Cue is on every hour of the month.`}
              {" "}Every plan includes unlimited clients and projects. Annual plans include two months free.
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
            <h2>Your office manager can start today.</h2>
            <p>
              Start free. Cue has the first reply drafted before you&rsquo;ve finished your
              coffee, and you decide whether it sends.
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
