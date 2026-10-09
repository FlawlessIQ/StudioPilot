"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { TrustDialOffers } from "@/components/communications/trust-dial-offers";
import { SalesTaxQuestion } from "@/components/integrations/sales-tax-question";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Pencil,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { KindGlyph } from "@/components/library/kind-glyph";
import { NotInquiryConfirm } from "@/components/leads/not-inquiry-confirm";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { BookingAmendmentPanel } from "@/components/booking/booking-amendment";
import { RecordFinalPayment } from "@/components/booking/record-final-payment";
import { requestBillingAddress, sendFinalBalance } from "@/lib/booking/command-client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { jobClientRecipient, recipientLabel } from "@/features/projects/client-recipient";
import { AiQueueCard, AutomationApprovalCard } from "@/components/ai/ai-approval-queue";
import { countdownPhrase } from "@/lib/format/event-date";
import { formatCents } from "@/lib/format/money";
import { AppShell } from "@/components/layout/app-shell";
import { useTodayInbox, type TodayCall } from "@/components/today/use-today-inbox";
import { CueHandoff } from "@/components/today/cue-handoff";
import { LeadCaptureStart } from "@/components/intake/lead-capture-setup";
import { JourneyTodayCard } from "@/components/help/journey-today-card";
import { setupStepName } from "@/features/today/setup-gaps";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
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
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { runCrmCommand } from "@/lib/crm/command-client";
import { runProposalCommand } from "@/lib/proposals/command-client";
import {
  packageChangeAlreadyApplied,
  proposalAlreadyRevised,
} from "@/features/proposals/workspace-guards";
import { useRouter } from "next/navigation";
import { TodayMaybeInquiries } from "@/components/today/today-maybe-inquiries";
import { InfoHint } from "@/components/ui/info-hint";
import { heldSendFrom, UndoSend, type HeldSend } from "@/components/communications/undo-send";

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

/**
 * True on a phone-width viewport. Starts false so SSR and the first client
 * render agree (no hidden content, no hydration mismatch); collapses after
 * mount if the screen is small.
 */
function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return phone;
}

// How many prepared cards a phone shows before "show more". A queue of 13
// full cards is the endless scroll; a short preview with a count is not.
const PREPARED_PHONE_PREVIEW = 4;

const BAND_LABEL: Record<TodayBand, string> = {
  overdue: "Already late",
  soon: "Next two weeks",
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
  const { inbox, metrics, booked, handled, handoff, journeys, loading, setup, aiActions, automationApprovals, calls } =
    useTodayInbox();
  // A workflow step waiting for approval, decided here rather than on a
  // separate review page.
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const reviewingApproval =
    approvalId != null
      ? automationApprovals.find((record) => record.id === approvalId) ?? null
      : null;
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  // Replies sent from a card, still inside their undo window. Held here, not
  // in the card: the card is cleared the moment it sends, and Today unmounts
  // its cards on every refresh.
  const [held, setHeld] = useState<Array<HeldSend & { itemId: string }>>([]);
  const [showHandled, setShowHandled] = useState(false);
  const [showAllPrepared, setShowAllPrepared] = useState(false);
  // The AI action being reviewed in the sheet — the whole point of the rethink:
  // review this exact prepared task in context, without leaving Today.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  // A couple's request on a signed booking, being written up as a change.
  // Held here, not in the card: Today unmounts its cards while it refreshes,
  // and the draft the sheet writes is exactly such a refresh.
  const [changing, setChanging] = useState<PackageRequestAction | null>(null);
  // "Paid another way" on a final balance: a form, so held here for the same
  // reason as the booking change — a refresh unmounts the card it came from.
  const [settling, setSettling] = useState<FinalBalanceAction | null>(null);
  const [settledNotice, setSettledNotice] = useState<string | null>(null);
  // Opened from an inquiry card's "Edit": the review sheet starts in the editor.
  const [reviewEditing, setReviewEditing] = useState(false);
  const isPhone = useIsPhone();
  const reviewingAction =
    reviewingId != null
      ? (aiActions ?? []).find((record) => record.id === reviewingId) ?? null
      : null;

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
    lead?.action.kind === "link" || lead?.action.kind === "inquiry"
      ? lead.action.href
      : (lead?.jobHref ?? "/studio/projects");
  // The hero links; sending happens on the card itself, so an inquiry hero
  // says where the link goes rather than "Send reply".
  const leadLabel =
    lead?.action.kind === "link"
      ? lead.action.label
      : lead?.action.kind === "inquiry"
        ? "Review & reply"
        : "Open it";

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
    // Cue's handoff line below says what was handled, from the sends
    // themselves. Two different "handled" counts on one screen read as a bug.
    handled > 0 && !handoff.length
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
        ? // "You're all clear. Nothing needs you right now" on a studio that
          // cannot yet price a proposal, with "1 of 4 answered" on the same
          // screen. Congratulating someone for finishing nothing is worse than
          // saying nothing; while there is genuinely no work and the setup is
          // unfinished, the setup is the news.
          setup.brandNew && !setup.complete
          ? "Let's get you set up."
          : "You're all clear."
        : (lead?.title ?? "Here's where things stand.");

  const bands: TodayBand[] = ["overdue", "soon", "later"];
  const actBands = bands.filter((band) =>
    laneAct.some((item) => item.band === band),
  );
  const clear = (id: string) =>
    setCleared((current) => new Set(current).add(id));
  const hold = (itemId: string) => (send: HeldSend) =>
    setHeld((current) => [...current.filter((entry) => entry.emailJobId !== send.emailJobId), { ...send, itemId }]);
  const release = (emailJobId: string) =>
    setHeld((current) => current.filter((entry) => entry.emailJobId !== emailJobId));
  const maybes = inbox.maybeInquiries.filter(
    (item) => !cleared.has(`maybe-${item.leadId}`),
  );
  const formMaybes = maybes.filter((item) => item.fromForm);
  const otherMaybes = maybes.filter((item) => !item.fromForm);

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
              {!loading && lead?.action.kind === "inquiry" && lead.action.reply ? (
                // The headline inquiry is lifted out of the list below, so its
                // reply is answered here or not at all.
                <InquiryActions
                  action={lead.action}
                  onCleared={() => clear(lead.id)}
                  onHeld={hold(lead.id)}
                  onEdit={(actionId) => {
                    setReviewEditing(true);
                    setReviewingId(actionId);
                  }}
                  variant="hero"
                />
              ) : !loading && lead?.action.kind === "final_balance" ? (
                <span className="today-inquiry-buttons">
                  <FinalBalanceCardActions action={lead.action} onCleared={() => clear(lead.id)} onSettle={setSettling} />
                </span>
              ) : !loading && lead?.action.kind === "close_inquiry" ? (
                <span className="today-inquiry-buttons">
                  <CloseInquiryActions action={lead.action} onCleared={() => clear(lead.id)} />
                </span>
              ) : !loading && lead?.action.kind === "email_problem" ? (
                <span className="today-inquiry-buttons">
                  <EmailProblemActions action={lead.action} onCleared={() => clear(lead.id)} />
                </span>
              ) : !loading && lead ? (
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
                    {countdown.unit}{" "} to
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

          {/* Cue's morning handoff: what went out overnight with nobody
              pressing anything, and how much of the queue below is theirs.
              Owners and admins only; hidden when Cue handled nothing. */}
          {!loading && !failed ? <CueHandoff items={handoff} needYou={waiting} /> : null}

          {!loading ? <TrustDialOffers /> : null}

          {/* Renders only for a studio whose QuickBooks charges tax and that
              hasn't said whether to add it (components/integrations/
              sales-tax-question.tsx). */}
          {!loading ? <SalesTaxQuestion /> : null}

          {/* A website-form submission held only because its forwarder
              couldn't be confirmed is a couple by its content. Up here, above
              setup and the queue — Gabe forwarded one and it sat beneath
              eleven items, where he had to ask where it went. Still not
              counted and never the headline. */}
          {!loading ? (
            <TodayMaybeInquiries
              items={formMaybes}
              onAnswered={(leadId) => clear(`maybe-${leadId}`)}
              variant="form"
            />
          ) : null}

          {!loading && !setup.complete && !(setup.brandNew && waiting > 0) ? (
            /**
             * The first screen a new studio ever sees.
             *
             * Today replaced the old dashboard and inherited none of its
             * onboarding: the four-question setup flow — which is good, and
             * exactly what a new studio needs — was left reachable only from
             * Studio settings. So a studio with no packages and no consultation
             * hours, unable to price a proposal or let a client book a call,
             * opened on "Nothing is waiting on you."
             *
             * Deliberately not a blocker and not a nag. `setupGaps` is right
             * that a studio with no clients is new rather than stuck; this is
             * an invitation, it shows only while there is genuinely no work on
             * the books, and it goes away for good once the four are answered.
             */
            /* Shown until the four are answered, not until the first job is
               created. It used to require `brandNew` — no projects and no
               leads — so it vanished the moment a studio created its first
               project, which is the first thing anyone does, leaving three
               questions unanswered with no prompt and no route back. Once
               there is work on the books it demotes to a quiet strip rather
               than disappearing. */
            <section
              className={
                setup.brandNew
                  ? "today-clear today-getting-started"
                  : "today-clear today-getting-started is-compact"
              }
            >
              <span className="today-clear-icon">
                <Sparkles size={20} />
              </span>
              <div>
                <strong>
                  {setup.brandNew
                    ? "Show Cue how you work."
                    : "Finish setting up your studio."}
                </strong>
                <small>
                  {`${setup.answered} of ${setup.total} answered.${
                    setup.next ? ` Next: ${setupStepName(setup.next, workspace.tenantTrade)}.` : ""
                  }`}
                </small>
              </div>
              <Link
                className={
                  setup.brandNew ? "button button-dark" : "button button-light"
                }
                href="/studio/setup"
              >
                Continue setup <ArrowRight size={15} />
              </Link>
            </section>
          ) : null}
          {/* While no inquiry has ever reached StudioCue, the most useful thing
              Today can do is show the way in. A studio moving over from email
              has a mailbox full of them and, until now, no route to the
              forwarding address at all — it lived only on /studio/leads, which
              has no nav entry and which they had no reason to visit. The three
              ways in — the website form, the inbox, a forward by hand — each
              open their setup sheet here, without leaving Today. */}
          {!loading && setup.noInquiriesEver ? <LeadCaptureStart /> : null}
          {/* Not beneath "Let's get you set up": a brand-new studio has
              nothing waiting because it has nothing yet, and the setup card
              above is what to do. */}
          {!loading && waiting === 0 && !(setup.brandNew && !setup.complete) && !formMaybes.length ? (
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
                <h2>
                  Prepared for you <InfoHint term="prepared" />
                </h2>
                <span>{laneApprove.length} · one tap each</span>
              </div>
              {(() => {
                const collapse =
                  isPhone &&
                  !showAllPrepared &&
                  laneApprove.length > PREPARED_PHONE_PREVIEW;
                const shown = collapse
                  ? laneApprove.slice(0, PREPARED_PHONE_PREVIEW)
                  : laneApprove;
                return (
                  <>
                    {shown.map((item) => (
                      <TodayCard
                        item={item}
                        key={item.id}
                        onCleared={() => clear(item.id)}
                        onHeld={hold(item.id)}
                        onReview={setReviewingId}
                        onReviewApproval={setApprovalId}
                        tone="approve"
                      />
                    ))}
                    {collapse ? (
                      <button
                        className="today-lane-more"
                        onClick={() => setShowAllPrepared(true)}
                        type="button"
                      >
                        Show {laneApprove.length - PREPARED_PHONE_PREVIEW}{" "} more
                        prepared
                      </button>
                    ) : null}
                  </>
                );
              })()}
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
                        onCleared={() => clear(item.id)}
                        onHeld={hold(item.id)}
                        onChangeBooking={setChanging}
                        onSettleBalance={setSettling}
                        onEdit={(actionId) => {
                          setReviewEditing(true);
                          setReviewingId(actionId);
                        }}
                        showEvidence={index === 0}
                        tone="act"
                      />
                    ))}
                  </div>
                );
              })}
            </section>
          ) : null}

          {/* Beside the queue, not in it: not counted, never the headline,
              always below the work that is certainly real. Form submissions
              are asked about near the top instead (above). */}
          {!loading ? (
            <TodayMaybeInquiries
              items={otherMaybes}
              onAnswered={(leadId) => clear(`maybe-${leadId}`)}
            />
          ) : null}

          {/* Until the first booking: what the next year of a wedding looks
              like. Below the work, so it never pushes a real inquiry down. */}
          {!loading && !setup.bookedAJob ? <JourneyTodayCard /> : null}

          {inbox.fyi.length ? (
            <section className="today-handled" aria-label="Handled for you">
              <button
                aria-expanded={showHandled}
                onClick={() => setShowHandled((value) => !value)}
                type="button"
              >
                <ShieldCheck size={15} />
                {inbox.fyi.length}{" "} handled for you{" "}
                <em>{showHandled ? "Hide" : "Show"}</em>
              </button>
              {showHandled ? (
                <div className="today-handled-list">
                  {inbox.fyi.map((item) => (
                    <TodayCard item={item} key={item.id} tone="fyi" />
                  ))}
                  {/* Every receipt — failed and scheduled ones too, with
                      retry and cancel — lives on the activity page, which
                      left the nav when Today took over its approvals. */}
                  <Link className="today-card-secondary" href="/studio/ai-queue">
                    All activity, including anything that failed <ArrowRight size={14} />
                  </Link>
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
          calls={calls}
          trade={workspace.tenantTrade}
        />
      </div>

      {held.length ? (
        <div className="today-undo-stack">
          {held.map((entry) => (
            <UndoSend
              buttonClassName="today-undo-button"
              className="today-undo-send"
              held={entry}
              key={entry.emailJobId}
              onGone={() => release(entry.emailJobId)}
              onUndone={() => {
                release(entry.emailJobId);
                // The draft is waiting again: bring its card back.
                setCleared((current) => {
                  const next = new Set(current);
                  next.delete(entry.itemId);
                  return next;
                });
              }}
            />
          ))}
        </div>
      ) : null}

      {/* Review the specific prepared task in context — the full "why, with
          what confidence, and exactly what happens on approval" plus the
          draft and Approve/Edit/Reject — without leaving Today. On a phone
          this rises as a bottom sheet. */}
      <SheetDialog
        label="Review prepared action"
        onClose={() => {
          setReviewingId(null);
          setReviewEditing(false);
        }}
        open={reviewingAction != null}
        width="wide"
      >
        {reviewingAction ? (
          <AiQueueCard
            action={reviewingAction}
            // Keyed so "Edit" on one card and "Review" on another never share
            // an editor's half-typed state.
            key={`${reviewingAction.id}-${reviewEditing ? "edit" : "review"}`}
            // Today's own stack, so Undo brings back the card it came from.
            onHeld={(send) => {
              const inquiry = [...inbox.act].find(
                (item) => item.action.kind === "inquiry" && item.action.reply?.actionId === reviewingAction.id,
              );
              hold(inquiry?.id ?? `ai-${reviewingAction.id}`)(send);
            }}
            onDecision={(id) => {
              // Approve-lane cards are keyed `ai-<actionId>`; clearing the bare
              // id left the decided card on screen until the next refresh.
              clear(`ai-${id}`);
              // A reply sent from the sheet answers the inquiry card too.
              const inquiry = [...inbox.act].find(
                (item) => item.action.kind === "inquiry" && item.action.reply?.actionId === id,
              );
              if (inquiry) clear(inquiry.id);
              setReviewingId(null);
              setReviewEditing(false);
            }}
            startEditing={reviewEditing}
          />
        ) : null}
      </SheetDialog>
      <SheetDialog label={settling?.singleBill ? "Record the payment" : "Record the final balance"} onClose={() => setSettling(null)} open={settling != null}>
        {settling && settling.packageSnapshotId ? (
          <div className="record-sheet">
            <header>
              <p className="eyebrow">{settling.singleBill ? "The bill" : "Final balance"}</p>
              <h3>Paid another way</h3>
              <p>
                {settling.singleBill
                  ? "For a payment taken on the day, or by transfer, check or cash. The amount is the one they agreed to."
                  : "For a balance that arrived by transfer, check or cash. The amount is the one they agreed to."}
              </p>
            </header>
            <RecordFinalPayment
              onTheDay={Boolean(settling.onTheDay)}
              singleBill={Boolean(settling.singleBill)}
              balanceLabel={settling.balanceCents ? formatCents(settling.balanceCents) : null}
              onRecorded={(message) => {
                setSettledNotice(message);
                refreshTenantRecords("invoiceReferences", "projects", "checkpoints");
                setSettling(null);
              }}
              defaultOpen
              packageSnapshotId={settling.packageSnapshotId}
              projectId={settling.projectId}
            />
          </div>
        ) : null}
      </SheetDialog>
      {settledNotice ? (
        <p className="today-card-notice" role="status">
          {settledNotice}
        </p>
      ) : null}
      <SheetDialog label="Change the booking" onClose={() => setChanging(null)} open={changing != null}>
        {changing ? (
          <div className="record-sheet">
            <header>
              <p className="eyebrow">The booking</p>
              <h3>Change the booking</h3>
              <p>What they asked for is filled in. They sign the change; their agreement stands until they do.</p>
            </header>
            <BookingAmendmentPanel
              key={changing.requestId}
              onDone={() => setChanging(null)}
              prefill={{
                eventDate: changing.requestKind === "date_change" ? changing.requestedDate : null,
                addPackageIds: changing.requestKind === "package" && changing.packageId ? [changing.packageId] : [],
              }}
              projectId={changing.projectId}
            />
          </div>
        ) : null}
      </SheetDialog>
      <SheetDialog
        label="Review workflow step"
        onClose={() => setApprovalId(null)}
        open={reviewingApproval != null}
        width="wide"
      >
        {reviewingApproval ? (
          <AutomationApprovalCard
            approval={reviewingApproval}
            onDecision={(id) => {
              clear(`automation-approval-${id}`);
              setApprovalId(null);
            }}
          />
        ) : null}
      </SheetDialog>
    </AppShell>
  );
}

function callPurposeWord(purpose: TodayCall["purpose"], trade: unknown): string {
  if (purpose === "final_details") return "final details";
  if (purpose === "trial") return "trial";
  return tradeVocab(trade).consultation.toLowerCase();
}

/** What is in flight and what is coming — context, not work. */
function TodayRail({
  headlinedProjectId,
  inMotion,
  upcoming,
  loading,
  bands,
  calls,
  trade,
}: {
  inMotion: number;
  calls: TodayCall[];
  trade: unknown;
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
      {calls.length ? (
        <section className="today-rail-card">
          <p className="eyebrow">Calls</p>
          <ul className="today-upcoming">
            {calls.map((call) => (
              <li key={call.id}>
                <Link href={`/studio/projects/${call.projectId}`}>
                  <strong>{call.name}</strong>
                  <small>
                    <CalendarDays size={11} />
                    {call.when}
                    {" · "}
                    {callPurposeWord(call.purpose, trade)}
                  </small>
                </Link>
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
          {inMotion === 1 ? "job is" : "jobs are"}{" "} waiting on a client, a
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
  onHeld,
  onReview,
  onReviewApproval,
  onEdit,
  onChangeBooking,
  onSettleBalance,
  showEvidence = true,
}: {
  item: TodayItem;
  /** Opens the booking-change sheet for a couple's request on a signed job. */
  onChangeBooking?: (action: PackageRequestAction) => void;
  /** Opens "paid another way" for a final balance. */
  onSettleBalance?: (action: FinalBalanceAction) => void;
  tone: "act" | "approve" | "fyi";
  onCleared?: () => void;
  /** A reply sent from this card, held for its undo window. */
  onHeld?: (held: HeldSend) => void;
  /** Opens the full review sheet for this prepared action, in context. */
  onReview?: (actionId: string) => void;
  /** Opens a workflow approval in its sheet. */
  onReviewApproval?: (approvalId: string) => void;
  /** Opens the review sheet already editing — an inquiry's drafted reply. */
  onEdit?: (actionId: string) => void;
  /** False on all but the first card of a band — see the call site. */
  showEvidence?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  return (
    <article
      className={`today-card is-${tone} band-${item.band}${item.kind ? " has-glyph" : ""}${
        item.action.kind === "inquiry" && item.action.reply ? " has-reply" : ""
      }`}
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
                {/^waiting/.test(fact) ? (
                  <Clock3 size={10} />
                ) : /^[A-Z][a-z]{2} \d{1,2}, \d{4}/.test(fact) ? (
                  // The event's date. Unmarked, "Oct 4, 2026 · 1d ago" beside
                  // "waiting 2 days" read as when the item was made.
                  <CalendarDays aria-label="Event date" size={10} />
                ) : null}
                {fact}
              </li>
            ))}
          </ul>
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
        {item.action.kind === "inquiry" ? (
          <InquiryActions
            action={item.action}
            onCleared={onCleared}
            onEdit={onEdit}
            onHeld={onHeld}
            variant="card"
          />
        ) : item.action.kind === "approve" ? (
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
            {/* Review this exact prepared task in context — the full why /
                confidence / what-happens-on-approve plus the draft — in a
                sheet, instead of being sent to the general queue. */}
            <button
              className="today-card-secondary"
              onClick={() => {
                if (item.action.kind === "approve")
                  onReview?.(item.action.actionId);
              }}
              type="button"
            >
              Review
            </button>
          </>
        ) : item.action.kind === "final_balance" ? (
          <FinalBalanceCardActions action={item.action} onCleared={onCleared} onSettle={onSettleBalance} />
        ) : item.action.kind === "detail_change" ? (
          <DetailChangeActions action={item.action} jobHref={item.jobHref} onCleared={onCleared} />
        ) : item.action.kind === "billing_address" ? (
          <BillingAddressActions action={item.action} jobHref={item.jobHref} onCleared={onCleared} />
        ) : item.action.kind === "package_request" ? (
          <PackageRequestActions action={item.action} onChangeBooking={onChangeBooking} onCleared={onCleared} />
        ) : item.action.kind === "close_inquiry" ? (
          <CloseInquiryActions action={item.action} onCleared={onCleared} />
        ) : item.action.kind === "email_problem" ? (
          <EmailProblemActions action={item.action} onCleared={onCleared} />
        ) : item.action.kind === "automation" ? (
          <button
            className="today-card-primary"
            onClick={() => {
              if (item.action.kind === "automation") onReviewApproval?.(item.action.approvalId);
            }}
            type="button"
          >
            {item.action.label} <ArrowRight size={14} />
          </button>
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

type InquiryAction = Extract<TodayItem["action"], { kind: "inquiry" }>;

/**
 * Answer a new inquiry without leaving Today.
 *
 * With a drafted reply: its opening lines, then **Send reply** (approving the
 * draft sends it, on the lead's own thread), **Edit** (the review sheet, in
 * the editor), and **Not an inquiry**. Without one, the lead page is where
 * the reply is prepared, so the card links there.
 *
 * "Not an inquiry" archives the lead and retires the pending reply draft. It
 * asks first, naming the sender, whether to ignore that sender from now on or
 * just this one (NotInquiryConfirm) — and it is not offered at all on a job
 * the server would refuse it for (notInquiryAllowed).
 */
function InquiryActions({
  action,
  onCleared,
  onEdit,
  onHeld,
  variant,
}: {
  action: InquiryAction;
  onCleared?: () => void;
  onEdit?: (actionId: string) => void;
  /** Told when the send is held for its undo window, so Today can offer Undo. */
  onHeld?: (held: HeldSend) => void;
  variant: "card" | "hero";
}) {
  const [busy, setBusy] = useState<"send" | "remove" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reply = action.reply;
  // A makeup artist or hair stylist has no call: the link takes the couple's
  // details and the quote follows (functions/src/intake/inquiry-link.ts).
  const trade = useWorkspace().tenantTrade;
  const calls = tradeProfile(trade).consultation;

  async function send() {
    if (!reply) return;
    setBusy("send");
    setNotice(null);
    try {
      // One tap, no confirm — it is the most frequent thing done here — so
      // the server holds it a few seconds instead, and Today offers Undo.
      const result = await runAiQueueCommand({
        type: "decideAiAction",
        input: { actionId: reply.actionId, decision: "approved", holdForUndo: true },
      });
      const sent = heldSendFrom(
        result,
        `${action.followUp ? "your follow-up" : "your reply"}${reply.recipient ? ` to ${reply.recipient}` : ""}`,
      );
      if (sent) onHeld?.(sent);
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That reply couldn't be sent. Open it to review."));
      setBusy(null);
    }
  }

  /** Close, or "they replied elsewhere" — either way the card is done. */
  async function lifecycle(
    type: "closeInquiry" | "inquiryHeardElsewhere",
    extra: Record<string, unknown>,
  ) {
    setBusy("remove");
    setNotice(null);
    try {
      await runCrmCommand(type, {
        projectId: action.projectId ?? null,
        leadId: action.projectId ? null : action.leadId,
        ...extra,
      });
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That didn't go through. Try again."));
      setBusy(null);
    }
  }

  const primaryClass = variant === "hero" ? "today-hero-go" : "today-card-primary";
  const secondaryClass =
    variant === "hero" ? "today-hero-secondary" : "today-card-secondary";

  return (
    <div className={`today-inquiry-actions is-${variant}`}>
      {reply?.preview ? (
        <blockquote className="today-card-preview today-inquiry-reply">
          <small>
            {action.followUp ? "Follow-up ready" : "Reply ready"}
            {reply.recipient ? ` to ${reply.recipient}` : ""}
          </small>
          {reply.preview.subject ? <strong>{reply.preview.subject}</strong> : null}
          <p>{reply.preview.body}</p>
          {!action.followUp ? (
            // Change it for next time, where every first reply starts
            // (Settings → Email templates → Your reply to a new inquiry).
            <small className="today-inquiry-hint">
              <Link href="/studio/settings/templates?email=inquiry_reply">
                {reply.fromTemplate ? "Edit your reply template" : "Write your own reply template"}
              </Link>
              {reply.fromTemplate ? "" : " to start every reply from your words."}
            </small>
          ) : null}
          {reply.bookingLinkIncluded === false ? (
            <small className="today-inquiry-hint">
              {calls ? "No booking link yet — " : "No inquiry link yet — "}
              <Link href="/studio/settings/consultation-availability">
                {`set your ${calls ? tradeVocab(trade).consultation.toLowerCase() : "trial"} hours`}
              </Link>{" "}
              {calls
                ? "and replies will let couples pick a time themselves."
                : `and replies will link them to a page for their details, before their ${tradeVocab(trade).proposal.toLowerCase()}.`}
            </small>
          ) : null}
        </blockquote>
      ) : null}
      {confirming ? (
        <NotInquiryConfirm
          className="today-inquiry-confirm"
          leadId={action.leadId}
          onCancel={() => setConfirming(false)}
          onDone={() => onCleared?.()}
          primaryClass={primaryClass}
          secondaryClass={secondaryClass}
          sender={action.ignorableSender ?? null}
        />
      ) : (
        <div className="today-inquiry-buttons">
          {reply ? (
            <button
              className={primaryClass}
              disabled={busy !== null}
              onClick={() => void send()}
              type="button"
            >
              {busy === "send" ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
              {busy === "send" ? "Sending…" : action.followUp ? "Send follow-up" : "Send reply"}
            </button>
          ) : (
            <Link className={primaryClass} href={action.href}>
              Review &amp; reply <ArrowRight size={14} />
            </Link>
          )}
          {reply ? (
            <button
              className={secondaryClass}
              disabled={busy !== null}
              onClick={() => onEdit?.(reply.actionId)}
              type="button"
            >
              <Pencil size={13} /> Edit
            </button>
          ) : null}
          {reply && !action.followUp ? (
            // The new-inquiry email replies to the couple, so the studio may
            // have answered from its own inbox: put the drafted reply away
            // rather than let one tap send them a second answer.
            <button
              className={secondaryClass}
              disabled={busy !== null}
              onClick={() => void lifecycle("inquiryHeardElsewhere", { studioReplied: true })}
              type="button"
            >
              Replied by email
            </button>
          ) : null}
          {action.followUp ? (
            // They may well have answered in the studio's own inbox, which
            // StudioCue can't see: say so, and nobody is chased who replied.
            <button
              className={secondaryClass}
              disabled={busy !== null}
              onClick={() => void lifecycle("inquiryHeardElsewhere", {})}
              type="button"
            >
              They replied elsewhere
            </button>
          ) : action.notInquiryAllowed !== false ? (
            <button
              className={secondaryClass}
              disabled={busy !== null}
              onClick={() => setConfirming(true)}
              type="button"
            >
              Not an inquiry
            </button>
          ) : null}
          {action.dateTaken ? (
            <button
              className={secondaryClass}
              disabled={busy !== null}
              onClick={() => void lifecycle("closeInquiry", { reason: "date_taken" })}
              type="button"
            >
              Close — date taken
            </button>
          ) : null}
          {reply ? (
            <Link className={secondaryClass} href={action.href}>
              Details
            </Link>
          ) : null}
        </div>
      )}
      {notice ? (
        <span className="today-card-notice" role="status">
          {notice}
        </span>
      ) : null}
    </div>
  );
}

type CloseInquiryAction = Extract<TodayItem["action"], { kind: "close_inquiry" }>;

/**
 * Two weeks quiet: close it as "went quiet", or give it another week. A
 * closed inquiry reopens by itself if the couple writes again, so closing is
 * the tidy default rather than a door shut.
 */
function CloseInquiryActions({ action, onCleared }: { action: CloseInquiryAction; onCleared?: () => void }) {
  const [busy, setBusy] = useState<"close" | "keep" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function decide(type: "closeInquiry" | "keepInquiryOpen") {
    setBusy(type === "closeInquiry" ? "close" : "keep");
    setNotice(null);
    try {
      await runCrmCommand(type, {
        projectId: action.projectId,
        leadId: action.projectId ? null : action.leadId,
        ...(type === "closeInquiry" ? { reason: "went_quiet" } : {}),
      });
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That didn't go through. Try again."));
      setBusy(null);
    }
  }
  return (
    <>
      <button className="today-card-primary" disabled={busy !== null} onClick={() => void decide("closeInquiry")} type="button">
        {busy === "close" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
        {busy === "close" ? "Closing…" : action.label}
      </button>
      <button className="today-card-secondary" disabled={busy !== null} onClick={() => void decide("keepInquiryOpen")} type="button">
        Keep it open
      </button>
      <Link className="today-card-secondary" href={action.href}>
        Open
      </Link>
      {notice ? (
        <span className="today-card-notice" role="status">
          {notice}
        </span>
      ) : null}
    </>
  );
}

type EmailProblemAction = Extract<TodayItem["action"], { kind: "email_problem" }>;

/**
 * An email that did not reach someone, settled on the card.
 *
 * Retry sends a failed email again (communicationsCommand retryEmailJob — the
 * server re-checks the job's contact rules and refuses for a job put away,
 * paused or cancelled). A bounce cannot be retried to the same address, so it
 * offers the place the address lives instead. Leave it clears the card.
 */
function EmailProblemActions({ action, onCleared }: { action: EmailProblemAction; onCleared?: () => void }) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState<"retry" | "dismiss" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Retry and Leave it are owner/admin on the server (APPROVAL_PERMISSION_
  // REQUIRED); a coordinator was offered both and refused (wave 3).
  if (!ownerOrAdmin(workspace.role)) {
    return (
      <>
        {action.fixHref ? (
          <Link className="today-card-primary" href={action.fixHref}>
            Fix the address
          </Link>
        ) : null}
        <span className="today-card-notice">An owner or admin can send it again or clear it.</span>
      </>
    );
  }
  async function run(type: "retryEmailJob" | "dismissEmailProblem") {
    setBusy(type === "retryEmailJob" ? "retry" : "dismiss");
    setNotice(null);
    try {
      const result = await sendCommunicationsCommand({
        type,
        idempotencyKey: `${type}_${action.emailJobId}_${Date.now()}`,
        input: { emailJobId: action.emailJobId },
      });
      if (result.mode === "preview") {
        setNotice("Preview mode — nothing was sent.");
        setBusy(null);
        return;
      }
      refreshTenantRecords("emailJobs");
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That didn't go through. Try again."));
      setBusy(null);
    }
  }
  return (
    <>
      {action.canRetry ? (
        <button className="today-card-primary" disabled={busy !== null} onClick={() => void run("retryEmailJob")} type="button">
          {busy === "retry" ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
          {busy === "retry" ? "Sending…" : "Retry"}
        </button>
      ) : null}
      {action.fixHref ? (
        <Link className={action.canRetry ? "today-card-secondary" : "today-card-primary"} href={action.fixHref}>
          Fix the address
        </Link>
      ) : null}
      <button className="today-card-secondary" disabled={busy !== null} onClick={() => void run("dismissEmailProblem")} type="button">
        {busy === "dismiss" ? "Clearing…" : "Leave it"}
      </button>
      {notice ? (
        <span className="today-card-notice" role="status">
          {notice}
        </span>
      ) : null}
    </>
  );
}

type PackageRequestAction = Extract<TodayItem["action"], { kind: "package_request" }>;
type DetailChangeAction = Extract<TodayItem["action"], { kind: "detail_change" }>;

/**
 * A couple's change to a locked location or time: Accept changes it and tells
 * them (and opens a task when the timeline is already published); Decline
 * keeps it and tells them (functions/src/planning/detail-changes.ts).
 */
function DetailChangeActions({
  action,
  jobHref,
  onCleared,
}: {
  action: DetailChangeAction;
  jobHref: string | null;
  onCleared?: () => void;
}) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function decide(decision: "accept" | "decline") {
    setBusy(decision);
    setNotice(null);
    try {
      await sendPlanningCommand("decideDetailChange", { requestId: action.requestId, projectId: action.projectId, decision });
      refreshTenantRecords("detailChangeRequests", "questionnaireResponses", "tasks", "detailSignoffs");
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That couldn't be saved. Open the job to check."));
      setBusy(null);
      setConfirmingDecline(false);
    }
  }
  if (confirmingDecline)
    return (
      <ConfirmStep
        busy={busy !== null}
        cancelClassName="today-card-secondary"
        cancelLabel="Go back"
        className="today-confirm-step"
        confirmClassName="today-card-primary"
        confirmLabel="Keep it as it is"
        label="Decline the change?"
        onCancel={() => setConfirmingDecline(false)}
        onConfirm={() => void decide("decline")}
      >
        They get an email saying it stays as it was, and that they can reply to talk it through.
      </ConfirmStep>
    );
  return (
    <>
      <button className="today-card-primary" disabled={busy !== null} onClick={() => void decide("accept")} type="button">
        {busy === "accept" ? "Accepting…" : "Accept"} <ArrowRight size={14} />
      </button>
      <button className="today-card-secondary" disabled={busy !== null} onClick={() => setConfirmingDecline(true)} type="button">
        Decline
      </button>
      {jobHref ? (
        <Link className="today-card-secondary" href={jobHref}>
          Open the job
        </Link>
      ) : null}
      {notice ? <span className="today-card-notice">{notice}</span> : null}
    </>
  );
}

type BillingAddressAction = Extract<TodayItem["action"], { kind: "billing_address" }>;

/**
 * "Ask them" / "Ask again": email the couple for their billing address.
 * Names who gets it before it goes, as the final bill does.
 */
function BillingAddressActions({
  action,
  jobHref,
  onCleared,
}: {
  action: BillingAddressAction;
  jobHref: string | null;
  onCleared?: () => void;
}) {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: contacts } = useTenantDocuments("contacts");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const recipient = recipientLabel(
    jobClientRecipient(
      projects?.find((project) => project.id === action.projectId),
      contacts,
    ),
  );
  async function ask() {
    setBusy(true);
    setNotice(null);
    try {
      await requestBillingAddress(action.projectId);
      refreshTenantRecords("billingAddressRequests", "emailJobs");
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The request couldn't be sent. Open the job to check."));
      setConfirming(false);
      setBusy(false);
    }
  }
  if (!ownerOrAdmin(workspace.role)) {
    return (
      <>
        <Link className="today-card-primary" href={jobHref ?? `/studio/projects/${action.projectId}`}>
          Open the job <ArrowRight size={14} />
        </Link>
        <span className="today-card-notice">An owner or admin asks the couple.</span>
      </>
    );
  }
  if (confirming) {
    return (
      <ConfirmStep
        busy={busy}
        cancelClassName="today-card-secondary"
        cancelLabel="Not now"
        className="today-confirm-step"
        confirmClassName="today-card-primary"
        confirmLabel="Send the request"
        label="Ask for their billing address?"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void ask()}
      >
        {`${recipient ?? "The couple"} gets an email from you with a link to their portal, where they add it once. QuickBooks then works out the tax on their final invoice.`}
      </ConfirmStep>
    );
  }
  return (
    <>
      <button className="today-card-primary" disabled={busy} onClick={() => setConfirming(true)} type="button">
        {action.label} <ArrowRight size={14} />
      </button>
      {jobHref ? (
        <Link className="today-card-secondary" href={jobHref}>
          Open the job
        </Link>
      ) : null}
      {notice ? <span className="today-card-notice">{notice}</span> : null}
    </>
  );
}

type FinalBalanceAction = Extract<TodayItem["action"], { kind: "final_balance" }>;

/**
 * A final balance nothing has billed. "Send the final bill" raises it through
 * the studio's invoicing provider (bookingCommand sendFinalBalance); "Paid
 * another way" opens the page-level sheet to record it.
 */
function FinalBalanceCardActions({
  action,
  onCleared,
  onSettle,
}: {
  action: FinalBalanceAction;
  onCleared?: () => void;
  onSettle?: (action: FinalBalanceAction) => void;
}) {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: contacts } = useTenantDocuments("contacts");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * "Send the final bill" emailed the couple a bill on one tap, without the
   * amount or who it goes to (wave 3). The step names both.
   */
  const [confirming, setConfirming] = useState(false);
  const recipient = recipientLabel(
    jobClientRecipient(
      projects?.find((project) => project.id === action.projectId),
      contacts,
    ),
  );
  const amount = typeof action.balanceCents === "number" ? formatCents(action.balanceCents) : null;
  async function send() {
    setBusy(true);
    setNotice(null);
    try {
      await sendFinalBalance(action.projectId);
      refreshTenantRecords("invoiceReferences", "providerJobs", "projects");
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The final bill couldn't be sent. Open the job to check."));
      setConfirming(false);
      setBusy(false);
    }
  }
  // sendFinalBalance is owner/admin only (BALANCE_ATTESTATION_PERMISSION_REQUIRED).
  if (!ownerOrAdmin(workspace.role)) {
    return (
      <>
        <Link className="today-card-primary" href={`/studio/projects/${action.projectId}`}>
          Open the job <ArrowRight size={14} />
        </Link>
        <span className="today-card-notice">An owner or admin sends the final bill.</span>
      </>
    );
  }
  if (confirming) {
    return (
      <ConfirmStep
        busy={busy}
        cancelClassName="today-card-secondary"
        cancelLabel="Not now"
        className="today-confirm-step"
        confirmClassName="today-card-primary"
        confirmLabel={amount ? `Send the ${amount} bill` : "Send the bill"}
        label="Send the final bill?"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void send()}
      >
        {`${amount ? `A ${amount}` : "The"} final bill goes to ${recipient ?? "the couple"} by email from your invoicing app. Once it's out it can be voided, not unsent.`}
      </ConfirmStep>
    );
  }
  return (
    <>
      <button className="today-card-primary" disabled={busy} onClick={() => setConfirming(true)} type="button">
        {busy ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
        {busy ? "Sending…" : amount ? `${action.label} · ${amount}` : action.label}
      </button>
      {action.packageSnapshotId ? (
        <button className="today-card-secondary" disabled={busy} onClick={() => onSettle?.(action)} type="button">
          Paid another way
        </button>
      ) : null}
      <Link className="today-card-secondary" href={`/studio/projects/${action.projectId}`}>
        Open the job
      </Link>
      {notice ? (
        <span className="today-card-notice" role="status">
          {notice}
        </span>
      ) : null}
    </>
  );
}

/**
 * A couple asked, in their portal, to add a package. "Add and revise" does
 * what the Packages panel does — adds it alongside and prices their proposal
 * again — then opens the revised proposal to check and send. "Not now" closes
 * the request; the couple's portal says the studio will be in touch.
 */
function PackageRequestActions({
  action,
  onCleared,
  onChangeBooking,
}: {
  action: PackageRequestAction;
  onCleared?: () => void;
  onChangeBooking?: (action: PackageRequestAction) => void;
}) {
  const router = useRouter();
  const workspace = useWorkspace();
  // A makeup artist or hair stylist sends a quote (trades.ts).
  const offer = tradeVocab(workspace.tenantTrade).proposal.toLowerCase();
  const [busy, setBusy] = useState<"add" | "decline" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * "Not now" answered the couple for good on one tap — their portal says the
   * studio couldn't do it — and "Add" superseded a proposal they'd already
   * been sent without the Packages panel's warning (wave 3).
   */
  const [confirming, setConfirming] = useState<"add" | "decline" | null>(null);
  const proposalOut = ["sent", "viewed", "accepted"].includes(action.proposalStatus ?? "");
  // Adding re-prices the proposal (revise_packages), which is owner/admin.
  const mayAdd = !action.proposalId || ownerOrAdmin(workspace.role);

  async function add() {
    setBusy("add");
    setNotice(null);
    try {
      try {
        await runCrmCommand("selectPackage", {
          projectId: action.projectId,
          packageId: action.packageId,
          selectedAddOns: [],
          mode: "add",
          discount: { type: "keep" },
        });
      } catch (caught: unknown) {
        // Added already — from the proposal, Cue, or this button's first
        // attempt — so the package is on the job either way.
        if (!packageChangeAlreadyApplied(caught)) throw caught;
      }
      // Revised whether or not the add was new. Skipping it on "already on
      // the job" meant a retry after a failed revise never re-priced the
      // proposal, and the couple couldn't accept it (PACKAGE_SNAPSHOT_CONFLICT).
      let resultProposalId: string | null = null;
      if (action.proposalId) {
        try {
          const revised = await runProposalCommand("revise_packages", { proposalId: action.proposalId });
          resultProposalId = typeof revised.result.proposalId === "string" ? revised.result.proposalId : action.proposalId;
        } catch (caught: unknown) {
          // The first attempt revised it and only closing the request failed.
          if (!proposalAlreadyRevised(caught)) throw caught;
        }
      }
      await runCrmCommand("decidePackageRequest", {
        requestId: action.requestId,
        decision: "approved",
        resultProposalId,
      });
      onCleared?.();
      router.push(resultProposalId ? `/studio/proposals/${resultProposalId}` : `/studio/projects/${action.projectId}`);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, `${action.packageName} couldn't be added. Open the job to check.`));
      setConfirming(null);
      setBusy(null);
    }
  }

  async function decline() {
    setBusy("decline");
    setNotice(null);
    try {
      await runCrmCommand("decidePackageRequest", {
        requestId: action.requestId,
        decision: "declined",
        resultProposalId: null,
      });
      onCleared?.();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That didn't go through. Try again."));
      setConfirming(null);
      setBusy(null);
    }
  }

  if (confirming) {
    return (
      <ConfirmStep
        busy={busy !== null}
        cancelClassName="today-card-secondary"
        cancelLabel="Go back"
        className="today-confirm-step"
        confirmClassName="today-card-primary"
        confirmLabel={confirming === "decline" ? "Yes, not now" : "Add and revise"}
        label={confirming === "decline" ? "Say not now?" : `Revise their ${offer}?`}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void (confirming === "decline" ? decline() : add())}
      >
        {confirming === "decline"
          ? action.requestKind === "date_change"
            ? "Their portal will say you couldn't move their date and that you'll be in touch — this can't be undone, so tell them why yourself."
            : `Their portal will say you couldn't add ${action.packageName} and that you'll be in touch — this can't be undone, so tell them why yourself.`
          : action.proposalStatus === "accepted"
            ? `They've accepted their ${offer}. Adding ${action.packageName} makes a revised ${offer} for them to accept — the accepted one stays in the version history, and the agreement waits for the new one.`
            : `They've already been sent their ${offer}. Adding ${action.packageName} makes a revised version for you to check and send; the one they have can no longer be accepted.`}
      </ConfirmStep>
    );
  }

  return (
    <>
      {action.amend ? (
        // Signed: the answer is a booking change they sign. The request reads
        // as met once it's applied (functions/src/booking/amendment-apply.ts).
        <button className="today-card-primary" onClick={() => onChangeBooking?.(action)} type="button">
          <CalendarClock size={14} /> {action.label}
        </button>
      ) : action.requestKind === "date_change" ? (
        <Link className="today-card-primary" href={`/studio/projects/${action.projectId}`}>
          {action.label} <ArrowRight size={14} />
        </Link>
      ) : mayAdd ? (
        <button
          className="today-card-primary"
          disabled={busy !== null}
          onClick={() => (proposalOut ? setConfirming("add") : void add())}
          type="button"
        >
          {busy === "add" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
          {busy === "add" ? "Adding…" : action.label}
        </button>
      ) : (
        <span className="today-card-notice">{`An owner or admin adds it — their ${offer} is priced again.`}</span>
      )}
      <button className="today-card-secondary" disabled={busy !== null} onClick={() => setConfirming("decline")} type="button">
        Not now
      </button>
      {action.requestKind === "date_change" && !action.amend ? null : (
        <Link className="today-card-secondary" href={`/studio/projects/${action.projectId}`}>
          Open the job
        </Link>
      )}
      {notice ? (
        <span className="today-card-notice" role="status">
          {notice}
        </span>
      ) : null}
    </>
  );
}

/**
 * The roles the server lets send a bill, retry an email or re-price a
 * proposal. Display only — the server decides — but a button it will refuse
 * is a dead end, so it isn't offered (wave 3).
 */
function ownerOrAdmin(role: string | null | undefined): boolean {
  return role === "studio_owner" || role === "studio_admin";
}
