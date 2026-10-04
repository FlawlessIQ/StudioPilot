import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { clientIpFromForwardedFor } from "../lib/security/client-ip.ts";

const read = (path: string) => readFileSync(path, "utf8");

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// ── Client address ──

test("the client is the entry Google's load balancer added, not one the client sent", () => {
  // The load balancer appends "<client>, <itself>"; anything before is the client's own claim.
  assert.equal(clientIpFromForwardedFor("203.0.113.9, 34.120.1.1"), "203.0.113.9");
  assert.equal(clientIpFromForwardedFor("6.6.6.6, 203.0.113.9, 34.120.1.1"), "203.0.113.9", "a forged leading entry is ignored");
  assert.equal(clientIpFromForwardedFor("1.1.1.1, 2.2.2.2, 203.0.113.9, 34.120.1.1"), "203.0.113.9");
  assert.equal(clientIpFromForwardedFor("203.0.113.9"), "203.0.113.9", "straight to Cloud Run, or the emulator");
  assert.equal(clientIpFromForwardedFor(""), null);
  assert.equal(clientIpFromForwardedFor(null), null);
});

test("no route reads the first forwarded-for entry any more", () => {
  for (const file of filesUnder("app")) {
    assert.doesNotMatch(read(file), /x-forwarded-for"\)\?\.split\(","\)\[0\]/, file);
  }
  assert.match(read("app/api/functions/[functionName]/route.ts"), /const clientIp = requestClientIp\(request\);/);
});

// ── Address lookup on the public inquiry form ──

test("the public address lookup has a per-studio daily ceiling as well as a per-visitor one", () => {
  const route = read("app/api/public/places/route.ts");
  assert.match(route, /const DAILY_STUDIO_LIMIT = 3_000;/);
  assert.match(route, /const allowed = allowedNow\(id\) && studioDayAllows\(input\.tenantSlug\);/);
});

// ── CORS ──

test("production functions accept calls only from StudioCue's own origins", () => {
  const cors = read("functions/src/security/cors.ts");
  const production = cors.slice(cors.indexOf("const productionOrigins"), cors.indexOf("const localOrigins"));
  assert.doesNotMatch(production, /chatgpt|localhost|studiohub\\\.app\$/);
  assert.match(production, /studio-cue\\\.com/);
  assert.match(cors, /process\.env\.FUNCTIONS_EMULATOR === "true" \? \[\.\.\.productionOrigins, \.\.\.localOrigins\] : productionOrigins/);
  assert.equal(existsSync("app/chatgpt-auth.ts"), false);
});

// ── Retired endpoints ──

test("the Dropbox Sign callback is gone everywhere it was wired", () => {
  assert.doesNotMatch(read("functions/src/index.ts"), /dropboxSignWebhook/);
  assert.doesNotMatch(read("functions/src/booking/webhooks.ts"), /export const dropboxSignWebhook/);
  assert.equal(existsSync("app/api/webhooks/dropbox-sign/route.ts"), false);
  assert.doesNotMatch(read("scripts/configure-production-function-invokers.sh"), /dropboxsignwebhook/);
  // And it is not an integration anyone can choose.
  const integrations = read("features/integrations/schema.ts");
  const offered = integrations.slice(integrations.indexOf("export const offeredProviders"), integrations.indexOf("]);", integrations.indexOf("export const offeredProviders")));
  assert.doesNotMatch(offered, /dropbox_sign/);
});
