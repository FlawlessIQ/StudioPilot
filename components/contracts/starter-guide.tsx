"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import {
  fillStarterBlank,
  leaveOutStarterSection,
  starterBlanks,
  starterQuestion,
} from "@/features/contracts/starter-blanks";

/**
 * "Finish your agreement": the starter's blanks as questions, one at a time
 * (features/contracts/starter-blanks.ts). Each answer goes straight into the
 * agreement, so the text beside it and the preview show it at once, and the
 * studio still reads and saves the whole thing itself.
 */
export function StarterGuide({
  body,
  onChange,
  startedWith,
  trade,
}: {
  body: string;
  onChange: (body: string) => void;
  /** How many blanks the agreement had when it was opened: "all 3 done". */
  startedWith: number;
  trade: unknown;
}) {
  const blanks = useMemo(() => starterBlanks(body), [body]);
  const [chosen, setChosen] = useState(0);
  const current = blanks[Math.min(chosen, blanks.length - 1)] ?? null;
  const question = current ? starterQuestion(current, trade) : null;
  // What's typed for each section, kept while the studio looks at another.
  // A section starts empty: the example is offered, never typed in for them.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const currentKey = current ? `${current.heading}:${current.hint}` : "";
  const draft = drafts[currentKey] ?? "";
  const setDraft = (text: string) => setDrafts((all) => ({ ...all, [currentKey]: text }));

  if (!startedWith) return null;
  if (!current || !question) {
    return (
      <section className="panel starter-guide is-done" aria-label="Finish your agreement">
        <CheckCircle2 aria-hidden size={18} />
        <div>
          <h2>Every section is filled in</h2>
          <p>Read the whole agreement through in the preview, change anything you like, then save it.</p>
        </div>
      </section>
    );
  }

  const done = startedWith - blanks.length;
  const put = (text: string) => {
    onChange(fillStarterBlank(body, current, text));
    setChosen(0);
  };

  return (
    <section className="panel starter-guide" aria-label="Finish your agreement">
      <div className="starter-guide-heading">
        <p className="eyebrow">{`Finish your agreement · ${done} of ${startedWith} done`}</p>
        <h2>{blanks.length === 1 ? "One section only you can write" : `${blanks.length} sections only you can write`}</h2>
        <p>
          The services, the price and the payments fill themselves from each job. These are your own terms. Start from
          the example if it fits and change anything, or write your own.
        </p>
      </div>
      {blanks.length > 1 ? (
        <div className="starter-guide-steps" role="group" aria-label="Sections to fill in">
          {blanks.map((blank, index) => (
            <button
              aria-pressed={blank === current}
              className="schedule-moment-chip"
              key={`${blank.heading}:${blank.hint}:${blank.index}`}
              onClick={() => setChosen(index)}
              type="button"
            >
              {blank.heading && !blanks.some((other) => other !== blank && other.heading === blank.heading)
                ? blank.heading
                : starterQuestion(blank, trade).ask.replace(/\?$/, "")}
            </button>
          ))}
        </div>
      ) : null}
      <div className="starter-guide-question">
        {current.heading ? <small>{current.heading}</small> : null}
        <label>
          <strong>{question.ask}</strong>
          {question.short ? (
            <input maxLength={120} onChange={(event) => setDraft(event.target.value)} type="text" value={draft} />
          ) : (
            <textarea onChange={(event) => setDraft(event.target.value)} rows={5} value={draft} />
          )}
        </label>
        {question.example ? (
          <div className="starter-guide-example">
            <p>{question.example}</p>
            <button className="button button-light" onClick={() => setDraft(question.example ?? "")} type="button">
              Start from this example
            </button>
            <small>Common terms to start from, not legal advice. Make sure they say what you mean.</small>
          </div>
        ) : null}
        <div className="agreement-editor-actions">
          <button className="button button-dark" disabled={!draft.trim()} onClick={() => put(draft)} type="button">
            Put it in your agreement <ArrowRight aria-hidden size={15} />
          </button>
          {current.wholeSection ? (
            <button
              className="setup-answer-link"
              onClick={() => {
                onChange(leaveOutStarterSection(body, current));
                setChosen(0);
              }}
              type="button"
            >
              Leave this section out
            </button>
          ) : question.optional ? (
            <button className="setup-answer-link" onClick={() => put("")} type="button">
              We don&rsquo;t, leave it out
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
