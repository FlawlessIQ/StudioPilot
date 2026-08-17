import assert from "node:assert/strict";
import test from "node:test";
import {
  docusignOAuthBaseUrl,
  oauthRefreshTokenUrl,
  quickBooksApiBaseUrl,
  refreshCredentialsInRequestBody,
  refreshNeedsClientCredentials,
} from "../functions/src/integrations/provider-config.js";

test("provider defaults point at production, not sandbox", () => {
  const previousDocusign = process.env.DOCUSIGN_OAUTH_BASE_URL;
  const previousQuickBooks = process.env.QUICKBOOKS_API_BASE_URL;
  delete process.env.DOCUSIGN_OAUTH_BASE_URL;
  delete process.env.QUICKBOOKS_API_BASE_URL;
  try {
    assert.equal(docusignOAuthBaseUrl(), "https://account.docusign.com");
    assert.equal(quickBooksApiBaseUrl(), "https://quickbooks.api.intuit.com");
  } finally {
    if (previousDocusign === undefined) delete process.env.DOCUSIGN_OAUTH_BASE_URL;
    else process.env.DOCUSIGN_OAUTH_BASE_URL = previousDocusign;
    if (previousQuickBooks === undefined) delete process.env.QUICKBOOKS_API_BASE_URL;
    else process.env.QUICKBOOKS_API_BASE_URL = previousQuickBooks;
  }
});

test("provider base URLs can be overridden without duplicate slashes", () => {
  const previousDocusign = process.env.DOCUSIGN_OAUTH_BASE_URL;
  const previousQuickBooks = process.env.QUICKBOOKS_API_BASE_URL;
  process.env.DOCUSIGN_OAUTH_BASE_URL = "https://account-d.docusign.com/";
  process.env.QUICKBOOKS_API_BASE_URL = "https://sandbox-quickbooks.api.intuit.com/";
  try {
    assert.equal(docusignOAuthBaseUrl(), "https://account-d.docusign.com");
    assert.equal(
      quickBooksApiBaseUrl(),
      "https://sandbox-quickbooks.api.intuit.com",
    );
  } finally {
    if (previousDocusign === undefined) delete process.env.DOCUSIGN_OAUTH_BASE_URL;
    else process.env.DOCUSIGN_OAUTH_BASE_URL = previousDocusign;
    if (previousQuickBooks === undefined) delete process.env.QUICKBOOKS_API_BASE_URL;
    else process.env.QUICKBOOKS_API_BASE_URL = previousQuickBooks;
  }
});

test("refresh transport matches provider requirements", () => {
  assert.equal(
    oauthRefreshTokenUrl("dropbox_sign"),
    "https://app.hellosign.com/oauth/token?refresh",
  );
  assert.equal(refreshNeedsClientCredentials("dropbox_sign"), false);
  assert.equal(refreshCredentialsInRequestBody("google_calendar"), true);
  assert.equal(refreshCredentialsInRequestBody("dropbox_sign"), false);
  assert.equal(refreshCredentialsInRequestBody("zoom"), false);
  assert.equal(refreshNeedsClientCredentials("quickbooks"), true);
});
