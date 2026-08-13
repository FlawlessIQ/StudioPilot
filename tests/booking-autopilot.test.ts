import assert from "node:assert/strict";
import test from "node:test";
import { groundedBookingDraft } from "../features/booking/autopilot";
import { nextBookingAutomationStep } from "../features/booking/orchestration";

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

test("booking automation waits for provider evidence in sequence", () => {
  assert.equal(
    nextBookingAutomationStep({
      contractStatus: "sent",
      invoiceStatus: null,
      invoiceBalanceCents: null,
    }),
    "wait_for_signature",
  );
  assert.equal(
    nextBookingAutomationStep({
      contractStatus: "completed",
      invoiceStatus: null,
      invoiceBalanceCents: null,
    }),
    "create_retainer",
  );
  assert.equal(
    nextBookingAutomationStep({
      contractStatus: "completed",
      invoiceStatus: "sent",
      invoiceBalanceCents: 120000,
    }),
    "wait_for_payment",
  );
  assert.equal(
    nextBookingAutomationStep({
      contractStatus: "completed",
      invoiceStatus: "paid",
      invoiceBalanceCents: 0,
    }),
    "complete_booking",
  );
});

test("booking automation routes deterministic blockers to human attention", () => {
  assert.equal(
    nextBookingAutomationStep({
      contractStatus: "completed",
      invoiceStatus: "paid",
      invoiceBalanceCents: 0,
      gateBlockers: ["eventDateAvailable"],
    }),
    "needs_attention",
  );
  assert.equal(
    nextBookingAutomationStep({
      contractStatus: "completed",
      invoiceStatus: "paid",
      invoiceBalanceCents: 0,
      bookingComplete: true,
    }),
    "completed",
  );
});
