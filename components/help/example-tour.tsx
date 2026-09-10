import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Circle,
  CircleDot,
  FlaskConical,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

/**
 * An annotated sample job — the lifecycle shown, not described. Everything here
 * is illustrative sample data (no Firestore, no writes, nothing saved to the
 * studio); it exists so a new owner can see what a real job looks like and what
 * each piece means before they have one of their own. Reuses the design-system
 * tokens so it reads like the real product.
 */

const PHASES = [
  { key: "inquiry", label: "Inquiry", state: "done" as const },
  { key: "booking", label: "Booking", state: "done" as const },
  { key: "planning", label: "Planning", state: "current" as const },
  { key: "event", label: "Event", state: "future" as const },
  { key: "delivery", label: "Delivery", state: "future" as const },
];

const CHECKPOINTS = [
  { label: "Contract signed", done: true, note: "Signed Jun 2" },
  { label: "Retainer paid", done: true, note: "$1,200 · Jun 2" },
  { label: "Second photographer accepted", done: true, note: "Jordan Reyes" },
  { label: "Questionnaire complete", done: false, note: "Waiting on the couple" },
  { label: "Shot list approved", done: false, note: "Not started" },
  { label: "Final balance paid", done: false, note: "Due Jun 6" },
];

export function ExampleTour() {
  const cleared = CHECKPOINTS.filter((c) => c.done).length;

  return (
    <div className="post-event-page example-tour">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Help &amp; guides · Example</p>
          <h1>A job, end to end</h1>
          <p>
            This is a sample wedding — made up, not saved to your studio — so you
            can see what a real job looks like and what each part means. The
            numbered notes explain what you&rsquo;re looking at.
          </p>
        </div>
        <Link className="button button-light" href="/studio/help">
          <ArrowLeft aria-hidden="true" /> Back to help
        </Link>
      </header>

      <p className="example-banner">
        <FlaskConical aria-hidden="true" size={15} />
        Sample data — nothing here is real, and none of these buttons send
        anything.
      </p>

      {/* 1 — the job + phase track */}
      <section className="example-step">
        <div className="example-note">
          <span className="example-note-num">1</span>
          <p>
            A <strong>job</strong>{" "}is one client&rsquo;s whole story. This
            one is booked and now in <strong>Planning</strong>{" "}— the track
            shows every phase it moves through, in order.
          </p>
        </div>
        <article className="panel example-job">
          <div className="example-job-head">
            <div>
              <strong>Alex &amp; Sam · Riverside Wedding</strong>
              <small>Sat, Jun 20 · Cedar Lakes Estate</small>
            </div>
            <span className="example-badge is-booked">Booked</span>
          </div>
          <ol className="example-phases" aria-label="Lifecycle">
            {PHASES.map((phase) => (
              <li key={phase.key} className={`is-${phase.state}`}>
                <span className="example-phase-mark">
                  {phase.state === "done" ? (
                    <Check aria-hidden="true" size={13} />
                  ) : phase.state === "current" ? (
                    <CircleDot aria-hidden="true" size={13} />
                  ) : (
                    <Circle aria-hidden="true" size={13} />
                  )}
                </span>
                <small>{phase.label}</small>
              </li>
            ))}
          </ol>
        </article>
      </section>

      {/* 2 — readiness */}
      <section className="example-step">
        <div className="example-note">
          <span className="example-note-num">2</span>
          <p>
            <strong>Readiness</strong>{" "}is what has to be true before the
            day. StudioCue tracks it for you — the cleared items are done; the
            rest are what&rsquo;s left, and what it&rsquo;ll prepare next.
          </p>
        </div>
        <article className="panel example-readiness">
          <div className="example-readiness-head">
            <span className="example-gauge">
              <strong>{cleared}</strong>
              <small>of {CHECKPOINTS.length} clear</small>
            </span>
            <span className="example-readiness-title">
              Before the day
              <small>Booked · {CHECKPOINTS.length - cleared} still open</small>
            </span>
          </div>
          <ul className="example-checks">
            {CHECKPOINTS.map((c) => (
              <li key={c.label} className={c.done ? "is-done" : ""}>
                <span className="example-check-mark">
                  {c.done ? (
                    <Check aria-hidden="true" size={14} />
                  ) : (
                    <Circle aria-hidden="true" size={14} />
                  )}
                </span>
                <span className="example-check-label">{c.label}</span>
                <span className="example-check-note">{c.note}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      {/* 3 — AI prepares, you approve */}
      <section className="example-step">
        <div className="example-note">
          <span className="example-note-num">3</span>
          <p>
            <strong>Cue prepares; you approve.</strong>{" "}It drafts the next
            step — here, the reminder for the couple&rsquo;s questionnaire — and
            waits. Nothing is sent and no status changes until you tap approve.
          </p>
        </div>
        <article className="panel example-prepared">
          <div className="example-prepared-head">
            <span className="example-prepared-icon">
              <Sparkles aria-hidden="true" size={15} />
            </span>
            <span>
              <small>Prepared for you</small>
              <strong>Nudge the couple to finish their questionnaire</strong>
            </span>
          </div>
          <div className="example-email">
            <p className="example-email-line">
              <Mail aria-hidden="true" size={13} /> To: alex&amp;sam@example.com ·
              Subject: One quick thing before your day
            </p>
            <p>
              Hi Alex and Sam — we&rsquo;re getting everything ready for June
              20th. When you have a moment, could you finish your planning
              questionnaire? It&rsquo;s how we lock in timings, family photos,
              and the shots that matter most to you.
            </p>
          </div>
          <div className="example-prepared-actions">
            <span className="ds-btn ds-btn-primary" aria-disabled="true">
              Approve &amp; send
            </span>
            <span className="ds-btn" aria-disabled="true">
              Edit first
            </span>
            <em>Sample — these don&rsquo;t send anything</em>
          </div>
        </article>
      </section>

      <aside className="panel example-close">
        <ShieldCheck aria-hidden="true" />
        <span>
          <h2>That&rsquo;s the whole rhythm</h2>
          <p>
            Today shows you what needs a decision, each job carries its own next
            move, and Cue does the legwork for you to approve. When you&rsquo;re
            ready, ask Cue <Link href="/studio/copilot">how to do anything</Link>{" "}
            or start from your <Link href="/studio/help">getting-started
            steps</Link>.
          </p>
        </span>
      </aside>
    </div>
  );
}
