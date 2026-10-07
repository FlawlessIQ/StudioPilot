import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  amendmentFollows,
  draftFollows,
  emailChanged,
  followedRecipient,
  invitationRetires,
  leadFollows,
  retargetContractSigners,
  withPreviousEmail,
} from "../functions/src/crm/email-change";

/**
 * GR, 2026-10-06: "I changed emails mid job. And now can't resend the proposal
 * to new email." Albert's test wedding moved from gershphoto@ to albertgersh20@;
 * every resend still went to the address the proposal was drafted for.
 */

const OLD = "gershphoto@gmail.com";
const NEW = "albertgersh20@gmail.com";
const read = (path: string) => readFileSync(path, "utf8");

test("only a real change of address counts", () => {
  assert.equal(emailChanged(OLD, NEW), true);
  assert.equal(emailChanged(OLD, " GershPhoto@Gmail.com "), false);
  assert.equal(emailChanged(null, NEW), false);
  assert.equal(emailChanged(OLD, null), false);
});

test("an unsigned agreement's client signer moves; studio and partner stay", () => {
  const signers = [
    { role: "studio", email: "gabe@grproductions.com", status: "completed" },
    { role: "primary_client", email: OLD, status: "sent" },
  ];
  const moved = retargetContractSigners({ status: "sent", signers }, OLD, NEW);
  assert.deepEqual(moved?.map((signer) => signer.email), ["gabe@grproductions.com", NEW]);
  // Someone else's address is never overwritten.
  assert.equal(retargetContractSigners({ status: "sent", signers }, "partner@example.com", NEW), null);
});

test("a signed, voided or superseded agreement is left exactly as it was", () => {
  const signers = [{ role: "primary_client", email: OLD, status: "completed" }];
  for (const status of ["completed", "voided", "superseded", "declined", "expired"]) {
    assert.equal(retargetContractSigners({ status, signers }, OLD, NEW), null, status);
  }
  assert.equal(
    retargetContractSigners({ status: "viewed", signers: [{ role: "primary_client", email: OLD, status: "completed" }] }, OLD, NEW),
    null,
  );
});

test("booking changes and invitations follow only while still open", () => {
  assert.equal(amendmentFollows({ status: "sent", clientEmail: OLD }, OLD), true);
  assert.equal(amendmentFollows({ status: "signed", clientEmail: OLD }, OLD), false);
  assert.equal(amendmentFollows({ status: "sent", clientEmail: "partner@example.com" }, OLD), false);
  assert.equal(invitationRetires({ status: "pending", normalizedEmail: OLD }, OLD), true);
  assert.equal(invitationRetires({ status: "accepted", normalizedEmail: OLD }, OLD), false);
});

test("proposal sends and follow-ups mail the client as they are now", () => {
  const proposals = read("functions/src/booking/proposals.ts");
  assert.match(proposals, /stringValue\(currentContact\?\.get\("email"\)\)\.trim\(\) \|\|\s*stringValue\(recipient\.email\)/);
  assert.equal((proposals.match(/lastSentTo: clientEmail/g) ?? []).length, 2, "send and resend both record it");
  const followUps = read("functions/src/booking/proposal-follow-ups.ts");
  assert.match(followUps, /text\(current\?\.get\("email"\)\)\.trim\(\) \|\| text\(client\.email\)/);
});

test("a new agreement signs with the current address, and an edit carries it over", () => {
  assert.match(read("functions/src/contracts/sources.ts"), /primaryContact\?\.get\("email"\)/);
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /retargetContractSigners\(contract\.data\(\), fromEmail, toEmail\)/);
  assert.match(crm, /invitationRetires\(invitation\.data\(\), fromEmail\)/);
});

test("the proposal card names where it went and flags a changed email", () => {
  const card = read("components/proposals/studio-proposal-workspace.tsx");
  assert.match(card, /text\(proposal\.lastSentTo, ""\)/);
  assert.match(card, /Their email changed to \{currentClientEmail\}\. Resend goes there\./);
});

/**
 * GR, 2026-10-07: Albert typed gamil.com on the inquiry form. Gabe corrected
 * the client at 11:03, approved the drafted reply at 11:06, and it went to
 * gamil.com — the draft and the inquiry both kept the address it arrived with.
 */
const TYPO = "albertgersh20@gamil.com";
const FIXED = "albertgersh20@gmail.com";

test("the inquiry follows its couple's corrected address, and only theirs", () => {
  assert.equal(leadFollows({ primaryContactId: "c1", email: TYPO }, "c1", TYPO), true);
  assert.equal(leadFollows({ primaryContactId: "c2", email: TYPO }, "c1", TYPO), false);
  assert.equal(leadFollows({ primaryContactId: "c1", email: "partner@example.com" }, "c1", TYPO), false);
});

test("a waiting reply to the old address moves; a decided or someone else's does not", () => {
  const scope = { contactId: "c1", leadIds: ["lead1"] };
  const reply = { status: "review_required", structuredOutput: { leadId: "lead1", contactId: null, recipientEmail: TYPO } };
  assert.equal(draftFollows(reply, scope, TYPO), true);
  assert.equal(draftFollows({ ...reply, structuredOutput: { contactId: "c1", recipientEmail: TYPO } }, scope, TYPO), true);
  assert.equal(draftFollows({ ...reply, status: "approved" }, scope, TYPO), false);
  assert.equal(draftFollows({ ...reply, structuredOutput: { leadId: "lead1", recipientEmail: "planner@example.com" } }, scope, TYPO), false);
  assert.equal(draftFollows({ ...reply, structuredOutput: { leadId: "other", recipientEmail: TYPO } }, scope, TYPO), false);
});

test("an approved draft goes to the corrected address, never redirecting anyone else", () => {
  const contact = { email: FIXED, previousEmails: withPreviousEmail([], TYPO, FIXED) };
  assert.equal(followedRecipient(TYPO, contact), FIXED);
  assert.equal(followedRecipient(" AlbertGersh20@Gamil.com ", contact), FIXED);
  // A partner or planner on the thread is not the client's old address.
  assert.equal(followedRecipient("planner@example.com", contact), "planner@example.com");
  assert.equal(followedRecipient(FIXED, contact), FIXED);
  assert.equal(followedRecipient(TYPO, { email: FIXED }), TYPO, "no correction recorded: the draft stands");
  assert.equal(followedRecipient(TYPO, null), TYPO);
  assert.equal(followedRecipient(TYPO, { ...contact, archivedAt: "2026-10-07" }), TYPO);
});

test("a correction undone is no longer one", () => {
  const once = withPreviousEmail([], TYPO, FIXED);
  assert.deepEqual(once, [TYPO]);
  const back = withPreviousEmail(once, FIXED, TYPO);
  assert.deepEqual(back, [FIXED]);
  assert.equal(followedRecipient(TYPO, { email: TYPO, previousEmails: back }), TYPO);
  assert.equal(followedRecipient(FIXED, { email: TYPO, previousEmails: back }), TYPO);
});

test("the client save moves the inquiry and its drafts, and approval checks again", () => {
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /previousEmails: withPreviousEmail\(contact\.get\("previousEmails"\), fromEmail, toEmail\)/);
  assert.match(crm, /await followEmailToInquiries\(db, \{/);
  const actions = read("functions/src/ai/actions.ts");
  assert.match(actions, /await currentRecipient\(db, parsed\.tenantId, structuredOutput, editDelta\)/);
  assert.match(actions, /^\s+recipient,$/m);
  assert.match(actions, /recipient: recipient \?\? structuredOutput\.recipientEmail \?\? null/);
});
