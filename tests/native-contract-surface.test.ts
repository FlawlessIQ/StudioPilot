import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NATIVE_SIGNING_GENERALLY_AVAILABLE as featureFlag, nativeSigningOn } from "@/features/contracts/rollout";
import { NATIVE_SIGNING_GENERALLY_AVAILABLE as functionsFlag } from "../functions/src/contracts/commands";
import {
  contractReminderDue,
  contractStillAwaitingSignature,
} from "../functions/src/contracts/reminders";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { formatSigningTime } from "../functions/src/contracts/seal";
import { clientAutomationEmailTypes } from "@/features/imports/existing-booking";
import { PURGE_KEEPS, purgeLineLabel } from "@/features/projects/purge-policy";
import { errorCodeHasCopy } from "@/lib/ai/friendly-error";

/**
 * Everything around a StudioCue contract that is not the signing itself: the
 * rollout switch, the reminders, the emails, and what the rest of the product
 * says about it. Each of these has a failure that would reach a couple.
 */

test("the rollout switch is the same on both sides, and off until counsel has read the wording", () => {
  assert.equal(featureFlag, functionsFlag);
  assert.equal(featureFlag, false);
  assert.equal(nativeSigningOn(null), false);
  assert.equal(nativeSigningOn({ nativeContractSigning: "yes" }), false);
  assert.equal(nativeSigningOn({ nativeContractSigning: true }), true);
});

const reminder = (overrides: Partial<Parameters<typeof contractReminderDue>[0]> = {}) =>
  contractReminderDue({
    provider: "studiocue",
    status: "sent",
    sentAt: "2026-09-20T15:00:00.000Z",
    sentOffsets: [],
    today: "2026-09-25",
    ...overrides,
  });

test("a couple is reminded at 3 and 7 days, latest only, once each", () => {
  assert.equal(reminder({ today: "2026-09-21" }), null, "not the day after");
  assert.equal(reminder({ today: "2026-09-23" }), 3);
  assert.equal(reminder({ today: "2026-09-23", sentOffsets: [3] }), null);
  assert.equal(reminder({ today: "2026-09-27", sentOffsets: [3] }), 7);
  // Found late with nothing sent: the day-7 reminder, not both.
  assert.equal(reminder({ today: "2026-09-29" }), 7);
  assert.equal(reminder({ today: "2026-10-10", sentOffsets: [3, 7] }), null);
  assert.equal(reminder({ status: "viewed", today: "2026-09-23" }), 3);
});

test("no reminder for anything but an unsigned StudioCue contract", () => {
  for (const status of ["completed", "voided", "superseded", "draft"]) {
    assert.equal(reminder({ status }), null, status);
  }
  assert.equal(reminder({ provider: "dropbox_sign" }), null);
  assert.equal(reminder({ sentAt: null }), null);
});

test("a contract email is dropped at send time once the contract no longer waits", () => {
  assert.equal(contractStillAwaitingSignature({ exists: true, status: "sent" }), true);
  assert.equal(contractStillAwaitingSignature({ exists: true, status: "viewed" }), true);
  assert.equal(contractStillAwaitingSignature({ exists: true, status: "completed" }), false);
  assert.equal(contractStillAwaitingSignature({ exists: true, status: "voided" }), false);
  assert.equal(contractStillAwaitingSignature({ exists: false, status: "sent" }), false);
  const worker = readFileSync("functions/src/operations/jobs.ts", "utf8");
  assert.match(worker, /type === "contract_ready" \|\| type === "contract_reminder"/);
  assert.match(worker, /contract_no_longer_awaiting_signature/);
});

test("the reminder is held on a quiet imported booking; the studio's own send is not", () => {
  assert.ok(clientAutomationEmailTypes.includes("contract_reminder"));
  assert.ok(!clientAutomationEmailTypes.includes("contract_ready"));
});

const brand = {
  studioName: "GR Productions",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: null,
  contactEmail: "hello@example.com",
};

test("every contract email says what happens and links where the couple signs", () => {
  const ready = renderEmailTemplate({
    key: "contract_ready",
    brand,
    recipientName: "Erin Walsh",
    projectName: "Erin & Joe's wedding",
    values: { actionUrl: "https://studio-cue.com/client/contract", signerName: "Gabe Rivera" },
  });
  assert.match(ready.subject, /ready to sign/);
  assert.match(ready.text, /Gabe Rivera has already signed/);
  assert.match(ready.html, /https:\/\/studio-cue\.com\/client\/contract/);
  assert.match(ready.text, /proposal you accepted/);

  const reminderEmail = renderEmailTemplate({
    key: "contract_reminder",
    brand,
    recipientName: "Erin Walsh",
    projectName: null,
    values: { portalUrl: "https://studio-cue.com/client" },
  });
  assert.match(reminderEmail.html, /https:\/\/studio-cue\.com\/client\/contract/);

  const signed = renderEmailTemplate({
    key: "contract_signed",
    brand,
    recipientName: "Erin Walsh",
    projectName: null,
    values: { portalUrl: "https://studio-cue.com/client" },
  });
  assert.match(signed.text, /copy of the complete agreement is attached/);
  assert.match(signed.text, /paper copy/);

  const voided = renderEmailTemplate({
    key: "contract_voided",
    brand,
    recipientName: "Erin Walsh",
    projectName: null,
    values: {},
  });
  assert.match(voided.text, /no longer be signed/);

  const studio = renderEmailTemplate({
    key: "studio_contract_signed",
    brand,
    recipientName: null,
    projectName: "Erin & Joe's wedding",
    values: { clientName: "Erin Walsh", retainerAutomatic: false, actionUrl: "https://studio-cue.com/studio/projects/p1" },
  });
  assert.match(studio.subject, /Erin Walsh signed/);
  assert.match(studio.text, /record it on the job/);
});

test("the signed copy travels with the email", () => {
  const worker = readFileSync("functions/src/operations/jobs.ts", "utf8");
  assert.match(worker, /type === "proposal_sent" \|\| type === "contract_signed"/);
});

test("signing times on the certificate are in the event's zone, with the zone named", () => {
  assert.equal(
    formatSigningTime("2026-09-27T00:41:00.000Z", "America/New_York"),
    "September 26, 2026 at 8:41 PM EDT",
  );
});

test("a purge names what it deletes and what it cannot recall", () => {
  assert.equal(purgeLineLabel("contractSignatures", 2), "signature records");
  assert.ok(PURGE_KEEPS.some((line) => /emailed to them when they signed/.test(line)));
});

test("every error a studio or couple can hit on this path reads as English", () => {
  const codes = [
    "NATIVE_SIGNING_NOT_ENABLED",
    "AGREEMENT_TEMPLATE_REQUIRED",
    "AGREEMENT_HAS_PLACEHOLDER_TEXT",
    "CONTRACT_CHANGED",
    "CONTRACT_FIELDS_MISSING",
    "CONTRACT_DRAFT_NOT_FOUND",
    "SIGNED_CONTRACT_CANNOT_BE_VOIDED",
    "CONTRACT_SIGNING_PERMISSION_REQUIRED",
    "DOCUMENT_CHANGED",
    "WRONG_SIGNER",
  ];
  for (const code of codes) assert.ok(errorCodeHasCopy(code), code);
});

test("the portal never hands a couple a draft, and exposes the signed copy only by its own path", () => {
  const route = readFileSync("app/api/client/portal/route.ts", "utf8");
  // Drafts live in contractDrafts, which the portal cannot read at all.
  assert.doesNotMatch(route, /contractDrafts/);
  assert.match(route, /signedCopyPath = `tenants\/\$\{tenantId\}\/projects\/\$\{projectId\}\/contracts\/signed\/\$\{document\.id\}\.pdf`/);
  assert.match(route, /delete sanitized\.signedDocumentId/);
});

test("the sealed copy is the couple's, not the crew's", () => {
  const seal = readFileSync("functions/src/contracts/seal.ts", "utf8");
  assert.doesNotMatch(seal, /visibility: "shared"/);
  assert.match(seal, /visibility: "client"/);
});

test("a recorded signature overtakes a StudioCue contract still out for signature", () => {
  const commands = readFileSync("functions/src/booking/commands.ts", "utf8");
  const record = commands.slice(commands.indexOf('command.type === "recordSignedAgreement"'));
  assert.match(record, /outstandingNative/);
  assert.match(record, /status: "superseded"/);
});

test("Cue's product facts describe both ways a contract gets signed, and neither is Cue's", () => {
  const copilot = readFileSync("functions/src/ai/copilot.ts", "utf8");
  assert.match(copilot, /`Contracts` then `Your agreement`/);
  assert.match(copilot, /signing is the client's or the operator's act, never Cue's/);
});
