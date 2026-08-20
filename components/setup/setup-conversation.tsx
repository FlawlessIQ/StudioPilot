"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { useSetupState } from "@/components/setup/use-setup-state";
import { useWorkspace } from "@/features/auth/workspace-context";
import type { SetupGapKey } from "@/features/today/setup-gaps";

/**
 * Setup as a conversation.
 *
 * Phase 3 of "Today & Jobs". A new studio's assets already exist somewhere —
 * a price list, a contract, a questionnaire — so setup asks four questions
 * and hands each answer to the import machinery, rather than presenting a
 * library of tools to discover. Every question is skippable: what is skipped
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
    key: "packages",
    ask: "What do you charge?",
    why: "Paste or upload your price list and StudioCue drafts your packages — you confirm every price. Nothing is invented.",
    doneLabel: "Your packages are ready to use in proposals.",
  },
  {
    key: "agreement",
    ask: "What agreement do your clients sign?",
    why: "Import it once. StudioCue keeps your wording and signer fields, then reuses it for every client.",
    doneLabel: "Your agreement is ready to send.",
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

export function SetupConversation() {
  const workspace = useWorkspace();
  const { gaps, complete, loading } = useSetupState();
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
              : "Four questions. You already have the answers — most of them are a document you can paste. Skip anything; StudioCue will bring it back when a job actually needs it."}
          </p>
          {!loading ? (
            <p className="setup-progress">
              {answered} of {QUESTIONS.length} answered
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
                  <p>{done ? question.doneLabel : question.why}</p>
                  {gap?.blocking ? (
                    <span className="setup-blocking">
                      <CircleAlert size={12} /> {gap.detail}
                    </span>
                  ) : null}
                </div>
                {!done && gap ? (
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

        <section className="setup-aside">
          <div>
            <strong>Your inquiry form is already live.</strong>
            <p>
              Share this link and inquiries arrive in Today, read and ready to
              reply to.
            </p>
          </div>
          {workspace.tenantSlug ? (
            <Link
              href={`/inquiry?studio=${encodeURIComponent(workspace.tenantSlug)}`}
              target="_blank"
            >
              Preview it <ExternalLink size={13} />
            </Link>
          ) : null}
        </section>

        <p className="setup-footnote">
          Prefer to wander? Everything here also lives in{" "}
          <Link href="/studio/library">your library</Link> and{" "}
          <Link href="/studio/integrations">integrations</Link>.
        </p>
      </div>
    </AppShell>
  );
}
