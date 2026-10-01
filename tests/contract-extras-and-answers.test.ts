import assert from "node:assert/strict";
import { test } from "node:test";

import { contractFormAnswers } from "../functions/src/contracts/form-answers";
import { contractExtras } from "../functions/src/contracts/sources";
import { resolveContractDocument } from "@/features/contracts/document";

/**
 * GR Productions, 2026-10-01: the agreement's total included a $500
 * engagement shoot and a $200 discount that it never named, and the couple's
 * details-form answers never reached it at all.
 */

test("form answers are read from the map the form saves, in the order asked", () => {
  const sections = [
    {
      fields: [
        { id: "ceremony-start", label: "Ceremony start", type: "time" },
        { id: "studio-note", label: "Internal note", type: "long_text", internalOnly: true },
        { id: "venue", label: "Ceremony venue", type: "text" },
        { id: "contract", label: "Upload", type: "file" },
        { id: "social-consent", label: "May we share images?", type: "acknowledgement" },
        { id: "unanswered", label: "Anything else?", type: "long_text" },
      ],
    },
  ];
  const rows = contractFormAnswers({
    sections,
    answers: {
      venue: " The Park Savoy Estate ",
      "ceremony-start": "17:30",
      "studio-note": "deposit late",
      contract: { name: "plan.pdf" },
      "social-consent": true,
    },
  });
  assert.deepEqual(rows, [
    { question: "Ceremony start", answer: "5:30 PM" },
    { question: "Ceremony venue", answer: "The Park Savoy Estate" },
    { question: "May we share images?", answer: "Confirmed" },
  ]);
});

test("an older array of {question, answer} rows still reads", () => {
  assert.deepEqual(
    contractFormAnswers({ sections: [], answers: [{ question: "Venue", answer: "Barn" }, { question: "x" }] }),
    [{ question: "Venue", answer: "Barn" }],
  );
  assert.deepEqual(contractFormAnswers({ sections: undefined, answers: undefined }), []);
});

test("extras are named with their price under the package they belong to", () => {
  assert.deepEqual(
    contractExtras(
      [
        { name: "Engagement shoot", quantity: 1, unitPriceCents: 50_000, lineTotalCents: 50_000 },
        { name: "Album spreads", quantity: 2, unitPriceCents: 15_000, lineTotalCents: 30_000 },
        { name: "" },
      ],
      "USD",
    ),
    ["Engagement shoot (extra, $500.00)", "Album spreads ×2 (extra, $300.00)"],
  );
  assert.deepEqual(contractExtras(undefined, "USD"), []);
});

test("the total says when a discount was taken off it", () => {
  const sources = {
    client: { names: "Beth Betherson", email: "beth@example.com" },
    event: { name: "Beth's wedding", type: "Wedding", date: "2026-10-03", venue: null },
    packages: [],
    package: { name: "Gold Photo Package", coverage: null, deliverables: [] },
    pricing: { currency: "USD", totalCents: 909_800, retainerCents: 500, discountCents: 20_000 },
    paymentSchedule: [],
    formAnswers: [],
    studio: { name: "GR Productions", legalName: null, address: null, phone: null, email: null, website: null },
    contractDate: "2026-10-01",
  };
  const fee = (discountCents: number) =>
    resolveContractDocument({
      template: { title: "Agreement", body: "The total fee is {{price.total}}.", customFields: [] },
      sources: { ...sources, pricing: { ...sources.pricing, discountCents } },
      overrides: {},
    }).fields.find((field) => field.key === "price.total")?.value;
  assert.equal(fee(20_000), "$9,098.00 (after a $200.00 discount)");
  assert.equal(fee(0), "$9,098.00");
});
