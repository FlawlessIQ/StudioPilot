import assert from "node:assert/strict";
import test from "node:test";

import { messageIdPrefix } from "../functions/src/communications/delivery-reconciler.js";

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
