"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { KindGlyph } from "@/components/library/kind-glyph";
import { countdownPhrase } from "@/lib/format/event-date";
import { formatCents } from "@/lib/format/money";
import { AppShell } from "@/components/layout/app-shell";
import { useTodayInbox } from "@/components/today/use-today-inbox";
import { useWorkspace } from "@/features/auth/workspace-context";
import { greetingFor } from "@/features/dashboard/home-metrics";
import { greetingName } from "@/features/auth/session-failure";
import {
  todayHeadline,
  todaySummary,
  type TodayBand,
  type TodayItem,
} from "@/features/today/inbox";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runAiQueueCommand } from "@/lib/ai-actions/command-client";

const DATE_LABEL = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

/** One number in the briefing, with the sentence that gives it meaning. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className={`today-stat${tone ? ` is-${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      <small>{hint}</small>
    </div>
  );
}

const BAND_LABEL: Record<TodayBand, string> = {
  overdue: "Already late",
  soon: "This fortnight",
  later: "When you get to it",
};

/**
 * Today — the studio's inbox of moments.
 *
 * Every card answers, without being opened: what is this, whose job is it,
 * when is the event, how long has it waited, and what is the one thing to
 * do. Items are grouped by how late they are so the ranking is visible
 * rather than implied by list order.
 */
export function TodayInbox() {
  const workspace = useWorkspace();
  const { inbox, metrics, booked, handled, journeys, loading } =
    useTodayInbox();
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [showHandled, setShowHandled] = useState(false);

  const visible = (items: TodayItem[]) =>
    items.filter((item) => !cleared.has(item.id));
  const act = visible(inbox.act);
  const approve = visible(inbox.approve);
  const waiting = act.length + approve.length;
  const summary = todaySummary({
    act: act.length,
    approve: approve.length,
    inMotion: inbox.inMotion,
  });

  // The single most urgent thing that is *about a client or a job* — see
  // todayHeadline. Studio plumbing keeps its rank in the queue below.
  const lead = todayHeadline(act, approve);
  const leadHref =
    lead?.action.kind === "link"
      ? lead.action.href
      : (lead?.jobHref ?? "/studio/projects");
  const leadLabel =
    lead?.action.kind === "link" ? lead.action.label : "Open it";

  // The hero *is* the first item of the queue, shown larger. Listing it
  // again immediately beneath — same title, same button — reads as a bug.
  // The summary line still counts it, so nothing goes missing.
  const laneAct = lead ? act.filter((item) => item.id !== lead.id) : act;
  const laneApprove = lead
    ? approve.filter((item) => item.id !== lead.id)
    : approve;

  /**
   * The next wedding, in the terms a photographer counts in.
   *
   * `upcoming` is already sorted soonest-first and filtered to future
   * events by the engine.
   */
  const nextEvent = inbox.upcoming[0];
  const countdown = nextEvent
    ? {
        days: nextEvent.inDays,
        name: nextEvent.name,
        projectId: nextEvent.projectId,
        href: `/studio/projects/${nextEvent.projectId}`,
        // "414" is not a countdown anyone runs in their head. Past two
        // months the unit changes with it — "14 months", not 414 days.
        count: countdownPhrase(nextEvent.inDays).split(" ")[0],
        unit: countdownPhrase(nextEvent.inDays).split(" ")[1],
        when: new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${nextEvent.eventDate}T12:00:00Z`)),
      }
    : null;

  /**
   * Only the numbers that say something.
   *
   * A studio with two jobs and no invoices raised saw "0 · $0 · $0 · 0" —
   * four zeros as the first thing on screen every morning. A zero here is
   * not a measurement, it is the absence of one, and printing four of them
   * makes a working studio look like a failing one.
   */
  const stats = [
    metrics.eventsThisMonth > 0
      ? {
          label: "Events this month",
          value: String(metrics.eventsThisMonth),
          // Same reason as "jobs in flight": the countdown is naming it
          // already, and the name was being ellipsised to fit a quarter
          // column anyway.
          /**
           * "On the books" reads as work coming, so it must only be said of
           * events that are. On 27 August this tile read "3 events this month ·
           * on the books" with all three dates behind it.
           *
           * "All already shot" was the first correction and it claimed too
           * much: two of those three were still marked planning and ready for
           * the day, and Today was asking "did this go ahead?" about both of
           * them further down the same page. What the metric knows is that the
           * dates have passed. Whether they were shot is the open question.
           */
          hint:
            metrics.eventsThisMonthRemaining === 0
              ? "all dates passed"
              : metrics.eventsThisMonthRemaining < metrics.eventsThisMonth
                ? `${metrics.eventsThisMonthRemaining} still ahead`
                : countdown
                  ? "on the books"
                  : metrics.nextEvent
                    ? `next: ${metrics.nextEvent.name}`
                    : "on the books",
        }
      : null,
    booked > 0
      ? {
          label: "Booked",
          value: formatCents(booked),
          hint: "signed and in flight",
        }
      : null,
    metrics.outstandingCents > 0
      ? {
          label: "Outstanding",
          value: formatCents(metrics.outstandingCents),
          hint: metrics.overdueInvoiceCount
            ? `${metrics.overdueInvoiceCount} overdue`
            : "all on schedule",
          tone: metrics.overdueInvoiceCount
            ? ("warn" as const)
            : undefined,
        }
      : null,
    handled > 0
      ? {
          label: "Handled for you",
          value: String(handled),
          hint: "in the last 7 days",
          tone: "good" as const,
        }
      : null,
  ].filter((stat): stat is NonNullable<typeof stat> => stat !== null);

  /**
   * A studio that has not invoiced anything yet still has a business.
   *
   * Suppressing the zeros is only half the fix — it leaves the rail empty on
   * exactly the studios that most need to feel something is happening. So
   * when there is little money to report, the rail measures activity
   * instead: jobs in flight, work prepared, what is waiting.
   */
  if (stats.length < 4) {
    const activity = [
      journeys.length
        ? {
            label: journeys.length === 1 ? "Job in flight" : "Jobs in flight",
            value: String(journeys.length),
            // The countdown already names the next one, a few inches to
            // the right. Saying it a third time is not emphasis.
            hint: countdown ? "in your studio" : "on the books",
          }
        : null,
      approve.length
        ? {
            label: "Prepared for you",
            value: String(approve.length),
            hint: "one tap each",
            tone: "good" as const,
          }
        : null,
      act.length
        ? {
            label: "Needs you",
            value: String(act.length),
            hint: "only you can do these",
          }
        : null,
      inbox.inMotion
        ? {
            label: "In motion",
            value: String(inbox.inMotion),
            hint: "waiting on someone else",
          }
        : null,
    ].filter((stat): stat is NonNullable<typeof stat> => stat !== null);
    for (const stat of activity) {
      if (stats.length >= 4) break;
      if (stats.some((existing) => existing.label === stat.label)) continue;
      stats.push(stat);
    }
  }

  // A revoked session left `loading` true forever, so the hero sat on
  // "Catching up… / Reading your studio…" and the screen read as slow rather
  // than signed out. A failure is not a loading state.
  const failed = Boolean(workspace.error);
  const headline = failed
    ? workspace.failureKind === "session_ended"
      ? "You have been signed out."
      : "We could not reach your studio."
    : loading
      ? "Catching up…"
      : waiting === 0
        ? "You're all clear."
        : (lead?.title ?? "Here's where things stand.");

  const bands: TodayBand[] = ["overdue", "soon", "later"];
  const actBands = bands.filter((band) =>
    laneAct.some((item) => item.band === band),
  );
  const clear = (id: string) =>
    setCleared((current) => new Set(current).add(id));

  return (
    <AppShell active="Today">
      <div className="today-shell">
        <div className="today-main">
          <header className="today-hero">
            <div className="today-hero-glow" aria-hidden="true" />
            <div className="today-hero-copy">
              <p className="today-hero-eyebrow">
                {/* `firstName` on the fallback display name produced "Good
                    morning, Signed-in." A greeting with no name is fine; one
                    addressed to a placeholder is not. */}
                {greetingFor(new Date())}
                {greetingName(workspace.userName, workspace.tenantName)
                  ? `, ${greetingName(workspace.userName, workspace.tenantName)}`
                  : ""}
                <span>{DATE_LABEL.format(new Date())}</span>
              </p>
              {/* "20 things need you" counts what has not been done. The
                  same data supports a truer opening: the one thing that
                  matters most right now, named. The total moves to the line
                  beneath, where it is information rather than a verdict. */}
              <h1 className={headline.length > 38 ? "is-long" : undefined}>
                {headline}
              </h1>
              {/* What the headline is *about*. This used to be the queue
                  breakdown — "4 only you can do." — which the "Needs you"
                  stat directly below already says, and which told a reader
                  looking at a named piece of work nothing about it. */}
              <p className="today-hero-sub">
                {failed
                  ? workspace.error
                  : loading
                    ? "Reading your studio…"
                    : waiting === 0
                      ? summary
                      : [lead?.detail, lead?.facts[0]]
                          .filter(Boolean)
                          .join(" · ") || summary}
              </p>
              {!loading && lead ? (
                <Link className="today-hero-go" href={leadHref}>
                  {leadLabel} <ArrowRight size={15} />
                </Link>
              ) : null}
            </div>
            {/* The next wedding, counted down.
                This is the one thing on the page a photographer feels
                something about, and it used to be a small grey line in the
                rail. It also fills the empty right half of the hero. */}
            {!loading && countdown ? (
              <Link
                aria-label={`Next event: ${countdown.name}`}
                className="today-countdown"
                href={countdown.href}
              >
                <span className="today-countdown-number">
                  {countdown.days === 0 ? "Today" : countdown.count}
                </span>
                {countdown.days > 0 ? (
                  <span className="today-countdown-unit">
                    {countdown.unit} to
                  </span>
                ) : null}
                <strong>{countdown.name}</strong>
                <small>{countdown.when}</small>
              </Link>
            ) : null}
            {!loading && stats.length ? (
              <dl
                className="today-hero-stats"
                style={
                  {
                    "--today-stat-count": stats.length,
                  } as CSSProperties
                }
              >
                {stats.map((stat) => (
                  <Stat key={stat.label} {...stat} />
                ))}
              </dl>
            ) : null}
          </header>

          {!loading && waiting === 0 ? (
            <section className="today-clear">
              <span className="today-clear-icon">
                <Check size={20} />
              </span>
              <div>
                <strong>Nothing is waiting on you.</strong>
                <small>
                  {inbox.inMotion > 0
                    ? "Everything in flight is with a client, a provider, or not due yet. StudioCue will bring it back when it needs a decision."
                    : "When an inquiry arrives or a job needs a decision, it appears here."}
                </small>
              </div>
              <Link className="button button-light" href="/studio/projects">
                See all jobs <ArrowRight size={15} />
              </Link>
            </section>
          ) : null}

          {laneApprove.length ? (
            <section className="today-lane" aria-label="Ready for your approval">
              <div className="today-lane-heading">
                <h2>Prepared for you</h2>
                <span>{laneApprove.length} · one tap each</span>
              </div>
              {laneApprove.map((item) => (
                <TodayCard
                  item={item}
                  key={item.id}
                  onCleared={() => clear(item.id)}
                  tone="approve"
                />
              ))}
            </section>
          ) : null}

          {laneAct.length ? (
            <section className="today-lane" aria-label="Needs you">
              <div className="today-lane-heading">
                {/* Two headings and the same count twice — "Then these · 2"
                    directly above "WHEN YOU GET TO IT · 2" — is a band
                    system announcing itself on a list too short to need
                    one. With a single band, the band *is* the heading. */}
                <h2>
                  {actBands.length === 1
                    ? BAND_LABEL[actBands[0]]
                    : lead?.lane === "act"
                      ? "Then these"
                      : "Only you can do this"}
                </h2>
                <span>{laneAct.length}</span>
              </div>
              {actBands.map((band) => {
                const items = laneAct.filter((item) => item.band === band);
                return (
                  <div className="today-band" id={`band-${band}`} key={band}>
                    {actBands.length > 1 ? (
                    <p className={`today-band-label is-${band}`}>
                      {BAND_LABEL[band]}
                      <em>{items.length}</em>
                    </p>
                    ) : null}
                    {/* The same reassurance under seven consecutive cards
                        stops being reassurance. Say it once per band. */}
                    {items.map((item, index) => (
                      <TodayCard
                        item={item}
                        key={item.id}
                        showEvidence={index === 0}
                        tone="act"
                      />
                    ))}
                  </div>
                );
              })}
            </section>
          ) : null}

          {inbox.fyi.length ? (
            <section className="today-handled" aria-label="Handled for you">
              <button
                aria-expanded={showHandled}
                onClick={() => setShowHandled((value) => !value)}
                type="button"
              >
                <ShieldCheck size={15} />
                {inbox.fyi.length} handled for you
                <em>{showHandled ? "Hide" : "Show"}</em>
              </button>
              {showHandled ? (
                <div className="today-handled-list">
                  {inbox.fyi.map((item) => (
                    <TodayCard item={item} key={item.id} tone="fyi" />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <TodayRail
          bands={bands.map((band) => ({
            band,
            count: laneAct.filter((item) => item.band === band).length,
          }))}
          headlinedProjectId={countdown?.projectId ?? null}
          inMotion={inbox.inMotion}
          loading={loading}
          upcoming={inbox.upcoming}
        />
      </div>
    </AppShell>
  );
}

/** What is in flight and what is coming — context, not work. */
function TodayRail({
  headlinedProjectId,
  inMotion,
  upcoming,
  loading,
  bands,
}: {
  inMotion: number;
  upcoming: Array<{ projectId: string; name: string; eventDate: string; inDays: number }>;
  loading: boolean;
  bands: Array<{ band: TodayBand; count: number }>;
  /** Already counted down in the hero; showing it again reads as a bug. */
  headlinedProjectId: string | null;
}) {
  if (loading) return <aside className="today-rail" />;
  const rest = upcoming.filter(
    (event) => event.projectId !== headlinedProjectId,
  );
  const shaped = bands.filter((entry) => entry.count > 0);
  return (
    <aside className="today-rail" aria-label="Coming up">
      {/* The queue runs to three and a half screens on a laptop, and the
          rail used to stop after one — 85% of the column was empty while
          the reader scrolled past it. It is sticky now, and it carries the
          shape of what they are scrolling through. */}
      {shaped.length > 1 ? (
        <section className="today-rail-card">
          <p className="eyebrow">In this queue</p>
          <ul className="today-rail-jump">
            {shaped.map((entry) => (
              <li key={entry.band}>
                <a href={`#band-${entry.band}`}>
                  <span className={`today-rail-dot is-${entry.band}`} />
                  {BAND_LABEL[entry.band]}
                  <em>{entry.count}</em>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rest.length || !headlinedProjectId ? (
      <section className="today-rail-card">
        <p className="eyebrow">{headlinedProjectId ? "After that" : "Coming up"}</p>
        {rest.length === 0 ? (
          <p className="today-rail-empty">No events on the books yet.</p>
        ) : (
          <ul className="today-upcoming">
            {rest.map((event) => (
              <li key={event.projectId}>
                <Link href={`/studio/projects/${event.projectId}`}>
                  <strong>{event.name}</strong>
                  <small>
                    <CalendarDays size={11} />
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(`${event.eventDate}T12:00:00Z`))}
                    {" · "}
                    {event.inDays === 0
                      ? "today"
                      : event.inDays === 1
                        ? "tomorrow"
                        : `in ${countdownPhrase(event.inDays)}`}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}
      {inMotion > 0 ? (
      <section className="today-rail-card is-quiet">
        <p className="eyebrow">In motion</p>
        <p className="today-rail-count">{inMotion}</p>
        <small>
          {inMotion === 1 ? "job is" : "jobs are"} waiting on a client, a
          provider, or a date — nothing for you to do.
        </small>
        <Link href="/studio/projects">
          All jobs <ArrowRight size={13} />
        </Link>
      </section>
      ) : null}
    </aside>
  );
}

function TodayCard({
  item,
  tone,
  onCleared,
  showEvidence = true,
}: {
  item: TodayItem;
  tone: "act" | "approve" | "fyi";
  onCleared?: () => void;
  /** False on all but the first card of a band — see the call site. */
  showEvidence?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function approveInPlace() {
    if (item.action.kind !== "approve") return;
    setBusy(true);
    setNotice(null);
    try {
      await runAiQueueCommand({
        type: "decideAiAction",
        input: { actionId: item.action.actionId, decision: "approved" },
      });
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "That couldn't be approved. Open it to review."),
      );
      setBusy(false);
    }
  }

  const preview = item.action.kind === "approve" ? item.action.preview : null;

  return (
    <article
      className={`today-card is-${tone} band-${item.band}${item.kind ? " has-glyph" : ""}`}
    >
      {/* The queue is the other genuinely mixed list in the product: an
          invoice, a crew gap and a drafted email, one after another, all
          rendered alike. The glyph says which before the title is read.
          Items with no record behind them — studio setup, a broken
          connector — stay plain rather than borrowing a colour. */}
      {item.kind ? <KindGlyph kind={item.kind} size={30} /> : null}
      <div className="today-card-body">
        <div className="today-card-title">
          <strong>{item.title}</strong>
          {item.projectName && !item.title.includes(item.projectName) ? (
            <em>{item.projectName}</em>
          ) : null}
        </div>
        {/* The project name is already the chip beside the title; repeating
            it as the detail line is noise. */}
        {item.detail && item.detail !== item.projectName ? (
          <p>{item.detail}</p>
        ) : null}
        {item.facts.length ? (
          <ul className="today-card-facts">
            {item.facts.map((fact) => (
              <li key={fact}>
                {/^waiting/.test(fact) ? <Clock3 size={10} /> : null}
                {fact}
              </li>
            ))}
          </ul>
        ) : null}
        {preview && open ? (
          <div className="today-card-preview">
            {preview.subject ? <strong>{preview.subject}</strong> : null}
            <p>{preview.body}</p>
          </div>
        ) : null}
        {item.evidence && showEvidence ? (
          <span className="today-card-evidence">
            {tone === "approve" ? (
              <Sparkles size={11} />
            ) : tone === "fyi" ? (
              <ShieldCheck size={11} />
            ) : (
              <CircleAlert size={11} />
            )}
            {item.evidence}
          </span>
        ) : null}
        {notice ? (
          <span className="today-card-notice" role="status">
            {notice}
          </span>
        ) : null}
      </div>

      <div className="today-card-actions">
        {item.action.kind === "approve" ? (
          <>
            <button
              className="today-card-primary"
              disabled={busy}
              onClick={() => void approveInPlace()}
              type="button"
            >
              {busy ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Check size={14} />
              )}
              {busy ? "Approving…" : item.action.label}
            </button>
            {preview ? (
              <button
                aria-expanded={open}
                className="today-card-secondary"
                onClick={() => setOpen((value) => !value)}
                type="button"
              >
                {open ? "Hide" : "Read it"}
                <ChevronDown
                  size={12}
                  style={open ? { transform: "rotate(180deg)" } : undefined}
                />
              </button>
            ) : (
              <Link className="today-card-secondary" href={item.action.href}>
                Review first
              </Link>
            )}
          </>
        ) : item.action.kind === "link" ? (
          <>
            <Link className="today-card-primary" href={item.action.href}>
              {item.action.label} <ArrowRight size={14} />
            </Link>
            {item.jobHref && item.jobHref !== item.action.href ? (
              <Link className="today-card-secondary" href={item.jobHref}>
                Open the job
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <span className="today-card-done">{item.action.label}</span>
            {item.jobHref ? (
              <Link className="today-card-secondary" href={item.jobHref}>
                Open the job
              </Link>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
