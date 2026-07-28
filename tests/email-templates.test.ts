import assert from "node:assert/strict";
import test from "node:test";
import {
  emailTemplateKeys,
  renderEmailTemplate,
} from "../functions/src/communications/email-templates.ts";

const brand = {
  studioName: "Alder & Muse Photography",
  productName: "StudioCue",
  accentColor: "#35664a",
  logoUrl: "https://example.com/logo.png",
  contactEmail: "hello@example.com",
};

const values = {
  inviteUrl: "https://example.com/invite",
  actionUrl: "https://example.com/action",
  destinationUrl: "https://example.com/review",
  invoiceUrl: "https://example.com/invoice",
  portalUrl: "https://example.com/portal",
  scheduleUrl: "https://example.com/schedule",
  galleryUrl: "https://example.com/gallery",
  startsAt: "2027-06-12T14:00:00.000Z",
  location: "Studio consultation room",
  reason: "The venue address needs to be corrected.",
  venueName: "The Garden Conservatory",
  requirement: {
    venueLegalName: "Garden Conservatory LLC",
    eventDate: "2027-06-12",
    certificateHolder: "Garden Conservatory LLC",
    dueDate: "2027-05-12",
  },
};

test("every transactional template renders branded HTML and plain text", () => {
  for (const key of emailTemplateKeys) {
    const rendered = renderEmailTemplate({
      key,
      brand,
      recipientName: "Jordan Rivera",
      projectName: "Rivera wedding",
      values,
    });
    assert.ok(rendered.subject.length > 5, key);
    assert.ok(rendered.preheader.length > 5, key);
    assert.match(rendered.html, /Alder &amp; Muse Photography/);
    assert.match(rendered.html, /StudioCue/);
    assert.match(rendered.html, /type="text\/html"|<!doctype html>/i);
    assert.match(rendered.text, /Alder & Muse Photography/);
    assert.doesNotMatch(rendered.text, /<table|<div|<p/i);
  }
});

test("email content escapes tenant and recipient supplied HTML", () => {
  const rendered = renderEmailTemplate({
    key: "client_invitation",
    brand: {
      ...brand,
      studioName: "<script>bad()</script>",
      logoUrl: "javascript:alert(1)",
    },
    recipientName: "<img src=x onerror=bad()>",
    projectName: "Smith & Jones",
    values,
  });
  assert.doesNotMatch(rendered.html, /<script>|<img src=x/i);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /javascript:/i);
});

test("unknown email types receive the same branded safe fallback", () => {
  const rendered = renderEmailTemplate({
    key: "future_notification",
    brand,
    values: { actionUrl: "https://example.com/update" },
  });
  assert.equal(
    rendered.subject,
    "Alder & Muse Photography sent you an update",
  );
  assert.match(rendered.html, /View update/);
  assert.match(rendered.text, /https:\/\/example.com\/update/);
});
