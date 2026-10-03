import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { blockingIssues } from "@/features/ai/blocking-issues";
import { DEFAULT_PROPOSAL_TERMS, proposalTermsFor } from "@/features/booking/autopilot";
import { todayInbox } from "@/features/today/inbox";

/**
 * GR Productions couldn't send a proposal at all (2026-09-30).
 *
 * The AI picked no package from the consultation, and the studio's packages
 * had no terms written. Today offered "Approve" on both prepared actions and
 * the server refused each press; the booking brief tried to approve the same
 * two and failed; its button was disabled for the missing terms; and the
 * composer wanted terms nobody had written.
 */
const failedPackage = {
  id: "ai_package_c1",
  projectId: "p1",
  capability: "package_recommendation",
  status: "review_required",
  title: "Review package recommendation",
  validation: {
    status: "failed",
    issues: [{ code: "PACKAGE_RECOMMENDATION_REQUIRED", severity: "blocking", message: "AI did not select an active package.", field: "packageId" }],
  },
};
const failedProposal = {
  id: "ai_proposal_c1",
  projectId: "p1",
  capability: "proposal_draft",
  status: "review_required",
  title: "Prepare proposal draft",
  validation: {
    status: "failed",
    issues: [
      { code: "PACKAGE_REQUIRED", severity: "blocking", message: "Approve a package before drafting the proposal.", field: "packageId" },
      { code: "APPROVED_TERMS_REQUIRED", severity: "blocking", message: "The recommended package has no approved terms.", field: "termsSummary" },
    ],
  },
};

test("Today sends blocked booking work to the brief, once, with no Approve", () => {
  const inbox = todayInbox({
    now: "2026-09-30T12:00:00Z",
    projects: [{ id: "p1", name: "Dionne Rhodes wedding", state: "CONSULTATION", eventDate: "2027-06-12", archivedAt: null }],
    aiActions: [failedPackage, failedProposal],
  });
  assert.ok(!inbox.approve.some((item) => item.projectId === "p1"), "nothing to approve that the server refuses");
  const cards = inbox.act.filter((item) => item.id.startsWith("ai-"));
  assert.equal(cards.length, 1, "the pair is one card");
  assert.equal(cards[0]!.title, "Pick Dionne Rhodes's packages for the proposal");
  assert.deepEqual(cards[0]!.action, { kind: "link", label: "Pick packages", href: "/studio/booking?project=p1" });
});

test("once a proposal exists the blocked booking work is not asked about", () => {
  const inbox = todayInbox({
    now: "2026-09-30T12:00:00Z",
    projects: [{ id: "p1", name: "Dionne Rhodes wedding", state: "PROPOSAL", eventDate: "2027-06-12", archivedAt: null }],
    aiActions: [failedPackage, failedProposal],
  });
  assert.ok(!inbox.act.some((item) => item.id.startsWith("ai-")));
  assert.ok(!inbox.approve.some((item) => item.projectId === "p1"));
});

test("a low-confidence summary can still be approved with the studio's edit", () => {
  const summary = { validation: { issues: [{ code: "LOW_CONFIDENCE", severity: "blocking", message: "Confirm." }] } };
  assert.equal(blockingIssues(summary).length, 1);
  assert.equal(blockingIssues(summary, { withEdit: true }).length, 0);
  assert.equal(blockingIssues(failedPackage, { withEdit: true }).length, 1);
});

test("a package with no terms written gets the default wording, long enough to send", () => {
  assert.equal(proposalTermsFor(""), DEFAULT_PROPOSAL_TERMS);
  assert.equal(proposalTermsFor(undefined), DEFAULT_PROPOSAL_TERMS);
  assert.equal(proposalTermsFor("  Written terms here.  "), "Written terms here.");
  assert.ok(DEFAULT_PROPOSAL_TERMS.length >= 10 && DEFAULT_PROPOSAL_TERMS.length <= 6000);
  // The composer and the brief both use it.
  assert.match(readFileSync("components/proposals/studio-proposal-workspace.tsx", "utf8"), /setTermsSummary\(proposalTermsForJob\(jobSnapshotsOf\(/);
  // The brief sets aside what it can't approve rather than failing on it.
  const brief = readFileSync("components/booking/booking-autopilot-workspace.tsx", "utf8");
  assert.match(brief, /blockingIssues\(action, \{ withEdit: true \}\)/);
  assert.match(brief, /decision: "dismissed"/);
});

test("the AI draft and Cue use the same default wording as the app", () => {
  const functionsCopy = readFileSync("functions/src/proposals/default-terms.ts", "utf8");
  assert.ok(functionsCopy.includes(JSON.stringify(DEFAULT_PROPOSAL_TERMS)), "functions copy matches features/booking/autopilot.ts");
  const worker = readFileSync("functions/src/operations/ai-pdf.ts", "utf8");
  assert.match(worker, /const termsSummary=recommended\?proposalTermsFor\(recommended\.get\("terms"\)\):"";/);
  const cue = readFileSync("functions/src/ai/copilot.ts", "utf8");
  assert.match(cue, /const terms = proposalTermsForPackages\(jobSnapshots\.map\(\(snapshot\) => snapshot\.data\)\);/);
  assert.doesNotMatch(cue, /terms\.trim\(\)\.length < 10\) continue;/);
});
