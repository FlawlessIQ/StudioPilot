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
  readFileSync("components/client/live-client-views.tsx", "utf8"),
);

test("the thread line branches its status on who wrote the message", () => {
  const line = view
    .split("\n")
    .find((l) => l.includes('"You"') && l.includes("statusLabel(message.status)"));
  assert.ok(line, "could not find the client message thread line");
  assert.match(
    line,
    /fromStudio \? statusLabel\(message\.status\)[^:]*:\s*"Sent"/,
    'The couple\'s own message must read "Sent". The stored status describes ' +
      "the studio's receipt, so rendering it unconditionally tells the client " +
      'their own message was "Received".',
  );
});

test("the client's own message never renders the raw stored status", () => {
  // Guards the shape rather than the exact copy: whatever the label becomes,
  // it must not be the studio-side value for a message the client wrote.
  assert.doesNotMatch(
    view,
    /\{fromStudio \? workspace\.tenantName : "You"\}[^\n]*·\s*\{statusLabel\(message\.status\) \|\| "sent"\}/,
    "the status is being rendered the same way for both sides again",
  );
});
