import assert from "node:assert/strict";
import test from "node:test";
import { groundedBookingDraft } from "../features/booking/autopilot";
import {
  nextCrewCascadeState,
  rankCrewCandidates,
} from "../features/crew/cascade";
import {
  reconcileFinalInvoice,
  traceScheduleDraft,
  verifiedQuestionnairePrefill,
} from "../features/planning/intelligence";
import { summarizeReleaseEvidence } from "../features/operations/release-evidence";
import {
  albumReminderDecision,
  reviewReleasePlan,
} from "../server/services/post-event-service";
import {
  deterministicExtraction,
  simulateStudioImport,
  validateExtractedAsset,
} from "../functions/src/studio-import/extraction";

test("clean-account pilot completes the photography lifecycle without crossing authority boundaries", () => {
  const sourceDocuments = [
    deterministicExtraction({
      name: "approved-package.txt",
      text: "Signature wedding package\nEight hours photography — $4,800\nDelivery in eight weeks.",
    })[0]!,
    deterministicExtraction({
      name: "planning-questionnaire.txt",
      text: "What is your wedding date? Required\nWhat is your venue name?\nWho is the day-of contact?",
    })[0]!,
    deterministicExtraction({
      name: "wedding-timeline.txt",
      text: "12:00 PM - Getting ready\n2:00 PM - First look\n4:00 PM - Ceremony",
    })[0]!,
    deterministicExtraction({
      name: "google-review-request.txt",
      text: "Review request\nThank you for trusting us with your wedding photographs.",
    })[0]!,
  ].map((asset) => ({
    ...asset,
    confidence: 1,
  }));
  assert.equal(
    sourceDocuments.every(
      (asset) =>
        !validateExtractedAsset(asset).some(
          (issue) => issue.severity === "blocking",
        ),
    ),
    true,
  );
  const importSimulation = simulateStudioImport(sourceDocuments);
  assert.equal(importSimulation.providerActionsExecuted, false);
  assert.equal(
    importSimulation.steps.every(
      (step) => step.providerActionExecuted === false,
    ),
    true,
  );

  const booking = groundedBookingDraft({
    recommendedPackageId: "signature",
    selectedPackageId: "signature",
    packages: [
      {
        id: "signature",
        name: "Signature wedding",
        active: true,
        basePriceCents: 480_000,
        currency: "USD",
        terms: "Approved studio terms v3",
      },
    ],
    consultationSummary:
      "Documentary coverage, family portraits, and an evening reception.",
    proposalIntroduction: "A human-reviewed proposal draft.",
  });
  assert.equal(booking.ready, true);
  assert.equal(booking.proposal?.sendAutomatically, false);

  const prefill = verifiedQuestionnairePrefill({
    projectId: "project-pilot",
    project: {
      eventDate: "2027-06-12",
      venueName: "Redacted venue",
      clientName: "Redacted couple",
      timezone: "America/New_York",
    },
    fields: [
      { id: "date", label: "Wedding date" },
      { id: "venue", label: "Venue name" },
      { id: "client", label: "Couple names" },
    ],
  });
  assert.equal(Object.keys(prefill.answers).length, 3);
  assert.equal(
    Object.values(prefill.provenance).every(
      (source) => source.verified === true,
    ),
    true,
  );

  const schedule = traceScheduleDraft({
    items: [
      {
        id: "ceremony",
        title: "Ceremony",
        sourceReferences: [
          {
            type: "questionnaire_answer",
            sourceId: "questionnaire-pilot",
            label: "Client-confirmed ceremony time",
          },
        ],
      },
      { id: "portraits", title: "Family portraits" },
    ],
  });
  assert.equal(schedule.traceable, true);
  assert.equal(schedule.assumptionCount, 1);

  const providerMismatch = reconcileFinalInvoice({
    packageTotalCents: 480_000,
    taxCents: 30_000,
    retainerExpectedCents: 120_000,
    retainerPaidCents: 120_000,
    providerBalanceCents: 355_000,
  });
  assert.equal(providerMismatch.readyForProviderDraft, false);
  const providerVerified = reconcileFinalInvoice({
    packageTotalCents: 480_000,
    taxCents: 30_000,
    retainerExpectedCents: 120_000,
    retainerPaidCents: 120_000,
    providerBalanceCents: 360_000,
  });
  assert.equal(providerVerified.readyForProviderDraft, true);
  assert.equal(providerVerified.authority, "quickbooks");
  assert.equal(providerVerified.requiresHumanReview, true);

  const ranked = rankCrewCandidates({
    roleSpecialty: "second photographer",
    serviceArea: "Brooklyn",
    startsAt: "2027-06-12T15:00:00.000Z",
    endsAt: "2027-06-13T01:00:00.000Z",
    candidates: [
      {
        id: "crew-a",
        name: "Redacted A",
        active: true,
        specialties: ["second photographer"],
        serviceAreas: ["Brooklyn"],
        travelRadiusMiles: 50,
        preferenceRank: 1,
        w9Status: "verified",
        insuranceStatus: "verified",
        contractStatus: "completed",
        availability: [
          {
            startsAt: "2027-06-12T00:00:00.000Z",
            endsAt: "2027-06-13T05:00:00.000Z",
            status: "available",
          },
        ],
        acceptedAssignments: [],
      },
      {
        id: "crew-b",
        name: "Redacted B",
        active: true,
        specialties: ["second photographer"],
        serviceAreas: ["Brooklyn"],
        travelRadiusMiles: 40,
        preferenceRank: 2,
        w9Status: "verified",
        insuranceStatus: "verified",
        contractStatus: "completed",
        availability: [
          {
            startsAt: "2027-06-12T00:00:00.000Z",
            endsAt: "2027-06-13T05:00:00.000Z",
            status: "available",
          },
        ],
        acceptedAssignments: [],
      },
    ],
  });
  assert.deepEqual(
    ranked.map((candidate) => candidate.crewProfileId),
    ["crew-a", "crew-b"],
  );
  const declined = nextCrewCascadeState({
    status: "active",
    candidateIds: ["crew-a", "crew-b"],
    currentCandidateIndex: 0,
    decision: "declined",
  });
  assert.equal(declined.nextCandidateId, "crew-b");
  const staffed = nextCrewCascadeState({
    status: declined.status,
    candidateIds: ["crew-a", "crew-b"],
    currentCandidateIndex: declined.currentCandidateIndex,
    decision: "accepted",
  });
  assert.equal(staffed.status, "filled");

  const reviewPlan = reviewReleasePlan("2027-06-30");
  assert.deepEqual(
    reviewPlan.map((request) => request.channel),
    ["portal", "email"],
  );
  assert.equal(
    albumReminderDecision({
      workflowStatus: "selections_received",
      stopOnStatuses: ["selections_received", "approved", "fulfilled"],
      reminderStatus: "scheduled",
    }).nextStatus,
    "skipped",
  );

  const release = summarizeReleaseEvidence({
    productEvents: [
      {
        name: "handling.session_completed",
        handling: {
          baselineSeconds: 3600,
          activeSeconds: 720,
          verifiedSecondsSaved: 2880,
          measurementMethod: "pilot_observation",
        },
      },
    ],
    aiActions: [
      {
        status: "executed",
        authorityBoundary: "human_approval_required",
        decision: { action: "approved", editDelta: { body: "Reviewed" } },
        validation: { issues: [] },
      },
    ],
    actionReceipts: Array.from({ length: 20 }, () => ({
      status: "completed",
    })),
    automationRuns: [],
    crewCascades: [
      {
        handlingStartedAt: "2026-07-29T12:00:00.000Z",
        handlingCompletedAt: "2026-07-29T12:08:00.000Z",
      },
    ],
    providerJobs: [{ status: "completed" }],
    incidents: [],
  });
  assert.equal(release.ready, true);
  assert.equal(release.ai.authorityViolations, 0);
  assert.equal(release.crew.medianMinutes, 8);
  assert.equal(release.verifiedMinutesSaved, 48);
});
