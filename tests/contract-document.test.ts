import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalJson,
  contractDocumentSchema,
  convertImportedAgreement,
  formatMoney,
  importedAgreementText,
  inlineText,
  normaliseTokenKey,
  resolveContractDocument,
  suggestFieldForPlaceholder,
  templateFieldKeys,
  type ContractSources,
} from "@/features/contracts/document";
import { STUDIO_SIGNING_STATEMENT as featureStatement } from "@/features/contracts/esign-consent";
import { contractDocumentHash as serverHash } from "@/server/contracts/document-hash";
import { contractDocumentHash as functionsHash } from "../functions/src/contracts/document-hash";
import { STUDIO_SIGNING_STATEMENT as functionsStatement } from "../functions/src/contracts/commands";

/**
 * StudioCue writes the contract from the studio's own agreement and the
 * proposal the couple accepted, and the couple signs a hash of the result.
 * These pin the parts that make that honest: money only from records, one
 * byte-exact form for the hash, and an imported agreement that comes through
 * with the studio's words intact.
 */

const sources: ContractSources = {
  client: { names: "Erin Walsh & Joe DeMattia", email: "erin@example.com" },
  event: {
    name: "Erin & Joe DeMattia Wedding",
    type: "Wedding",
    date: "2027-06-12",
    venue: null,
  },
  package: {
    name: "Gold Cinematic Package",
    coverage: "2 photographers and 1 videographer, 10 hours",
    deliverables: ["Online gallery", "Highlight film", "10x10 album"],
  },
  pricing: { currency: "USD", totalCents: 640_000, retainerCents: 160_000 },
  paymentSchedule: [
    { label: "Retainer", amountCents: 160_000, dueDate: null },
    { label: "Final balance", amountCents: 480_000, dueDate: "2027-05-15" },
  ],
  studio: { name: "GR Productions", legalName: "GR Productions LLC" },
  contractDate: "2026-09-25",
};

const template = {
  title: "Wedding Agreement",
  body: [
    "# Wedding Agreement",
    "",
    "This agreement is between {{studio.legal_name}} and **{{client.names}}** for {{event.date}} at {{event.venue}}.",
    "",
    "## Fees",
    "The total is {{price.total}}, with a retainer of {{price.retainer}}.",
    "{{payment.schedule}}",
    "",
    "Included:",
    "{{package.deliverables}}",
    "",
    "- Travel within {{custom.travel_radius}}",
    "- Second location: {{custom.second_location}}",
  ].join("\n"),
  customFields: [
    { key: "custom.travel_radius", label: "Travel radius" },
    { key: "custom.second_location", label: "Second location" },
  ],
};

test("the functions copy of the document module is identical", () => {
  assert.equal(
    readFileSync("functions/src/contracts/document.ts", "utf8"),
    readFileSync("features/contracts/document.ts", "utf8"),
  );
});

test("the studio signing statement is the same words on both sides", () => {
  assert.equal(functionsStatement, featureStatement);
});

test("money, dates and the schedule come from the accepted proposal", () => {
  const { document, fields } = resolveContractDocument({ template, sources, overrides: {} });
  const text = JSON.stringify(document);
  assert.match(text, /\$6,400\.00/);
  assert.match(text, /\$1,600\.00/);
  assert.match(text, /Saturday, June 12, 2027/);
  const schedule = document.blocks.find((block) => block.type === "payment_schedule");
  assert.ok(schedule && schedule.type === "payment_schedule");
  assert.deepEqual(schedule.rows, [
    { label: "Retainer", amount: "$1,600.00", due: "As agreed" },
    { label: "Final balance", amount: "$4,800.00", due: "May 15, 2027" },
  ]);
  const deliverables = document.blocks.find(
    (block) => block.type === "list" && block.items.some((item) => inlineText(item) === "Highlight film"),
  );
  assert.ok(deliverables, "deliverables render as a list");
  assert.equal(fields.find((field) => field.key === "price.total")?.source, "record");
});

test("a studio cannot type a different price, date or schedule", () => {
  const { document, fields } = resolveContractDocument({
    template,
    sources,
    overrides: {
      "price.total": "$1.00",
      "event.date": "Never",
      "payment.schedule": "Pay nothing",
    },
  });
  const text = JSON.stringify(document);
  assert.doesNotMatch(text, /\$1\.00|Never|Pay nothing/);
  assert.equal(fields.find((field) => field.key === "price.total")?.value, "$6,400.00");
});

test("a gap the records cannot answer blocks the send until the studio fills it", () => {
  const empty = resolveContractDocument({ template, sources, overrides: {} });
  assert.deepEqual(
    [...empty.unresolved].sort(),
    ["custom.second_location", "custom.travel_radius", "event.venue"],
  );
  assert.match(JSON.stringify(empty.document), /\[event\.venue\]/);

  const filled = resolveContractDocument({
    template,
    sources,
    overrides: {
      "event.venue": "Wildflower Barn",
      "custom.travel_radius": "50 miles",
      "custom.second_location": "Hotel suite",
    },
  });
  assert.deepEqual(filled.unresolved, []);
  assert.equal(filled.fields.find((field) => field.key === "event.venue")?.source, "studio");
  assert.equal(
    filled.fields.find((field) => field.key === "custom.travel_radius")?.label,
    "Travel radius",
  );
});

test("a typed value never replaces one the records hold", () => {
  const { fields } = resolveContractDocument({
    template,
    sources: { ...sources, event: { ...sources.event, venue: "The Real Venue" } },
    overrides: { "event.venue": "Somewhere else" },
  });
  assert.equal(fields.find((field) => field.key === "event.venue")?.value, "The Real Venue");
});

test("markup in an agreement stays text", () => {
  const { document } = resolveContractDocument({
    template: {
      title: "<script>x</script>",
      body: "<img src=x onerror=alert(1)> **bold <b>html</b>** {{client.names}}\n\n- <a href='x'>link</a>",
      customFields: [],
    },
    sources,
    overrides: {},
  });
  // The document holds strings; nothing is ever interpreted. Renderers escape.
  const paragraph = document.blocks[0];
  assert.ok(paragraph && paragraph.type === "paragraph");
  assert.match(inlineText(paragraph.content), /<img src=x onerror=alert\(1\)>/);
  assert.ok(paragraph.content.some((piece) => piece.bold && piece.text.includes("<b>html</b>")));
  contractDocumentSchema.parse(document);
});

test("the hash is stable across key order and Unicode forms, and moves with any change", () => {
  const { document } = resolveContractDocument({ template, sources, overrides: { "event.venue": "Café Nuit" } });
  const reverseKeys = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverseKeys)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .reverse()
              .map(([key, inner]) => [key, reverseKeys(inner)]),
          )
        : value;
  const reordered = reverseKeys(document) as typeof document;
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(document));
  assert.equal(canonicalJson(reordered), canonicalJson(document));
  const decomposed = resolveContractDocument({
    template,
    sources,
    overrides: { "event.venue": "Café Nuit" },
  }).document;
  assert.equal(serverHash(decomposed), serverHash(document));
  const changed = resolveContractDocument({ template, sources, overrides: { "event.venue": "Café Nuits" } }).document;
  assert.notEqual(serverHash(changed), serverHash(document));
  assert.equal(functionsHash(document), serverHash(document));
  assert.match(serverHash(document), /^[a-f0-9]{64}$/);
});

test("field keys are found in first-use order, and loose tokens become custom fields", () => {
  assert.deepEqual(templateFieldKeys("{{client.names}} {{ Venue Notes }} {{client.names}}"), [
    "client.names",
    "custom.venue_notes",
  ]);
  assert.equal(normaliseTokenKey("custom.travel_radius"), "custom.travel_radius");
  assert.equal(formatMoney(123_456, "usd"), "$1,234.56");
});

/**
 * The shape the reference studio's agreement actually arrives in: a docx run
 * through the importer, with bracketed placeholders in capitals, angle-bracket
 * fields, all-caps clause headings and paper signature lines at the end.
 */
const importedGabeStyle = `PHOTOGRAPHY & VIDEOGRAPHY SERVICES AGREEMENT

This Agreement is made on [DATE OF AGREEMENT] between GR Productions ("Photographer") and [CLIENT NAME] ("Client").

1. EVENT DETAILS
Event Date: <<Event Date>>
Venue: [VENUE]
Package: [PACKAGE]

2. FEES
The total fee is [TOTAL FEE]. A non-refundable retainer of [RETAINER AMOUNT] is due on signing. The remaining balance of [BALANCE] is due 30 days before the event.

3. SECOND SHOOTER
A second shooter will cover [SECOND SHOOTER HOURS] of the day.

Client Signature: ______________________   Date: __________
Photographer Signature: ______________________   Date: __________
`;

test("an imported agreement keeps its wording and gains fields StudioCue can fill", () => {
  const conversion = convertImportedAgreement(importedGabeStyle);
  assert.match(conversion.body, /\{\{client\.names\}\}/);
  assert.match(conversion.body, /\{\{event\.date\}\}/);
  assert.match(conversion.body, /\{\{event\.venue\}\}/);
  assert.match(conversion.body, /\{\{package\.name\}\}/);
  assert.match(conversion.body, /\{\{price\.total\}\}/);
  assert.match(conversion.body, /\{\{price\.retainer\}\}/);
  assert.match(conversion.body, /\{\{price\.balance\}\}/);
  assert.match(conversion.body, /\{\{contract\.date\}\}/);
  // "Second shooter hours" names nothing StudioCue holds as one value — it is
  // the studio's to fill, and it says so in its own words.
  const hours = conversion.mapped.find((entry) => entry.placeholder === "SECOND SHOOTER HOURS");
  assert.ok(hours);
  assert.equal(hours.key, "package.coverage");
  // The first line is the title, printed once — not also a heading.
  assert.equal(conversion.title, "Photography & Videography Services Agreement");
  assert.doesNotMatch(conversion.body, /SERVICES AGREEMENT/);
  // Clause headings survive as headings, wording untouched.
  assert.match(conversion.body, /^## 2\. FEES$/m);
  assert.match(conversion.body, /is due 30 days before the event\./);
  // StudioCue adds the signature page; the paper lines go.
  assert.equal(conversion.signatureLinesRemoved, 2);
  assert.doesNotMatch(conversion.body, /_{5,}/);
});

test("a placeholder with no clear meaning becomes a named custom field", () => {
  const conversion = convertImportedAgreement("Getting ready at [BRIDAL SUITE LOCATION NOTES] and <<Officiant>>.");
  assert.ok(conversion.customFields.some((field) => field.label === "Officiant"));
  assert.equal(suggestFieldForPlaceholder("Officiant"), null);
  assert.equal(suggestFieldForPlaceholder("Couple's names"), "client.names");
  assert.equal(suggestFieldForPlaceholder("Deposit"), "price.retainer");
  // Found on a real walk: "location" alone is the venue, but a getting-ready
  // or second location is not, and must be the studio's to fill.
  assert.equal(suggestFieldForPlaceholder("VENUE"), "event.venue");
  assert.equal(suggestFieldForPlaceholder("Location"), "event.venue");
  assert.equal(suggestFieldForPlaceholder("Ceremony location"), "event.venue");
  assert.equal(suggestFieldForPlaceholder("GETTING READY LOCATION"), null);
  assert.equal(suggestFieldForPlaceholder("Second location"), null);
});

test("the imported body is found whichever extractor wrote it", () => {
  assert.equal(importedAgreementText({ body: "A", sourceText: "B" }), "A");
  assert.equal(importedAgreementText({ sourceText: "B" }), "B");
  assert.equal(importedAgreementText("C"), "C");
  assert.equal(importedAgreementText(null), "");
});

/**
 * The shape production actually handed us (2026-09-25): an agreement imported
 * from a PDF as one unbroken line, clauses marked only by "Label:" openers, and
 * no placeholder anywhere for the couple, the date or the price. It would have
 * gone out as a wall of terms naming nobody.
 */
const flattenedImport =
  "It is agreed that the following terms form part of this Contract. Booking Fee: A retainer per crew member is required when the client signs. Dates are reserved when it is paid. Payment & Prices: No images are released until payment is complete. Prices hold for 90 days after the event. Cancellation: The retainer is non-refundable. Rescheduling is subject to a 25% fee. Limitation of Liability: Liability is limited to the money paid. Neither party is liable for indirect losses. Copyright: All images remain the property of the studio.";

test("a flattened import is split back into its clauses, labels in bold", () => {
  const conversion = convertImportedAgreement(flattenedImport);
  assert.equal(conversion.clausesRestored, 5);
  for (const label of ["Booking Fee", "Payment & Prices", "Cancellation", "Limitation of Liability", "Copyright"]) {
    assert.match(conversion.body, new RegExp(`\\n\\n\\*\\*${label.replace("&", "\\&")}:\\*\\* `));
  }
  // Nothing of the studio's wording is lost or reordered.
  assert.match(conversion.body, /Rescheduling is subject to a 25% fee\.\n\n\*\*Limitation/);
});

test("an agreement that never names the couple gets a details section filled from the job", () => {
  const conversion = convertImportedAgreement(flattenedImport);
  assert.equal(conversion.detailsAdded, true);
  assert.match(conversion.body, /^## The details\n/);
  assert.match(conversion.body, /\{\{client\.names\}\}/);
  assert.match(conversion.body, /\{\{price\.total\}\}/);
  assert.match(conversion.body, /\n## Terms\n/);
  const { document, unresolved } = resolveContractDocument({
    template: { title: "Agreement", body: conversion.body, customFields: conversion.customFields },
    sources: { ...sources, event: { ...sources.event, venue: "The Barn" } },
    overrides: {},
  });
  assert.deepEqual(unresolved, []);
  const text = JSON.stringify(document);
  assert.match(text, /Erin Walsh & Joe DeMattia/);
  assert.match(text, /\$6,400\.00/);
});

test("an agreement that already names the couple is not given a second details section", () => {
  assert.equal(convertImportedAgreement(importedGabeStyle).detailsAdded, false);
  // Text that already has its line breaks is left as written.
  assert.equal(convertImportedAgreement(importedGabeStyle).clausesRestored, 0);
});
