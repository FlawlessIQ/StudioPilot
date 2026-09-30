"use client";

import { EXPLAINERS } from "@/features/help/explainers";
import { glossaryFor } from "@/features/help/glossary";
import { HELP_STAGES, HELP_STAGE_LABELS, type HelpAudience } from "@/features/help/types";
import { GuideLabel } from "@/components/help/how-to";
import { openHowTo } from "@/components/help/how-to-events";

/**
 * Every guide for an audience, grouped by stage. Each card is a real link to
 * its /how-to page; where a How-to popup is mounted (inside the product) the
 * click opens the guide in place instead, so a studio never leaves its work.
 */
export function GuideLibrary({ audience }: { audience: HelpAudience }) {
  const guides = EXPLAINERS.filter((guide) => guide.audience === audience);
  return (
    <div className="help-guides">
      {HELP_STAGES.map((stage) => {
        const inStage = guides.filter((guide) => guide.stage === stage);
        if (!inStage.length) return null;
        return (
          <section className="help-guide-stage" key={stage}>
            <h3>{HELP_STAGE_LABELS[stage]}</h3>
            <ul className="help-guide-grid">
              {inStage.map((guide) => (
                <li key={guide.id}>
                  <a
                    className="help-guide-card"
                    href={`/how-to/${guide.id}`}
                    onClick={(event) => {
                      if (openHowTo(guide.id)) event.preventDefault();
                    }}
                  >
                    <GuideLabel guide={guide} />
                    <small>{guide.summary}</small>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The audience's words, A–Z, each linkable as #term-<id>. */
export function GlossaryList({ audience }: { audience: HelpAudience }) {
  return (
    <dl className="help-glossary">
      {glossaryFor(audience).map((term) => (
        <div id={`term-${term.id}`} key={term.id}>
          <dt>{term.term}</dt>
          <dd>
            {term.hint}{" "}
            {term.explainer ? (
              <a
                href={`/how-to/${term.explainer}`}
                onClick={(event) => {
                  if (term.explainer && openHowTo(term.explainer)) event.preventDefault();
                }}
              >
                Learn more
              </a>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
