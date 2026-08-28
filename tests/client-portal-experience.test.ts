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

test("proposal stage without a shared proposal does not nag the client to review", () => {
  // Project has entered PROPOSAL but the studio has not shared a proposal yet
  // (availability.proposal is false). The client must not be told to "review"
  // a proposal the proposal page reports as still being prepared.
  const experience = buildClientPortalExperience({
    state: "PROPOSAL",
    availability: {},
    checkpoints: [],
  });

  assert.equal(experience.nextClientAction.responsibility, "studio");
  assert.match(experience.nextClientAction.name, /preparing/i);
  assert.notEqual(experience.nextClientAction.actionLabel, "Review proposal");
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

test("an explicit client checkpoint destination takes precedence over its wording", () => {
  const experience = buildClientPortalExperience({
    state: "PLANNING",
    availability: { files: true },
    checkpoints: [
      {
        name: "Review the details we prepared",
        description: "Open the approved reference document.",
        status: "ready",
        dueDate: null,
        ownerType: "client",
        actionHref: "/client/documents",
        actionLabel: "Open project records",
      },
    ],
  });

  assert.equal(experience.nextClientAction.href, "/client/documents");
  assert.equal(experience.nextClientAction.actionLabel, "Open project records");
});

test("an unsafe explicit checkpoint destination cannot leave the client portal", () => {
  const experience = buildClientPortalExperience({
    state: "PLANNING",
    availability: {},
    checkpoints: [
      {
        name: "Complete family questionnaire",
        description: null,
        status: "ready",
        dueDate: null,
        ownerType: "client",
        actionHref: "https://example.com/unsafe",
        actionLabel: "Leave portal",
      },
    ],
  });

  assert.equal(experience.nextClientAction.href, "/client/questionnaire");
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

/**
 * Exactly one milestone is current, and the event is behind them once the
 * studio has recorded it.
 *
 * `EVENT_COMPLETE` is the state that means the wedding happened, and the rail
 * treated it as "NOW · Event day · Use the final schedule and shared details" —
 * shown to a couple thirteen days after theirs, beneath a hero saying the
 * studio was backing up their photographs.
 */
test("the client rail never says event day is now after the event", () => {
  const shot = buildClientMilestones("EVENT_COMPLETE");
  assert.equal(shot.find((m) => m.id === "event")?.status, "complete");
  assert.equal(shot.find((m) => m.id === "delivery")?.status, "current");
});

test("exactly one milestone is current at every state", () => {
  for (const state of [
    "LEAD",
    "CONSULTATION",
    "PROPOSAL",
    "CONTRACT_PENDING",
    "RETAINER_PENDING",
    "BOOKED",
    "PLANNING",
    "READY",
    "EVENT_COMPLETE",
    "POST_PRODUCTION",
    "DELIVERED",
    "REVIEW_REQUESTED",
  ]) {
    const current = buildClientMilestones(state).filter(
      (milestone) => milestone.status === "current",
    );
    assert.equal(current.length, 1, `${state} had ${current.length} current`);
  }
});

test("ready for the day points at the event, not at planning", () => {
  const ready = buildClientMilestones("READY");
  assert.equal(ready.find((m) => m.id === "planning")?.status, "complete");
  assert.equal(ready.find((m) => m.id === "event")?.status, "current");
});

test("a closed job has nothing current left", () => {
  const closed = buildClientMilestones("CLOSED");
  assert.equal(
    closed.filter((milestone) => milestone.status !== "complete").length,
    0,
  );
});
