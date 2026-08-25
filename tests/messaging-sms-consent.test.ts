import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConsentIntent,
  canSendSms,
  consentIntentOf,
  optOutAcknowledgement,
  unknownSmsConsent,
  type SmsConsent,
} from "../features/messaging/sms-consent";

const granted: SmsConsent = {
  state: "granted",
  decidedAt: "2026-08-01T10:00:00.000Z",
  source: "portal_checkbox",
  recordedBy: "user_1",
  disclosureText: "Text me about my booking.",
};

test("never having asked is not permission", () => {
  assert.equal(canSendSms(unknownSmsConsent, "+15550109999").allowed, false);
  assert.match(
    String(canSendSms(unknownSmsConsent, "+15550109999").reason),
    /has not agreed/i,
  );
  // Missing consent record entirely behaves the same way.
  assert.equal(canSendSms(null, "+15550109999").allowed, false);
  assert.equal(canSendSms(undefined, "+15550109999").allowed, false);
});

test("consent granted with a valid number allows a send", () => {
  const decision = canSendSms(granted, "+15550109999");
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, null);
});

test("a revoked client is never textable, and the reason says why", () => {
  const revoked: SmsConsent = { ...granted, state: "revoked" };
  const decision = canSendSms(revoked, "+15550109999");
  assert.equal(decision.allowed, false);
  assert.match(String(decision.reason), /asked to stop/i);
});

test("a number that is not E.164 blocks the send", () => {
  for (const phone of ["555-010-9999", "15550109999", "", null, "+1555"]) {
    assert.equal(canSendSms(granted, phone).allowed, false, String(phone));
  }
});

test("carrier opt-out keywords are honoured whatever the casing or punctuation", () => {
  for (const body of ["STOP", "stop", "Stop.", "  STOP  ", "unsubscribe", "Cancel!", "QUIT"]) {
    assert.equal(consentIntentOf(body), "opt_out", body);
  }
});

test("a keyword inside a sentence is prose, not an opt-out", () => {
  assert.equal(consentIntentOf("Stop by the church at 2 please"), "none");
  assert.equal(consentIntentOf("cancel the second photographer"), "none");
  assert.equal(consentIntentOf("Can you end the coverage at 10?"), "none");
});

test("stop please still counts — people are polite", () => {
  assert.equal(consentIntentOf("stop please"), "opt_out");
});

test("opt-in keywords bring a stopped client back", () => {
  for (const body of ["START", "start", "Unstop", "YES"]) {
    assert.equal(consentIntentOf(body), "opt_in", body);
  }
});

test("an ordinary text leaves consent untouched", () => {
  assert.equal(consentIntentOf("Can we move the ceremony to 4pm?"), "none");
  const unchanged = applyConsentIntent(
    granted,
    "Can we move the ceremony to 4pm?",
    "2026-08-25T10:00:00.000Z",
    "+15550109999",
  );
  assert.deepEqual(unchanged, granted);
});

test("replying STOP records a revocation with its evidence", () => {
  const revoked = applyConsentIntent(
    granted,
    "STOP",
    "2026-08-25T10:00:00.000Z",
    "+15550109999",
  );
  assert.equal(revoked.state, "revoked");
  assert.equal(revoked.decidedAt, "2026-08-25T10:00:00.000Z");
  assert.equal(revoked.source, "sms_reply");
  assert.equal(revoked.recordedBy, "+15550109999");
  // The wording originally agreed to survives the revocation as evidence.
  assert.equal(revoked.disclosureText, granted.disclosureText);
  assert.equal(canSendSms(revoked, "+15550109999").allowed, false);
});

test("replying START after a stop restores consent", () => {
  const revoked = applyConsentIntent(
    granted,
    "STOP",
    "2026-08-25T10:00:00.000Z",
    "+15550109999",
  );
  const restored = applyConsentIntent(
    revoked,
    "START",
    "2026-08-26T10:00:00.000Z",
    "+15550109999",
  );
  assert.equal(restored.state, "granted");
  assert.equal(canSendSms(restored, "+15550109999").allowed, true);
});

test("the opt-out acknowledgement names the studio and the way back", () => {
  const text = optOutAcknowledgement("Alder & Muse");
  assert.match(text, /Alder & Muse/);
  assert.match(text, /START/);
});
