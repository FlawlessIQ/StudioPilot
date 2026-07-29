import assert from "node:assert/strict";
import test from "node:test";
import { planClientProposalDecision } from "../server/client/proposal-decision";

const base = {
  now: "2026-07-28T12:00:00.000Z",
  project: {
    state: "PROPOSAL",
    packageSnapshotId: null,
  },
  proposal: {
    status: "viewed",
    expiresAt: "2026-08-05T12:00:00.000Z",
    packageSnapshotId: "snapshot-1",
  },
} as const;

test("accepting the current proposal advances only to contract pending", () => {
  const plan = planClientProposalDecision({
    ...base,
    decision: "accepted",
  });

  assert.equal(plan.proposalStatus, "accepted");
  assert.equal(plan.projectState, "CONTRACT_PENDING");
  assert.equal(plan.transitionProject, true);
  assert.equal(plan.alreadyComplete, false);
});

test("requesting changes preserves the project state", () => {
  const plan = planClientProposalDecision({
    ...base,
    decision: "declined",
  });

  assert.equal(plan.proposalStatus, "declined");
  assert.equal(plan.projectState, "PROPOSAL");
  assert.equal(plan.transitionProject, false);
});

test("repeating the same decision is idempotent", () => {
  const plan = planClientProposalDecision({
    ...base,
    decision: "accepted",
    project: {
      state: "CONTRACT_PENDING",
      packageSnapshotId: "snapshot-1",
    },
    proposal: {
      ...base.proposal,
      status: "accepted",
    },
  });

  assert.equal(plan.alreadyComplete, true);
  assert.equal(plan.transitionProject, false);
});

test("expired proposals cannot be accepted", () => {
  assert.throws(
    () =>
      planClientProposalDecision({
        ...base,
        decision: "accepted",
        proposal: {
          ...base.proposal,
          expiresAt: "2026-07-28T11:59:59.000Z",
        },
      }),
    /PROPOSAL_EXPIRED/,
  );
});

test("a client cannot replace a different package snapshot", () => {
  assert.throws(
    () =>
      planClientProposalDecision({
        ...base,
        decision: "accepted",
        project: {
          state: "PROPOSAL",
          packageSnapshotId: "snapshot-other",
        },
      }),
    /PACKAGE_SNAPSHOT_CONFLICT/,
  );
});

test("acceptance cannot bypass the project state machine", () => {
  assert.throws(
    () =>
      planClientProposalDecision({
        ...base,
        decision: "accepted",
        project: {
          state: "LEAD",
          packageSnapshotId: null,
        },
      }),
    /PROJECT_STATE_CONFLICT/,
  );
});
