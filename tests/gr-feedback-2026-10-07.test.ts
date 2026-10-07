import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bookingSteps } from "@/features/client/booking-steps";
import { StructuredContentPreview } from "@/components/ai/structured-content-fields";
import { withoutShownIssues } from "@/components/ai/ai-approval-queue";

/** Gabe and Albert's test, 2026-10-07: the three asks after the email fixes. */
const read = (path: string) => readFileSync(path, "utf8");

test("an approved reply closes its card with the one click, and the shell says it went", () => {
  const card = read("components/ai/ai-approval-queue.tsx");
  // No second "Queued to send" / Done step after a send that went.
  assert.doesNotMatch(card, /dispatched \? "Queued to send"/);
  assert.match(card, /if \(sending && result\.alreadyDecided !== true && result\.emailQueued === true\) \{/);
  assert.match(card, /\.\.\.\(sending \? \{ holdForUndo: true \} : \{\}\)/);
  assert.match(card, /else announceHeldSend\(held \?\? \{ label \}\);\s+onDecision\(action\.id, decision\);/);
  // Mounted once, so every place the card appears gets the banner.
  assert.match(read("components/layout/app-shell.tsx"), /<HeldSendStack \/>/);
  // Today keeps its own stack, which brings its card back on Undo.
  assert.match(read("components/today/today-inbox.tsx"), /onHeld=\{\(send\) => \{/);
  // The banner names who it really went to (a corrected address, too).
  assert.match(read("functions/src/ai/actions.ts"), /recipient: emailJobId \? recipient : null,/);
});

const questionnaireReview = {
  status: "ready",
  summary: "The planning questionnaire for the Gabriel Rhodes Wedding has been reviewed.",
  missingInformation: ["Travel plans between the separate prep locations"],
  contradictions: ["Photo 1 / Video 1 coverage ends at 22:30 but the reception runs until 23:00"],
  planningRisks: ["Two prep locations 40 minutes apart", "Sunset falls during cocktail hour"],
  suggestedQuestions: ["Who is riding with the groom?", "Can the first look move earlier?"],
  humanReviewRequired: true,
  generatedAt: "2026-10-07T15:27:58.339Z",
  modelMode: "vertex",
};

test("a questionnaire review reads as findings, with none of the record's bookkeeping", () => {
  const html = renderToStaticMarkup(createElement(StructuredContentPreview, { value: questionnaireReview }));
  for (const hidden of ["Model Mode", "vertex", "Human Review Required", "Generated At", "2026-10-07T15", ">Status<", ">ready<", "items"]) {
    assert.doesNotMatch(html, new RegExp(hidden), hidden);
  }
  assert.match(html, /Gabriel Rhodes Wedding has been reviewed/);
  assert.match(html, /Worth checking/);
  assert.match(html, /<li>Sunset falls during cocktail hour<\/li>/);
  assert.match(html, /You could ask them/);
  assert.match(html, /<li>Who is riding with the groom\?<\/li>/);
});

test("what already shows as a warning is not printed again below it", () => {
  const issues = [
    { severity: "warning", message: "Travel plans between the separate prep locations" },
    { severity: "warning", message: "Photo 1 / Video 1 coverage ends at 22:30 but the reception runs until 23:00" },
  ];
  const html = renderToStaticMarkup(
    createElement(StructuredContentPreview, { value: withoutShownIssues(questionnaireReview, issues) }),
  );
  assert.doesNotMatch(html, /Still missing/);
  assert.doesNotMatch(html, /Doesn&#x27;t line up|Doesn't line up/);
  assert.match(html, /Worth checking/);
});

test("event times in prepared work are content, not bookkeeping", () => {
  const html = renderToStaticMarkup(
    createElement(StructuredContentPreview, { value: { title: "First look", startsAt: "3:15 PM" } }),
  );
  assert.match(html, /3:15 PM/);
});

test("after accepting, the couple is told to check their email for the agreement", () => {
  const waiting = bookingSteps({ proposalStatus: "accepted", contractStatus: null, retainer: null });
  assert.match(waiting.next.detail, /Check your email/);
  const sent = bookingSteps({ proposalStatus: "accepted", contractStatus: "sent", retainer: null });
  assert.equal(sent.next.actionLabel, "Sign your agreement");
  assert.match(sent.next.detail, /emailed you the link/);
  const proposal = read("components/client/kit/client-proposal.tsx");
  assert.match(proposal, /check your email for the link to sign it/);
  assert.doesNotMatch(proposal, /Your studio can now prepare the agreement/);
});

test("accepting re-reads the whole page, so the next step stops asking them to accept", () => {
  const proposal = read("components/client/kit/client-proposal.tsx");
  assert.match(proposal, /refreshClientRecords\(\);\s+window\.setTimeout\(refreshClientRecords, 4_000\);/);
  const views = read("components/client/live-client-views.tsx");
  assert.match(views, /window\.addEventListener\(CLIENT_RECORDS_REFRESH, refresh\)/);
});
