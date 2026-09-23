import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * What a turn cost, and which model it should have used.
 *
 * Vertex returns `usageMetadata` on every response and StudioCue discarded it,
 * so `usage` on an interaction read `{inputTokens: 0, outputTokens: 0}` from
 * the day it was written. The bill could not be attributed to a tenant, a
 * question or a model — which meant choosing between models was guesswork, and
 * a routing decision could not be checked afterwards.
 *
 * It understates the problem to call it one missing number. A Cue question is
 * not one model call: the retrieval loop runs up to four times and each call
 * resends the whole context, so the input cost is a multiple that nothing
 * recorded.
 */

const copilot = readFileSync("functions/src/ai/copilot.ts", "utf8");
const transport = readFileSync("functions/src/ai/vertex-transport.ts", "utf8");

test("every model call adds to the turn's token count", () => {
  assert.match(copilot, /function recordUsage/);
  assert.match(copilot, /promptTokenCount/);
  assert.match(copilot, /candidatesTokenCount/);
  // Thinking tokens bill as output and are absent on non-thinking models, so
  // they are added rather than assumed either way.
  assert.match(copilot, /thoughtsTokenCount/);
});

test("the retrieval loop is counted, not just the answer", () => {
  // This is where the cost actually accumulates, and it was the invisible half.
  const loop = copilot.slice(copilot.indexOf("COPILOT_MAX_TOOL_ITERATIONS; iteration++"));
  assert.match(loop.slice(0, 1200), /recordUsage\(body\)/);
});

test("the counter starts clean for each turn", () => {
  // Module-scoped, so a turn that inherited the last one's total would be
  // worse than no measurement at all.
  assert.match(copilot, /resetTurnTokens\(\);/);
  assert.match(copilot, /tokens: readTurnTokens\(\)/);
});

test("retrieval can run on a different model from the answer", () => {
  // Choosing which records to fetch is mechanical; the answer is the judgement.
  // Unset, both use the answering model and nothing changes.
  assert.match(transport, /VERTEX_AI_COPILOT_RETRIEVAL_MODEL/);
  assert.match(transport, /purpose === "answer"/);
  assert.match(copilot, /"retrieval",/);
});

test("an unset retrieval model changes nothing", () => {
  const fn = transport.slice(
    transport.indexOf("export function vertexModelFor"),
    transport.indexOf("export function vertexUrl"),
  );
  assert.match(
    fn,
    /process\.env\.VERTEX_AI_COPILOT_RETRIEVAL_MODEL \|\| answering/,
    "falling back to the answering model is what makes this safe to ship unset",
  );
});
