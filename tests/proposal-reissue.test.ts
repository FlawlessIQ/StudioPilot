import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A sent proposal could not be corrected, and that was not an oversight in the
 * data model — it was the data model. `clientSnapshot` and `eventSnapshot`
 * freeze the client and event a quote was written for, correctly, because the
 * client must keep seeing what they were sent.
 *
 * What was missing was the act that supersedes one. `version` and a
 * `superseded` status have been in the schema since it was written and the
 * workspace already renders "Version history"; nothing ever wrote a second
 * version. So a studio who mistyped a client's email sent the same proposal
 * four times to an address nobody reads, and editing the client afterwards
 * would not have helped, because the wrong address was already frozen.
 */
const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const proposals = source("functions/src/booking/proposals.ts");
const domain = source("functions/src/booking/proposal-domain.ts");
const workspace = source("components/proposals/studio-proposal-workspace.tsx");

const branch = proposals.slice(
  proposals.indexOf('} else if (command.type === "reissue") {'),
  proposals.indexOf('} else if (\n            command.type === "approve"'),
);

test("a correction supersedes rather than mutates", () => {
  assert.ok(branch.length > 0, "reissue branch not found");
  // A new document at the next version…
  assert.match(branch, /transaction\.create\(db\.doc\(`proposals\/\$\{reissuedId\}`\)/);
  assert.match(branch, /version: nextVersion/);
  // …and the old one kept, marked, and pointing at its replacement.
  assert.match(branch, /status: "superseded"/);
  assert.match(branch, /supersededByProposalId: reissuedId/);
  assert.match(branch, /supersedesProposalId: proposal\.id/);
  // The original is never updated in place beyond that marking.
  assert.ok(!branch.includes("clientSnapshot: { displayName: freshName, email: freshEmail },\n            });\n            transaction.update(proposalReference, {\n              clientSnapshot"));
});

/**
 * The whole point is that the frozen copy is wrong. Carrying it over would
 * reproduce the typo in the correction.
 */
test("the client and event are re-read, not copied forward", () => {
  assert.match(branch, /contactDocument\?\.get\("email"\)/);
  assert.match(branch, /projectDocument\.get\("name"\)/);
  assert.match(branch, /projectDocument\.get\("eventDate"\)/);
});

test("an accepted proposal is final, and a superseded one is not re-superseded", () => {
  assert.match(branch, /ACCEPTED_PROPOSAL_IS_FINAL/);
  assert.match(branch, /PROPOSAL_ALREADY_SUPERSEDED/);
  // Only from states where the client has actually been given something wrong.
  assert.match(domain, /reissue: \["sent", "viewed"\]/);
});

test("the correction lands as a draft, not straight at the client", () => {
  assert.match(branch, /status: "draft"/);
  assert.match(branch, /sentAt: null/);
  assert.match(branch, /emailDeliveryStatus: "not_sent"/);
  assert.match(branch, /pdfState: "not_requested"/);
});

/**
 * The correction that matters most is the one nobody can see. He resent four
 * times without ever learning the address was wrong.
 */
test("a changed recipient is reported back and said out loud", () => {
  assert.match(branch, /recipientChanged:/);
  assert.match(workspace, /command\.result\.recipientChanged === true/);
  assert.match(workspace, /It will go to \$\{text\(command\.result\.recipient/);
});

test("the control sits where the studio was stuck", () => {
  assert.match(workspace, /run\("reissue"\)/);
  assert.match(workspace, /Correct and re-issue/);
  // Beside resend, which was the only control there and the wrong one.
  const stack = workspace.slice(workspace.indexOf("Resend branded email"));
  assert.ok(stack.indexOf("Correct and re-issue") < 2000);
});

test("both refusals have copy a studio can act on", () => {
  const copy = source("lib/ai/friendly-error.ts");
  assert.match(copy, /ACCEPTED_PROPOSAL_IS_FINAL:/);
  assert.match(copy, /PROPOSAL_ALREADY_SUPERSEDED:/);
});
