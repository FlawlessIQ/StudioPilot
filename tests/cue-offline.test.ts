import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  lastUserText,
  scriptedReplyFor,
  scriptedVertexResponse,
  VERTEX_SCRIPTS,
} from "../functions/src/ai/vertex-script.js";
import {
  resolveFlowProjectId,
  responseSchema,
} from "../functions/src/ai/copilot.js";

/**
 * Cue, answerable without GCP.
 *
 * `cloudAccessToken()` reads metadata.google.internal, so until now Cue ran in
 * exactly one place: production. Every defect fixed in the 2026-09-19 batch was
 * a turn *shape* problem — the subject discarded, a blocker audit outranking
 * the action, the flow rendering last, a finished flow forgetting — and every
 * one was found by reading a production transcript after the reference studio
 * had already hit it. None of them needed a real model.
 */

const body = (said: string) => ({
  contents: [
    { role: "user", parts: [{ text: "an earlier turn" }] },
    { role: "model", parts: [{ text: "an earlier answer" }] },
    { role: "user", parts: [{ text: said }] },
  ],
});

// --- the fixtures cannot drift from the real contract --------------------

/**
 * The whole reason this is safe to have. A scripted reply that the real schema
 * rejects is a stage set teaching the UI a shape Vertex will never send.
 */
test("every scripted reply parses through the copilot's own schema", () => {
  const said = [
    "add albert gershengoren to 2nd photogrpaher for erin and joe demattia",
    "add marco silva as second videographer for lena and chris",
    "set the gold package on this job",
    "send the wedding details form",
    "what is outstanding on this job?",
  ];
  for (const words of said) {
    const parsed = responseSchema.safeParse(scriptedReplyFor(words));
    assert.equal(parsed.success, true, `${words}: ${parsed.error?.message}`);
  }
});

test("every script says why it is in the list", () => {
  // Each fixture is a reported failure, not an invention. If one cannot be
  // explained it should not be here shaping how the UI is tested.
  for (const script of VERTEX_SCRIPTS)
    assert.ok(script.because.length > 20, String(script.match));
});

// --- the operator's own words survive the trip ---------------------------

test("the words reach the flow as its subject", () => {
  // This is the defect the whole batch existed for: the flow carried a type
  // and a project and nothing else, so "add Albert" opened a picker with no
  // sign of Albert and the operator asked three more times.
  const reply = scriptedReplyFor(
    "add albert gershengoren to 2nd photogrpaher for erin and joe demattia",
  );
  assert.equal(reply.flow?.type, "crew_offer");
  assert.equal(reply.flow?.subject, "albert gershengoren");
});

test("a videographer request is a videographer request", () => {
  const reply = scriptedReplyFor("add marco silva as second videographer for lena");
  assert.equal(reply.flow?.type, "crew_offer");
  assert.equal(reply.flow?.subject, "marco silva");
});

test("the flow never carries an identifier", () => {
  // The model has no roster tool, so any id it produced would be invention.
  const reply = scriptedReplyFor("add albert gershengoren as second photographer");
  assert.equal(reply.flow?.projectId, null);
});

test("a question with no action gets no flow", () => {
  const reply = scriptedReplyFor("what is outstanding on this job?");
  assert.equal(reply.flow, null);
  assert.ok(reply.facts.length, "a plain answer still carries facts");
});

test("the latest turn is what is answered, not the first", () => {
  assert.equal(lastUserText(body("the newest question")), "the newest question");
  assert.equal(lastUserText({}), "");
  assert.equal(lastUserText({ contents: [] }), "");
});

/** The error card must be reachable without breaking production to see it. */
test("a failure can be provoked on purpose", () => {
  assert.throws(() => scriptedReplyFor("make this fail"), /VERTEX_AI_COPILOT_FAILED/);
});

// --- the wire shape is Vertex's, so no caller knows ----------------------

test("a scripted answer is shaped like a generateContent response", async () => {
  const response = scriptedVertexResponse(body("what is outstanding?"), "generateContent");
  assert.equal(response.ok, true);
  const json = (await response.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };
  const text = json.candidates[0]!.content.parts[0]!.text;
  assert.equal(responseSchema.safeParse(JSON.parse(text)).success, true);
});

/**
 * The retrieval loop stops as soon as a turn carries no functionCall part, so
 * a scripted answer must not carry one. An earlier version deliberately
 * emitted a tool call so the loop would run offline — but the loop records
 * every project a tool touched as "referenced", and `resolveFlowProjectId`
 * trusts a single referenced project above the name the operator typed, so a
 * blunt scripted call aimed the flow at an unrelated job. See the note in
 * vertex-script.ts.
 */
test("a scripted answer ends the tool loop immediately", async () => {
  const response = scriptedVertexResponse(body("add albert as second photographer"), "generateContent");
  const json = JSON.stringify(await response.json());
  assert.doesNotMatch(json, /functionCall/);
});

test("the streamed answer arrives in frames, not one lump", async () => {
  // The reader reveals `answer` as it arrives; a single frame would never
  // exercise the partial-JSON path, which has broken before.
  const response = scriptedVertexResponse(body("what is outstanding?"), "streamGenerateContent");
  const text = await response.text();
  const frames = text.split("\n\n").filter(Boolean);
  assert.ok(frames.length > 3, `expected several frames, got ${frames.length}`);
  for (const frame of frames) assert.match(frame, /^data: \{/);
  // Reassembled, the frames must be the same answer.
  const raw = frames
    .map((frame) => JSON.parse(frame.slice(5).trim()))
    .map((chunk) => chunk.candidates[0].content.parts[0].text)
    .join("");
  assert.equal(responseSchema.safeParse(JSON.parse(raw)).success, true);
});

// --- nothing reaches a model by another route ----------------------------

test("the copilot has one way out to a model", () => {
  const copilot = readFileSync(
    `${process.cwd()}/functions/src/ai/copilot.ts`,
    "utf8",
  );
  // The three copilot-turn call sites go through the transport. The two that
  // remain — intake extraction and drafting — return a deterministic fallback
  // before they ever reach a token, which is why they are allowed to stay.
  const direct = [...copilot.matchAll(/await fetch\(/g)].length;
  assert.equal(direct, 2, `${direct} direct fetches in copilot.ts`);
  for (const guarded of copilot.split("const token = await cloudAccessToken();").slice(0, -1))
    assert.match(
      guarded.slice(-900),
      /PROVIDER_MOCK_MODE === "true"\) return fallback\(\);/,
      "a direct model call with no mock-mode fallback above it",
    );
});

test("the script is unreachable unless mock mode is on", () => {
  const transport = readFileSync(
    `${process.cwd()}/functions/src/ai/vertex-transport.ts`,
    "utf8",
  );
  assert.match(transport, /if \(vertexMockMode\(\)\) return scriptedVertexResponse/);
  assert.match(transport, /process\.env\.PROVIDER_MOCK_MODE === "true"/);
});

// --- the defect walking Cue offline exposed on its first day -------------

/**
 * Almost every wedding is filed as "Maya & Theo Johnson" and typed as "maya
 * and theo johnson". The last-resort resolver matched the stored name inside
 * the question **verbatim**, so the name never matched, the flow resolved to
 * nothing, and the turn came back as an answer with no action — the exact
 * shape the 2026-09-19 batch existed to remove.
 *
 * Found by asking Cue a question locally, which until 2026-09-20 was not
 * something anyone could do.
 */
test("an ampersand in the job name does not drop the flow", () => {
  const allowed = new Set(["wedding-booked", "other"]);
  const names = new Map([
    ["wedding-booked", "Maya & Theo Johnson"],
    ["other", "Northstar Annual Summit"],
  ]);
  const resolve = (said: string) =>
    resolveFlowProjectId(null, allowed, null, new Set(), names, said);

  assert.equal(
    resolve("add jordan reid to 2nd photogrpaher for maya and theo johnson"),
    "wedding-booked",
  );
  // And the way it is actually written still works.
  assert.equal(resolve("staff Maya & Theo Johnson"), "wedding-booked");
});

test("a name that fits nothing still resolves to nothing", () => {
  // Better a dropped flow than one aimed at the wrong wedding.
  const allowed = new Set(["a"]);
  const names = new Map([["a", "Maya & Theo Johnson"]]);
  assert.equal(
    resolveFlowProjectId(null, allowed, null, new Set(), names, "staff the Ellis job"),
    null,
  );
});

test("an explicit id and the conversation's scope still come first", () => {
  const allowed = new Set(["scoped", "named"]);
  const names = new Map([["named", "Maya & Theo Johnson"]]);
  // The model's own id wins.
  assert.equal(
    resolveFlowProjectId("scoped", allowed, null, new Set(), names, "maya and theo johnson"),
    "scoped",
  );
  // Then the project the whole conversation is scoped to.
  assert.equal(
    resolveFlowProjectId(null, allowed, "scoped", new Set(), names, "maya and theo johnson"),
    "scoped",
  );
});
