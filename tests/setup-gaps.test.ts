import assert from "node:assert/strict";
import test from "node:test";
import {
  setupComplete,
  setupGaps,
  type SetupSignals,
  type SetupState,
} from "@/features/today/setup-gaps";
import { todayInbox } from "@/features/today/inbox";

const nothingConfigured: SetupState = {
  hasActivePackage: false,
  hasAgreementTemplate: false,
  hasQuestionnaireTemplate: false,
  hasConsultationAvailability: false,
};

const quiet: SetupSignals = {
  projectsNeedingPackage: [],
  projectsNeedingAgreement: [],
  projectsNeedingForm: [],
  openInquiries: 0,
};

test("a brand-new studio has gaps, but none of them are blocking", () => {
  const gaps = setupGaps(nothingConfigured, quiet);
  assert.equal(gaps.length, 4);
  assert.ok(gaps.every((gap) => !gap.blocking));
  // It is invited to import, not scolded.
  assert.match(
    gaps[0]?.detail ?? "",
    /Paste your price list and StudioCue drafts them/,
  );
});

test("a gap becomes blocking the moment a real job waits on it", () => {
  const gaps = setupGaps(nothingConfigured, {
    ...quiet,
    projectsNeedingPackage: ["Chen Wedding"],
  });
  const packages = gaps.find((gap) => gap.key === "packages");
  assert.equal(packages?.blocking, true);
  assert.equal(packages?.blockedProjectName, "Chen Wedding");
  assert.match(packages?.detail ?? "", /Chen Wedding can't get a proposal/);
  // Only that one is blocking; the others stay quiet.
  assert.equal(gaps.filter((gap) => gap.blocking).length, 1);
});

test("configured pieces produce no gap at all", () => {
  const gaps = setupGaps(
    {
      hasActivePackage: true,
      hasAgreementTemplate: true,
      hasQuestionnaireTemplate: false,
      hasConsultationAvailability: true,
    },
    quiet,
  );
  assert.deepEqual(
    gaps.map((gap) => gap.key),
    ["questionnaire"],
  );
});

test("setup is complete only when every piece exists", () => {
  assert.equal(setupComplete(nothingConfigured), false);
  assert.equal(
    setupComplete({
      hasActivePackage: true,
      hasAgreementTemplate: true,
      hasQuestionnaireTemplate: true,
      hasConsultationAvailability: true,
    }),
    true,
  );
});

test("only blocking gaps reach Today, and they rank with exceptions", () => {
  const gaps = setupGaps(nothingConfigured, {
    ...quiet,
    projectsNeedingPackage: ["Chen Wedding"],
  });
  const inbox = todayInbox({
    now: "2026-08-20T12:00:00.000Z",
    setupGaps: gaps,
    journeys: [
      {
        projectId: "p1",
        projectName: "Chen Wedding",
        eventDate: "2027-10-09",
        state: "PROPOSAL",
        stepTitle: "Proposal",
        stepDetail: "Ready to send",
        owner: "studio",
        actionLabel: "Prepare proposal",
        actionHref: "/studio/proposals/new?project=p1",
        updatedAt: null,
      },
    ],
  });
  // Three non-blocking gaps stayed out of the queue entirely.
  const setupItems = inbox.act.filter((item) => item.id.startsWith("setup-"));
  assert.deepEqual(
    setupItems.map((item) => item.id),
    ["setup-packages"],
  );
  // Work has stopped, so it leads the lane.
  assert.equal(inbox.act[0]?.id, "setup-packages");
});
