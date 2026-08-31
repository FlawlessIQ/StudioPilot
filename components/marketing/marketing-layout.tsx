import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export function MarketingLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ds-root marketing-page marketing-subpage" data-ds-theme="emerald">
      <header className="marketing-nav">
        <Link href="/" aria-label="StudioCue home"><Logo /></Link>
        <nav aria-label="Main navigation">
          <Link href="/features">Features</Link>
          <Link href="/integrations">Integrations</Link>
          <Link href="/studio-preview">Product tour</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/wedding-photographers">Industries</Link>
        </nav>
        <div className="marketing-actions">
          <Link className="text-link" href="/auth/login">Sign in</Link>
          <Link className="button button-dark button-sm" href="/auth/register">Start free trial</Link>
        </div>
      </header>
      <main>
        <section className="marketing-subhero">
          <p className="section-kicker">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div>
            <Link className="button button-dark" href="/auth/register">
              Start a 14-day trial <ArrowRight />
            </Link>
            <Link className="button button-light" href="/pricing">View pricing</Link>
          </div>
        </section>
        {children}
      </main>
      <footer className="marketing-footer">
        <Logo />
        <p>Calm operations for remarkable photography teams.</p>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© 2026 StudioCue</span>
        </div>
      </footer>
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
