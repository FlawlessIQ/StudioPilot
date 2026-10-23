import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isPermanentTriggerError, retryingTrigger, BOOKING_TRIGGER_RETRY_WINDOW_MS } from "../functions/src/booking/trigger-retry.ts";
import { UNVERIFIED_HOLDS_PER_HOUR, UNVERIFIED_HOLDS_PER_SENDER_PER_HOUR } from "../server/intake/hold-inquiry";

/**
 * Wave A of the 2026-10-22 reliability review: the ways StudioCue could go
 * down, or quietly stop, that the outage that day pointed at.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("functions have room to start: 512MiB, and the image starts node itself", () => {
  assert.match(read("functions/src/runtime.ts"), /setGlobalOptions\(\{ region: "us-east4", memory: "512MiB" \}\)/);
  const deploy = read("scripts/deploy-functions-self-contained.sh");
  assert.match(deploy, /CMD \["node", "node_modules\/@google-cloud\/functions-framework\/build\/src\/main\.js"\]/);
  assert.match(deploy, /case "\$\{current\}" in 128Mi\|256Mi\|""\) memory="--memory=512Mi"/);
});

test("every scheduler is bound to its invoker, listed or not", () => {
  const script = read("scripts/configure-production-function-invokers.sh");
  assert.match(script, /\n  dailydigestscheduler\n/);
  assert.match(script, /--filter='metadata\.labels\.deployment-scheduled=true'/);
});

test("a disabled secret version a function is pinned to fails the deploy check", () => {
  assert.match(read("scripts/verify-function-images.sh"), /3\. Every secret version a function is pinned to is enabled/);
  assert.match(read("docs/production-secrets.md"), /Redeploy \*\*every\*\* function that mounts the secret/);
});

test("booking triggers retry a blip, give up on a decided error, and stop after two hours", async () => {
  assert.equal(isPermanentTriggerError("PACKAGE_SNAPSHOT_NOT_FOUND"), true);
  assert.equal(isPermanentTriggerError("INVALID_BOOKING_STATE: BOOKED"), true);
  assert.equal(isPermanentTriggerError("10 ABORTED: Too much contention"), false);
  assert.equal(isPermanentTriggerError("fetch failed"), false);
  const now = Date.parse("2026-10-23T12:00:00Z");
  const young = { time: new Date(now - 60_000).toISOString(), id: "e1" };
  const old = { time: new Date(now - BOOKING_TRIGGER_RETRY_WINDOW_MS - 1).toISOString(), id: "e2" };
  await assert.rejects(retryingTrigger("t", young, async () => { throw new Error("14 UNAVAILABLE"); }, now));
  await retryingTrigger("t", old, async () => { throw new Error("14 UNAVAILABLE"); }, now);
  await retryingTrigger("t", young, async () => { throw new Error("PACKAGE_SNAPSHOT_NOT_FOUND"); }, now);
  const orchestration = read("functions/src/booking/orchestration.ts");
  for (const [name, document] of [
    ["bookingProposalAccepted", "proposals/{proposalId}"],
    ["bookingContractCompleted", "contracts/{contractId}"],
    ["bookingRetainerPaid", "invoiceReferences/{invoiceId}"],
  ])
    assert.match(
      orchestration,
      new RegExp(`${name} = onDocumentWritten\\(\\s*\\{ document: "${document.replace(/[{}]/g, "\\$&")}", retry: true \\},\\s*async \\(event\\) => retryingTrigger\\("${name}"`),
      name,
    );
});

test("an inquiry with no App Check token is held, within tighter limits, not refused", () => {
  assert.match(read("components/crm/lead-intake-form.tsx"), /const appCheckToken = await getOptionalAppCheckToken\(\);/);
  const relay = read("app/api/functions/[functionName]/route.ts");
  assert.match(relay, /if \(holdable && !request\.headers\.get\("x-firebase-appcheck"\)\) \{\s*return hold\("no_app_check"\)/);
  // The probe's dummy token must still see an outage.
  assert.match(relay, /if \(reason !== "no_app_check" && held\.status === 401\)\s*return Response\.json\(\{ error: "FUNCTION_UPSTREAM_UNAVAILABLE" \}, \{ status: 502 \}\);/);
  assert.ok(UNVERIFIED_HOLDS_PER_SENDER_PER_HOUR <= 5 && UNVERIFIED_HOLDS_PER_HOUR <= 50);
  assert.match(read("server/intake/hold-inquiry.ts"), /if \(!verified && !\(await withinUnverifiedLimits\(clientAddress\)\)\) return \{ status: 429/);
});
