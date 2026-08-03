import assert from "node:assert/strict";
import test from "node:test";
import { providerUsesPkce } from "../functions/src/integrations/oauth-strategy.ts";

test("confidential server-side Dropbox OAuth does not send PKCE", () => {
  assert.equal(providerUsesPkce("dropbox"), false);
});

test("Google Calendar and Zoom retain PKCE protection", () => {
  assert.equal(providerUsesPkce("google_calendar"), true);
  assert.equal(providerUsesPkce("zoom"), true);
});

test("other confidential provider adapters do not opt into PKCE implicitly", () => {
  assert.equal(providerUsesPkce("quickbooks"), false);
  assert.equal(providerUsesPkce("docusign"), false);
  assert.equal(providerUsesPkce("dropbox_sign"), false);
  assert.equal(providerUsesPkce("stripe"), false);
});
