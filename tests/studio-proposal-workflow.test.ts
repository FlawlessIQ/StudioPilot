import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProposalAction,
  canApproveProposal,
  canCreateProposalForProject,
  canSendProposal,
  proposalEmailDeliveryStatus,
} from "../functions/src/booking/proposal-domain";

test("proposal authoring follows an explicit approval path", () => {
  assert.doesNotThrow(() => assertProposalAction("draft", "update_draft"));
  assert.doesNotThrow(() =>
    assertProposalAction("draft", "submit_for_approval"),
  );
  assert.doesNotThrow(() =>
    assertProposalAction("internal_review", "approve"),
  );
  assert.doesNotThrow(() => assertProposalAction("approved", "send"));
});

test("a draft cannot be sent and an approved proposal cannot be edited", () => {
  assert.throws(
    () => assertProposalAction("draft", "send"),
    /PROPOSAL_ACTION_NOT_ALLOWED/,
  );
  assert.throws(
    () => assertProposalAction("approved", "update_draft"),
    /PROPOSAL_ACTION_NOT_ALLOWED/,
  );
});

test("review can be returned for edits without making client-visible history mutable", () => {
  assert.doesNotThrow(() =>
    assertProposalAction("internal_review", "return_to_draft"),
  );
  assert.doesNotThrow(() =>
    assertProposalAction("approved", "return_to_draft"),
  );
  assert.throws(
    () => assertProposalAction("sent", "return_to_draft"),
    /PROPOSAL_ACTION_NOT_ALLOWED/,
  );
});

test("PDF regeneration and email resends are limited to their safe lifecycle states", () => {
  assert.doesNotThrow(() =>
    assertProposalAction("approved", "regenerate_pdf"),
  );
  assert.doesNotThrow(() => assertProposalAction("sent", "resend"));
  assert.doesNotThrow(() => assertProposalAction("viewed", "resend"));
  assert.throws(
    () => assertProposalAction("internal_review", "regenerate_pdf"),
    /PROPOSAL_ACTION_NOT_ALLOWED/,
  );
  assert.throws(
    () => assertProposalAction("accepted", "resend"),
    /PROPOSAL_ACTION_NOT_ALLOWED/,
  );
});

test("accepted and superseded versions are terminal in the studio command surface", () => {
  for (const action of [
    "update_draft",
    "submit_for_approval",
    "return_to_draft",
    "approve",
    "regenerate_pdf",
    "send",
    "resend",
  ] as const) {
    assert.throws(
      () => assertProposalAction("accepted", action),
      /PROPOSAL_ACTION_NOT_ALLOWED/,
    );
    assert.throws(
      () => assertProposalAction("superseded", action),
      /PROPOSAL_ACTION_NOT_ALLOWED/,
    );
  }
});

test("unknown stored proposal states are rejected explicitly", () => {
  assert.throws(
    () => assertProposalAction("paid", "send"),
    /PROPOSAL_STATUS_INVALID/,
  );
});

test("only the consultation and proposal project stages can author offers", () => {
  assert.equal(canCreateProposalForProject("CONSULTATION"), true);
  assert.equal(canCreateProposalForProject("PROPOSAL"), true);
  assert.equal(canCreateProposalForProject("LEAD"), false);
  assert.equal(canCreateProposalForProject("CONTRACT_PENDING"), false);
});

test("approval and delivery remain restricted to owners and administrators", () => {
  assert.equal(canApproveProposal("studio_owner"), true);
  assert.equal(canApproveProposal("studio_admin"), true);
  assert.equal(canApproveProposal("studio_coordinator"), false);
  assert.equal(canSendProposal("studio_admin"), true);
  assert.equal(canSendProposal("studio_coordinator"), false);
});

test("only supported SendGrid events become proposal delivery state", () => {
  assert.equal(proposalEmailDeliveryStatus("delivered"), "delivered");
  assert.equal(proposalEmailDeliveryStatus("open"), "open");
  assert.equal(proposalEmailDeliveryStatus("spamreport"), null);
});
