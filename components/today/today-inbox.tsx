"use client";

import { useState } from "react";
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
import { formatCents } from "@/lib/format/money";
import { AppShell } from "@/components/layout/app-shell";
import { useTodayInbox } from "@/components/today/use-today-inbox";
import { useWorkspace } from "@/features/auth/workspace-context";
import { greetingFor } from "@/features/dashboard/home-metrics";
import {
  todaySummary,
  type TodayBand,
  type TodayItem,
} from "@/features/today/inbox";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runAiQueueCommand } from "@/lib/ai-actions/command-client";

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

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
  const { inbox, metrics, booked, handled, loading } = useTodayInbox();
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

  const bands: TodayBand[] = ["overdue", "soon", "later"];
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
                {greetingFor(new Date())}, {firstName(workspace.userName ?? "there")}
                <span>{DATE_LABEL.format(new Date())}</span>
              </p>
              <h1>
                {loading
                  ? "Catching up…"
                  : waiting === 0
                    ? "You're all clear."
                    : `${waiting} ${waiting === 1 ? "thing needs" : "things need"} you.`}
              </h1>
              <p className="today-hero-sub">
                {loading ? "Reading your studio…" : summary}
              </p>
            </div>
            {!loading ? (
              <dl className="today-hero-stats">
                <Stat
                  hint={
                    metrics.nextEvent
                      ? `next: ${metrics.nextEvent.name}`
                      : "nothing on the books"
                  }
                  label="Events this month"
                  value={String(metrics.eventsThisMonth)}
                />
                <Stat
                  hint="signed and in flight"
                  label="Booked"
                  value={formatCents(booked)}
                />
                <Stat
                  hint={
                    metrics.overdueInvoiceCount
                      ? `${metrics.overdueInvoiceCount} overdue`
                      : "all on schedule"
                  }
                  label="Outstanding"
                  tone={metrics.overdueInvoiceCount ? "warn" : undefined}
                  value={formatCents(metrics.outstandingCents)}
                />
                <Stat
                  hint="in the last 7 days"
                  label="Handled for you"
                  tone="good"
                  value={String(handled)}
                />
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

          {approve.length ? (
            <section className="today-lane" aria-label="Ready for your approval">
              <div className="today-lane-heading">
                <h2>Prepared for you</h2>
                <span>{approve.length} · one tap each</span>
              </div>
              {approve.map((item) => (
                <TodayCard
                  item={item}
                  key={item.id}
                  onCleared={() => clear(item.id)}
                  tone="approve"
                />
              ))}
            </section>
          ) : null}

          {act.length ? (
            <section className="today-lane" aria-label="Needs you">
              <div className="today-lane-heading">
                <h2>Only you can do this</h2>
                <span>{act.length}</span>
              </div>
              {bands.map((band) => {
                const items = act.filter((item) => item.band === band);
                if (!items.length) return null;
                return (
                  <div className="today-band" key={band}>
                    <p className={`today-band-label is-${band}`}>
                      {BAND_LABEL[band]}
                      <em>{items.length}</em>
                    </p>
                    {items.map((item) => (
                      <TodayCard item={item} key={item.id} tone="act" />
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
  inMotion,
  upcoming,
  loading,
}: {
  inMotion: number;
  upcoming: Array<{ projectId: string; name: string; eventDate: string; inDays: number }>;
  loading: boolean;
}) {
  if (loading) return <aside className="today-rail" />;
  return (
    <aside className="today-rail" aria-label="Coming up">
      <section className="today-rail-card">
        <p className="eyebrow">Coming up</p>
        {upcoming.length === 0 ? (
          <p className="today-rail-empty">No events on the books yet.</p>
        ) : (
          <ul className="today-upcoming">
            {upcoming.map((event) => (
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
                        : `in ${event.inDays} days`}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
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
}: {
  item: TodayItem;
  tone: "act" | "approve" | "fyi";
  onCleared?: () => void;
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
    <article className={`today-card is-${tone} band-${item.band}`}>
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
        {item.evidence ? (
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
