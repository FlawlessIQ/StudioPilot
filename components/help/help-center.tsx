"use client";

import Link from "next/link";
import {
  ArrowRight,
  CircleGauge,
  ClipboardCheck,
  ExternalLink,
  FolderKanban,
  Sparkles,
  Wand2,
} from "lucide-react";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { JourneyFilmTeaser, useOffersWeddingFilm } from "@/components/help/journey-film";
import { GlossaryList, GuideLibrary } from "@/components/help/guide-library";
import { YourFeedback } from "@/components/feedback/your-feedback";
import { useWorkspace } from "@/features/auth/workspace-context";
import { helpTrade, type HelpTrade } from "@/features/help/types";

/**
 * The workspace had no Help, Docs, or Support entry, and nothing in-app mapped
 * the Today → Jobs → project lifecycle or defined "readiness" / "booking gate".
 * This hub is that standing reference: the getting-started checklist, a plain
 * explanation of how StudioCue works, and a push toward Cue for anything else.
 */

type Concept = {
  icon: typeof CircleGauge;
  title: string;
  body: string;
};

/**
 * In the studio's trade's words (features/trades/trades.ts): a makeup artist
 * sends quotes, and a trade with nothing to deliver has no delivery phase.
 */
const concepts = ({ words, has }: HelpTrade): Concept[] => [
  {
    icon: CircleGauge,
    title: "Today is your inbox",
    body: "Everything that needs a decision, ranked by what it costs to wait — and everything StudioCue already handled for you. Start each day here; if nothing is waiting, nothing is wrong.",
  },
  {
    icon: FolderKanban,
    title: "Every client is a Job",
    body: `A Job is one client's whole story — inquiry, ${words.proposal.toLowerCase()}, booking, planning, the event, ${has.delivery ? "delivery, " : ""}and closeout — moving through those phases in order. Open a Job to see where it is and the one next move.`,
  },
  {
    icon: Wand2,
    title: "Cue prepares, you approve",
    body: `StudioCue drafts the emails, ${words.proposal.toLowerCase()}s, and next steps and hands them to you to review. Nothing is sent and no status changes until you tap approve — you keep every consequential decision.`,
  },
  {
    icon: ClipboardCheck,
    title: "Readiness & the booking gate",
    body: "Readiness is the checklist a booked job must clear before the event — contract signed, deposit paid, crew accepted, questionnaire complete. The booking gate is the one that turns a job Booked, and it only flips on real evidence: a signed contract and a retainer (or a signature you record yourself).",
  },
];

export function HelpCenter() {
  // The film is a photographer's wedding (useOffersWeddingFilm).
  const shootsWeddings = useOffersWeddingFilm();
  const trade = helpTrade(useWorkspace().tenantTrade);
  return (
    <div className="post-event-page help-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Help &amp; guides</p>
          <h1>Getting started with StudioCue</h1>
          <p>
            New here? Finish the essentials below, then pick a guide. Every
            screen also has a How to button at the top that opens the guide for
            what you&rsquo;re looking at — and Cue can walk you through anything
            else.
          </p>
        </div>
      </header>

      {/* The film first, for a studio that shoots weddings: the year ahead in
          six minutes, before the checklist asks them to configure it. */}
      {shootsWeddings ? (
        <section className="help-section">
          <p className="eyebrow">Start here</p>
          <div className="panel help-film">
            <JourneyFilmTeaser
              pageHref="/studio/help/journey"
              text="Inquiry to album: what StudioCue does by itself, what you approve, and what your couple and crew see at each stage."
              title="A wedding, start to finish"
            />
          </div>
        </section>
      ) : null}

      <section className="help-section">
        <p className="eyebrow">Set up your studio</p>
        <SetupChecklist />
      </section>

      <section className="help-section" id="guides">
        <p className="eyebrow">Guides</p>
        <GuideLibrary audience="studio" />
      </section>

      <section className="help-section">
        <p className="eyebrow">How StudioCue works</p>
        <div className="help-concepts">
          {concepts(trade).map((concept) => {
            const Icon = concept.icon;
            return (
              <article className="panel help-concept" key={concept.title}>
                <span className="help-concept-icon">
                  <Icon aria-hidden="true" />
                </span>
                <div>
                  <h2>{concept.title}</h2>
                  <p>{concept.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="help-section" id="glossary">
        <p className="eyebrow">Words to know</p>
        <GlossaryList audience="studio" />
      </section>

      <section className="help-section" id="feedback">
        <p className="eyebrow">Your feedback</p>
        <YourFeedback />
      </section>

      <section className="help-section">
        <p className="eyebrow">Still stuck?</p>
        <div className="help-links">
          <Link className="panel help-link is-primary" href="/studio/copilot">
            <span className="help-link-icon">
              <Sparkles aria-hidden="true" />
            </span>
            <div>
              <strong>Ask Cue how to do anything</strong>
              <small>
                &ldquo;How do I book a client?&rdquo;, &ldquo;How do I staff{" "}
                {trade.has.family === "photo" ? "a second shooter" : `another ${trade.words.member}`}?&rdquo;
                {" "}— Cue explains the steps and can prepare the work for you to approve.
              </small>
            </div>
            <ArrowRight className="help-link-arrow" aria-hidden="true" />
          </Link>
          <Link
            className="panel help-link"
            href="/support"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="help-link-icon">
              <ExternalLink aria-hidden="true" />
            </span>
            <div>
              <strong>Support &amp; documentation</strong>
              <small>Guides and contact, opens in a new tab.</small>
            </div>
            <ArrowRight className="help-link-arrow" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
