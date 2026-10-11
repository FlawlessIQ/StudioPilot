import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { generateProposalDraft, proposalDraftInstruction } from "../functions/src/ai/copilot.js";
import { fallbackDraft } from "../functions/src/ai/message-draft.js";
import { tradeVocab } from "../functions/src/trades/trades";

/**
 * Cue drafts in the studio's own trade, everywhere it drafts.
 *
 * "Draft from what they told you" on a hair studio's quote wrote "We are
 * delighted to put together your proposal for Bridal hair" (Priya Shah, Jess
 * Styles Bridal, 2026-10-10). tradeInstruction() already said "Call the
 * proposal a quote" — the proposal-copy prompt just never appended it, and nor
 * did the consultation brief, the questionnaire follow-up, the reply to a
 * client's message or the run-of-show. A photographer's prompts and fallbacks
 * read exactly as they did.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `missing after ${from}: ${to}`);
  return source.slice(start, end);
};

// --- every model call is either a drafting route in the trade's words, or an extraction

/** Calls that only read a document or a message into fields; nobody else reads their output. */
const EXTRACTION_ONLY: Record<string, string> = {
  "functions/src/ai/signed-agreement.ts": "reads a signed agreement into fields",
  "functions/src/ai/timing-rules.ts": "learns the studio's own timing rules",
  "functions/src/intake/enrich.ts": "fills an inquiry's empty fields from its message",
  "functions/src/planning/questionnaire-fact-map.ts": "maps form fields to job facts",
  "functions/src/studio-import/extraction.ts": "reads imported bookings",
};
const TRANSPORT = new Set(["functions/src/ai/vertex-endpoint.ts", "functions/src/ai/vertex-transport.ts"]);
const TRADE_AWARE = /tradeInstruction\(|inquiryReplySystemInstruction\(|messageDraftSystemInstruction\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

test("every model call that writes for a client or the crew is told the studio's trade", () => {
  const callers = sources("functions/src").filter(
    (path) => !TRANSPORT.has(path) && /vertexEndpoint\(|vertexGenerate\(/.test(readFileSync(path, "utf8")),
  );
  assert.ok(callers.length >= 10, "the scan found the model calls");
  for (const path of callers) {
    if (EXTRACTION_ONLY[path]) continue;
    assert.match(readFileSync(path, "utf8"), TRADE_AWARE, `${path} drafts without the studio's trade`);
  }
});

test("the quote composer's draft carries the trade instruction", () => {
  const copilot = read("functions/src/ai/copilot.ts");
  assert.match(
    between(copilot, "export function proposalDraftInstruction(", "\n}\n"),
    /tradeInstruction\(trade\)/,
  );
  const draft = between(copilot, "export async function generateProposalDraft(", "export const aiCopilotCommand");
  assert.match(draft, /text: proposalDraftInstruction\(facts\.trade\),/);
  // The trade comes from the tenant, not the browser.
  assert.match(
    between(copilot, 'kind === "proposal_drafting"', 'kind === "list_threads"'),
    /trade: tenantDocument\.get\("trade"\),/,
  );

  const hair = proposalDraftInstruction("hair");
  assert.ok(hair.startsWith("Write quote copy for a hair business, grounded ONLY"));
  assert.match(hair, /Call the proposal a quote\./);
  assert.match(hair, /Never offer to schedule a consultation/);
  assert.match(proposalDraftInstruction("makeup"), /Call the proposal a quote\./);
  assert.match(proposalDraftInstruction("dj"), /vibe call/);
  // A photographer's prompt is what it was.
  const photo = proposalDraftInstruction("photographer");
  assert.ok(photo.startsWith("Write proposal copy for a photography studio, grounded ONLY"));
  assert.ok(photo.endsWith("Return JSON only."));
  assert.doesNotMatch(photo, /not a photography studio/);
  assert.equal(proposalDraftInstruction(undefined), photo);
});

test("the brief, the questionnaire follow-up and the reply to a client are drafted in the trade", () => {
  const worker = read("functions/src/operations/ai-pdf.ts");
  const brief = between(worker, "async function runConsultationAnalysis(", "async function runQuestionnaireAnalysis(");
  const questionnaire = between(worker, "async function runQuestionnaireAnalysis(", "async function runInboundReplyDraft(");
  const inbound = between(worker, "async function runInboundReplyDraft(", "\n}\n");
  for (const [name, body] of [["brief", brief], ["questionnaire", questionnaire], ["inbound reply", inbound]] as const) {
    assert.match(body, /tenantTrade\(db,\s*(string\(job\.get\("tenantId"\)\)|tenantId)\)/, name);
    assert.match(body, /tradeInstruction\(trade\)/, name);
  }
  // The first reply to an inquiry already was (studio-voice.ts).
  assert.match(worker, /inquiryReplySystemInstruction\(\{[^}]*trade:tenant\.get\("trade"\)\}\)/);
  // No prompt names photography for every studio any more.
  assert.doesNotMatch(worker, /"Analyze photography consultation notes/);
  assert.doesNotMatch(worker, /"Review a photography planning questionnaire/);
  assert.doesNotMatch(worker, /"Draft one reply from a photography studio/);
});

/** Renders a `${words.x}` / `${words.x.toLowerCase()}` template from the source in a trade's words. */
function render(template: string, trade: unknown): string {
  const words = tradeVocab(trade) as unknown as Record<string, unknown>;
  return template.replace(/\$\{words\.(\w+)(\.toLowerCase\(\))?\}/g, (_match, key: string, lower?: string) => {
    const value = String(words[key]);
    return lower ? value.toLowerCase() : value;
  });
}

test("a photographer's prompts read exactly as they did", () => {
  const worker = read("functions/src/operations/ai-pdf.ts");
  const template = (from: string) => between(worker, from, "`+tradeInstruction(trade)").slice(1);
  assert.equal(
    render(template("`Analyze "), "photographer"),
    "Analyze photography consultation notes using only supplied project facts and the exact active package catalog. Summarize stated priorities, missing information, and follow-up questions. Recommend only a supplied package id or null. Do not invent pricing, discounts, availability, deliverables, legal terms, or client agreement. Draft a short proposal introduction in the studio's professional voice. All outputs require human review.",
  );
  assert.equal(
    render(template("`Review a "), "photographer"),
    "Review a photography planning questionnaire using only supplied facts. Identify missing information, possible contradictions, operational planning risks, and suggested follow-up questions. Also draft a concise, warm follow-up email that asks only the necessary supplied follow-up questions; its body must not include a greeting or sign-off. Do not invent dates, contacts, prices, legal conclusions, approvals, or completion states. Every result is advisory and requires studio review.",
  );
  const inbound = between(worker, "`Draft one reply from a ", "` +").slice(1);
  assert.equal(
    render(inbound, "photographer"),
    "Draft one reply from a photography studio to its client, answering their most recent message. Use only the supplied facts. Never invent prices, dates, times, links or promises — put anything you would need to guess in missingInformation instead. Do not restate the thread. Never mention AI. Plain text, short paragraphs. A person reviews this before it is sent.",
  );
  // And a hair studio's say so.
  assert.match(render(template("`Analyze "), "hair"), /^Analyze hair consultation notes/);
  assert.match(render(template("`Analyze "), "hair"), /Draft a short quote introduction/);
  assert.match(render(template("`Review a "), "hair"), /^Review a hair planning questionnaire/);
  assert.match(render(inbound, "hair"), /^Draft one reply from a hair business to its client/);
});

test("the run-of-show is drafted in the trade, and a photographer's still says photography and video", () => {
  const schedule = read("functions/src/ai/schedule.ts");
  assert.match(schedule, /momentsInstruction \+\n\s+tradeInstruction\(trade\) \+\n\s+" This is an unapproved draft/);
  assert.match(schedule, /\? "Draft a photography and video run-of-show"\n\s+: `Draft a \$\{tradeVocab\(trade\)\.service\} run-of-show`\) \+\n\s+" from only the supplied facts\./);
  assert.match(schedule, /tenantTrade\(db, input\.tenantId\),/);
  assert.match(schedule, /momentsInstructionFor\(project\.data\(\)\), trade\);/);
});

// --- the deterministic fallbacks use the trade's offer word ---------------------

test("the quote draft's fallback says quote for a hair studio, and proposal for a photographer", async () => {
  const previous = process.env.PROVIDER_MOCK_MODE;
  process.env.PROVIDER_MOCK_MODE = "true";
  try {
    const facts = (trade: unknown, message: string | null) => ({
      studioName: "Jess Styles Bridal",
      trade,
      project: { name: "Priya Shah", eventKind: "wedding", eventDate: "2027-05-22" },
      consultation: { summary: null, priorities: [] },
      inquiry: { message, summary: null },
      packages: [{ packageName: "Bridal hair", terms: null }],
      combinedCoverage: "1 stylist",
    });
    const hair = await generateProposalDraft(facts("hair", null));
    assert.equal(hair.mode, "deterministic");
    assert.match(hair.draft.introduction, /This quote reflects what you shared with us\./);
    assert.doesNotMatch(hair.draft.introduction, /proposal|consultation/i);
    assert.match(hair.draft.termsSummary, /set out in this quote/);
    const told = await generateProposalDraft(facts("hair", "Long hair, a cathedral veil and four bridesmaids."));
    assert.match(told.draft.introduction, /This quote is shaped around what you told us matters most\./);
    const dj = await generateProposalDraft(facts("dj", null));
    assert.match(dj.draft.introduction, /during your vibe call\./);
    const photo = await generateProposalDraft(facts("photographer", null));
    assert.match(photo.draft.introduction, /This proposal reflects the priorities discussed during your consultation\./);
  } finally {
    if (previous === undefined) delete process.env.PROVIDER_MOCK_MODE;
    else process.env.PROVIDER_MOCK_MODE = previous;
  }
});

test("the fallback reply to an inquiry offers a hair studio's quote, not coverage or a call", () => {
  const context = {
    lead: { name: "Priya Shah", eventDate: "2027-05-22", venue: "The Grand" },
    packages: [],
    studio: { name: "Jess Styles Bridal" },
  };
  const hair = fallbackDraft({ trigger: "inquiry_reply", context, trade: "hair" }).body;
  assert.match(hair, /I'd love to put together a quote for the day you have in mind\./);
  assert.match(hair, /If you have any questions, just reply/);
  assert.doesNotMatch(hair, /coverage|a short call|consultation|proposal/i);
  const dj = fallbackDraft({ trigger: "inquiry_reply", context, trade: "dj" }).body;
  assert.match(dj, /Would a short vibe call this week suit\?/);
  assert.doesNotMatch(dj, /coverage/);
  // A photographer's, word for word.
  for (const photo of [
    fallbackDraft({ trigger: "inquiry_reply", context, trade: "photographer" }).body,
    fallbackDraft({ trigger: "inquiry_reply", context }).body,
  ]) {
    assert.match(photo, /I'd love to talk through what coverage would suit the day you have in mind\./);
    assert.match(photo, /Would a short call this week suit\? I'll walk you through how I work/);
  }
  // Every fallback route is handed the tenant's trade.
  const drafts = read("functions/src/ai/message-draft.ts");
  assert.equal((drafts.match(/fallbackDraft\(\{ trigger: input\.trigger, context: input\.context, trade: input\.trade \}\)/g) ?? []).length, 2);
  assert.match(drafts, /fallbackDraft\(\{ trigger: input\.trigger, context, trade: tenant\.get\("trade"\) \}\)/);
});

test("the worker's own fallbacks use the trade's words", () => {
  const worker = read("functions/src/operations/ai-pdf.ts");
  // The first reply: a quote is the next step where there is no sales call.
  assert.match(worker, /const nextStep=tradeProfile\(tenant\.get\("trade"\)\)\.consultation\?`a short \$\{replyWords\.consultation\.toLowerCase\(\)\}`:`your \$\{replyWords\.proposal\.toLowerCase\(\)\}`;/);
  assert.match(worker, /The next step is \$\{nextStep\} so we can confirm/);
  assert.equal((worker.match(/\|\|replyWords\.service\} inquiry`/g) ?? []).length, 2);
  // The brief's introduction names the trade's own call.
  assert.match(worker, /priorities discussed during your \$\{words\.consultation\.toLowerCase\(\)\}\.`/);
  // The follow-up names the trade's plan of the day; a photographer's is the photography timeline.
  assert.match(worker, /begin preparing your \$\{dayPlan\}\.`/);
  assert.equal(tradeVocab("photographer").planOfDay, null);
  assert.equal(tradeVocab("photographer").service, "photography");
  assert.equal(tradeVocab("hair").planOfDay, "Getting-ready schedule");
  // A reply with no subject: a photographer's as before, nobody else's "your photography".
  assert.match(worker, /\(tradeProfile\(trade\)\.family === "photo" \? "Re: your photography" : "Re: your message"\)/);
});
