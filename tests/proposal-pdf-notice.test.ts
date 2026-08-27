import assert from "node:assert/strict";
import { test } from "node:test";
import {
  proposalNoticeStillHolds,
  proposalPdfDetail,
  proposalPdfNotice,
} from "@/features/proposals/pdf-notice";

test("a failed PDF is never announced as being generated", () => {
  // The contradiction this exists to remove: the notice claimed generation was
  // under way while the panel below read "PDF generation failed".
  const notice = proposalPdfNotice(true, "failed");
  assert.match(notice, /could not be generated/);
  assert.doesNotMatch(notice, /being generated/);
  // And it still says the approval landed, because it did.
  assert.match(notice, /^Approved/);
});

test("a ready PDF is not announced as pending", () => {
  assert.match(proposalPdfNotice(true, "ready"), /is ready/);
  assert.doesNotMatch(proposalPdfNotice(true, "ready"), /being generated/);
});

test("queued and unknown states keep the optimistic wording", () => {
  for (const state of ["queued", "not_requested", "something_new"]) {
    assert.match(proposalPdfNotice(true, state), /being generated/);
  }
  assert.match(proposalPdfNotice(false, "queued"), /fresh PDF/);
});

test("the failed panel does not reassure", () => {
  assert.doesNotMatch(proposalPdfDetail("failed"), /within a minute/);
  assert.match(proposalPdfDetail("failed"), /cannot be sent/);
  assert.match(proposalPdfDetail("queued"), /within a minute/);
});

test("a generating notice is dropped once the record says it failed", () => {
  // The stale-notice case: the response was truthful when written, the worker
  // failed a second later, and both stayed on screen.
  assert.equal(
    proposalNoticeStillHolds("A fresh PDF is being generated.", "failed"),
    false,
  );
  assert.equal(
    proposalNoticeStillHolds("A fresh PDF is being generated.", "queued"),
    true,
  );
  // Notices about anything else survive a failed PDF — the draft did save.
  assert.equal(proposalNoticeStillHolds("Draft saved.", "failed"), true);
  assert.equal(proposalNoticeStillHolds(null, "queued"), false);
});
