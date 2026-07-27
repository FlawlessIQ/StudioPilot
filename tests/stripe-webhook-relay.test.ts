import assert from "node:assert/strict";
import test from "node:test";
import {
  GET,
  POST,
} from "../app/api/webhooks/stripe/route.ts";

test("Stripe webhook relay rejects non-POST requests", async () => {
  const response = GET();

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "METHOD_NOT_ALLOWED" });
});

test("Stripe webhook relay requires a signature before reading the body", async () => {
  const response = await POST(
    new Request("https://studiohub.test/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "STRIPE_SIGNATURE_REQUIRED",
  });
});

test("Stripe webhook relay rejects declared oversized payloads", async () => {
  const response = await POST(
    new Request("https://studiohub.test/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
      headers: {
        "content-length": String(1024 * 1024 + 1),
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=invalid",
      },
    }),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "PAYLOAD_TOO_LARGE" });
});
