"use client";

import Link from "next/link";
import { SalesTaxQuestion } from "@/components/integrations/sales-tax-question";
import { useStudioJobTypes } from "@/components/job-kinds/use-studio-job-types";
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
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { JourneySetupBanner } from "@/components/help/journey-film";
import { useSetupState } from "@/components/setup/use-setup-state";
import { LeadCaptureRoutes } from "@/components/intake/lead-capture-setup";
import { fromSetup } from "@/components/setup/back-to-setup";
import { setSignatureMode, startProviderConnect } from "@/lib/integrations/command-client";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  INQUIRY_FORM_SETTING_HREF,
  SETUP_ORDER,
  setupQuestionCount,
  type SetupGap,
  type SetupGapKey,
} from "@/features/today/setup-gaps";
import { InquiryEventFormSetting } from "@/components/planning/inquiry-event-form-setting";
import { JOB_KIND_LABELS, JOB_KINDS, type JobKind } from "@/features/job-kinds/job-kinds";
import { defaultInquiryFormConfig } from "@/features/leads/inquiry-form-config";
import { runCrmCommand } from "@/lib/crm/command-client";

/**
 * Setup as a conversation.
 *
 * Phase 3 of "Today & Jobs". A new studio's assets already exist somewhere —
 * a price list, a contract, a questionnaire — so setup asks seven questions
 * and hands each answer to the import machinery, rather than presenting a
 * library of tools to discover. Most are answered right on this page: the
 * inquiry routes open their sheets here, hours take one tap, the agreement
 * answer is one tap, and the details form starts answered. Every question is
 * skippable: what is skipped comes back in Today when it blocks real work.
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
    why: "Venues often want one. Save your agent (or your insurer's portal) and StudioCue asks for it once a job is booked, follows up, and brings it back for one approval. Skip it if venues never ask.",
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
  "Bring in the agreement you already use. StudioCue writes each client's contract from it, with their details and the price they accepted, and they sign in their portal.";

// Forms are in; the question left is which one the first reply's link asks for.
const INQUIRY_FORM_WHY =
  "Your forms are in. Choose the one your first reply's link asks for, and new clients fill it in before they pick a time to talk — so you have it for the call.";

// Asked in the one shared order Today's "Next:" also follows.
const ORDERED = SETUP_ORDER.map((key) => QUESTIONS.find((question) => question.key === key)!);

const IMPORT_PRICES = fromSetup("/studio/import?kind=Package");
const IMPORT_FORM = fromSetup("/studio/import?kind=Questionnaire");

export function SetupConversation() {
  const shootsWeddings = useStudioJobTypes().some((type) => type.kind === "wedding");
  const workspace = useWorkspace();
  const { gaps, complete, loading, refresh, calendarConnected } = useSetupState();
  const gapByKey = new Map(gaps.map((gap) => [gap.key, gap]));
  const answered = QUESTIONS.length - gaps.length;
  // `complete` is "ready to take bookings" (setupComplete), which leaves out
  // insurance on purpose. The page said "Your studio is set up." over "5 of 6
  // answered"; now it only says that when every question is answered.
  const allAnswered = !loading && gaps.length === 0;

  /** What a question offers when it isn't answered yet. */
  const answer = (question: Question, gap: SetupGap): ReactNode => {
    switch (question.key) {
      case "work":
        return <WorkAnswer onAnswered={refresh} />;
      case "inquiries":
        // Answered in place: the three routes open their sheets here.
        return <LeadCaptureRoutes />;
      case "availability":
        return <HoursAnswer onAnswered={refresh} />;
      case "packages":
        return (
          <div className="setup-answer-row">
            <Link className="button button-dark" href={IMPORT_PRICES}>
              Paste or upload your prices <ArrowRight size={14} />
            </Link>
            <Link className="setup-answer-link" href={fromSetup("/studio/packages/new")}>
              Add one by hand
            </Link>
          </div>
        );
      case "agreement":
        return gap.href === NATIVE_AGREEMENT_HREF ? (
          <div className="setup-answer-row">
            <Link className="button button-dark" href={fromSetup(gap.href)}>
              {gap.actionLabel} <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          /* It linked to Integrations, where no signing app is offered: a
             dead end, and the one step setup could never tick. */
          <SendOwnAgreement onAnswered={refresh} />
        );
      case "questionnaire":
        // Forms are in; what's left is which one the inquiry link asks for.
        if (gap.href === INQUIRY_FORM_SETTING_HREF) return <InquiryEventFormSetting onSaved={refresh} />;
        return (
          <div className="setup-answer-row">
            <Link className="button button-dark" href={IMPORT_FORM}>
              Paste or upload your form <ArrowRight size={14} />
            </Link>
          </div>
        );
      case "insurance":
        return (
          <div className="setup-answer-row">
            <Link className="button button-dark" href={fromSetup("/studio/settings/insurance")}>
              Save who sends them <ArrowRight size={14} />
            </Link>
          </div>
        );
    }
  };

  /** What an answered question still offers. */
  const afterwards = (question: Question): ReactNode => {
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
        {/* Weddings only, like every way into the journey film. */}
        {shootsWeddings ? <JourneySetupBanner /> : null}
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
                : `${setupQuestionCount().replace(/^./, (first) => first.toUpperCase())} questions about how your studio runs, most answered right here. Skip anything; Cue will bring it back when a job actually needs it.`}
          </p>
          {!loading ? (
            <p className="setup-progress">
              {answered} of {QUESTIONS.length}{" "} answered
            </p>
          ) : null}
        </header>

        <ol className="setup-questions">
          {ORDERED.map((question, index) => {
            const gap = gapByKey.get(question.key);
            const done = !gap;
            return (
              <li
                className={done ? "is-done" : gap?.blocking ? "is-blocking" : ""}
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
                  <strong>{question.ask}</strong>
                  <p>
                    {done
                      ? question.doneLabel
                      : question.key === "agreement" &&
                          gap?.href === NATIVE_AGREEMENT_HREF
                        ? NATIVE_AGREEMENT_WHY
                        : gap?.href === INQUIRY_FORM_SETTING_HREF
                          ? INQUIRY_FORM_WHY
                          : question.why}
                  </p>
                  {gap?.blocking ? (
                    <span className="setup-blocking">
                      <CircleAlert size={12} /> {gap.detail}
                    </span>
                  ) : null}
                  {!loading && gap ? answer(question, gap) : null}
                  {!loading && done ? afterwards(question) : null}
                  {/* Beside the hours it decides, answered or not; optional,
                      so it never counts towards the five. */}
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

        {workspace.tenantSlug ? <HostedFormLink slug={workspace.tenantSlug} /> : null}

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
function HoursAnswer({ onAnswered }: { onAnswered: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="setup-answer-row">
      <button
        className="button button-dark"
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
 * the form editor. Weddings start ticked; nothing is saved until Save.
 */
function WorkAnswer({ onAnswered }: { onAnswered: () => void }) {
  // The first kind (weddings) starts ticked.
  const [chosen, setChosen] = useState<JobKind[]>([JOB_KINDS[0]]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const toggle = (kind: JobKind) =>
    setChosen((current) => (current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]));
  return (
    <div className="setup-answer-row setup-kinds">
      <div className="setup-kind-options" role="group" aria-label="What you shoot">
        {JOB_KINDS.map((kind) => (
          <label className="form-checkbox" key={kind}>
            <input checked={chosen.includes(kind)} onChange={() => toggle(kind)} type="checkbox" />
            <span>{JOB_KIND_LABELS[kind]}</span>
          </label>
        ))}
      </div>
      <button
        className="button button-dark"
        disabled={busy || chosen.length === 0}
        onClick={() => {
          setBusy(true);
          setNotice(null);
          const base = defaultInquiryFormConfig();
          const config = {
            ...base,
            eventTypes: base.eventTypes.filter(
              (type) => type.kind === "general" || chosen.includes(type.kind as JobKind),
            ),
          };
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
 * only a Preview. Now the full address copies in one tap.
 */
function HostedFormLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/inquiry?studio=${encodeURIComponent(slug)}`;
  return (
    <section className="setup-aside">
      <div>
        <strong>Or use StudioCue&apos;s own inquiry form.</strong>
        <p>
          It&apos;s already live. Paste it into your website (&ldquo;On your
          website&rdquo;, under inquiry capture, has the code) or link to it from
          Instagram, and inquiries arrive in Today with nothing to forward.
        </p>
      </div>
      <div className="setup-aside-actions">
        <button
          className="button button-light button-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(`${window.location.origin}${path}`).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
          type="button"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <Link href={`${path}&preview=studio`} target="_blank">
          Preview <ExternalLink size={13} />
        </Link>
      </div>
    </section>
  );
}

/** "I send my own agreement": the answer, saved in one tap. */
function SendOwnAgreement({ onAnswered }: { onAnswered: () => void }) {
  const workspace = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="setup-question-answer">
      <button
        className="button button-dark"
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
