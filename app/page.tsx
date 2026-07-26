import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  CircleCheck,
  FileCheck2,
  Gauge,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ReadinessMeter } from "@/components/ui/readiness-meter";
import { StatusBadge } from "@/components/ui/status-badge";

const readinessItems = [
  { label: "Contract signed", detail: "Completed Jul 02", complete: true },
  { label: "Retainer paid", detail: "QuickBooks · Paid", complete: true },
  { label: "Final schedule", detail: "Waiting on client", complete: false },
  { label: "Crew confirmed", detail: "3 of 3 accepted", complete: true },
];

const productPoints = [
  {
    icon: Gauge,
    eyebrow: "Know what’s ready",
    title: "One clear readiness score",
    text: "Every contract, payment, document, assignment, and approval rolls into a deterministic project view.",
  },
  {
    icon: CalendarCheck2,
    eyebrow: "Run the day",
    title: "Schedules everyone follows",
    text: "Build, approve, publish, and acknowledge a precise run of show across clients, venues, and crew.",
  },
  {
    icon: Sparkles,
    eyebrow: "Operate with AI",
    title: "Useful help, firm guardrails",
    text: "Draft messages and schedules, surface missing information, and explain risks without inventing business facts.",
  },
];

export default function MarketingHome() {
  return (
    <div className="marketing-page">
      <header className="marketing-nav">
        <Link href="/" aria-label="StudioHub home">
          <Logo />
        </Link>
        <nav aria-label="Main navigation">
          <Link href="#platform">Platform</Link>
          <Link href="#readiness">Readiness</Link>
          <Link href="#integrations">Integrations</Link>
          <Link href="#pricing">Pricing</Link>
        </nav>
        <div className="marketing-actions">
          <Link className="text-link" href="/auth/login">
            Sign in
          </Link>
          <Link className="button button-dark button-sm" href="/auth/login?mode=trial">
            Start free trial
          </Link>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-copy">
            <StatusBadge tone="info" dot>
              Built for professional photography teams
            </StatusBadge>
            <h1>
              Every project,
              <br />
              genuinely ready.
            </h1>
            <p>
              StudioHub brings your clients, contracts, payments, schedules, crew, and
              documents into one calm operations system—so event day never runs on
              crossed fingers.
            </p>
            <div className="hero-actions">
              <Link className="button button-dark" href="/auth/login?mode=trial">
                Start your free trial <ArrowRight size={17} />
              </Link>
              <Link className="button button-light" href="/studio">
                Explore the live product
              </Link>
            </div>
            <div className="hero-proof">
              <span>
                <Check size={15} /> 14-day trial
              </span>
              <span>
                <Check size={15} /> No card required
              </span>
              <span>
                <Check size={15} /> Guided setup
              </span>
            </div>
          </div>

          <div className="hero-product" aria-label="StudioHub project readiness preview">
            <div className="window-bar">
              <span className="window-mark">
                <Logo compact />
              </span>
              <span className="window-title">Johnson Wedding</span>
              <span className="window-status">Planning</span>
            </div>
            <div className="product-body">
              <div className="project-mini-header">
                <div>
                  <small>Saturday, August 15 · Brooklyn, NY</small>
                  <h2>Maya &amp; Theo</h2>
                  <p>The Foundry · Wedding photography</p>
                </div>
                <ReadinessMeter value={72} size="lg" />
              </div>

              <div className="next-action-preview">
                <div className="next-icon">
                  <MessageSquareText size={20} />
                </div>
                <div>
                  <small>Recommended next action</small>
                  <strong>Follow up on final schedule approval</strong>
                  <span>Owned by Maya &amp; Theo · Due tomorrow</span>
                </div>
                <Link href="/client#schedule" aria-label="Open schedule review">
                  Review <ArrowRight size={14} />
                </Link>
              </div>

              <div className="readiness-preview">
                <div className="section-heading">
                  <div>
                    <h3>Event readiness</h3>
                    <p>3 of 4 critical requirements complete</p>
                  </div>
                  <StatusBadge tone="warning">1 blocker</StatusBadge>
                </div>
                <div className="readiness-checks">
                  {readinessItems.map((item) => (
                    <div className="readiness-row" key={item.label}>
                      <span className={item.complete ? "check-complete" : "check-waiting"}>
                        {item.complete ? <CircleCheck size={17} /> : <span />}
                      </span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Workflow capabilities">
          <span>LEAD TO CLOSEOUT</span>
          <span>DETERMINISTIC READINESS</span>
          <span>PERMISSION-AWARE AI</span>
          <span>AUDITED AUTOMATION</span>
        </section>

        <section className="platform-section" id="platform">
          <div className="section-kicker">A photography operations OS</div>
          <div className="section-intro">
            <h2>Less chasing. More certainty.</h2>
            <p>
              Replace the scattered tabs, spreadsheets, and status messages with one
              source of operational truth.
            </p>
          </div>
          <div className="feature-grid">
            {productPoints.map((point) => {
              const Icon = point.icon;
              return (
                <article className="feature-card" key={point.title}>
                  <div className="feature-icon">
                    <Icon size={22} />
                  </div>
                  <small>{point.eyebrow}</small>
                  <h3>{point.title}</h3>
                  <p>{point.text}</p>
                  <Link href="/studio">
                    See it in StudioHub <ArrowRight size={15} />
                  </Link>
                </article>
              );
            })}
          </div>
        </section>

        <section className="readiness-story" id="readiness">
          <div className="story-copy">
            <span className="section-kicker">The readiness engine</span>
            <h2>“Booked” is not the same as ready.</h2>
            <p>
              StudioHub checks the facts your team defines: signed agreements,
              reconciled payments, approved schedules, accepted crew, confirmed
              locations, insurance, and every blocking checkpoint.
            </p>
            <ul>
              <li>
                <ShieldCheck size={18} /> Deterministic rules—never an AI guess
              </li>
              <li>
                <Users size={18} /> A clear owner for every blocker
              </li>
              <li>
                <FileCheck2 size={18} /> Evidence and audit history built in
              </li>
            </ul>
            <Link className="button button-dark" href="/studio">
              Open the readiness dashboard <ArrowRight size={17} />
            </Link>
          </div>
          <div className="story-visual">
            <div className="readiness-orbit">
              <ReadinessMeter value={88} size="lg" label="project readiness" />
              <div>
                <strong>Nearly ready</strong>
                <span>2 blockers across 14 requirements</span>
              </div>
            </div>
            <div className="signal-row">
              <span>Contract</span>
              <strong className="signal-good">Complete</strong>
            </div>
            <div className="signal-row">
              <span>COI delivery</span>
              <strong className="signal-warn">Needs attention</strong>
            </div>
            <div className="signal-row">
              <span>Crew acknowledgement</span>
              <strong className="signal-warn">2 pending</strong>
            </div>
            <div className="signal-row">
              <span>Final balance</span>
              <strong className="signal-good">Synced · Paid</strong>
            </div>
          </div>
        </section>

        <section className="integration-band" id="integrations">
          <p>Works with the tools your studio already trusts</p>
          <div>
            {["QuickBooks", "Docusign", "Google Calendar", "Dropbox", "Zoom", "Stripe"].map(
              (name) => (
                <span key={name}>{name}</span>
              ),
            )}
          </div>
        </section>

        <section className="pricing-preview" id="pricing">
          <div>
            <span className="section-kicker">Simple, serious software</span>
            <h2>Start at $59/month.</h2>
            <p>Unlimited clients and projects, with the operational foundation included.</p>
          </div>
          <Link className="button button-light-on-dark" href="/auth/login?mode=trial">
            Compare plans <ArrowRight size={17} />
          </Link>
        </section>
      </main>

      <footer className="marketing-footer">
        <Logo />
        <p>Calm operations for remarkable photography teams.</p>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© 2026 StudioHub</span>
        </div>
      </footer>
    </div>
  );
}
