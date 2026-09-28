import assert from "node:assert/strict";
import { test } from "node:test";
import {
  envelopeSender,
  eventDateFrom,
  headerValue,
  inboundRecipients,
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

test("a Gmail filter auto-forward is found by its envelope, not its To header", () => {
  // Gmail keeps the original headers when a filter forwards: To: is still the
  // studio's own mailbox, and only the envelope names the inquiry address.
  const fields = {
    envelope: JSON.stringify({
      to: ["inquiries+gr-productions.Ab3dEf9GhIj@inbound.studio-cue.com"],
      from: "gabe+caf_=inquiries+gr-productions.Ab3dEf9GhIj=inbound.studio-cue.com@gmail.com",
    }),
    to: "gabe@grproductions.com",
  };
  const headers = { To: "gabe@grproductions.com", From: "Wix Forms <no-reply@crm.wix.com>" };
  const recipients = inboundRecipients(fields, headers);
  assert.deepEqual(inquiryTokenFromRecipients(recipients), {
    slug: "gr-productions",
    signature: "Ab3dEf9GhIj",
  });
  assert.equal(
    envelopeSender(fields),
    "gabe+caf_=inquiries+gr-productions.ab3def9ghij=inbound.studio-cue.com@gmail.com",
  );
});

test("a hand forward, with the address in To, still resolves", () => {
  const recipients = inboundRecipients(
    { to: "inquiries+gr-productions.Ab3dEf9GhIj@inbound.studio-cue.com" },
    {},
  );
  assert.equal(inquiryTokenFromRecipients(recipients)?.slug, "gr-productions");
});

test("a missing or malformed envelope falls back to the headers", () => {
  const recipients = inboundRecipients(
    { envelope: "not json" },
    { to: "inquiries+gr-productions.Ab3dEf9GhIj@inbound.studio-cue.com" },
  );
  assert.equal(inquiryTokenFromRecipients(recipients)?.slug, "gr-productions");
  assert.equal(envelopeSender({ envelope: "not json" }), null);
});

test("headers are found whatever case the sender wrote them in", () => {
  assert.equal(headerValue({ "Message-Id": "<a@b>" }, "Message-ID"), "<a@b>");
  assert.equal(headerValue({}, "Message-ID"), undefined);
});

test("the public form rate limit keys on the couple, not the relay", async () => {
  const { requestFingerprint } = await import("../functions/src/crm/security.ts");
  const behindRelay = (client: string) =>
    ({
      header: (name: string) =>
        ({ "x-studiohub-client-ip": client, "x-forwarded-for": "10.0.0.1" })[name.toLowerCase()],
      ip: "10.0.0.1",
    }) as unknown as Parameters<typeof requestFingerprint>[0];
  const first = requestFingerprint(behindRelay("203.0.113.7"), "lead:t1");
  const second = requestFingerprint(behindRelay("198.51.100.4"), "lead:t1");
  assert.notEqual(first, second);
  assert.equal(first, requestFingerprint(behindRelay("203.0.113.7"), "lead:t1"));
});
