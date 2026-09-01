import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Every refusal the invitation endpoints can make, said in words.
 *
 * These endpoints answer with a bare constant — INVITED_EMAIL_MISMATCH,
 * SUBCONTRACTOR_LIMIT_REACHED — and the accept page turns each into a sentence
 * that says what to do next. A code with no case falls to a generic "retry
 * once, then ask the studio to resend", which is wrong advice for most of
 * them: resending does not help somebody signed in as the wrong address, and
 * retrying does not help a studio out of crew seats.
 *
 * The person reading it cannot see the studio's screen, is usually not
 * technical, and has no other route in. A raw constant strands them.
 */
test("the accept page has words for every refusal the endpoints make", () => {
  const endpoints = readFileSync(
    `${process.cwd()}/functions/src/crew/invitations.ts`,
    "utf8",
  );
  const page = readFileSync(
    `${process.cwd()}/features/auth/accept-crew-invitation.tsx`,
    "utf8",
  );
  const thrown = new Set(
    [...endpoints.matchAll(/throw new Error\("([A-Z_]+)"\)/g)].map(
      (match) => match[1]!,
    ),
  );
  // Guards the extraction itself: if this ever reads zero codes the assertions
  // below pass vacuously.
  assert.ok(thrown.size >= 5, `only found ${thrown.size} codes`);
  for (const code of thrown) {
    assert.match(
      page,
      new RegExp(`case "${code}":`),
      `${code} reaches the crew member as a raw constant`,
    );
  }
});
