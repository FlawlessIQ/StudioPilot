import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalMailbox,
  shortAddressTrust,
  shortInquiryAddressFor,
  shortInquirySlugFromRecipients,
  staffMailboxes,
  staffUserIds,
} from "../functions/src/intake/short-address.ts";

const DOMAIN = "inbound.studio-cue.com";

test("a studio's short address is its slug at the inbound domain", () => {
  assert.equal(shortInquiryAddressFor("gr-productions", DOMAIN), "gr-productions@inbound.studio-cue.com");
  assert.equal(shortInquiryAddressFor("reply", DOMAIN), null);
  assert.equal(shortInquiryAddressFor("Not A Slug", DOMAIN), null);
  assert.equal(shortInquiryAddressFor("gr-productions", null), null);
});

test("only a bare local part at our domain is a short address", () => {
  assert.equal(
    shortInquirySlugFromRecipients('["gr-productions@inbound.studio-cue.com"]', DOMAIN),
    "gr-productions",
  );
  assert.equal(
    shortInquirySlugFromRecipients("Studio <GR-Productions@Inbound.Studio-Cue.com>", DOMAIN),
    "gr-productions",
  );
  // The + addresses belong to other routes.
  assert.equal(shortInquirySlugFromRecipients("reply+abcdefghijklmnopq@inbound.studio-cue.com", DOMAIN), null);
  assert.equal(shortInquirySlugFromRecipients("inquiries+gr.Ab3dEf9GhIj@inbound.studio-cue.com", DOMAIN), null);
  assert.equal(shortInquirySlugFromRecipients("coi+abcdefghijklmnopqrstu@inbound.studio-cue.com", DOMAIN), null);
  // Reserved names, and other domains, are not studios.
  assert.equal(shortInquirySlugFromRecipients("postmaster@inbound.studio-cue.com", DOMAIN), null);
  assert.equal(shortInquirySlugFromRecipients("gr-productions@gmail.com", DOMAIN), null);
  assert.equal(shortInquirySlugFromRecipients("gr-productions@inbound.studio-cue.com.evil.test", DOMAIN), null);
});

test("Gmail's forwarding tag is not part of the mailbox", () => {
  assert.equal(
    canonicalMailbox("Gabe+caf_=gr-productions=inbound.studio-cue.com@Gmail.com"),
    "gabe@gmail.com",
  );
  assert.equal(canonicalMailbox("not an address"), null);
});

const own = ["gabe@gmail.com", "hello@grproductions.com"];

test("a Gmail filter forward is trusted by its envelope sender and SPF", () => {
  const trust = shortAddressTrust({
    from: "no-reply@crm.wix.com",
    envelopeFrom: "gabe+caf_=gr-productions=inbound.studio-cue.com@gmail.com",
    auth: { spf: "pass", dkim: "{@wix.com : pass}" },
    own,
    confirmed: [],
  });
  assert.deepEqual(trust, { trusted: true, reason: "studio_mailbox" });
});

test("a hand forward is trusted when the studio's domain signed it", () => {
  const trust = shortAddressTrust({
    from: "hello@grproductions.com",
    envelopeFrom: "bounce@mailer.example",
    auth: { spf: "neutral", dkim: "{@grproductions.com : pass}" },
    own,
    confirmed: [],
  });
  assert.equal(trust.trusted, true);
});

test("a forged From with no passing authentication is not trusted", () => {
  const trust = shortAddressTrust({
    from: "gabe@gmail.com",
    envelopeFrom: "attacker@evil.test",
    auth: { spf: "pass", dkim: "{@evil.test : pass}" },
    own,
    confirmed: [],
  });
  assert.equal(trust.trusted, false);
});

test("the studio's envelope without SPF passing is not trusted", () => {
  const trust = shortAddressTrust({
    from: "no-reply@crm.wix.com",
    envelopeFrom: "gabe@gmail.com",
    auth: { spf: "fail", dkim: null },
    own,
    confirmed: [],
  });
  assert.equal(trust.trusted, false);
});

test("a confirmed form sender emailing StudioCue directly is trusted", () => {
  const trust = shortAddressTrust({
    from: "no-reply@crm.wix.com",
    envelopeFrom: "bounces@crm.wix.com",
    auth: { spf: "pass", dkim: "{@crm.wix.com : pass}" },
    own,
    confirmed: ["no-reply@crm.wix.com"],
  });
  assert.deepEqual(trust, { trusted: true, reason: "confirmed_sender" });
});

test("a stranger goes to review, with a reason the studio can read", () => {
  const trust = shortAddressTrust({
    from: "someone@example.test",
    envelopeFrom: "someone@example.test",
    auth: { spf: "pass", dkim: "{@example.test : pass}" },
    own,
    confirmed: [],
  });
  assert.equal(trust.trusted, false);
  assert.match(trust.trusted ? "" : trust.reason, /someone@example\.test/);
});

// Production, 2026-09-29: GR Productions' owner forwarded an inquiry from the
// address he signs in with. His membership, written at signup, has no email,
// so the forward was held as "Maybe an inquiry" from a sender StudioCue
// "doesn't recognise yet".
test("an owner whose membership has no email is known by their sign-in address", () => {
  const memberships = [
    { userId: "owner", role: "studio_owner", status: "active" },
    { userId: "couple", role: "client", status: "active", email: "couple@example.com" },
    { userId: "crew", role: "subcontractor", status: "active", email: "crew@example.com" },
    { userId: "former", role: "studio_admin", status: "removed", email: "former@example.com" },
    { userId: "coord", role: "studio_coordinator", status: "active", normalizedEmail: "coord@example.com" },
  ];
  assert.deepEqual(staffUserIds(memberships), ["owner", "coord"]);
  const own = staffMailboxes(
    memberships,
    new Map([
      ["owner", "Gabe_Rhodes@GRproductions.tv"],
      ["couple", "couple-login@example.com"],
    ]),
  );
  assert.deepEqual(own, ["gabe_rhodes@grproductions.tv", "coord@example.com"]);

  const trust = shortAddressTrust({
    from: "gabe_rhodes@grproductions.tv",
    envelopeFrom: "gabe_rhodes@grproductions.tv",
    auth: { spf: "pass", dkim: "{@grproductions.tv : pass}" },
    own,
    confirmed: [],
  });
  assert.deepEqual(trust, { trusted: true, reason: "studio_mailbox" });
});

test("without a sign-in address, the same forward is still held for review", () => {
  const own = staffMailboxes([{ userId: "owner", role: "studio_owner", status: "active" }], new Map());
  assert.deepEqual(own, []);
});
