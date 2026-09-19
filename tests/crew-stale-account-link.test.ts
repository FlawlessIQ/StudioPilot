import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A crew member whose account was replaced must still be able to accept.
 *
 * Found on a real phone, walking D1. Sam Rivera's `crewProfiles` row pointed at
 * a Firebase uid that no longer existed — the account behind that address had
 * been deleted and recreated during an earlier dry run. Accepting the offer
 * was refused with:
 *
 *   "This invitation is already linked to another account. Ask the studio to
 *    check the email on file, then resend."
 *
 * Every part of that advice fails. The email on file was correct. Resending
 * could not help, because `cascadeAssignment` copies `userId` from the profile,
 * so each new offer arrived carrying the same dead uid. Neither the crew member
 * nor the studio could clear it from any screen. A permanent lockout, from one
 * stale field.
 *
 * The authority this endpoint is built on is the emailed token plus a
 * signed-in address matching the one the studio recorded — see the note on
 * `markEmailVerified`. A differing uid proves only that the account behind
 * that address changed, so the accept adopts it.
 *
 * Asserted at source: `functions/` is a separate package the root suite cannot
 * import, and the behaviour needs Firebase Auth to reproduce.
 */
const source = readFileSync(
  `${process.cwd()}/functions/src/crew/invitations.ts`,
  "utf8",
);

test("neither accept path refuses a uid that is merely stale", () => {
  // The email comparison is what decides identity, and it stays.
  assert.match(source, /!== identityEmail\)?\s*\n?\s*throw new Error\("INVITED_EMAIL_MISMATCH"\)/);
  // Nothing in this file may refuse on a uid comparison again.
  assert.doesNotMatch(
    source,
    /!== identity\.uid\)[\s\S]{0,60}INVITATION_ALREADY_USED/,
    "a differing uid is a replaced account, not a different person",
  );
});

test("the accept re-points every record that carried the old uid", () => {
  // The repair is these writes; without them adoption would be cosmetic.
  const accept = source.slice(source.indexOf("transaction.update(profileReference"));
  assert.match(accept.slice(0, 400), /userId: identity\.uid/);
  const assignment = source.slice(
    source.indexOf("transaction.update(assignmentReference"),
  );
  assert.match(assignment.slice(0, 400), /userId: identity\.uid/);
});

/**
 * Adoption must not cost the studio a seat it has already paid for. The
 * assignment path always gated its increment on `wasLinked`; the roster path
 * relied on the refusal that no longer happens.
 */
test("coming back on a new account does not spend a second crew seat", () => {
  for (const [gate, where] of [
    [/if \(!wasLinked && subscription\.exists\)/, "assignment path"],
    [/if \(!linked && subscription\.exists\)/, "roster path"],
  ] as Array<[RegExp, string]>) {
    assert.match(source, gate, `${where} must not re-spend a seat`);
  }
});

/** Still refused: a link that is genuinely for somebody else, or expired. */
test("the real refusals are untouched", () => {
  for (const code of [
    "INVITATION_NOT_FOUND",
    "INVITATION_EXPIRED",
    "INVITED_EMAIL_MISMATCH",
    "MEMBERSHIP_ROLE_CONFLICT",
    "SUBCONTRACTOR_LIMIT_REACHED",
  ]) {
    assert.match(source, new RegExp(`"${code}"`), `${code} must still be thrown`);
  }
});
