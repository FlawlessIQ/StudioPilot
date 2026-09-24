import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isTransientVertexStatus,
  retryTransient,
  vertexRetryDelayMs,
} from "../functions/src/ai/vertex-transport.ts";

const reply = (status: number) => new Response("", { status });

function recorder() {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };
}

test("only the statuses worth retrying are retried", () => {
  for (const status of [429, 500, 502, 503, 504])
    assert.equal(isTransientVertexStatus(status), true, String(status));
  // A bad request, a refused token and a content block will all repeat.
  for (const status of [200, 400, 401, 403, 404, 422])
    assert.equal(isTransientVertexStatus(status), false, String(status));
});

test("backoff grows, and jitter can only ever delay", () => {
  assert.equal(vertexRetryDelayMs(1, () => 0), 250);
  assert.equal(vertexRetryDelayMs(2, () => 0), 500);
  assert.equal(vertexRetryDelayMs(3, () => 0), 1000);
  // Jitter adds to the base, never subtracts from it.
  for (const attempt of [1, 2, 3]) {
    const floor = vertexRetryDelayMs(attempt, () => 0);
    assert.ok(vertexRetryDelayMs(attempt, () => 0.999) > floor);
    assert.ok(vertexRetryDelayMs(attempt, () => 0.999) < floor * 2);
  }
});

test("a 429 that clears is invisible to the caller", async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  const response = await retryTransient(
    async () => {
      calls += 1;
      return calls === 1 ? reply(429) : reply(200);
    },
    { sleep, random: () => 0 },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(slept, [250]);
});

test("a success is never retried and never sleeps", async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  const response = await retryTransient(
    async () => {
      calls += 1;
      return reply(200);
    },
    { sleep },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

/**
 * A 400 is the model telling us the request is wrong. Retrying it three times
 * spends a studio's quota to be told so three times.
 */
test("a permanent refusal fails on the first attempt", async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  const response = await retryTransient(
    async () => {
      calls += 1;
      return reply(400);
    },
    { sleep },
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
  assert.deepEqual(slept, []);
});

/**
 * When the backoff is exhausted the caller must still see Vertex's own status,
 * so the error it reports is the one that actually happened.
 */
test("exhausting the attempts returns the real last refusal", async () => {
  const { slept, sleep } = recorder();
  let calls = 0;
  const response = await retryTransient(
    async () => {
      calls += 1;
      return reply(429);
    },
    { sleep, random: () => 0 },
  );
  assert.equal(response.status, 429);
  assert.equal(calls, 3);
  assert.deepEqual(slept, [250, 500]);
});

test("the last attempt does not sleep before giving up", async () => {
  const { slept, sleep } = recorder();
  await retryTransient(async () => reply(503), {
    sleep,
    random: () => 0,
    maxAttempts: 2,
  });
  assert.equal(slept.length, 1);
});

const copilot = readFileSync(
  `${process.cwd()}/functions/src/ai/copilot.ts`,
  "utf8",
);

/**
 * The retry that guarded the wrong path.
 *
 * `generateStructuredBody` got a malformed-generation retry on 2026-09-23 and
 * it never fired once, because production answers stream and the streamed
 * parse lives in `streamStructuredBody` — which re-wraps the SyntaxError into a
 * plain Error, so it could not have matched even if it had been reached. Two
 * more turns were lost to it the next day.
 *
 * Asserted at the source, because this function needs a live stream to exercise
 * and the thing worth protecting is structural: the streamed parse must have
 * somewhere to fall back to.
 */
test("a streamed answer that does not parse falls back rather than failing", () => {
  const start = copilot.indexOf("async function streamStructuredBody");
  assert.ok(start > 0, "streamStructuredBody not found");
  const body = copilot.slice(start, copilot.indexOf("\n// The agentic retrieval loop", start));
  assert.ok(
    body.includes("await generateStructuredBody(requestBody)"),
    "the streamed parse failure must finish the turn without streaming",
  );
  // And it must still surface the original reason when the fallback also fails.
  assert.match(body, /VERTEX_AI_PARSE_FAILED:\$\{reason\}/);
});

/** Both parse paths retry; neither may quietly lose it again. */
test("the non-streaming structured call still retries a malformed generation", () => {
  assert.match(copilot, /function isMalformedGeneration/);
  assert.match(copilot, /return await generateStructuredOnce\(requestBody\)/);
});
