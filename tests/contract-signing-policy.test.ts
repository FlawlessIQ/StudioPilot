import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canClientSignContract,
  normaliseTypedName,
  signingRefusalCopy,
  type SigningRefusal,
} from "@/features/contracts/signing-policy";
import { evaluateBookingGate } from "@/server/services/booking-gate-service";
import { studioVouchedAuthorities } from "@/features/imports/existing-booking";
import { completionAuthoritySchema } from "@/features/contracts/schema";
import {
  currentEsignConsent,
  esignConsentText,
  esignConsentVersion,
} from "@/features/contracts/esign-consent";

/**
 * A signature captured in StudioCue is booking evidence (ADR 0006). It is the
 * couple's act only if nobody else could have made it, and only if what they
 * signed is what they were shown. Every refusal below is one of those two
 * conditions failing.
 */

const hash = "a".repeat(64);
const allowed = {
  contract: {
    exists: true,
    provider: "studiocue",
    status: "sent",
    documentHash: hash,
    clientSignerEmail: "Erin@Example.com",
  },
  projectState: "CONTRACT_PENDING",
  signer: { membershipRole: "client", email: "erin@example.com" },
  presentedDocumentHash: hash,
  consent: true,
  typedName: "Erin Walsh",
};

const refusalOf = (overrides: Partial<typeof allowed> & Record<string, unknown>) => {
  const decision = canClientSignContract({ ...allowed, ...overrides } as typeof allowed);
  return decision.allowed ? null : decision.refusal;
};

test("the addressed client, on a sent contract, with consent and a name, may sign", () => {
  assert.deepEqual(canClientSignContract(allowed), { allowed: true, alreadySigned: false });
  // A viewed contract is still waiting for them.
  assert.equal(refusalOf({ contract: { ...allowed.contract, status: "viewed" } }), null);
});

test("a studio member cannot sign as their client", () => {
  for (const role of ["studio_owner", "studio_admin", "studio_coordinator", "staff_photographer", null]) {
    assert.equal(
      refusalOf({ signer: { membershipRole: role, email: "erin@example.com" } } as never),
      "SIGNER_NOT_A_CLIENT",
    );
  }
});

test("another client on the account cannot sign in the addressed client's name", () => {
  assert.equal(
    refusalOf({ signer: { membershipRole: "client", email: "joe@example.com" } }),
    "WRONG_SIGNER",
  );
  assert.equal(
    refusalOf({ contract: { ...allowed.contract, clientSignerEmail: "" } }),
    "WRONG_SIGNER",
  );
});

test("text that changed after it was shown cannot be signed", () => {
  assert.equal(refusalOf({ presentedDocumentHash: "b".repeat(64) }), "DOCUMENT_CHANGED");
  assert.equal(
    refusalOf({ contract: { ...allowed.contract, documentHash: undefined as never } }),
    "DOCUMENT_CHANGED",
  );
});

test("consent and a typed name are both required", () => {
  assert.equal(refusalOf({ consent: false }), "CONSENT_REQUIRED");
  assert.equal(refusalOf({ typedName: " " }), "NAME_REQUIRED");
  assert.equal(refusalOf({ typedName: "x" }), "NAME_REQUIRED");
  assert.equal(refusalOf({ typedName: "<b>Erin</b>" }), "NAME_REQUIRED");
  assert.equal(refusalOf({ typedName: "12345" }), "NAME_REQUIRED");
  assert.equal(normaliseTypedName("  Siobhán   Ní  Bhriain "), "Siobhán Ní Bhriain");
});

test("only a sent, unsigned StudioCue contract on a job waiting for it can be signed", () => {
  const cases: Array<[Record<string, unknown>, SigningRefusal]> = [
    [{ contract: { ...allowed.contract, exists: false } }, "CONTRACT_NOT_FOUND"],
    [{ contract: { ...allowed.contract, provider: "dropbox_sign" } }, "NOT_A_STUDIOCUE_CONTRACT"],
    [{ contract: { ...allowed.contract, status: "completed" } }, "CONTRACT_ALREADY_SIGNED"],
    [{ contract: { ...allowed.contract, status: "voided" } }, "CONTRACT_VOIDED"],
    [{ contract: { ...allowed.contract, status: "draft" } }, "CONTRACT_NOT_SENT"],
    [{ projectState: "PROPOSAL" }, "PROJECT_NOT_AWAITING_SIGNATURE"],
    [{ projectState: "BOOKED" }, "PROJECT_NOT_AWAITING_SIGNATURE"],
  ];
  for (const [overrides, refusal] of cases) assert.equal(refusalOf(overrides), refusal);
});

test("every refusal has words for the couple", () => {
  for (const [refusal, copy] of Object.entries(signingRefusalCopy)) {
    assert.ok(copy.length > 10, refusal);
    assert.doesNotMatch(copy, /[A-Z]{4,}_/, "no codes in client copy");
  }
});

test("the couple's signature is signer evidence, never the studio's word", () => {
  assert.ok(completionAuthoritySchema.options.includes("client_signed"));
  assert.ok(!studioVouchedAuthorities.includes("client_signed"));
  const gate = evaluateBookingGate({
    tenantId: "t",
    projectId: "p",
    signingProvider: "studiocue",
    evidence: {
      contractCompleted: true,
      contractAttestedManually: false,
      retainerInvoiceCreated: true,
      retainerAttestedManually: false,
      retainerSatisfied: true,
      retainerExceptionApproved: false,
      eventDateAvailable: true,
      requiredContactsComplete: true,
    },
    evaluatedAt: "2026-09-25T12:00:00.000Z",
  });
  const contract = gate.requirements.find((requirement) => requirement.key === "contractCompleted");
  assert.equal(contract?.source, "studiocue_signature");
  assert.equal(contract?.label, "Signed by the client in StudioCue");
  assert.equal(gate.passed, true);
});

test("both copies of the gate fold count a client signature as a completed contract", () => {
  // The functions gate derives `contractCompleted` from any completed
  // contract whose authority is not studio-vouched. Pin that reading.
  const commands = readFileSync("functions/src/booking/commands.ts", "utf8");
  assert.match(commands, /contractCompleted: !contracts\.empty && !attestedManually/);
});

test("consent text is versioned and recoverable by id", () => {
  assert.equal(esignConsentVersion(currentEsignConsent.id), currentEsignConsent);
  assert.equal(esignConsentVersion("nope"), null);
  const text = esignConsentText(currentEsignConsent);
  assert.match(text, /paper copy/i);
  assert.match(text, /decline/i);
  assert.match(text, /copy of the complete agreement is emailed/i);
});
