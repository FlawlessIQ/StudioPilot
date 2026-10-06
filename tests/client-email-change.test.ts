import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  amendmentFollows,
  emailChanged,
  invitationRetires,
  retargetContractSigners,
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
