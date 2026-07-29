import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClientMilestones,
  buildClientPortalExperience,
} from "../server/client/portal-experience";

test("a lead sees a studio-owned waiting state instead of an impossible client task", () => {
  const experience = buildClientPortalExperience({
    state: "LEAD",
    availability: {},
    checkpoints: [],
  });

  assert.equal(experience.nextClientAction.responsibility, "studio");
  assert.equal(
    experience.nextClientAction.name,
    "Your studio is reviewing your inquiry",
  );
  assert.equal(experience.navigation.contract, false);
  assert.equal(experience.navigation.proposal, false);
  assert.equal(experience.navigation.payments, false);
  assert.equal(experience.navigation.delivery, false);
});

test("proposal stage points to a dedicated decision experience", () => {
  const experience = buildClientPortalExperience({
    state: "PROPOSAL",
    availability: { proposal: true, package: true },
    checkpoints: [],
  });

  assert.equal(experience.navigation.proposal, true);
  assert.equal(experience.navigation.package, false);
  assert.equal(experience.nextClientAction.href, "/client/proposal");
  assert.equal(experience.nextClientAction.actionLabel, "Review proposal");
});

test("accepted proposal unlocks the preserved package and contract stage", () => {
  const experience = buildClientPortalExperience({
    state: "CONTRACT_PENDING",
    availability: { proposal: true, package: true },
    checkpoints: [],
  });

  assert.equal(experience.navigation.proposal, true);
  assert.equal(experience.navigation.package, true);
  assert.equal(experience.navigation.contract, true);
});

test("a change request becomes studio-owned work instead of prompting another decision", () => {
  const experience = buildClientPortalExperience({
    state: "PROPOSAL",
    availability: { proposal: true },
    checkpoints: [],
    proposalStatus: "declined",
  });

  assert.equal(experience.nextClientAction.responsibility, "studio");
  assert.match(experience.nextClientAction.name, /reviewing/i);
  assert.equal(experience.nextClientAction.href, "/client/proposal");
});

test("a visible client checkpoint becomes the next action with a safe destination", () => {
  const experience = buildClientPortalExperience({
    state: "PLANNING",
    availability: { questionnaire: true },
    checkpoints: [
      {
        name: "Complete family questionnaire",
        description: "Share the people who matter most.",
        status: "ready",
        dueDate: "2026-09-01",
        ownerType: "client",
      },
    ],
  });

  assert.equal(experience.nextClientAction.responsibility, "client");
  assert.equal(experience.nextClientAction.href, "/client/questionnaire");
  assert.equal(experience.nextClientAction.dueDate, "2026-09-01");
  assert.equal(experience.navigation.questionnaire, true);
  assert.equal(experience.navigation.schedule, true);
});

test("studio-owned checkpoints never masquerade as client work", () => {
  const experience = buildClientPortalExperience({
    state: "POST_PRODUCTION",
    availability: {},
    checkpoints: [
      {
        name: "Finish editing photographs",
        description: null,
        status: "in_progress",
        dueDate: null,
        ownerType: "studio",
      },
    ],
  });

  assert.equal(experience.nextClientAction.responsibility, "studio");
  assert.match(experience.nextClientAction.name, /production/i);
});

test("delivery and reviews appear only when the lifecycle or records support them", () => {
  const planning = buildClientPortalExperience({
    state: "PLANNING",
    availability: { files: true },
    checkpoints: [],
  });
  assert.equal(planning.navigation.files, true);
  assert.equal(planning.navigation.delivery, false);
  assert.equal(planning.navigation.reviews, false);

  const delivered = buildClientPortalExperience({
    state: "DELIVERED",
    availability: {},
    checkpoints: [],
  });
  assert.equal(delivered.navigation.delivery, true);
  assert.equal(delivered.navigation.reviews, false);

  const reviewRequested = buildClientPortalExperience({
    state: "REVIEW_REQUESTED",
    availability: {},
    checkpoints: [],
  });
  assert.equal(reviewRequested.navigation.reviews, true);
});

test("milestones remain client-safe and progress in lifecycle order", () => {
  const milestones = buildClientMilestones("BOOKED");
  assert.deepEqual(
    milestones.map((milestone) => milestone.status),
    ["complete", "complete", "complete", "current", "upcoming", "upcoming"],
  );
  assert.equal(
    milestones.some((milestone) => /retainer|blocker|coi/i.test(milestone.label)),
    false,
  );
});
