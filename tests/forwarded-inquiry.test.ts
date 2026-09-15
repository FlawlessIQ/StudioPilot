import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventDateFrom,
  inquiryAddressFor,
  inquirySignatureMatches,
  inquiryTokenFromRecipients,
  parseForwardedInquiry,
} from "../functions/src/communications/forwarded-inquiry.ts";

test("a Gmail forward yields the original sender and message", () => {
  const parsed = parseForwardedInquiry({
    forwarderEmail: "studio@example.com",
    today: "2026-09-15",
    text: [
      "FYI new one",
      "",
      "---------- Forwarded message ---------",
      "From: Maren Castillo <maren@example.test>",
      "Date: Mon, Sep 14, 2026 at 9:12 AM",
      "Subject: Wedding photography",
      "To: <studio@example.com>",
      "",
      "Hi! Diego and I are getting married October 9, 2027 at The Ryland Inn.",
      "Are you available?",
    ].join("\n"),
  });
  assert.equal(parsed.senderName, "Maren Castillo");
  assert.equal(parsed.senderEmail, "maren@example.test");
  assert.equal(parsed.eventDate, "2027-10-09");
  assert.match(parsed.message, /^Hi! Diego/);
  assert.equal(parsed.source, "email");
});

test("an Apple Mail forward and a marketplace notice are recognised", () => {
  const parsed = parseForwardedInquiry({
    forwarderEmail: "studio@example.com",
    today: "2026-09-15",
    text: [
      "Begin forwarded message:",
      "",
      "From: The Knot <noreply@theknot.com>",
      "Subject: New message from Priya",
      "",
      "Name: Priya Shah",
      "Email: priya@example.test",
      "Wedding date: 06/12/2027",
    ].join("\n"),
  });
  assert.equal(parsed.source, "the_knot");
  // The Knot's no-reply address is not the couple; the labelled one is.
  assert.equal(parsed.senderEmail, "priya@example.test");
  assert.equal(parsed.senderName, "Priya Shah");
  assert.equal(parsed.eventDate, "2027-06-12");
});

test("the studio forwarding its own note is not taken as the couple", () => {
  const parsed = parseForwardedInquiry({
    forwarderEmail: "studio@example.com",
    today: "2026-09-15",
    text: "---------- Forwarded message ---------\nFrom: Studio <studio@example.com>\n\nEmail: noah@example.test\nWe'd love you for May 3rd, 2028",
  });
  assert.equal(parsed.senderEmail, "noah@example.test");
  assert.equal(parsed.eventDate, "2028-05-03");
});

test("a date is taken only when the message is unambiguous", () => {
  assert.equal(eventDateFrom("Either June 12, 2027 or June 19, 2027", "2026-09-15"), null);
  assert.equal(eventDateFrom("We met March 2, 2025; wedding is 2027-04-10", "2026-09-15"), "2027-04-10");
  assert.equal(eventDateFrom("no date here", "2026-09-15"), null);
});

test("the forwarding address is signed per studio", () => {
  process.env.INBOUND_REPLY_SIGNING_SECRET = "x".repeat(40);
  process.env.SENDGRID_INBOUND_DOMAIN = "reply.example.com";
  const address = inquiryAddressFor("tenant_abc", "alder-and-muse");
  assert.ok(address);
  const token = inquiryTokenFromRecipients(`Studio <${address}>`);
  assert.equal(token?.slug, "alder-and-muse");
  assert.equal(inquirySignatureMatches("tenant_abc", token!.signature), true);
  assert.equal(inquirySignatureMatches("tenant_other", token!.signature), false);
});
