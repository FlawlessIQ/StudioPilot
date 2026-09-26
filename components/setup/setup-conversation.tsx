"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { useSetupState } from "@/components/setup/use-setup-state";
import { LeadCaptureRoutes } from "@/components/intake/lead-capture-setup";
import { setSignatureMode } from "@/lib/integrations/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { useWorkspace } from "@/features/auth/workspace-context";
import type { SetupGapKey } from "@/features/today/setup-gaps";

/**
 * Setup as a conversation.
 *
 * Phase 3 of "Today & Jobs". A new studio's assets already exist somewhere —
 * a price list, a contract, a questionnaire — so setup asks five questions
 * and hands each answer to the import machinery, rather than presenting a
 * library of tools to discover. The first is how inquiries reach StudioCue,
 * answered right here in the same sheets Today and Settings use. Every question is skippable: what is skipped
 * comes back in Today at the moment it blocks real work.
 */

type Question = {
  key: SetupGapKey;
  ask: string;
  why: string;
  doneLabel: string;
};

const QUESTIONS: Question[] = [
  {
    /**
     * First, because until inquiries arrive StudioCue has nothing to do. It
     * used to sit under the four questions as a "forward by hand" strip,
     * uncounted, so setup could say "Your studio is set up" with nothing
     * coming in (docs/onboarding-assessment-2026-09-26.md).
     */
    key: "inquiries",
    ask: "How do inquiries reach you?",
    why: "Your website form can send StudioCue a copy, your inbox can pass them on, or you forward one by hand. Each arrives filled in, with a reply drafted.",
    doneLabel: "Inquiries are reaching StudioCue.",
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
     *
     * The same promise sat on the Today card and is fixed there too. This is
     * the one a new studio meets first, which makes it the more expensive of
     * the two.
     */
    key: "agreement",
    ask: "How do your clients sign?",
    why: "StudioCue doesn't write your contract. Most studios send their own and record the signature on the job — if that's you, say so and StudioCue stops asking.",
    doneLabel: "StudioCue knows how you handle signatures.",
  },
  {
    key: "questionnaire",
    ask: "What do you ask couples before the day?",
    why: "Forward the form you already send and confirm the draft — locations, timings, family names.",
    doneLabel: "Your details form is ready to assign.",
  },
  {
    key: "availability",
    ask: "When do you take consultations?",
    why: "Set your hours and clients can pick a time themselves, without the back-and-forth.",
    doneLabel: "Clients can book a time that suits you both.",
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

export function SetupConversation() {
  const workspace = useWorkspace();
  const { gaps, complete, loading, refresh } = useSetupState();
  const gapByKey = new Map(gaps.map((gap) => [gap.key, gap]));
  const answered = QUESTIONS.length - gaps.length;

  return (
    <AppShell active="Studio settings">
      <div className="setup-conversation">
        <header>
          <p className="eyebrow">Getting started</p>
          <h1>
            {complete
              ? "Your studio is set up."
              : "Let's set up your studio."}
          </h1>
          <p className="setup-lede">
            {complete
              ? "Everything StudioCue needs is in place. Change any of it whenever your studio does."
              : "Five questions. You already have the answers — most of them are a document you can paste. Skip anything; StudioCue will bring it back when a job actually needs it."}
          </p>
          {!loading ? (
            <p className="setup-progress">
              {answered} of {QUESTIONS.length}{" "} answered
            </p>
          ) : null}
        </header>

        <ol className="setup-questions">
          {QUESTIONS.map((question, index) => {
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
                        : question.why}
                  </p>
                  {gap?.blocking ? (
                    <span className="setup-blocking">
                      <CircleAlert size={12} /> {gap.detail}
                    </span>
                  ) : null}
                  {/* Answered in place: the three routes open their sheets here. */}
                  {!done && question.key === "inquiries" ? <LeadCaptureRoutes /> : null}
                </div>
                {!done && gap && question.key === "inquiries" ? null : !done &&
                  gap &&
                  question.key === "agreement" &&
                  gap.href !== NATIVE_AGREEMENT_HREF ? (
                  /* It linked to Integrations, where no signing app is offered:
                     a dead end, and the one step setup could never tick. */
                  <SendOwnAgreement onAnswered={refresh} />
                ) : !done && gap ? (
                  <Link className="button button-dark" href={gap.href}>
                    {gap.actionLabel} <ArrowRight size={14} />
                  </Link>
                ) : (
                  <span className="setup-question-done">Done</span>
                )}
              </li>
            );
          })}
        </ol>

        {workspace.tenantSlug ? <HostedFormLink slug={workspace.tenantSlug} /> : null}

        <p className="setup-footnote">
          Prefer to wander? Everything here also lives in{" "}
          <Link href="/studio/library">your library</Link> and{" "}
          <Link href="/studio/integrations">integrations</Link>.
        </p>
      </div>
    </AppShell>
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
        <strong>No website form? Use StudioCue&apos;s.</strong>
        <p>
          It&apos;s already live. Link to it from your website or Instagram and
          inquiries arrive in Today, read and ready to reply to.
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
