import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { JOURNEY_PAGE } from "@/features/journey/expected-timeline";

/** The site's top bar, shared by the homepage and every marketing page. */
export function MarketingNav() {
  return (
    <header className="marketing-nav">
      <Link href="/" aria-label="StudioCue home"><Logo /></Link>
      <nav aria-label="Main navigation">
        <Link href="/features">Features</Link>
        <Link href="/for-crew">For crew</Link>
        <Link href="/for-clients">For clients</Link>
        <Link href="/wedding-photographers">For weddings</Link>
        <Link href="/integrations">Integrations</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/how-to">How to</Link>
      </nav>
      <div className="marketing-actions">
        <Link className="text-link" href="/auth/login">Sign in</Link>
        <Link className="button button-dark button-sm" href="/auth/register">Start free trial</Link>
      </div>
    </header>
  );
}

/**
 * The tagline and the links sit in their own columns. They used to be two
 * cells of a three-column grid whose middle column was sized to the tagline,
 * so on a desktop the links wrapped up against it and read as one run of
 * text ("…photography teams.Corporate").
 */
export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-footer-brand">
        <Logo />
        <p>Calm operations for remarkable photography teams.</p>
      </div>
      <nav aria-label="Footer" className="marketing-footer-links">
        <Link href={JOURNEY_PAGE}>A wedding, start to finish</Link>
        <Link href="/for-crew">For crew</Link>
        <Link href="/for-clients">For clients</Link>
        <Link href="/wedding-photographers">Weddings</Link>
        <Link href="/corporate-photographers">Corporate</Link>
        <Link href="/sports-photographers">Sports</Link>
        <Link href="/how-to">How to use StudioCue</Link>
        <Link href="/about">About</Link>
        <Link href="/support">Support</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <span>© 2026 StudioCue</span>
      </nav>
    </footer>
  );
}

export function MarketingLayout({
  eyebrow,
  title,
  description,
  children,
  hero = "trial",
  pricingLink = true,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  /** "plain" drops the trial and pricing buttons, for reading pages like a guide. */
  hero?: "trial" | "plain";
  /** False on /pricing itself, which offered a "View pricing" button to the page it was on. */
  pricingLink?: boolean;
}) {
  return (
    <div className="ds-root marketing-page marketing-subpage" data-ds-theme="emerald">
      <MarketingNav />
      <main>
        <section className="marketing-subhero">
          <p className="section-kicker">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          {hero === "trial" ? (
            <div>
              <Link className="button button-dark" href="/auth/register">
                Start a 14-day trial <ArrowRight />
              </Link>
              {pricingLink ? <Link className="button button-light" href="/pricing">View pricing</Link> : null}
            </div>
          ) : null}
        </section>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}

type Capability = {
  title: string;
  text: string;
  points: string[];
  badge?: string;
  /**
   * One still for this card (docs/marketing-visuals-plan-2026-10-03.md §2):
   * the card then spans the row, its copy beside the picture ("side") or
   * above it ("below", for a wide screen). Give a few cards one, never two
   * in a row.
   */
  visual?: { node: ReactNode; layout: "side" | "below"; flip?: boolean };
  /** A card that spans the row with no picture: its points sit beside the copy. */
  wide?: boolean;
};

export function CapabilityGrid({
  items,
}: {
  /**
   * `badge` marks a capability that is built but not yet connectable. The
   * integrations page listed three of those as though a studio could use
   * them today, which is a promise the product cannot keep at signup.
   */
  items: Capability[];
}) {
  return (
    <section className="marketing-capability-grid">
      {items.map((item) => {
        const heading = (
          <h2>
            {item.title}
            {item.badge ? <span className="capability-badge">{item.badge}</span> : null}
          </h2>
        );
        const points = (
          <ul>
            {item.points.map((point) => (
              <li key={point}><CircleCheck /> {point}</li>
            ))}
          </ul>
        );
        if (item.visual?.layout === "side")
          return (
            <article
              className="capability-feature"
              data-flip={item.visual.flip ? "true" : undefined}
              data-pending={item.badge ? "true" : undefined}
              key={item.title}
            >
              <div className="capability-copy">
                {heading}
                <p>{item.text}</p>
                {points}
              </div>
              <div className="capability-visual">{item.visual.node}</div>
            </article>
          );
        if (item.visual || item.wide)
          return (
            <article className="capability-wide" data-pending={item.badge ? "true" : undefined} key={item.title}>
              <div className="capability-copy">
                {heading}
                <p>{item.text}</p>
              </div>
              {points}
              {item.visual ? <div className="capability-visual">{item.visual.node}</div> : null}
            </article>
          );
        return (
          <article key={item.title} data-pending={item.badge ? "true" : undefined}>
            {heading}
            <p>{item.text}</p>
            {points}
          </article>
        );
      })}
    </section>
  );
}
