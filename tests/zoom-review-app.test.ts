import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  zoomDevelopmentClient,
  zoomOAuthAppFor,
} from "../functions/src/integrations/zoom-review-app.ts";

/**
 * Zoom reviews an update by authorizing the app's development client
 * (Marketplace note, 2026-10-02). Only the reviewer's test studio may take
 * that path; every real studio stays on the production client.
 */

test("only a listed studio, and only for Zoom, connects through the development client", () => {
  const before = process.env.ZOOM_DEV_TENANT_IDS;
  try {
    delete process.env.ZOOM_DEV_TENANT_IDS;
    assert.equal(zoomOAuthAppFor("zoom", "tenant_review"), null, "nothing listed: production for everyone");

    process.env.ZOOM_DEV_TENANT_IDS = " tenant_review , tenant_other ";
    assert.equal(zoomOAuthAppFor("zoom", "tenant_review"), "development");
    assert.equal(zoomOAuthAppFor("zoom", "tenant_other"), "development");
    assert.equal(zoomOAuthAppFor("zoom", "tenant_real_studio"), null);
    assert.equal(zoomOAuthAppFor("google_calendar", "tenant_review"), null, "other providers never");
    assert.equal(zoomOAuthAppFor("zoom", null), null);
  } finally {
    if (before === undefined) delete process.env.ZOOM_DEV_TENANT_IDS;
    else process.env.ZOOM_DEV_TENANT_IDS = before;
  }
});

test("a half-configured development client refuses rather than falling back to production", async () => {
  const before = { id: process.env.ZOOM_DEV_CLIENT_ID, secret: process.env.ZOOM_DEV_CLIENT_SECRET };
  try {
    delete process.env.ZOOM_DEV_CLIENT_ID;
    process.env.ZOOM_DEV_CLIENT_SECRET = "s";
    await assert.rejects(zoomDevelopmentClient(), /ZOOM_DEVELOPMENT_APP_NOT_CONFIGURED/);
    process.env.ZOOM_DEV_CLIENT_ID = "dev-id";
    assert.deepEqual(await zoomDevelopmentClient(), { clientId: "dev-id", clientSecret: "s" });
  } finally {
    for (const [key, value] of [["ZOOM_DEV_CLIENT_ID", before.id], ["ZOOM_DEV_CLIENT_SECRET", before.secret]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("wired: the connect flow, the code exchange and the refresh all follow the issuing client", () => {
  const oauth = readFileSync("functions/src/integrations/oauth.ts", "utf8");
  assert.match(oauth, /const oauthApp = zoomOAuthAppFor\(input\.provider, input\.tenantId\)/);
  assert.match(oauth, /oauthApp,\n\s+expiresAt:/, "the state remembers which client started it");
  assert.match(oauth, /oauthAppOf\(saved\.get\("oauthApp"\)\),\n\s+\);/, "the exchange uses that client");
  assert.match(oauth, /oauthApp: ZOOM_DEVELOPMENT_APP/, "the credential records it");
  const runtime = readFileSync("functions/src/operations/provider-runtime.ts", "utf8");
  assert.match(runtime, /provider==="zoom"&&current\.oauthApp===ZOOM_DEVELOPMENT_APP\?await zoomDevelopmentClient\(\)/);
});
