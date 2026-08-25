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

test("tenant template versions substitute only allow-listed variables and escape HTML", () => {
  const rendered = renderEmailTemplate({
    key: "client_invitation",
    brand,
    recipientName: "Jordan <Admin>",
    projectName: "Rivera wedding",
    values,
    template: {
      subject: "{{studioName}} has an update for {{projectName}}",
      preheader: "Private project details",
      eyebrow: "Made for {{recipientName}}",
      heading: "Welcome, {{recipientName}}",
      paragraphs: [
        "Your project is {{projectName}}.",
        "Unknown variables stay empty: {{notAllowed}}.",
      ],
      actionLabel: "Open {{projectName}}",
      note: "Sent securely by {{studioName}}",
    },
  });
  assert.equal(
    rendered.subject,
    "Alder & Muse Photography has an update for Rivera wedding",
  );
  assert.match(rendered.html, /Welcome, Jordan &lt;Admin&gt;/);
  assert.doesNotMatch(rendered.html, /\{\{notAllowed\}\}/);
  assert.match(rendered.text, /Open Rivera wedding/);
});

test("the event preparation reminder includes the photographer's detail checklist", () => {
  const rendered = renderEmailTemplate({
    key: "event_reminder",
    brand,
    recipientName: "Jordan Rivera",
    projectName: "Rivera wedding",
    values,
  });
  for (const item of [
    "dress on a hanger",
    "shoes",
    "flowers",
    "rings",
    "invitation suite",
  ]) {
    assert.match(rendered.text.toLowerCase(), new RegExp(item));
  }
});

test("crew invitations include the decision-critical assignment details", () => {
  const rendered = renderEmailTemplate({
    key: "crew_invitation",
    brand,
    recipientName: "Jordan Rivera",
    projectName: "Rivera wedding",
    values: {
      inviteUrl: "https://example.com/crew/accept",
      role: "Second photographer",
      arrivalAt: "2027-06-12T14:00:00.000Z",
      departureAt: "2027-06-13T00:00:00.000Z",
      respondBy: "2027-05-12T21:00:00.000Z",
      locationName: "The Garden Conservatory",
      locationAddress: "21 Orchard Lane",
      compensationCents: 85000,
      compensationType: "flat",
      compensationVisibleToCrew: true,
      currency: "USD",
    },
  });

  assert.match(rendered.subject, /Second photographer/);
  assert.match(rendered.text, /Role: Second photographer/);
  assert.match(rendered.text, /The Garden Conservatory/);
  assert.match(rendered.text, /21 Orchard Lane/);
  assert.match(rendered.text, /\$850\.00 total/);
  assert.match(rendered.text, /Please respond by/);
  assert.match(rendered.text, /https:\/\/example.com\/crew\/accept/);
});

test("manual emails render one greeting, no duplicate sign-off, and a compact project heading", () => {
  const rendered = renderEmailTemplate({
    key: "manual_message",
    brand,
    recipientName: "John Smith",
    projectName: "Smith wedding",
    values: {
      customSubject: "Following Up: Your Smith Wedding Photography Proposal",
      customBody:
        "Hi John Smith, It was a pleasure speaking with you. Please review the proposal. Best, Alder & Muse Photography",
    },
  });
  assert.equal(rendered.text.match(/Hi John Smith,/g)?.length, 1);
  assert.doesNotMatch(rendered.text, /Best, Alder & Muse Photography/);
  assert.match(rendered.text, /A note about Smith wedding/);
  assert.doesNotMatch(rendered.html, />Following Up: Your Smith Wedding Photography Proposal<\/h1>/);
  assert.match(rendered.html, /@media screen and \(max-width:600px\)/);
});

test("the retainer email is the studio's, and carries a way to pay", () => {
  // Until now QuickBooks sent this mail: its subject, its branding, and for
  // a company file with no company name set, "No company name" three times
  // over. `retainer_invoice` had been written and never enqueued by
  // anything. StudioCue sends it now, so it has to stand on its own.
  const rendered = renderEmailTemplate({
    key: "retainer_invoice",
    brand,
    recipientName: "Priya",
    projectName: "Priya & Sam",
    values: { ...values, invoiceUrl: "https://quickbooks.example/pay/6" },
  });
  assert.match(rendered.subject, /Alder & Muse Photography/);
  assert.doesNotMatch(rendered.subject, /QuickBooks/i);
  // The pay link is the point of the email.
  assert.match(rendered.html, /https:\/\/quickbooks\.example\/pay\/6/);
  assert.match(rendered.text, /https:\/\/quickbooks\.example\/pay\/6/);

  // A company with no online payment link still gets an actionable email —
  // the worker falls back to the portal, and an invoice email with nowhere
  // to pay is a notification, not an invoice.
  const fallback = renderEmailTemplate({
    key: "retainer_invoice",
    brand,
    recipientName: "Priya",
    projectName: "Priya & Sam",
    values: { ...values, invoiceUrl: "https://studio-cue.com/client" },
  });
  assert.match(fallback.html, /https:\/\/studio-cue\.com\/client/);
});
