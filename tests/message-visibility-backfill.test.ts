import assert from "node:assert/strict";
import { test } from "node:test";
import { decideVisibility } from "@/features/messaging/visibility-backfill";

/**
 * The rule this backfill must never break:
 *
 *   a message already delivered to, or received from, the client cannot be
 *   leaked by showing it to the client.
 *
 * Anything whose audience is not proven stays internal. The portal's
 * fail-closed filter is correct; this decides history from evidence rather than
 * widening the default.
 */

test("an inbound message is shared — the client wrote it", () => {
  assert.equal(decideVisibility({ direction: "inbound" }), "shared");
});

test("outbound to a proven client address is shared", () => {
  assert.equal(
    decideVisibility({
      direction: "outbound",
      recipient: "Maren@Example.com",
      clientEmails: ["maren@example.com"],
    }),
    "shared",
    "matching should ignore case and whitespace",
  );
});

test("outbound flagged as client-facing is shared", () => {
  assert.equal(
    decideVisibility({ direction: "outbound", recipientIsClient: true }),
    "shared",
  );
});

test("outbound to an unknown address stays internal", () => {
  // The important case: a studio note, a vendor email, an internal forward.
  assert.equal(
    decideVisibility({
      direction: "outbound",
      recipient: "second.shooter@example.com",
      clientEmails: ["maren@example.com"],
    }),
    "studio",
  );
});

test("a message with no direction at all stays internal", () => {
  assert.equal(decideVisibility({}), "studio");
  assert.equal(decideVisibility({ direction: null }), "studio");
});

test("recipientIsClient false is not treated as true", () => {
  assert.equal(
    decideVisibility({ direction: "outbound", recipientIsClient: false }),
    "studio",
  );
});

test("no combination of missing fields ever yields shared", () => {
  // Exhaustive over the shapes a legacy document can take with no evidence.
  for (const direction of [undefined, null, "", "outbound", "unknown"]) {
    for (const recipient of [undefined, null, "", "  "]) {
      const decision = decideVisibility({
        direction,
        recipient,
        clientEmails: [],
      });
      assert.equal(
        decision,
        "studio",
        `direction=${String(direction)} recipient=${String(recipient)} leaked`,
      );
    }
  }
});
