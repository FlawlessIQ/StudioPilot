import assert from "node:assert/strict";
import test from "node:test";
import { groundedBookingDraft } from "../features/booking/autopilot";

const packages = [
  {
    id: "signature",
    name: "Signature Collection",
    active: true,
    basePriceCents: 640000,
    currency: "USD",
    terms: "Eight hours, two photographers, and an engagement session.",
  },
  {
    id: "legacy",
    name: "Legacy Collection",
    active: false,
    basePriceCents: 420000,
    currency: "USD",
    terms: "Archived terms.",
  },
] as const;

test("booking draft is grounded in the selected active package", () => {
  const result = groundedBookingDraft({
    recommendedPackageId: "signature",
    selectedPackageId: "signature",
    packages,
    consultationSummary: "The couple values candid coverage and family portraits.",
    proposalIntroduction: "Thank you for sharing your plans.",
  });

  assert.equal(result.ready, true);
  assert.equal(result.aiRecommendationAccepted, true);
  assert.equal(result.proposal?.basePriceCents, 640000);
  assert.equal(
    result.proposal?.termsSummary,
    "Eight hours, two photographers, and an engagement session.",
  );
  assert.equal(result.proposal?.sendAutomatically, false);
});

test("booking draft blocks an inactive or invented package", () => {
  const inactive = groundedBookingDraft({
    recommendedPackageId: "legacy",
    selectedPackageId: "legacy",
    packages,
    consultationSummary: "A complete consultation summary.",
    proposalIntroduction: "",
  });
  const invented = groundedBookingDraft({
    recommendedPackageId: "imaginary",
    selectedPackageId: "imaginary",
    packages,
    consultationSummary: "A complete consultation summary.",
    proposalIntroduction: "",
  });

  assert.deepEqual(inactive.blockers, ["ACTIVE_PACKAGE_REQUIRED"]);
  assert.deepEqual(invented.blockers, ["ACTIVE_PACKAGE_REQUIRED"]);
  assert.equal(inactive.proposal, null);
  assert.equal(invented.ready, false);
});

test("booking draft requires approved consultation context and terms", () => {
  const withoutContext = groundedBookingDraft({
    recommendedPackageId: "signature",
    selectedPackageId: "signature",
    packages,
    consultationSummary: " ",
    proposalIntroduction: "",
  });
  const withoutTerms = groundedBookingDraft({
    recommendedPackageId: "custom",
    selectedPackageId: "custom",
    packages: [
      {
        id: "custom",
        name: "Custom",
        active: true,
        basePriceCents: 500000,
        currency: "USD",
        terms: "",
      },
    ],
    consultationSummary: "A complete consultation summary.",
    proposalIntroduction: "",
  });

  assert.deepEqual(withoutContext.blockers, [
    "CONSULTATION_SUMMARY_REQUIRED",
  ]);
  assert.deepEqual(withoutTerms.blockers, ["APPROVED_TERMS_REQUIRED"]);
});
