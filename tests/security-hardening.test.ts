import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { clientIpFromHeaders } from "../lib/security/client-ip.ts";

const read = (path: string) => readFileSync(path, "utf8");

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// ── Client address ──

test("the client is App Hosting's own header, which no client can forge", () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  // As measured on production: forged entries in front, the real client,
  // then Google's front end and proxy.
  assert.equal(
    clientIpFromHeaders(headers({
      "x-fah-client-ip": "100.1.29.148",
      "x-forwarded-for": "6.6.6.6, 100.1.29.148, 35.219.200.201, 192.178.13.1",
    })),
    "100.1.29.148",
  );
  // Off App Hosting (emulator, local start) the first forwarded-for entry.
  assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })), "203.0.113.9");
  assert.equal(clientIpFromHeaders(headers({})), null);
});

test("every route reads the address through the one helper", () => {
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
