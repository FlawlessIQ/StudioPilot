import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicExtraction,
  type ExtractedStudioAsset,
} from "../functions/src/studio-import/extraction";
import { evaluateStudioImportFixtures } from "../functions/src/studio-import/evaluation";

const redactedSources = [
  {
    id: "redacted-package",
    name: "wedding-package.txt",
    text: "Signature wedding collection\nEight hours photography — $4,800\nSecond photographer — $900",
    expectedAssetType: "package" as const,
  },
  {
    id: "redacted-questionnaire",
    name: "client-questionnaire.txt",
    text: "What is your ceremony address? Required\nWho should be included in family portraits?\nAre there mobility considerations?",
    expectedAssetType: "questionnaire" as const,
  },
  {
    id: "redacted-schedule",
    name: "wedding-timeline.txt",
    text: "12:30 PM - Detail photographs 30 minutes\n1:00 PM - Getting ready\n3:30 PM - Ceremony",
    expectedAssetType: "schedule" as const,
  },
  {
    id: "redacted-contract",
    name: "photography-agreement.txt",
    text: "Photography agreement\nClient signature line\nStudio signature line\nCancellation terms and rescheduling terms.",
    expectedAssetType: "contract" as const,
  },
  {
    id: "redacted-coi",
    name: "venue-coi-instructions.txt",
    text: "Certificate of insurance instructions\nList the venue as additional insured. Submit the COI to the venue coordinator.",
    expectedAssetType: "coi_instruction" as const,
  },
];

test("redacted Studio Import fixtures meet classification and citation thresholds", () => {
  const fixtures = redactedSources.map((source) => ({
    id: source.id,
    expectedAssetType: source.expectedAssetType,
    extracted: deterministicExtraction(source)[0]!,
    expectsHumanReview: source.expectedAssetType === "contract",
    containsUnsupportedAuthorityClaim: false,
  }));
  const result = evaluateStudioImportFixtures(fixtures);
  assert.equal(result.fixtureCount, 5);
  assert.equal(result.metrics.classificationAccuracy, 1);
  assert.equal(result.metrics.citationCoverage, 1);
  assert.equal(result.metrics.humanReviewRecall, 1);
  assert.equal(result.passed, true);
});

test("unsupported legal, payment, and insurance states are blocked before activation", () => {
  const extracted: ExtractedStudioAsset = {
    assetType: "contract",
    name: "Imported agreement",
    confidence: 0.95,
    citations: [{ locator: "page:1", excerpt: "Agreement draft" }],
    structuredContent: {
      body: "Agreement draft",
      signers: [],
      signatureAnchors: [],
      paymentStatus: "paid",
      signatureStatus: "executed",
      insuranceStatus: "approved",
    },
  };
  const result = evaluateStudioImportFixtures([
    {
      id: "unsupported-authority",
      expectedAssetType: "contract",
      extracted,
      expectsHumanReview: true,
      containsUnsupportedAuthorityClaim: true,
    },
  ]);
  assert.equal(result.metrics.authorityClaimBlockRate, 1);
  assert.equal(
    result.outcomes[0]?.validationIssues.some(
      (issue) => issue.code === "UNSUPPORTED_AUTHORITATIVE_CLAIM",
    ),
    true,
  );
  assert.equal(result.passed, true);
});
