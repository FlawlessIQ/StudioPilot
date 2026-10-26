"use client";

import Link from "next/link";
import { SalesTaxQuestion } from "@/components/integrations/sales-tax-question";
import { PaymentDetailsQuestion } from "@/components/setup/payment-details-question";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
  Plus,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { JourneySetupBanner, useOffersWeddingFilm } from "@/components/help/journey-film";
import { SetupVideoCard, useOffersSetupVideo } from "@/components/help/setup-video";
import { useSetupState } from "@/components/setup/use-setup-state";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { perPersonPricesLink } from "@/features/packages/per-person-price";
import { LeadCaptureRoutes, LeadCaptureTestButton } from "@/components/intake/lead-capture-setup";
import { fromSetup } from "@/components/setup/back-to-setup";
import { setOutsideStep, setSignatureMode, startProviderConnect } from "@/lib/integrations/command-client";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeOf, tradeProfile, tradeVocab } from "@/features/trades/trades";
import {
  INQUIRY_FORM_SETTING_HREF,
  setupOrderFor,
  setupQuestionCount,
  setupStepNeed,
  type SetupGap,
  type SetupGapKey,
} from "@/features/today/setup-gaps";
import { InquiryEventFormSetting } from "@/components/planning/inquiry-event-form-setting";
import { JOB_KIND_LABELS, JOB_KINDS, type JobKind } from "@/features/job-kinds/job-kinds";
import { inquiryFormForKinds, setupOfferedKinds } from "@/features/setup/work-kinds";
import { runCrmCommand } from "@/lib/crm/command-client";

/**
 * Setup as a conversation.
 *
 * Phase 3 of "Today & Jobs". A new studio's assets already exist somewhere —
 * a price list, a contract, a questionnaire — so setup asks a photographer
 * seven questions (a DJ, makeup artist or hair stylist four, setupOrderFor)
 * and hands each answer to the import machinery, rather than presenting a
 * library of tools to discover. Most are answered right on this page: the
 * inquiry routes open their sheets here, hours take one tap, the agreement
 * answer is one tap, and the details form starts answered. Every question is
 * skippable: what is skipped comes back in Today when it blocks real work.
 *
 * Onboarding audit, 2026-10-24: every unanswered question carried its own
 * dark button, so the page offered five "first" things at once and said
 * nothing about which could wait. Now only the next question's button is the
 * dark one, each question says what it's needed for, answered ones say what
 * was answered, and the top says a job can be started (or brought over)
 * without finishing.
 */

type Question = {
  key: SetupGapKey;
  ask: string;
  why: string;
  doneLabel: string;
};

/**
 * In the order a new studio needs them: inquiries in, then when it can talk to
 * them, then what it charges, how they sign, and what it asks before the day
 * (docs/onboarding-assessment-2026-09-26.md, "setup v2").
 */
const QUESTIONS: Question[] = [
  {
    /**
     * What the studio shoots decides its inquiry form's types and the words
     * every client reads (docs/job-types-plan-2026-10-02.md). Asked once; an
     * established studio changes it in Settings → Job types.
     */
    key: "work",
    ask: "What do you shoot?",
    why: "Check everything you take on. Your inquiry form offers just these, and each kind gets its own steps and words — a family session books on payment alone, with no contract.",
    doneLabel: "StudioCue knows what you shoot.",
  },
  {
    /**
     * First, because until inquiries arrive StudioCue has nothing to do. It
     * used to sit under the four questions as a "forward by hand" strip,
     * uncounted, so setup could say "Your studio is set up" with nothing
     * coming in.
     */
    key: "inquiries",
    ask: "How do inquiries reach you?",
    why: "Your website form can send StudioCue a copy, your inbox can pass them on, or you forward one by hand. Each arrives filled in, with a reply drafted.",
    doneLabel: "Inquiries are reaching StudioCue.",
  },
  {
    key: "availability",
    ask: "When can clients book a call?",
    why: "Pick your hours and clients book a consultation themselves. Connect Google Calendar too, and times you're busy are never offered.",
    doneLabel: "Clients can book a time that suits you both.",
  },
  {
    key: "packages",
    ask: "What do you charge?",
    why: "Paste or upload your price list and StudioCue drafts your packages — you confirm every price. Nothing is invented.",
    doneLabel: "Your packages are ready to use in proposals.",
  },
  {
    /**
     * StudioCue does not write, render or send a contract.
     *
     * This said "import it once, StudioCue keeps your wording and signer
     * fields, then reuses it for every client" and promised "your agreement is
     * ready to send". Both are true only once a signing app is connected, and
     * the reference studio had none: he imported his agreement, waited, and
     * told us "never got a contract to sign, so couldn't complete the run
     * through" — then asked "is it making the contract for me?".
     */
    key: "agreement",
    ask: "How do your clients sign?",
    why: "StudioCue doesn't write your contract. Most studios send their own and record the signature on the job — if that's you, say so and StudioCue stops asking.",
    doneLabel: "StudioCue knows how you handle signatures.",
  },
  {
    key: "questionnaire",
    ask: "What do you ask couples before the day?",
    why: "Paste or upload the form you already send and confirm the draft — locations, timings, family names.",
    // Every new studio starts with StudioCue's starter forms, so this is
    // usually done before the studio arrives; it says so, and offers theirs.
    doneLabel: "StudioCue's starter forms are ready to send — or use your own.",
  },
  {
    key: "insurance",
    ask: "Who sends your certificates of insurance?",
    why: "Venues often want one. Save your agent — or the insurance company whose website you make them on — and StudioCue asks for it once a job is booked (or gets you the details to paste), follows up, and brings it back for one approval. Skip it if venues never ask.",
    doneLabel: "StudioCue knows who sends your certificates.",
  },
];

/**
 * Where StudioCue does write contracts (features/contracts/rollout.ts), the
 * promise the paragraph above had to withdraw is true, and the card says so.
 * The gap's link is what tells the two apart — setup-gaps.ts sends a studio
 * with StudioCue signing to its agreement, and every other studio elsewhere.
 */
const NATIVE_AGREEMENT_HREF = "/studio/contracts/agreement";
const NATIVE_AGREEMENT_WHY =
  "Upload the agreement you already use, or finish StudioCue's starter: a few short sections, each with an example to start from. Every client's contract is written from it, with their details and the price they accepted, and they sign in their portal.";

// Forms are in; the question left is which one the first reply's link asks for.
const INQUIRY_FORM_WHY =
  "Your forms are in. Choose the one your first reply's link asks for, and new clients fill it in before they pick a time to talk — so you have it for the call.";

/**
 * The same, for a makeup artist or hair stylist: no call, so the link takes
 * the details and the quote follows (functions/src/intake/inquiry-link.ts).
 */
function inquiryFormWhy(trade: unknown): string {
  if (tradeProfile(trade).consultation) return INQUIRY_FORM_WHY;
  const offer = tradeVocab(trade).proposal.toLowerCase();
  return `Your forms are in. Choose the one your first reply's link asks for, and new clients fill it in with their inquiry — so you have it for the ${offer}.`;
}

/** This studio's questions, in the one shared order Today's "Next:" also follows. */
function orderedFor(trade: unknown): Question[] {
  return setupOrderFor(trade).map((key) => QUESTIONS.find((question) => question.key === key)!);
}

/**
 * A makeup artist or hair stylist prices her client's own look as the
 * package and everyone else getting ready per person (extra-ideas.ts), so the
 * question says so. The import drafts packages only; the per-person prices
 * are add-ons, set in the Library from the trade's own examples.
 */
const PER_PERSON_WHY =
  "Paste or upload your price list and StudioCue drafts your packages — you confirm every price. Then price everyone else getting ready per person, so a quote reads “4 people × $120”.";
const PER_PERSON_PRICES = "/studio/library/add-ons";

/**
 * A DJ's words for the same questions (features/trades/trades.ts): what they
 * play, a vibe call, and the music planner they start with.
 */
const DJ_COPY: Partial<Record<Question["key"], Partial<Pick<Question, "ask" | "why" | "doneLabel">>>> = {
  work: {
    ask: "What events do you play?",
    why: "Check everything you take on. Your inquiry form offers just these, and each kind gets its own steps and words.",
    doneLabel: "StudioCue knows what you play.",
  },
  availability: {
    why: "Pick your hours and clients book a vibe call themselves. Connect Google Calendar too, and times you're busy are never offered.",
  },
  questionnaire: {
    ask: "What do you ask clients before the night?",
    why: "StudioCue's Music & moments planner is ready: songs for every moment, the names you'll say with how to say them, and the dance floor. Or paste the form you already send.",
    doneLabel: "Your Music & moments planner is ready to send — or use your own.",
  },
};

/**
 * A makeup artist's or hair stylist's words: a trial instead of a call, and
 * the party list they start with (docs/vendor-journeys-plan.md, Phase 3).
 */
const BEAUTY_COPY: Partial<Record<Question["key"], Partial<Pick<Question, "ask" | "why" | "doneLabel">>>> = {
  work: {
    ask: "What events do you work?",
    why: "Check everything you take on. Your inquiry form offers just these, and asks how many people and when everyone must be ready.",
    doneLabel: "StudioCue knows what you take on.",
  },
  availability: {
    ask: "When can clients book a trial?",
    why: "Pick your hours and clients book their trial themselves. Connect Google Calendar too, and times you're busy are never offered.",
    doneLabel: "Clients can book a trial that suits you both.",
  },
  questionnaire: {
    ask: "What do you ask clients before the day?",
    why: "StudioCue's Party list is ready: who needs what, the ready-by time and where everyone gets ready — your morning is laid out from it. Or paste the form you already send.",
    doneLabel: "Your Party list is ready to send — or use your own.",
  },
};

/** A question in the studio's trade's words. */
function inTradeWords(question: Question, trade: unknown): Question {
  const tradeId = tradeOf(trade);
  // Packages price the trade's own offer: a makeup artist's quotes, priced
  // per person for everyone but her client.
  const offered: Question =
    question.key === "packages"
      ? {
          ...question,
          ...(tradeProfile(trade).perPersonPricing ? { why: PER_PERSON_WHY } : {}),
          doneLabel: `Your packages are ready to use in ${tradeVocab(trade).proposal.toLowerCase()}s.`,
        }
      : question;
  if (tradeId === "dj") return { ...offered, ...DJ_COPY[question.key] };
  if (tradeId === "makeup" || tradeId === "hair") return { ...offered, ...BEAUTY_COPY[question.key] };
  return offered;
}

const IMPORT_PRICES = fromSetup("/studio/import?kind=Package");
const IMPORT_FORM = fromSetup("/studio/import?kind=Questionnaire");

/** The dark button for the question that's next; every other one is light. */
const buttonClass = (primary: boolean) => (primary ? "button button-dark" : "button button-light");

export function SetupConversation() {
  // The film is a photographer's wedding (useOffersWeddingFilm).
  const shootsWeddings = useOffersWeddingFilm();
  const workspace = useWorkspace();
  const { state, gaps, complete, loading, refresh, calendarConnected, inquiryWaiting, answers } = useSetupState();
  const gapByKey = new Map(gaps.map((gap) => [gap.key, gap]));
  // A photographer's seven, a vendor's four: counted over the questions this
  // studio is actually asked, as Today and Help's checklist count them.
  const ordered = orderedFor(workspace.tenantTrade);
  const answered = ordered.filter((question) => !gapByKey.has(question.key)).length;
  const offersSetupVideo = useOffersSetupVideo();
  // The one question whose button is the dark one: the first still open.
  const nextKey = loading ? null : (ordered.find((question) => gapByKey.has(question.key))?.key ?? null);
  // `complete` is "ready to take bookings" (setupComplete), which leaves out
  // insurance on purpose. The page said "Your studio is set up." over "5 of 6
  // answered"; now it only says that when every question is answered.
  const allAnswered = !loading && gaps.length === 0;
  const manages = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  // Any package answers "What do you charge?", so a makeup artist or hair
  // stylist who imported one lost the way to her per-person prices with it
  // (Priya Shah, Jess Styles Bridal, 2026-10-10). Only her trade reads the
  // add-ons; nothing shows until both lists are in.
  const perPersonPricing = tradeProfile(workspace.tenantTrade).perPersonPricing;
  const addOnRead = useTenantDocuments("addOns", { enabled: perPersonPricing });
  const packageRead = useTenantDocuments("packages", { enabled: perPersonPricing });
  const perPersonLink = perPersonPricesLink({
    trade: workspace.tenantTrade,
    addOns: addOnRead,
    packages: packageRead,
  });
  const calls = tradeProfile(workspace.tenantTrade).consultation;

  /** What a question offers when it isn't answered yet. */
  const answer = (question: Question, gap: SetupGap, primary: boolean): ReactNode => {
    switch (question.key) {
      case "work":
        return <WorkAnswer onAnswered={refresh} primary={primary} />;
      case "inquiries":
        // Answered in place: the routes open their sheets here.
        return (
          <>
            <LeadCaptureRoutes />
            {workspace.tenantSlug ? (
              <HostedFormLink onCopied={recordFormLinkShared} slug={workspace.tenantSlug} />
            ) : null}
          </>
        );
      case "availability":
        return <HoursAnswer onAnswered={refresh} primary={primary} />;
      case "packages":
        return (
          <div className="setup-answer-row">
            <Link className={buttonClass(primary)} href={IMPORT_PRICES}>
              Paste or upload your prices <ArrowRight size={14} />
            </Link>
            <Link className="setup-answer-link" href={fromSetup("/studio/packages/new")}>
              Add one by hand
            </Link>
            {tradeProfile(workspace.tenantTrade).perPersonPricing ? (
              <Link className="setup-answer-link" href={PER_PERSON_PRICES}>
                Set per-person prices
              </Link>
            ) : null}
          </div>
        );
      case "agreement":
        return gap.href === NATIVE_AGREEMENT_HREF ? (
          <div className="setup-answer-row">
            <Link className={buttonClass(primary)} href={fromSetup(gap.href)}>
              {gap.actionLabel} <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          /* It linked to Integrations, where no signing app is offered: a
             dead end, and the one step setup could never tick. */
          <SendOwnAgreement onAnswered={refresh} primary={primary} />
        );
      case "questionnaire":
        // Forms are in; what's left is which one the inquiry link asks for.
        if (gap.href === INQUIRY_FORM_SETTING_HREF) return <InquiryEventFormSetting onSaved={refresh} />;
        return (
          <div className="setup-answer-row">
            <Link className={buttonClass(primary)} href={IMPORT_FORM}>
              Paste or upload your form <ArrowRight size={14} />
            </Link>
          </div>
        );
      case "insurance":
        return (
          <div className="setup-answer-row">
            <Link className={buttonClass(primary)} href={fromSetup("/studio/settings/insurance")}>
              Save who sends them <ArrowRight size={14} />
            </Link>
          </div>
        );
    }
  };

  /**
   * Copying StudioCue's form link is setting a way in up, as finishing a
   * route's guide is: recorded as the waiting outside step, so the question
   * counts as answered and Today asks after it if nothing arrives.
   */
  function recordFormLinkShared() {
    if (state.hasInquiryCapture || !workspace.tenantId) return;
    void setOutsideStep("inquiry_capture", "waiting", workspace.tenantId)
      .then(() => refreshTenantRecords("tenants"))
      .catch(() => undefined);
  }

  /** An answered question, in words: what was said, not only that it was. */
  const doneText = (question: Question, words: Question): string => {
    if (question.key === "work" && answers.work) return `Your inquiry form offers ${answers.work}.`;
    if (question.key === "inquiries" && inquiryWaiting)
      return "Set up. Waiting for your first inquiry — it lands in Today, filled in, the moment it arrives.";
    // "StudioCue knows how you handle signatures" was written before StudioCue
    // wrote contracts; a saved agreement is a stronger answer, so say it.
    if (question.key === "agreement" && answers.agreement === "native")
      return "Your agreement is saved. Every client's contract is written from it, and they sign in their portal.";
    if (question.key === "agreement" && answers.agreement === "own")
      return "You send your own agreement and record the signature on the job.";
    if (question.key === "availability" && answers.availability)
      return `${calls ? "Calls" : "Trials"} can be booked ${answers.availability}.`;
    return words.doneLabel;
  };

  /** What an answered question still offers. */
  const afterwards = (question: Question): ReactNode => {
    if (question.key === "work")
      return (
        <div className="setup-answer-row">
          <Link className="setup-answer-link" href={fromSetup("/studio/settings/job-types")}>
            Change
          </Link>
        </div>
      );
    if (question.key === "inquiries")
      return (
        <>
          {inquiryWaiting ? (
            <div className="setup-answer-row">
              <LeadCaptureTestButton />
              <Link className="setup-answer-link" href={fromSetup("/studio/settings/inquiry-capture")}>
                Other ways in
              </Link>
            </div>
          ) : null}
          {workspace.tenantSlug ? <HostedFormLink slug={workspace.tenantSlug} /> : null}
        </>
      );
    // Packages answer the question; per-person prices are what is left of it,
    // so here they are the button (beside the prices themselves, before any
    // package, they were the quieter link) until one exists.
    if (question.key === "packages" && perPersonLink) {
      return (
        <div className="setup-answer-row">
          {perPersonLink === "quiet" ? (
            <Link className="setup-answer-link" href={PER_PERSON_PRICES}>
              Per-person prices
            </Link>
          ) : (
            <Link className="button button-light button-sm" href={PER_PERSON_PRICES}>
              Set per-person prices <ArrowRight size={14} />
            </Link>
          )}
        </div>
      );
    }
    if (question.key === "packages" && answers.packages)
      return (
        <div className="setup-answer-row">
          <Link className="setup-answer-link" href="/studio/packages">
            {answers.packages === 1 ? "See your package" : `See your ${answers.packages} packages`}
          </Link>
        </div>
      );
    if (question.key === "agreement" && answers.agreement === "native")
      return (
        <div className="setup-answer-row">
          <Link className="setup-answer-link" href={fromSetup(NATIVE_AGREEMENT_HREF)}>
            Read or change it
          </Link>
        </div>
      );
    if (question.key === "availability")
      return (
        <div className="setup-answer-row">
          <Link className="setup-answer-link" href={fromSetup("/studio/settings/consultation-availability")}>
            Change hours
          </Link>
        </div>
      );
    if (question.key === "questionnaire")
      return (
        <div className="setup-answer-row">
          <Link className="setup-answer-link" href={IMPORT_FORM}>
            Use your own form instead
          </Link>
        </div>
      );
    return null;
  };

  return (
    <AppShell active="Studio settings">
      <div className="setup-conversation">
        {/* Weddings only, like every way into the journey film. Where the
            setup video fits the studio, it takes this place instead: the film
            stays one link away in the footnote. */}
        {shootsWeddings && !offersSetupVideo ? <JourneySetupBanner /> : null}
        <header>
          <p className="eyebrow">Getting started</p>
          <h1>
            {allAnswered
              ? "Your studio is set up."
              : complete
                ? "You're ready to take bookings."
                : "Show Cue how you work."}
          </h1>
          <p className="setup-lede">
            {allAnswered
              ? "Everything Cue needs is in place. Change any of it whenever your studio does."
              : complete
                ? "Everything a booking needs is in place. What's left below only matters if venues ask for it."
                : `${setupQuestionCount(workspace.tenantTrade).replace(/^./, (first) => first.toUpperCase())} questions about how your studio runs, most answered right here. Each says what it's needed for — skip the rest, and Cue brings it back when a job needs it.`}
          </p>
          {!loading ? (
            <div className="setup-progress">
              <span aria-hidden="true" className="setup-progress-bar">
                <b style={{ width: `${Math.round((answered / Math.max(ordered.length, 1)) * 100)}%` }} />
              </span>
              <span>
                {answered} of {ordered.length}{" "} answered
              </span>
            </div>
          ) : null}
          {!loading && !allAnswered ? <SetupVideoCard answered={answered} /> : null}
        </header>

        {/* The point of setup is getting to work, and nothing here has to be
            finished first: a studio with clients already booked elsewhere
            can bring them over now (ADR 0005), and anyone can start a job. */}
        {!allAnswered ? (
          <section aria-label="Start working now" className="setup-start-now">
            <p>
              <strong>You don&apos;t have to finish first.</strong>{" "}
              {manages
                ? "Start a job whenever you're ready, or bring over the bookings you already have."
                : "Start a job whenever you're ready."}
            </p>
            <div className="setup-answer-row">
              <Link className="setup-answer-link" href="/studio/projects/new">
                <Plus size={14} /> Start a job
              </Link>
              {manages ? (
                <Link className="setup-answer-link" href="/studio/projects/import">
                  <Upload size={14} /> Import bookings
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        <ol className="setup-questions">
          {ordered.map((question, index) => {
            const gap = gapByKey.get(question.key);
            // Not while loading: a question whose answer hasn't been read yet
            // has no gap either, and flashed "Done" before its real state.
            const done = !loading && !gap;
            const next = question.key === nextKey;
            const words = inTradeWords(question, workspace.tenantTrade);
            // The details form's second ask is which form the inquiry link
            // asks for, and that one is read before the call, not after booking.
            const need =
              question.key === "questionnaire" && gap?.href === INQUIRY_FORM_SETTING_HREF
                ? { label: "Needed for inquiries", optional: false }
                : setupStepNeed(question.key, workspace.tenantTrade);
            return (
              <li
                className={[done ? "is-done" : gap?.blocking ? "is-blocking" : "", next ? "is-next" : ""]
                  .filter(Boolean)
                  .join(" ")}
                key={question.key}
              >
                <span className="setup-question-marker" aria-hidden="true">
                  {loading ? (
                    <LoaderCircle className="spin" size={13} />
                  ) : done ? (
                    <Check size={14} />
                  ) : (
                    index + 1
                  )}
                </span>
                <div className="setup-question-body">
                  <span className="setup-question-title">
                    <strong>{words.ask}</strong>
                    {!loading && !done ? (
                      <em className={need.optional ? "setup-need is-optional" : "setup-need"}>
                        {next ? `Next · ${need.label}` : need.label}
                      </em>
                    ) : null}
                  </span>
                  <p>
                    {done
                      ? doneText(question, words)
                      : question.key === "agreement" &&
                          gap?.href === NATIVE_AGREEMENT_HREF
                        ? NATIVE_AGREEMENT_WHY
                        : gap?.href === INQUIRY_FORM_SETTING_HREF
                          ? inquiryFormWhy(workspace.tenantTrade)
                          : words.why}
                  </p>
                  {gap?.blocking ? (
                    <span className="setup-blocking">
                      <CircleAlert size={12} /> {gap.detail}
                    </span>
                  ) : null}
                  {!loading && gap ? answer(question, gap, next) : null}
                  {!loading && done ? afterwards(question) : null}
                  {/* Beside the hours it decides, answered or not; optional,
                      so it never counts as a question. */}
                  {!loading && question.key === "availability" ? (
                    <CalendarConnect connected={calendarConnected} />
                  ) : null}
                </div>
                {done ? <span className="setup-question-done">Done</span> : null}
              </li>
            );
          })}
        </ol>

        {/* Not one of the questions: only for a studio whose QuickBooks
            charges tax and hasn't said whether to add it. */}
        <SalesTaxQuestion />

        {/* Not one of the questions either: how clients pay, until it's said
            (own invoicing — every invoice StudioCue sends says it). */}
        <PaymentDetailsQuestion />

        <p className="setup-footnote">
          Prefer to wander? Everything here also lives in{" "}
          <Link href="/studio/library">your library</Link> and{" "}
          <Link href="/studio/integrations">integrations</Link>.
        </p>
        {shootsWeddings ? (
          <p className="setup-footnote">
            What happens once a couple inquires?{" "}
            <Link href="/studio/help/journey">See a wedding, start to finish</Link>.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}

/**
 * Consultation hours in one tap: Mon–Fri, 9–5 is what the settings page
 * pre-fills anyway, but it only counted once saved there — two pages away.
 */
function HoursAnswer({ onAnswered, primary }: { onAnswered: () => void; primary: boolean }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="setup-answer-row">
      <button
        className={buttonClass(primary)}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setNotice(null);
          sendBookingCommand({
            type: "setConsultationSettings",
            idempotencyKey: crypto.randomUUID(),
            input: {
              durationMinutes: 45,
              bufferMinutes: 15,
              mode: "closed_default",
              windows: (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => ({
                day,
                startMinute: 9 * 60,
                endMinute: 17 * 60,
              })),
              unavailableWindows: [],
              blockedDates: [],
            },
          })
            .then(() => onAnswered())
            .catch((caught: unknown) => setNotice(friendlyError(caught, "Those hours couldn't be saved. Try again.")))
            .finally(() => setBusy(false));
        }}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
        Use Mon–Fri, 9–5
      </button>
      <Link className="setup-answer-link" href={fromSetup("/studio/settings/consultation-availability")}>
        Choose my own hours
      </Link>
      {notice ? <small className="setup-answer-notice" role="status">{notice}</small> : null}
    </div>
  );
}

/**
 * "What do you shoot?", answered in place: the inquiry form keeps the types of
 * the kinds ticked (and "General question"), saved through the same command as
 * the form editor. Weddings start ticked; nothing is saved until Save. A kind
 * the trade's starting form doesn't have is added to it
 * (features/setup/work-kinds.ts) — it used to be dropped without a word.
 */
function WorkAnswer({ onAnswered, primary }: { onAnswered: () => void; primary: boolean }) {
  // Each trade's kinds of work, by what its forms cover
  // (docs/new-job-kinds-execution-plan-2026-10-15.md): a DJ plays the parties,
  // a beauty studio does the getting ready, a planner plans the celebrations.
  const trade = tradeOf(useWorkspace().tenantTrade);
  const beauty = trade === "makeup" || trade === "hair";
  const kinds = setupOfferedKinds(trade);
  // The first kind (weddings) starts ticked.
  const [chosen, setChosen] = useState<JobKind[]>([JOB_KINDS[0]]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = (kind: JobKind) =>
    setChosen((current) => (current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]));
  return (
    <div className="setup-answer-row setup-kinds">
      <div className="setup-kind-options" role="group" aria-label={trade === "dj" ? "What you play" : beauty ? "What you work" : "What you shoot"}>
        {kinds.map((kind) => (
          <label className="form-checkbox" key={kind}>
            <input checked={chosen.includes(kind)} onChange={() => toggle(kind)} type="checkbox" />
            <span>
              {trade === "dj" && kind === "other"
                ? "Parties and other events"
                : beauty && kind === "other"
                  ? "Special events"
                  : JOB_KIND_LABELS[kind]}
            </span>
          </label>
        ))}
      </div>
      <button
        className={buttonClass(primary)}
        disabled={busy || chosen.length === 0}
        onClick={() => {
          setBusy(true);
          setNotice(null);
          const config = inquiryFormForKinds(trade, chosen);
          runCrmCommand("setInquiryForm", { config })
            .then(() => onAnswered())
            .catch((caught: unknown) => setNotice(friendlyError(caught, "That couldn't be saved. Try again.")))
            .finally(() => setBusy(false));
        }}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
        Save
      </button>
      {notice ? <small className="setup-answer-notice" role="status">{notice}</small> : null}
    </div>
  );
}

/**
 * Google Calendar, offered where it matters: beside the hours it keeps honest.
 * Connecting comes back here (the OAuth flow's returnTo), not to Integrations.
 */
function CalendarConnect({ connected }: { connected: boolean }) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (connected)
    return (
      <p className="setup-calendar is-connected">
        <CalendarCheck size={14} /> Google Calendar connected — busy times are never offered.
      </p>
    );
  return (
    <p className="setup-calendar">
      <CalendarCheck size={14} />
      <button
        className="setup-answer-link"
        disabled={busy || !workspace.tenantId}
        onClick={() => {
          if (!workspace.tenantId) return;
          setBusy(true);
          setNotice(null);
          startProviderConnect("google_calendar", workspace.tenantId, "/studio/setup")
            .then((url) => window.location.assign(url))
            .catch((caught: unknown) => {
              setNotice(friendlyError(caught, "Google Calendar couldn't be connected. Try Integrations."));
              setBusy(false);
            });
        }}
        type="button"
      >
        {busy ? "Opening Google…" : "Connect Google Calendar"}
      </button>
      <span>(optional)</span>
      {notice ? <small className="setup-answer-notice" role="status">{notice}</small> : null}
    </p>
  );
}

/**
 * StudioCue's own inquiry form — the other way in, for a studio without a
 * website form of its own. It said "Share this link" with no link to share:
 * only a Preview. Now the full address copies in one tap. It sat under the
 * last question, apart from "How do inquiries reach you?"; it is one of the
 * answers to it, so it lives there now (onboarding audit, 2026-10-24).
 */
function HostedFormLink({ slug, onCopied }: { slug: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  // Where the clipboard is refused (an in-app browser, a denied permission),
  // the link is shown to copy by hand: the button did nothing at all.
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const path = `/inquiry?studio=${encodeURIComponent(slug)}`;
  return (
    <div className="setup-hosted-form">
      <p>
        <strong>No form of your own?</strong>{" "}
        StudioCue&apos;s inquiry form is already live — link to it from your website, Instagram or
        email signature.
      </p>
      <div className="setup-answer-row">
        <button
          className="button button-light button-sm"
          onClick={() => {
            const url = `${window.location.origin}${path}`;
            const showIt = () => {
              setManualUrl(url);
              onCopied?.();
            };
            const writing = navigator.clipboard?.writeText(url);
            if (!writing) return showIt();
            void writing
              .then(() => {
                setCopied(true);
                onCopied?.();
                window.setTimeout(() => setCopied(false), 2000);
              })
              .catch(showIt);
          }}
          type="button"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy your form link"}
        </button>
        <Link className="setup-answer-link" href={`${path}&preview=studio`} prefetch={false} target="_blank">
          Preview <ExternalLink size={13} />
        </Link>
      </div>
      {manualUrl ? (
        <input
          aria-label="Your inquiry form link"
          className="setup-hosted-url"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={manualUrl}
        />
      ) : null}
    </div>
  );
}

/** "I send my own agreement": the answer, saved in one tap. */
function SendOwnAgreement({ onAnswered, primary }: { onAnswered: () => void; primary: boolean }) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="setup-question-answer">
      <button
        className={buttonClass(primary)}
        disabled={busy || !workspace.tenantId}
        onClick={() => {
          if (!workspace.tenantId) return;
          setBusy(true);
          setNotice(null);
          setSignatureMode("record_own", workspace.tenantId)
            .then(() => onAnswered())
            .catch((caught: unknown) => {
              setNotice(friendlyError(caught, "That couldn't be saved. Try again."));
            })
            .finally(() => setBusy(false));
        }}
        type="button"
      >
        {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
        I send my own agreement
      </button>
      {notice ? <small role="status">{notice}</small> : null}
    </div>
  );
}
