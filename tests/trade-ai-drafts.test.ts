import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { generateProposalDraft, proposalDraftInstruction } from "../functions/src/ai/copilot.js";
import { fallbackDraft } from "../functions/src/ai/message-draft.js";
import { runOfShowInstruction } from "../functions/src/ai/schedule.js";
import { draftInstructionVersion } from "../functions/src/operations/ai-pdf.js";
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

// --- every model call is classified, function by function --------------------

/**
 * Every function in functions/src that calls the model or writes its prompt,
 * as `file#function`, and what it is. A draft is read by a client, the crew or
 * the operator, so it must be told the studio's trade; anything else says why
 * it need not.
 *
 * Classified per function, not per file: copilot.ts and ai-pdf.ts each hold
 * several calls, and a file that named the trade anywhere passed for all of
 * them, so a new drafting call added beside an old one would have drafted as a
 * photographer unnoticed (review of the hair walk's fix, 2026-10-10).
 */
const MODEL_CALLS: Record<string, { kind: "draft" | "extraction" | "retrieval" | "transport"; why: string }> = {
  "functions/src/ai/communications.ts#generateCommunication": { kind: "draft", why: "client emails" },
  "functions/src/ai/copilot.ts#finalAnswerBody": { kind: "draft", why: "Cue's answers and the client emails it writes" },
  "functions/src/ai/copilot.ts#generateProposalDraft": { kind: "draft", why: "the quote composer's introduction and terms" },
  "functions/src/ai/copilot.ts#generateIntake": {
    kind: "extraction",
    why: "reads a pasted message into intake fields the studio confirms",
  },
  "functions/src/ai/copilot.ts#runToolLoop": {
    kind: "retrieval",
    why: "picks the records to read and the card to prepare, in the operator's own words; finalAnswerBody writes the answer",
  },
  "functions/src/ai/copilot.ts#generateStructuredOnce": { kind: "transport", why: "sends the body finalAnswerBody built" },
  "functions/src/ai/copilot.ts#streamStructuredBody": { kind: "transport", why: "streams the body finalAnswerBody built" },
  "functions/src/ai/message-draft.ts#generateDraft": { kind: "draft", why: "message drafts and lifecycle emails" },
  "functions/src/ai/schedule.ts#generate": { kind: "draft", why: "the run-of-show the client and crew read" },
  "functions/src/ai/signed-agreement.ts#readWithVertex": { kind: "extraction", why: "reads a signed agreement into fields" },
  "functions/src/ai/timing-rules.ts#propose": { kind: "extraction", why: "learns the studio's own timing rules" },
  "functions/src/intake/enrich.ts#modelExtraction": { kind: "extraction", why: "fills an inquiry's empty fields from its message" },
  "functions/src/operations/ai-pdf.ts#runLeadIntakeAnalysis": { kind: "draft", why: "the first reply to an inquiry" },
  "functions/src/operations/ai-pdf.ts#runConsultationAnalysis": { kind: "draft", why: "the brief's introduction and follow-up questions" },
  "functions/src/operations/ai-pdf.ts#runQuestionnaireAnalysis": { kind: "draft", why: "the questionnaire follow-up email" },
  "functions/src/operations/ai-pdf.ts#runInboundReplyDraft": { kind: "draft", why: "the reply to a client's message" },
  "functions/src/operations/ai-pdf.ts#runAiJob": { kind: "extraction", why: "reads a certificate of insurance into fields" },
  "functions/src/planning/questionnaire-fact-map.ts#askModel": { kind: "extraction", why: "maps form fields to job facts" },
  "functions/src/studio-import/extraction.ts#vertexExtraction": { kind: "extraction", why: "reads imported bookings" },
};
const TRANSPORT = new Set(["functions/src/ai/vertex-endpoint.ts", "functions/src/ai/vertex-transport.ts"]);
/** The trade instruction, or a prompt builder pinned below to append it. */
const TRADE_AWARE =
  /tradeInstruction\(|inquiryReplySystemInstruction\(|messageDraftSystemInstruction\(|proposalDraftInstruction\(/;
/** A top-level function or const, where a model call is named. */
const DECLARATION = /^(?:export )?(?:async )?function\s+(\w+)|^(?:export )?(?:const|let)\s+(\w+)\s*[:=]/gm;
const MODEL_SITE = /vertexEndpoint\(|vertexGenerate\(|systemInstruction\s*:/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Each function that calls the model or writes a prompt: how many of each, and its body. */
function modelFunctions(): Map<string, { calls: number; prompts: number; body: string }> {
  const found = new Map<string, { calls: number; prompts: number; body: string }>();
  for (const path of sources("functions/src")) {
    if (TRANSPORT.has(path)) continue;
    const source = readFileSync(path, "utf8");
    const declarations = [...source.matchAll(DECLARATION)].map((match) => ({
      name: match[1] ?? match[2],
      at: match.index ?? 0,
    }));
    for (const site of source.matchAll(MODEL_SITE)) {
      const at = site.index ?? 0;
      let index = -1;
      for (let candidate = 0; candidate < declarations.length; candidate++) {
        if (declarations[candidate]!.at < at) index = candidate;
      }
      assert.ok(index >= 0, `${path}: a model call outside any function`);
      const declaration = declarations[index]!;
      const key = `${path}#${declaration.name}`;
      const entry = found.get(key) ?? {
        calls: 0,
        prompts: 0,
        body: source.slice(declaration.at, declarations[index + 1]?.at ?? source.length),
      };
      if (site[0].startsWith("systemInstruction")) entry.prompts += 1;
      else entry.calls += 1;
      found.set(key, entry);
    }
  }
  return found;
}

test("every model call that writes for a client or the crew is told the studio's trade", () => {
  const found = modelFunctions();
  assert.ok(found.size >= 15, "the scan found the model calls");
  // A new call is classified before it ships, and a gone one leaves the list.
  assert.deepEqual(
    [...found.keys()].sort(),
    Object.keys(MODEL_CALLS).sort(),
    "classify every model call in MODEL_CALLS: a draft carries tradeInstruction(), anything else says why not",
  );
  for (const [key, { calls, prompts, body }] of found) {
    const { kind } = MODEL_CALLS[key]!;
    // One call per function, so each is classified on its own: a second
    // prompt beside a draft's would pass on the draft's trade.
    assert.ok(calls <= 1 && prompts <= 1, `${key}: one model call per function — give the new one its own`);
    if (kind === "transport") assert.equal(prompts, 0, `${key} sends a prompt it did not write`);
    if (kind === "draft") assert.match(body, TRADE_AWARE, `${key} drafts without the studio's trade`);
  }
  // The prompt builders a draft may use in place of tradeInstruction() append it.
  for (const [path, builder] of [
    ["functions/src/ai/copilot.ts", "export function proposalDraftInstruction("],
    ["functions/src/ai/message-draft.ts", "export function messageDraftSystemInstruction("],
    ["functions/src/ai/studio-voice.ts", "export function inquiryReplySystemInstruction("],
  ] as const) {
    assert.match(between(read(path), builder, "\n}\n"), /tradeInstruction\(/, builder);
  }
});

/** The quote composer's prompt before the hair walk's fix, word for word. */
const PHOTO_PROPOSAL_PROMPT = "Write proposal copy for a photography studio, grounded ONLY in the supplied facts. introduction: 2-4 warm, professional sentences addressed to the client. Name at least one specific thing THEY said — in `inquiry.message`, `inquiry.summary` or the consultation priorities — in their terms, not a generic line about capturing their special day; if they mentioned particular people, moments or worries, that is what to reflect back. Write as the studio, to the client: turn their words into the second person (“your family of four”, never “the four of us”), and never add people, relationships or details they did not write — no partner, children or guests unless the facts name them. Call the event what a client calls it, by `project.eventKind`: their wedding only for a wedding, their session for portraits, their event otherwise (or simply their day) — and never the studio’s internal job name. Never invent prices, dates, discounts, deliverables, or promises not in the facts. `packages` is EVERY package the client is being offered (photography and video are often sold together) and `combinedCoverage` is everyone they send between them: when the introduction mentions what is on offer, name every package, never just the first, and describe each only from its own facts. termsSummary: restate each package's approved terms in plain client-friendly language, under that package's name when there is more than one; never add, soften, or remove a term, never apply one package's terms to another, and never write legal language of your own. If no package has terms, restate nothing. The studio edits and approves this before anything is sent. Return JSON only.";

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
  // Only a photographer sells photography and video together.
  for (const vendor of ["hair", "makeup", "dj"]) {
    const prompt = proposalDraftInstruction(vendor);
    assert.match(prompt, /`packages` is EVERY package the client is being offered and `combinedCoverage`/);
    assert.doesNotMatch(prompt, /photography and video/);
  }
  // A photographer's prompt is what it was, byte for byte.
  const photo = proposalDraftInstruction("photographer");
  assert.equal(photo, PHOTO_PROPOSAL_PROMPT);
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

/** The run-of-show prompt's opening before the hair walk's fix, word for word. */
const PHOTO_RUN_OF_SHOW_PROMPT = "Draft a photography and video run-of-show from only the supplied facts. Never invent a confirmed venue, person, vendor, travel time, approval, or provider status. Put unknowns in missingInformation and assumptions. Use ISO 8601 timestamps with offsets. coverageStartsAt and coverageEndsAt are absolute UTC instants that already account for the venue's local offset — never add that offset to them again, and never treat them as local wall-clock times. All items must fit within coverage start and end unless a conflict is explicitly reported, and a conflict on every item is never correct: it means the timestamps are offset. Every item must cite at least one sourceReferences entry from a project_fact, questionnaire_answer, timing_rule, package_fact, or crew_fact. If no verified source supports an item, cite an assumption and label it plainly. Visibility: the couple's portal shows only items marked \"client\" or \"shared\", so the client-facing running order (getting ready, first look, ceremony, portraits, cocktail hour, reception, dancing, and the like) MUST be \"shared\" — a run-of-show the couple cannot see is a failure. Reserve \"crew\" or \"studio\" only for genuinely internal logistics they should not see (card backups, gear staging, travel buffers, meal breaks). Default any client-relevant moment to \"shared\". Packages: packageFact can list several packages for the same day (a photo package and a video package, say); plan for every role in its coverage across the whole coverage window, and never shorten the day to one package's minutes. ";

test("the run-of-show is drafted in the trade, and a photographer's still says photography and video", () => {
  const schedule = read("functions/src/ai/schedule.ts");
  assert.match(
    schedule,
    /runOfShowInstruction\(trade\) \+\n\s+scheduleCrewInstruction \+\n\s+momentsInstruction \+\n\s+tradeInstruction\(trade\) \+\n\s+" This is an unapproved draft/,
  );
  assert.match(schedule, /tenantTrade\(db, input\.tenantId\),/);
  assert.match(schedule, /momentsInstructionFor\(project\.data\(\)\), trade\);/);
  // A photographer's, byte for byte.
  assert.equal(runOfShowInstruction("photographer"), PHOTO_RUN_OF_SHOW_PROMPT);
  assert.equal(runOfShowInstruction(undefined), PHOTO_RUN_OF_SHOW_PROMPT);
  // A vendor's has no photo or video package, and no card backups.
  const hair = runOfShowInstruction("hair");
  assert.ok(hair.startsWith("Draft a hair run-of-show from only the supplied facts."));
  assert.match(hair, /internal logistics they should not see \(setup, travel buffers, meal breaks\)/);
  assert.match(hair, /several packages for the same day; plan for every role/);
  assert.doesNotMatch(hair, /photo|video|card backups/);
  assert.ok(runOfShowInstruction("dj").startsWith("Draft a music run-of-show"));
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
  // With packages published, as Jess Styles Bridal has: the price in a
  // vendor's words, then the quote and the trial — never only a range.
  const priced = {
    ...context,
    packages: [
      { name: "Bridal hair", basePriceCents: 35000 },
      { name: "Bridal hair and party", basePriceCents: 90000 },
    ],
  };
  const hairPriced = fallbackDraft({ trigger: "inquiry_reply", context: priced, trade: "hair" }).body;
  assert.match(
    hairPriced,
    /Our packages run from \$350 to \$900\. I'd love to put together a quote for the day you have in mind\./,
  );
  assert.match(hairPriced, /I can also set up a hair trial, so we can settle the look before the day\./);
  assert.match(hairPriced, /If you have any questions, just reply/);
  assert.doesNotMatch(hairPriced, /collection|coverage|a short call|consultation|proposal/i);
  // One package priced per person only starts at its price.
  const onePackage = { ...context, packages: [{ name: "Bridal hair", basePriceCents: 35000 }] };
  assert.match(
    fallbackDraft({ trigger: "inquiry_reply", context: onePackage, trade: "hair" }).body,
    /Our package starts at \$350\. I'd love to put together a quote/,
  );
  assert.match(
    fallbackDraft({ trigger: "inquiry_reply", context: onePackage, trade: "dj" }).body,
    /Our package is \$350\. I'd love to put together a proposal for the day you have in mind\.\n\nWould a short vibe call this week suit\?/,
  );
  assert.match(
    fallbackDraft({ trigger: "inquiry_reply", context: priced, trade: "makeup" }).body,
    /I can also set up a makeup trial/,
  );
  // A photographer's priced reply, word for word: the range, then the call.
  for (const photo of [
    fallbackDraft({ trigger: "inquiry_reply", context: priced, trade: "photographer" }).body,
    fallbackDraft({ trigger: "inquiry_reply", context: priced }).body,
  ]) {
    assert.match(photo, /\n\nOur collections run from \$350 to \$900\.\n\nWould a short call this week suit\?/);
    assert.doesNotMatch(photo, /quote|trial/);
  }
  assert.match(
    fallbackDraft({ trigger: "inquiry_reply", context: onePackage, trade: "photographer" }).body,
    /\n\nOur collection is \$350\.\n\n/,
  );
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
  // The brief's introduction names the trade's own call, and with none says
  // what the quote composer's fallback says (copilot.ts generateProposalDraft).
  const briefIntro = between(worker, "proposalIntroduction:", "followUpQuestions:");
  assert.match(
    briefIntro,
    /tradeProfile\(trade\)\.consultation\n\s+\?`Thank you for sharing what matters most for your celebration\. This draft reflects the priorities discussed during your \$\{words\.consultation\.toLowerCase\(\)\}\.`\n\s+:"Thank you for sharing what matters most for your celebration\. This draft reflects what you shared with us\.",/,
  );
  // The follow-up names the trade's plan of the day; a photographer's is the photography timeline.
  assert.match(worker, /begin preparing your \$\{dayPlan\}\.`/);
  assert.equal(tradeVocab("photographer").planOfDay, null);
  assert.equal(tradeVocab("photographer").service, "photography");
  assert.equal(tradeVocab("hair").planOfDay, "Getting-ready schedule");
  // A reply with no subject: a photographer's as before, nobody else's "your photography".
  assert.match(worker, /\(tradeProfile\(trade\)\.family === "photo" \? "Re: your photography" : "Re: your message"\)/);
});

test("a vendor's drafts record the prompt version that carries the trade; a photographer's keep theirs", () => {
  assert.equal(draftInstructionVersion("inbound_reply_v1", "inbound_reply_v2", "photographer"), "inbound_reply_v1");
  assert.equal(draftInstructionVersion("inbound_reply_v1", "inbound_reply_v2", undefined), "inbound_reply_v1");
  assert.equal(draftInstructionVersion("inbound_reply_v1", "inbound_reply_v2", "hair"), "inbound_reply_v2");
  assert.equal(draftInstructionVersion("inbound_reply_v1", "inbound_reply_v2", "dj"), "inbound_reply_v2");
  const worker = read("functions/src/operations/ai-pdf.ts");
  for (const pinned of [
    'instructionVersion:draftInstructionVersion("consultation-booking-v1","consultation-booking-v2",trade),',
    'instructionVersion:draftInstructionVersion("questionnaire-review-v4","questionnaire-review-v5",trade),',
    'instructionVersion:draftInstructionVersion("planning-followup-v3","planning-followup-v4",trade),',
    'instructionVersion: draftInstructionVersion("inbound_reply_v1", "inbound_reply_v2", trade),',
  ]) {
    assert.ok(worker.includes(pinned), pinned);
  }
});
