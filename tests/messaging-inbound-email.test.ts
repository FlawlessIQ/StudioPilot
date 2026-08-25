import assert from "node:assert/strict";
import test from "node:test";
import {
  isAutomatedEmail,
  normalizeSubject,
  replyTokenFromRecipients,
  stripQuotedReply,
} from "../features/messaging/inbound-email";

test("a Gmail reply keeps only what the person wrote", () => {
  const raw = [
    "Four o'clock works for us, thanks!",
    "",
    "On Mon, Aug 25, 2026 at 9:14 AM Alder & Muse Photography <",
    "hello@studio-cue.com> wrote:",
    "",
    "> Hi John, confirming the ceremony at 3pm.",
    "> Let me know if that still suits.",
  ].join("\n");
  assert.equal(stripQuotedReply(raw), "Four o'clock works for us, thanks!");
});

test("an Outlook reply cuts at the original-message divider", () => {
  const raw = [
    "Yes, please go ahead.",
    "",
    "-----Original Message-----",
    "From: Alder & Muse",
    "Sent: Monday, August 25, 2026 9:14 AM",
    "Subject: Your schedule",
    "",
    "Confirming the ceremony at 3pm.",
  ].join("\n");
  assert.equal(stripQuotedReply(raw), "Yes, please go ahead.");
});

test("an Outlook header block counts as a quote only with a Sent line", () => {
  const quoted = [
    "Confirmed.",
    "",
    "From: Alder & Muse Photography",
    "Sent: Monday, August 25, 2026 9:14 AM",
    "To: John Smith",
  ].join("\n");
  assert.equal(stripQuotedReply(quoted), "Confirmed.");

  // "From" as prose must survive — this is someone typing, not a mail client.
  const prose = "From the church we walk to the reception. Does that work?";
  assert.equal(stripQuotedReply(prose), prose);
});

test("signatures are trimmed from the end", () => {
  const raw = ["Sounds good.", "", "--", "John Smith", "07700 900000"].join("\n");
  assert.equal(stripQuotedReply(raw), "Sounds good.");
  assert.equal(
    stripQuotedReply("Perfect, see you then.\n\nSent from my iPhone"),
    "Perfect, see you then.",
  );
});

test("a reply that is only a quote falls back rather than storing nothing", () => {
  const raw = "> Are we still on for Saturday?";
  assert.equal(stripQuotedReply(raw), raw);
});

test("empty stays empty", () => {
  assert.equal(stripQuotedReply("   \n\n  "), "");
});

test("the earliest marker wins when a reply contains several", () => {
  const raw = [
    "Short answer: yes.",
    "",
    "On Mon, Aug 25, 2026 John wrote:",
    "> earlier",
    "-----Original Message-----",
  ].join("\n");
  assert.equal(stripQuotedReply(raw), "Short answer: yes.");
});

test("out-of-office and bounce mail is recognised as automated", () => {
  assert.equal(isAutomatedEmail({ "Auto-Submitted": "auto-replied" }), true);
  assert.equal(isAutomatedEmail({ "auto-submitted": "auto-generated" }), true);
  assert.equal(isAutomatedEmail({ "X-Autoreply": "yes" }), true);
  assert.equal(isAutomatedEmail({ Precedence: "bulk" }), true);
  assert.equal(isAutomatedEmail({ "Return-Path": "<>" }), true);
  assert.equal(isAutomatedEmail({ "X-Failed-Recipients": "a@b.com" }), true);
  assert.equal(
    isAutomatedEmail({
      "Content-Type": 'multipart/report; report-type=delivery-status',
    }),
    true,
  );
});

test("a real reply is not mistaken for automation", () => {
  assert.equal(
    isAutomatedEmail({
      "Auto-Submitted": "no",
      From: "john@example.com",
      Subject: "Re: Your schedule",
    }),
    false,
  );
  assert.equal(isAutomatedEmail({}), false);
});

test("the thread token is found among every recipient", () => {
  assert.equal(
    replyTokenFromRecipients(
      "hello@studio-cue.com, reply+Y29udl9hYmMxMjM.9f8e7d@inbound.studio-cue.com",
    ),
    "Y29udl9hYmMxMjM.9f8e7d",
  );
  assert.equal(replyTokenFromRecipients("hello@studio-cue.com"), null);
  // The COI and gallery parsers own their own prefixes; this must not claim them.
  assert.equal(
    replyTokenFromRecipients("coi+abcdefghijklmnopqrst@inbound.studio-cue.com"),
    null,
  );
});

test("stacked reply prefixes collapse to one subject", () => {
  assert.equal(normalizeSubject("Re: Fwd: RE: Your schedule"), "Your schedule");
  assert.equal(normalizeSubject("Your schedule"), "Your schedule");
  // A subject that is only a prefix keeps something rather than becoming empty.
  assert.equal(normalizeSubject("Re:"), "Re:");
});
