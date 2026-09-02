import assert from "node:assert/strict";
import test from "node:test";

import {
  activityEntriesFromRows,
  messageIdPrefix,
} from "../functions/src/communications/delivery-reconciler.js";

test("an activity id reduces to the message id we stored", () => {
  // Verbatim from production: the job recorded the left-hand side, the
  // Activity API answered with the right. If this join is wrong the sweep
  // silently reconciles nothing, which looks exactly like everything being
  // delivered.
  assert.equal(
    messageIdPrefix(
      "oEFJhQ8ORt6NuTjWKmlY6g.recvd-6d4864cb4-hglw4-1-6A9850E6-10.0",
    ),
    "oEFJhQ8ORt6NuTjWKmlY6g",
  );
  // Our own stored form has no suffix and must survive unchanged, so the
  // same function can normalise both sides of the comparison.
  assert.equal(
    messageIdPrefix("oEFJhQ8ORt6NuTjWKmlY6g"),
    "oEFJhQ8ORt6NuTjWKmlY6g",
  );
  assert.equal(messageIdPrefix(""), "");
});

test("a delivered time comes from SendGrid, not from when we looked", () => {
  // Verbatim from the production activity feed. The offer was delivered at
  // 16:38:01Z; the first sweep saw it at 17:53:23Z. Recording the sweep's own
  // clock made `deliveredAt` an hour and a quarter late and looked entirely
  // reasonable doing it.
  const entries = activityEntriesFromRows([
    {
      msg_id: "oEFJhQ8ORt6NuTjWKmlY6g.recvd-6d4864cb4-hglw4-1-6A9850E6-10.0",
      status: "delivered",
      last_event_time: "2026-09-02T16:38:01Z",
    },
  ]);
  const entry = entries.get("oEFJhQ8ORt6NuTjWKmlY6g");
  assert.equal(entry?.summary, "delivered");
  assert.equal(entry?.lastEventTime, "2026-09-02T16:38:01Z");
  // The full id is kept, because the detail lookup needs it.
  assert.equal(
    entry?.activityId,
    "oEFJhQ8ORt6NuTjWKmlY6g.recvd-6d4864cb4-hglw4-1-6A9850E6-10.0",
  );
});

test("the newest row wins, and unusable rows are skipped", () => {
  const entries = activityEntriesFromRows([
    { msg_id: "abc.recvd-1", status: "delivered", last_event_time: "2026-09-02T10:00:00Z" },
    // SendGrid returns most recent first, so this older duplicate must lose.
    { msg_id: "abc.recvd-0", status: "processing", last_event_time: "2026-09-02T09:00:00Z" },
    { msg_id: "", status: "delivered" },
    { status: "delivered" },
    { msg_id: "def.recvd-1" },
  ]);
  assert.equal(entries.size, 1);
  assert.equal(entries.get("abc")?.summary, "delivered");
  assert.equal(entries.get("abc")?.lastEventTime, "2026-09-02T10:00:00Z");
  // A row with no event time must not invent one; the caller falls back.
  assert.equal(
    activityEntriesFromRows([{ msg_id: "x.y", status: "delivered" }]).get("x")
      ?.lastEventTime,
    "",
  );
});
