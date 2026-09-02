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
  assert.match(notice, /could not be built/);
  assert.doesNotMatch(notice, /being generated/);
  // And it still says the approval landed, because it did.
  assert.match(notice, /^Approved/);
  // It no longer claims sending is impossible: the server accepts a failed
  // PDF on the send path, and the confirmation beside it says so.
  assert.doesNotMatch(notice, /sending needs it/);
  assert.match(notice, /send the proposal as a link/);
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

test("the failed panel does not reassure, and does not overstate the failure", () => {
  // No "usually finishes within a minute" over something that already
  // stopped — the original point of this test.
  assert.doesNotMatch(proposalPdfDetail("failed"), /a minute/);
  // And not "the proposal cannot be sent without it" either, which was true
  // when written and became false when the send path started accepting a
  // failed PDF. The panel three inches below already offered exactly that.
  assert.doesNotMatch(proposalPdfDetail("failed"), /cannot be sent/);
  assert.match(proposalPdfDetail("failed"), /send the proposal as a link/);
  assert.match(proposalPdfDetail("queued"), /a minute/);
  // Said in the studio's terms, not the worker's.
  assert.doesNotMatch(proposalPdfDetail("queued"), /document worker/);
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
