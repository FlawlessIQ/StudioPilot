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

export function CapabilityGrid({
  items,
}: {
  /**
   * `badge` marks a capability that is built but not yet connectable. The
   * integrations page listed three of those as though a studio could use
   * them today, which is a promise the product cannot keep at signup.
   */
  items: Array<{ title: string; text: string; points: string[]; badge?: string }>;
}) {
  return (
    <section className="marketing-capability-grid">
      {items.map((item) => (
        <article key={item.title} data-pending={item.badge ? "true" : undefined}>
          <h2>
            {item.title}
            {item.badge ? <span className="capability-badge">{item.badge}</span> : null}
          </h2>
          <p>{item.text}</p>
          <ul>
            {item.points.map((point) => (
              <li key={point}><CircleCheck /> {point}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
