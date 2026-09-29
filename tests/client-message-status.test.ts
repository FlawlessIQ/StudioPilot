import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The couple's own message must not be labelled with the studio's status.
 *
 * Message status is stored from the studio's side: a client's message lands
 * `direction: "inbound", status: "received"`, meaning the studio has it. The
 * portal rendered that verbatim, so the couple saw
 *
 *   You · September 22, 2026 · Received
 *
 * on a message they had just written — backwards from where they are sitting,
 * and contradicting the confirmation they had just been shown ("Message sent
 * securely to your studio."). Found walking the portal as the client on
 * production, 2026-09-22.
 */

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const view = withoutComments(
  readFileSync("components/client/kit/client-messages.tsx", "utf8"),
);

// The chat (M4) no longer renders a stored status for either side: the
// studio's messages show who and when, and the couple's own say "Sent".
test("the couple's own message says Sent", () => {
  assert.match(view, /`You · \$\{time\(at\)\} · Sent`/);
});

test("the client's own message never renders the raw stored status", () => {
  assert.doesNotMatch(
    view,
    /statusLabel\(message\.status\)|message\.status/,
    "the stored status is the studio's receipt, not the couple's",
  );
});
