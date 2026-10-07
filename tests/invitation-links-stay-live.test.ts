import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  INVITE_REPEAT_WINDOW_MS,
  invitationAnswersTo,
  inviteJustSent,
  liveInvitationLinks,
} from "../functions/src/client/invitation-mint.ts";

/**
 * GR, 2026-10-07: Gabe sent Albert's portal invite twice, 2.7 seconds apart.
 * The second minted a new secret over the first, and Albert — opening the
 * first email — got "Invitation unavailable". The proposal, the agreement and
 * every reminder did the same to every earlier invite email.
 */
const equal = (left: string, right: string) => left === right;
const read = (path: string) => readFileSync(path, "utf8");

test("an earlier link still opens the invitation", () => {
  const invitation = { tokenHash: "second", tokenHashes: ["first", "second"] };
  assert.equal(invitationAnswersTo(invitation, "first", equal), true);
  assert.equal(invitationAnswersTo(invitation, "second", equal), true);
  assert.equal(invitationAnswersTo(invitation, "never-sent", equal), false);
  // From before the list existed: the newest link alone.
  assert.equal(invitationAnswersTo({ tokenHash: "only" }, "only", equal), true);
});

test("a replacing write keeps the live links, and a revoked one starts again", () => {
  assert.deepEqual(liveInvitationLinks(undefined, "a"), ["a"]);
  assert.deepEqual(liveInvitationLinks({ status: "pending", tokenHash: "legacy" }, "b"), ["legacy", "b"]);
  assert.deepEqual(liveInvitationLinks({ status: "pending", tokenHashes: ["a", "b"] }, "c"), ["a", "b", "c"]);
  assert.deepEqual(liveInvitationLinks({ status: "revoked", tokenHashes: ["a", "b"] }, "c"), ["c"]);
});

test("a second tap within seconds is the same send", () => {
  const sent = "2026-10-07T15:17:51.095Z";
  const at = Date.parse(sent);
  assert.equal(inviteJustSent(sent, "albertgersh20@gmail.com", "AlbertGersh20@gmail.com", at + 2_700), true);
  assert.equal(inviteJustSent(sent, "albertgersh20@gmail.com", "albertgersh20@gmail.com", at + INVITE_REPEAT_WINDOW_MS), false);
  assert.equal(inviteJustSent(sent, "old@example.com", "albertgersh20@gmail.com", at + 1_000), false);
  assert.equal(inviteJustSent(null, "albertgersh20@gmail.com", "albertgersh20@gmail.com", at), false);
});

test("every invitation writer adds its link rather than replacing the last", () => {
  const writers = [
    "functions/src/booking/proposals.ts",
    "functions/src/contracts/combined-commands.ts",
    "functions/src/contracts/amendments.ts",
    "functions/src/contracts/follow-ups.ts",
    "functions/src/contracts/commands.ts",
    "functions/src/planning/questionnaire-link.ts",
    "functions/src/client/partner-invitations.ts",
  ];
  for (const path of writers) {
    const source = read(path);
    assert.doesNotMatch(source, /^\s*tokenHash: invitation\.tokenHash,/m, path);
    assert.match(source, /\.\.\.invitationLinkFields\(invitation\.tokenHash\)/, path);
  }
  const invitations = read("functions/src/client/invitations.ts");
  assert.match(invitations, /tokenHashes: liveInvitationLinks\(existing\.data\(\), minted\.tokenHash\)/);
  assert.match(invitations, /where\("tokenHashes", "array-contains", tokenHash\)/);
  // Revoking kills every link, both places it happens.
  assert.match(invitations, /status: "revoked",\s+revokedAt: now,\s+\/\/[^\n]*\n\s+tokenHashes: \[\],/);
  assert.match(read("functions/src/crm/commands.ts"), /status: "revoked", revokedAt: timestamp, tokenHashes: \[\]/);
});

test("the studio is no longer told the earlier link stopped working", () => {
  const card = read("components/clients/client-portal-invite.tsx");
  assert.doesNotMatch(card, /earlier link is no longer valid/);
  assert.match(card, /The link in their earlier invitation still works too\./);
  assert.doesNotMatch(read("components/ai/actions/job-actions.tsx"), /Sending again replaces the earlier link/);
});
