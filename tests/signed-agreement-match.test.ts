import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessSignedAgreement,
  samePerson,
  type SignedAgreementCandidate,
  type SignedAgreementReading,
} from "../features/booking/signed-agreement-match";

/**
 * What a signed agreement Cue has read is worth.
 *
 * The model reads names and dates off the page; this decides which job they
 * point at and what to doubt. Its output prefills a form a person still
 * submits, so the failure that matters is not a wrong answer but a confident
 * one — a suggestion made where the evidence was a tie, or a flag swallowed
 * where the document disagreed with the job.
 */

const today = "2026-09-17";

const reading = (overrides: Partial<SignedAgreementReading> = {}) => ({
  isSignedAgreement: true,
  signatureVisible: true,
  signerNames: ["Maya Johnson"],
  clientNames: ["Maya Johnson", "Theo Johnson"],
  signedDate: "2026-09-10",
  eventDate: "2027-06-12",
  ...overrides,
});

const johnson: SignedAgreementCandidate = {
  projectId: "p-johnson",
  projectName: "Maya & Theo Johnson",
  eventDate: "2027-06-12",
  proposalId: "prop-johnson",
  proposalAcceptedOn: "2026-09-01",
  clientNames: ["Maya Johnson", "Theo Johnson"],
};

const reed: SignedAgreementCandidate = {
  projectId: "p-reed",
  projectName: "Emma & Noah Reed",
  eventDate: "2027-08-21",
  proposalId: "prop-reed",
  proposalAcceptedOn: "2026-08-20",
  clientNames: ["Emma Reed", "Noah Reed"],
};

const codes = (flags: { code: string }[]) => flags.map((flag) => flag.code);

test("a clean signed agreement suggests its job with nothing to doubt", () => {
  const result = assessSignedAgreement({
    reading: reading(),
    candidates: [reed, johnson],
    today,
  });
  assert.deepEqual(result.suggestion, {
    projectId: "p-johnson",
    proposalId: "prop-johnson",
    signerName: "Maya Johnson",
    signedAt: "2026-09-10",
  });
  assert.deepEqual(result.flags, []);
  assert.equal(result.matches[0]!.projectId, "p-johnson");
});

test("the same person spelled two ways is still the same person", () => {
  assert.equal(samePerson("Theodore J. Johnson", "Theo Johnson"), true);
  assert.equal(samePerson("Zoë Martínez", "zoe martinez"), true);
  // A different family is never a match, however similar the first name.
  assert.equal(samePerson("Maya Johnston", "Maya Johnson"), false);
  // One word is not enough to be anybody.
  assert.equal(samePerson("Maya", "Maya Johnson"), false);
});

test("a tie is never resolved on the studio's behalf", () => {
  // Two jobs, both naming a Johnson — the second a cousin's wedding.
  const cousin = {
    ...johnson,
    projectId: "p-cousin",
    projectName: "Mark & Theo Johnson",
    proposalId: "prop-cousin",
    eventDate: "2027-09-04",
    clientNames: ["Maya Johnson", "Theo Johnson"],
  };
  const result = assessSignedAgreement({
    reading: reading({ eventDate: null }),
    candidates: [johnson, cousin],
    today,
  });
  assert.equal(result.suggestion, null);
  assert.deepEqual(codes(result.flags), ["AMBIGUOUS_MATCH"]);
  assert.equal(result.matches.length, 2, "both stay choosable");
});

test("a job with no accepted proposal cannot take a signature", () => {
  const result = assessSignedAgreement({
    reading: reading(),
    candidates: [{ ...johnson, proposalId: null }],
    today,
  });
  assert.equal(result.suggestion, null);
  assert.deepEqual(codes(result.flags), ["NO_JOBS_AWAITING_SIGNATURE"]);
});

test("a document naming nobody on any job suggests nothing", () => {
  const result = assessSignedAgreement({
    reading: reading({
      signerNames: ["Sofia Carter"],
      clientNames: ["Sofia Carter", "Miles Carter"],
      eventDate: "2027-10-02",
    }),
    candidates: [johnson, reed],
    today,
  });
  assert.equal(result.suggestion, null);
  assert.deepEqual(codes(result.flags), ["NO_MATCHING_JOB"]);
});

test("every disagreement between the document and the job is raised", () => {
  const result = assessSignedAgreement({
    reading: reading({
      // The couple is named, but the page was signed by the planner, is dated
      // before the proposal was accepted, and is for a different day.
      signerNames: ["Priya Shah"],
      signedDate: "2026-08-15",
      eventDate: "2027-06-19",
    }),
    candidates: [johnson],
    today,
  });
  assert.equal(result.suggestion?.projectId, "p-johnson");
  assert.deepEqual(codes(result.flags).sort(), [
    "EVENT_DATE_MISMATCH",
    "SIGNED_BEFORE_ACCEPTANCE",
    "SIGNER_NOT_ON_JOB",
  ]);
});

test("a date that hasn't happened is flagged and left for a person to enter", () => {
  const result = assessSignedAgreement({
    reading: reading({ signedDate: "2027-09-10" }),
    candidates: [johnson],
    today,
  });
  assert.deepEqual(codes(result.flags), ["SIGNED_IN_FUTURE"]);
  // Prefilling it would make an obvious misreading a one-tap mistake.
  assert.equal(result.suggestion?.signedAt, "");
});

test("an unsigned or unrelated file says so before anything else", () => {
  const unsigned = assessSignedAgreement({
    reading: reading({ signatureVisible: false }),
    candidates: [johnson],
    today,
  });
  assert.equal(codes(unsigned.flags)[0], "NO_SIGNATURE_VISIBLE");

  const invoice = assessSignedAgreement({
    reading: reading({
      isSignedAgreement: false,
      signatureVisible: false,
      signedDate: null,
    }),
    candidates: [johnson],
    today,
  });
  assert.deepEqual(codes(invoice.flags).slice(0, 2), [
    "NOT_A_SIGNED_AGREEMENT",
    "NO_SIGNED_DATE",
  ]);
});

test("features/ and functions/ match signed agreements identically", () => {
  assert.equal(
    readFileSync("functions/src/booking/signed-agreement-match.ts", "utf8"),
    readFileSync("features/booking/signed-agreement-match.ts", "utf8"),
    "the copy the reader runs has drifted from the tested one",
  );
});
