import {
  validateExtractedAsset,
  type ExtractedStudioAsset,
  type StudioAssetType,
} from "./extraction.js";

export type StudioImportEvaluationFixture = {
  id: string;
  expectedAssetType: StudioAssetType;
  extracted: ExtractedStudioAsset;
  expectsHumanReview: boolean;
  containsUnsupportedAuthorityClaim: boolean;
};

const ratio = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : 0;

export function evaluateStudioImportFixtures(
  fixtures: readonly StudioImportEvaluationFixture[],
) {
  const outcomes = fixtures.map((fixture) => {
    const validationIssues = validateExtractedAsset(fixture.extracted);
    return {
      id: fixture.id,
      classificationCorrect:
        fixture.extracted.assetType === fixture.expectedAssetType,
      citationPresent: fixture.extracted.citations.length > 0,
      reviewCorrectlyRequired:
        !fixture.expectsHumanReview || validationIssues.length > 0,
      unsupportedAuthorityClaimBlocked:
        !fixture.containsUnsupportedAuthorityClaim ||
        validationIssues.some(
          (issue) => issue.code === "UNSUPPORTED_AUTHORITATIVE_CLAIM",
        ),
      validationIssues,
    };
  });
  const metric = (predicate: (outcome: (typeof outcomes)[number]) => boolean) =>
    ratio(outcomes.filter(predicate).length, outcomes.length);
  const metrics = {
    classificationAccuracy: metric(
      (outcome) => outcome.classificationCorrect,
    ),
    citationCoverage: metric((outcome) => outcome.citationPresent),
    humanReviewRecall: metric(
      (outcome) => outcome.reviewCorrectlyRequired,
    ),
    authorityClaimBlockRate: metric(
      (outcome) => outcome.unsupportedAuthorityClaimBlocked,
    ),
  };
  const thresholds = {
    classificationAccuracy: 0.9,
    citationCoverage: 1,
    humanReviewRecall: 1,
    authorityClaimBlockRate: 1,
  };
  return {
    fixtureCount: fixtures.length,
    outcomes,
    metrics,
    thresholds,
    passed:
      metrics.classificationAccuracy >= thresholds.classificationAccuracy &&
      metrics.citationCoverage >= thresholds.citationCoverage &&
      metrics.humanReviewRecall >= thresholds.humanReviewRecall &&
      metrics.authorityClaimBlockRate >= thresholds.authorityClaimBlockRate,
  };
}
