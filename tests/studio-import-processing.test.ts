import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageForAssetTypes,
  deterministicExtraction,
  simulateStudioImport,
  validateExtractedAsset,
} from "../functions/src/studio-import/extraction.ts";
import {
  importedDeliveryDefaults,
  importedMessageTemplate,
  importedReviewLink,
} from "../functions/src/studio-import/native-assets.ts";

test("studio import deterministically classifies and structures familiar source text", () => {
  const [asset] = deterministicExtraction({
    name: "signature-wedding-package.txt",
    text: [
      "Signature Wedding Collection",
      "Eight hours photography — $4,800",
      "Second photographer — $900",
      "Delivery within 8 weeks",
    ].join("\n"),
  });
  assert.equal(asset?.assetType, "package");
  assert.deepEqual(asset?.structuredContent.lineItems, [
    { label: "Eight hours photography —", amount: "$4,800" },
    { label: "Second photographer —", amount: "$900" },
  ]);
  assert.equal(asset?.citations.length, 1);
  assert.equal(validateExtractedAsset(asset!).length, 0);
});

test("low-confidence or structurally incomplete extraction blocks activation", () => {
  const [asset] = deterministicExtraction({
    name: "questionnaire.txt",
    text: "Wedding details",
  });
  const issues = validateExtractedAsset(asset!);
  assert.equal(
    issues.some(
      (issue) =>
        issue.code === "LOW_CONFIDENCE" && issue.severity === "blocking",
    ),
    true,
  );
  assert.equal(
    issues.some((issue) => issue.code === "MISSING_QUESTIONNAIRE_FIELDS"),
    true,
  );
});

test("coverage and simulation expose lifecycle gaps without provider actions", () => {
  const coverage = coverageForAssetTypes([
    "contract",
    "questionnaire",
    "schedule",
    "review_request",
  ]);
  assert.equal(coverage.completed, 4);
  assert.equal(coverage.percent, 100);

  const simulation = simulateStudioImport([
    { assetType: "contract", name: "Wedding agreement" },
    { assetType: "schedule", name: "Wedding timeline" },
  ]);
  assert.equal(simulation.providerActionsExecuted, false);
  assert.equal(
    simulation.steps.every((step) => step.providerActionExecuted === false),
    true,
  );
  assert.equal(
    simulation.steps.find((step) => step.stage === "Delivery")?.status,
    "gap",
  );
});

test("approved message imports become native reusable template drafts", () => {
  const template = importedMessageTemplate({
    name: "Wedding preparation reminder",
    structuredContent: {
      subject: "Tomorrow is the day",
      body: [
        "Subject: Tomorrow is the day",
        "",
        "Hi {{recipientName}},",
        "",
        "Please review https://example.com/details before the team arrives.",
      ].join("\n"),
    },
  });
  assert.equal(template.key, "event_reminder");
  assert.equal(template.subject, "Tomorrow is the day");
  assert.deepEqual(template.paragraphs, [
    "Hi {{recipientName}},",
    "Please review https://example.com/details before the team arrives.",
  ]);
  assert.equal(template.actionLabel, "Open details");
});

test("approved delivery and review instructions populate native studio defaults", () => {
  assert.deepEqual(
    importedDeliveryDefaults({
      sourceText:
        "Deliver galleries through Pic-Time. Galleries expire after 120 days. Album instructions: https://example.com/albums",
    }),
    {
      "deliveryDefaults.galleryProvider": "pic_time",
      "deliveryDefaults.galleryExpirationDays": 120,
      "deliveryDefaults.albumInstructionsUrl": "https://example.com/albums",
    },
  );
  assert.deepEqual(
    importedReviewLink({
      sourceText:
        "Please leave a Google review: https://example.com/google-review",
    }),
    {
      field: "google",
      url: "https://example.com/google-review",
    },
  );
});
