import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  AUTH_EMAIL_TYPES,
  emailTemplateKeys,
  isAuthEmailType,
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

test("a written list arrives as a list, not one run-on paragraph", () => {
  const rendered = renderEmailTemplate({
    key: "manual_message",
    brand,
    recipientName: "John Smith",
    projectName: "Smith wedding",
    values: {
      customSubject: "A few questions about your wedding day",
      customBody: [
        "A few questions so we can plan your day properly:",
        "",
        "- What is the confirmed ceremony start time?",
        "- What is the confirmed reception start time?",
        "- Are you planning a first look?",
        "",
        "No rush — whatever you know so far helps.",
      ].join("\n"),
    },
  });
  // The questions were arriving inside a single <p>, hyphens and all.
  assert.match(rendered.html, /<ul class="email-list"/);
  assert.equal(rendered.html.match(/<li /g)?.length, 3);
  assert.doesNotMatch(rendered.html, /<p[^>]*>- What is the confirmed ceremony/);
  // The lead-in and the sign-off stay prose.
  assert.match(rendered.html, /<p[^>]*>A few questions so we can plan/);
  assert.match(rendered.html, /<p[^>]*>No rush/);
  // Plain-text alternative keeps one item per line.
  assert.match(
    rendered.text,
    /- What is the confirmed ceremony start time\?\n- What is the confirmed reception start time\?/,
  );
});

test("a greeting uses the first name, and skips an honorific", () => {
  const greetingFor = (recipientName: string) =>
    renderEmailTemplate({
      key: "manual_message",
      brand,
      recipientName,
      values: { customSubject: "Hello", customBody: "An update for you." },
    }).text;
  assert.match(greetingFor("John Smith"), /Hi John,/);
  assert.match(greetingFor("Dr. Amara Osei"), /Hi Amara,/);
  assert.match(greetingFor("Prakash"), /Hi Prakash,/);
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
  // First name, not the contact record's full name.
  assert.equal(rendered.text.match(/Hi John,/g)?.length, 1);
  assert.doesNotMatch(rendered.text, /Hi John Smith,/);
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

/**
 * A key that renders is not a key that is handled.
 *
 * `copyFor` ends in a `default:` that returns "There's an update from your
 * studio" with no action button — deliberately, for a type nobody wrote copy
 * for. The loop above proves every key renders valid HTML, and a key falling
 * into that default renders valid HTML too, so it passed while producing an
 * email that says nothing and links nowhere.
 *
 * That is exactly what a crew member received: a roster invitation whose whole
 * purpose is a link, delivered as a contentless notice with no link in it. The
 * cause there was a stale deploy rather than missing code, but the failure mode
 * is the same either way and nothing detected it — the job recorded "succeeded".
 */
test("no published template key falls through to the generic update", () => {
  // The subject is not the tell: `manual_message` legitimately falls back to
  // "<studio> sent you an update" when the studio writes no subject of its
  // own, while having a full case and its own heading. The eyebrow is — only
  // the default branch says "Project update".
  const generic = renderEmailTemplate({
    key: "not_a_real_template_key" as (typeof emailTemplateKeys)[number],
    brand,
    values,
  });
  assert.ok(generic.html.includes("Project update"), "the tell moved");
  for (const key of emailTemplateKeys) {
    const rendered = renderEmailTemplate({ key, brand, values });
    assert.ok(
      !rendered.html.includes("Project update"),
      `${key} has no copy of its own and sends the generic update instead`,
    );
  }
});

// ---- P3: auth mail is platform-branded and tracking-free ----

test("auth mail types are the platform account-security messages", () => {
  assert.deepEqual(
    [...AUTH_EMAIL_TYPES],
    ["email_verification", "password_reset", "sign_in_link"],
  );
  assert.equal(isAuthEmailType("email_verification"), true);
  assert.equal(isAuthEmailType("password_reset"), true);
  assert.equal(isAuthEmailType("sign_in_link"), true);
  assert.equal(isAuthEmailType("client_invitation"), false);
  assert.equal(isAuthEmailType("proposal_sent"), false);
});

test("platform-branded mail (studio === product) drops the 'powered by' credit", () => {
  const platform = {
    studioName: "StudioCue",
    productName: "StudioCue",
    accentColor: "#35664a",
    logoUrl: null,
    contactEmail: null,
  };
  const rendered = renderEmailTemplate({
    key: "email_verification",
    brand: platform,
    recipientName: "Jordan Rivera",
    projectName: null,
    values: { actionUrl: "https://studio-cue.com/auth/verify-email?oobCode=x" },
  });
  // No "StudioCue · Powered by StudioCue" / "using StudioCue" redundancy.
  assert.ok(!rendered.text.includes("Powered by"), "text keeps no powered-by");
  assert.ok(!rendered.text.includes("using StudioCue"), "text keeps no using-line");
  assert.ok(!rendered.html.includes("powered by"), "html keeps no powered-by");
  assert.match(rendered.text, /Sent by StudioCue\./);

  // A real studio brand still gets its credit (studio !== product).
  const tenant = renderEmailTemplate({
    key: "email_verification",
    brand: { ...platform, studioName: "Alder & Muse", productName: "StudioCue" },
    recipientName: "Jordan",
    projectName: null,
    values: {},
  });
  assert.ok(tenant.text.includes("Powered by StudioCue"));
  assert.ok(tenant.text.includes("Sent by Alder & Muse using StudioCue"));
});

// The send path is Firebase-heavy, so guard by source: auth mail must disable
// SendGrid click/open tracking and be fed the platform brand. This mirrors the
// original invisible-gap pattern — nothing exercised the worker end to end.
test("send worker disables tracking and platform-brands auth mail (source guard)", () => {
  const src = readFileSync("functions/src/operations/jobs.ts", "utf8");
  assert.match(src, /isAuthEmailType\(type\)/, "tracking gate keyed on auth type");
  assert.match(src, /click_tracking:\s*\{\s*enable:\s*false/, "click tracking off");
  assert.match(src, /open_tracking:\s*\{\s*enable:\s*false/, "open tracking off");
  assert.match(src, /isAuthEmailType\(templateKey\)/, "brand override keyed on auth type");
});
