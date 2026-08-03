import assert from "node:assert/strict";
import test from "node:test";
import {
  GET as getDocusign,
  POST as postDocusign,
} from "../app/api/webhooks/docusign/route.ts";
import {
  GET as getDropboxSign,
  POST as postDropboxSign,
} from "../app/api/webhooks/dropbox-sign/route.ts";
import {
  GET as getQuickBooks,
  POST as postQuickBooks,
} from "../app/api/webhooks/quickbooks/route.ts";
import {
  GET as getStripeConnect,
  POST as postStripeConnect,
} from "../app/api/webhooks/stripe-connect/route.ts";

test("provider webhook relays reject non-POST requests", () => {
  assert.equal(getDocusign().status, 405);
  assert.equal(getDropboxSign().status, 405);
  assert.equal(getQuickBooks().status, 405);
  assert.equal(getStripeConnect().status, 405);
});

test("Stripe Connect webhook relay requires its signature header", async () => {
  const response = await postStripeConnect(
    new Request("https://studiohub.test/api/webhooks/stripe-connect", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "STRIPE_CONNECT_SIGNATURE_REQUIRED",
  });
});

test("Dropbox Sign webhook relay requires its signature header", async () => {
  const response = await postDropboxSign(
    new Request("https://studiohub.test/api/webhooks/dropbox-sign", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "multipart/form-data" },
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "DROPBOX_SIGN_SIGNATURE_REQUIRED",
  });
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
  const dropboxSign = await postDropboxSign(
    new Request("https://studiohub.test/api/webhooks/dropbox-sign", {
      method: "POST",
      body: "{}",
      headers: {
        "content-length": oversized,
        "content-type": "multipart/form-data",
        "content-sha256": "invalid",
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
  assert.equal(dropboxSign.status, 413);
  assert.equal(quickbooks.status, 413);
});
