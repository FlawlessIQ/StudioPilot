import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  STALE_REMINDER_DAYS,
  billingHoldApplies,
  releaseDecision,
} from "../functions/src/saas/billing-hold.ts";
import { emailTemplateKeys } from "../functions/src/communications/email-templates.ts";

const DAY = 24 * 60 * 60 * 1000;

test("mail to clients and crew on the studio's behalf is held", () => {
  for (const type of [
    "event_reminder",
    "questionnaire_request",
    "questionnaire_reminder",
    "contract_ready",
    "contract_reminder",
    "retainer_invoice",
    "final_invoice",
    "final_payment_reminder",
    "review_request",
    "album_selection_reminder",
    "delivery",
    "crew_reminder",
    "consultation_reminder",
    "manual_message",
    "client_invitation",
  ]) {
    assert.equal(billingHoldApplies("emailJobs", type), true, type);
  }
});

test("StudioCue's own mail, mail to the studio, and a client's copy of their own act still go", () => {
  for (const type of [
    "sign_in_link",
    "password_reset",
    "email_verification",
    "feedback_received",
    "platform_message",
    "studio_new_inquiry",
    "studio_contract_signed",
    "client_message_received",
    "daily_digest",
    "contract_signed",
    "inquiry_acknowledgement",
  ]) {
    assert.equal(billingHoldApplies("emailJobs", type), false, type);
  }
});

test("every studio-facing template is delivered while lapsed", () => {
  // A studio_* template added later must reach the studio too; holding the
  // studio's own notifications would hide its clients from it.
  for (const type of emailTemplateKeys.filter((key) => key.startsWith("studio_"))) {
    assert.equal(billingHoldApplies("emailJobs", type), false, type);
  }
});

test("bills and charges are held; bookkeeping of what already happened is not", () => {
  for (const type of ["create_quickbooks_invoice", "create_stripe_invoice", "release_quickbooks_invoice", "charge_saved_card"]) {
    assert.equal(billingHoldApplies("providerJobs", type), true, type);
  }
  for (const type of [
    "record_quickbooks_payment",
    "void_quickbooks_invoice",
    "reconcile_quickbooks_invoice",
    "move_booking_calendar_events",
    "remove_crew_calendar_invite",
  ]) {
    assert.equal(billingHoldApplies("providerJobs", type), false, type);
  }
  assert.equal(billingHoldApplies("aiJobs", "anything"), false);
  assert.equal(billingHoldApplies("pdfJobs", "anything"), false);
});

test("on release, a reminder parked too long is retired; everything else goes back in the queue", () => {
  const now = Date.parse("2026-11-01T00:00:00.000Z");
  const heldAt = (days: number) => ({ heldAt: new Date(now - days * DAY).toISOString() });
  assert.equal(releaseDecision("emailJobs", { type: "event_reminder", billingHold: heldAt(STALE_REMINDER_DAYS + 1) }, now), "retire");
  assert.equal(releaseDecision("emailJobs", { type: "event_reminder", billingHold: heldAt(3) }, now), "queue");
  // An invoice is never too late; its own send-time check decides.
  assert.equal(releaseDecision("emailJobs", { type: "final_invoice", billingHold: heldAt(40) }, now), "queue");
  assert.equal(releaseDecision("providerJobs", { type: "charge_saved_card", billingHold: heldAt(40) }, now), "queue");
});

test("the worker asks before every email and provider job, and parks instead of sending", () => {
  const jobs = readFileSync("functions/src/operations/jobs.ts", "utf8");
  const process = jobs.slice(jobs.indexOf("export async function processJobDocument"));
  const hold = process.indexOf("billingHoldFor(getFirestore(), collectionName, document)");
  assert.ok(hold > 0, "processJobDocument must check the billing hold");
  assert.ok(hold < process.indexOf("await finish(document, () => providerJob(document))"), "before any send");
  assert.match(process, /await holdJobForBilling\(document, hold\);\s*return \{ claimed: false \};/);
});

test("the release trigger is deployed and fires only on regaining access", () => {
  assert.match(
    readFileSync("functions/src/index.ts", "utf8"),
    /export \{ subscriptionAccessChanged \} from "\.\/saas\/billing-hold\.js";/,
  );
  const hold = readFileSync("functions/src/saas/billing-hold.ts", "utf8");
  assert.match(hold, /document: "subscriptions\/\{tenantId\}"/);
  assert.match(hold, /if \(wasWorking \|\| !isWorking\) return;/);
});

test("a parked email reads as held, not lost, wherever the studio sees it", () => {
  assert.match(readFileSync("components/communications/message-inbox.tsx", "utf8"), /"held_billing"\) return "Held until billing is updated"/);
  assert.match(readFileSync("components/booking/project-booking-workspace.tsx", "utf8"), /invoiceEmailJob\?\.status === "held_billing"/);
});

test("a hold is decided on a fresh read, so a release is never undone by a stale cache", () => {
  // Production, 2026-10-04: released at 17:31:44.064, parked again at
  // 17:31:44.976 by a worker that had cached "read-only" seconds earlier.
  const hold = readFileSync("functions/src/saas/billing-hold.ts", "utf8");
  assert.match(hold, /if \(accessAllowsWork\(access\)\) accessCache\.set\(tenantId, \{ at: Date\.now\(\), access \}\);\s*else accessCache\.delete\(tenantId\);/);
});
