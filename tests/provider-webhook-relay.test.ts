import assert from "node:assert/strict";
import test from "node:test";
import {
  GET as getDocusign,
  POST as postDocusign,
} from "../app/api/webhooks/docusign/route.ts";
import {
  GET as getQuickBooks,
  POST as postQuickBooks,
} from "../app/api/webhooks/quickbooks/route.ts";

test("provider webhook relays reject non-POST requests", () => {
  assert.equal(getDocusign().status, 405);
  assert.equal(getQuickBooks().status, 405);
});

test("Docusign webhook relay requires its HMAC signature", async () => {
  const response = await postDocusign(
    new Request("https://studiohub.test/api/webhooks/docusign", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "DOCUSIGN_SIGNATURE_REQUIRED",
  });
});

test("QuickBooks webhook relay requires its verifier signature", async () => {
  const response = await postQuickBooks(
    new Request("https://studiohub.test/api/webhooks/quickbooks", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "QUICKBOOKS_SIGNATURE_REQUIRED",
  });
});

test("provider webhook relays reject oversized payloads", async () => {
  const oversized = String(2 * 1024 * 1024 + 1);
  const docusign = await postDocusign(
    new Request("https://studiohub.test/api/webhooks/docusign", {
      method: "POST",
      body: "{}",
      headers: {
        "content-length": oversized,
        "content-type": "application/json",
        "x-docusign-signature-1": "invalid",
      },
    }),
  );
  const quickbooks = await postQuickBooks(
    new Request("https://studiohub.test/api/webhooks/quickbooks", {
      method: "POST",
      body: "{}",
      headers: {
        "content-length": oversized,
        "content-type": "application/json",
        "intuit-signature": "invalid",
      },
    }),
  );

  assert.equal(docusign.status, 413);
  assert.equal(quickbooks.status, 413);
});
