import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bookingGateRequirements } from "@/features/booking/gate-requirements";
import { retainerFromSchedule } from "@/features/booking/agreed-retainer";
import { BookingGateService, evaluateBookingGate, type BookingCompletionStore } from "@/server/services/booking-gate-service";

const completeEvidence = {
  contractCompleted: true,
  contractAttestedManually: false,
  retainerInvoiceCreated: true,
  retainerSatisfied: true,
  retainerExceptionApproved: false,
  retainerAttestedManually: false,
  eventDateAvailable: true,
  requiredContactsComplete: true,
};

test("booking gate cannot pass while a deterministic requirement is missing", () => {
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: { ...completeEvidence, contractCompleted: false },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, ["Docusign contract completed"]);
});

test("the contract-completed requirement is labeled for the active signing provider", () => {
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: { ...completeEvidence, contractCompleted: false },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
    signingProvider: "dropbox_sign",
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, ["Dropbox Sign contract completed"]);
  assert.equal(result.requirements.find((item) => item.key === "contractCompleted")?.source, "dropbox_sign");
});

test("an approved retainer exception is explicit gate evidence", () => {
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: { ...completeEvidence, retainerSatisfied: false, retainerExceptionApproved: true },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(result.passed, true);
  assert.equal(result.requirements.find((item) => item.key === "retainerSatisfied")?.source, "approved_exception");
});

test("booking completion side effects execute exactly once", async () => {
  let completed: { projectId: string } | null = null;
  const store: BookingCompletionStore = {
    async getCompletedRun() { return completed; },
    async completeAtomically(input) { completed = { projectId: input.projectId }; },
  };
  let executions = 0;
  const steps = {
    async createProjectFolders() { executions += 1; return { id: "folder", path: "/StudioCue/2026/project" }; },
    async createProductionEvent() { executions += 1; return { id: "event" }; },
    async instantiateWorkflow() { executions += 1; return { id: "workflow" }; },
    async activateClientPortal() { executions += 1; return { id: "portal" }; },
    async sendConfirmation() { executions += 1; return { id: "message" }; },
  };
  const service = new BookingGateService(store, () => "2026-07-26T12:00:00.000Z");
  const input = { tenantId: "tenant-a", projectId: "project-a", idempotencyKey: "booking:project-a", evidence: completeEvidence, steps };
  assert.equal((await service.complete(input)).completed, true);
  assert.equal((await service.complete(input)).completed, true);
  assert.equal(executions, 5);
});

/**
 * Signing providers charge for API access, and without one a project could
 * not leave CONTRACT_PENDING by any route — the transition is
 * evidence-controlled and only a provider webhook ever wrote it. Payment
 * already had `retainerExceptionApproved`; signing had nothing.
 *
 * A studio owner attesting is a legitimate authority. It is not the same
 * claim as a provider verifying, so the gate passes on it but never calls
 * it a provider signature.
 */
test("a manually attested signature satisfies the gate", () => {
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      contractCompleted: false,
      contractAttestedManually: true,
    },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
    signingProvider: "dropbox_sign",
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.blockers, []);
});

test("an attested signature is never reported as the provider's", () => {
  const attested = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      contractCompleted: false,
      contractAttestedManually: true,
    },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
    signingProvider: "dropbox_sign",
  }).requirements.find((item) => item.key === "contractCompleted");

  assert.equal(attested?.source, "manual_attestation");
  assert.match(attested?.label ?? "", /recorded by the studio/i);

  // And a real provider completion still reports the provider, so the two
  // can never be confused in the record.
  const verified = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: { ...completeEvidence, contractAttestedManually: false },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
    signingProvider: "dropbox_sign",
  }).requirements.find((item) => item.key === "contractCompleted");

  assert.equal(verified?.source, "dropbox_sign");
});

test("an attested signature still cannot excuse an unpaid retainer", () => {
  // The escape hatch is for the signature only. Nothing about attesting to
  // a signature says anything about money having moved.
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      contractCompleted: false,
      contractAttestedManually: true,
      retainerSatisfied: false,
      retainerExceptionApproved: false,
    },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, ["Retainer paid"]);
});

test("a retainer taken outside StudioCue books the job", () => {
  // Without an invoicing provider StudioCue refuses to raise a retainer, so
  // it can never watch one clear: the gate was short of both a created
  // retainer and a paid one, and a studio taking bank transfers could not
  // confirm a booking at all.
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      retainerInvoiceCreated: false,
      retainerSatisfied: false,
      retainerAttestedManually: true,
    },
    evaluatedAt: "2026-08-25T12:00:00.000Z",
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.blockers, []);
});

test("an attested retainer is never reported as the provider's", () => {
  // The whole reason it is a separate evidence field. Naming QuickBooks on
  // a payment QuickBooks never saw would put a provider's authority behind
  // a person's word.
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      retainerInvoiceCreated: false,
      retainerSatisfied: false,
      retainerAttestedManually: true,
    },
    evaluatedAt: "2026-08-25T12:00:00.000Z",
  });
  for (const key of ["retainerInvoiceCreated", "retainerSatisfied"]) {
    const requirement = result.requirements.find((item) => item.key === key);
    assert.equal(requirement?.source, "manual_attestation", key);
    assert.doesNotMatch(String(requirement?.label), /QuickBooks/, key);
  }
});

test("attesting a payment and waiving one stay different claims", () => {
  // An approved exception says the money has not arrived and the studio is
  // going ahead regardless; an attestation says it has arrived. Both pass
  // the same requirement and the record has to say which happened.
  const waived = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      retainerSatisfied: false,
      retainerExceptionApproved: true,
    },
    evaluatedAt: "2026-08-25T12:00:00.000Z",
  });
  assert.equal(
    waived.requirements.find((item) => item.key === "retainerSatisfied")?.source,
    "approved_exception",
  );
  const received = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      retainerInvoiceCreated: false,
      retainerSatisfied: false,
      retainerAttestedManually: true,
    },
    evaluatedAt: "2026-08-25T12:00:00.000Z",
  });
  assert.equal(
    received.requirements.find((item) => item.key === "retainerSatisfied")
      ?.source,
    "manual_attestation",
  );
});

test("an attested retainer still cannot excuse an unsigned agreement", () => {
  // Money is not a signature. The escape hatches are per-requirement and
  // must not start covering for each other.
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      contractCompleted: false,
      contractAttestedManually: false,
      retainerAttestedManually: true,
    },
    evaluatedAt: "2026-08-25T12:00:00.000Z",
  });
  assert.equal(result.passed, false);
});

test("evidence folds into requirements, and both copies fold it the same way", () => {
  // The bug this guards: blockers were derived by treating every false
  // evidence field as a missing requirement. The moment a signature could
  // be satisfied two ways, no booking could pass at all — a provider-signed
  // contract blocked for want of an attestation, an attested one for want
  // of a provider. It shipped, because the gate service gets this right and
  // the gate service is not what books the job.
  const provider = bookingGateRequirements({
    contractCompleted: true,
    contractAttestedManually: false,
    retainerInvoiceCreated: true,
    retainerAttestedManually: false,
    retainerSatisfied: true,
    retainerExceptionApproved: false,
    eventDateAvailable: true,
    requiredContactsComplete: true,
  });
  assert.deepEqual(Object.values(provider).every(Boolean), true);
  const attested = bookingGateRequirements({
    contractCompleted: false,
    contractAttestedManually: true,
    retainerInvoiceCreated: false,
    retainerAttestedManually: true,
    retainerSatisfied: false,
    retainerExceptionApproved: false,
    eventDateAvailable: true,
    requiredContactsComplete: true,
  });
  assert.deepEqual(Object.values(attested).every(Boolean), true);

  // functions/ cannot import from features/, so the fold is duplicated. The
  // two disagreeing means the gate a studio is shown and the gate that
  // books the job are different gates.
  const body = (source: string) =>
    source.slice(source.indexOf("export type BookingGateEvidenceFlags"));
  assert.equal(
    body(readFileSync("functions/src/booking/gate-requirements.ts", "utf8")),
    body(readFileSync("features/booking/gate-requirements.ts", "utf8")),
    "features/ and functions/ fold gate evidence differently",
  );
});

test("the retainer billed is the one the couple accepted", () => {
  // The reported case, exactly: a $1,899 package whose proposal set the
  // retainer to $1. Every path that raised a retainer read the package
  // snapshot instead of the accepted schedule, so StudioCue billed $569.70
  // — a number nobody had agreed to, on an invoice going out in the
  // studio's name.
  const schedule = [
    { label: "Retainer", amountCents: 100, dueDate: null },
    { label: "Final balance", amountCents: 189800, dueDate: "2026-09-30" },
  ];
  assert.equal(retainerFromSchedule(schedule, 56970), 100);

  // No override: the package figure stands.
  assert.equal(
    retainerFromSchedule(
      [{ label: "Retainer", amountCents: 56970, dueDate: null }],
      56970,
    ),
    56970,
  );
  // Taking nothing up front is a real choice, not a missing value.
  assert.equal(
    retainerFromSchedule([{ label: "Retainer", amountCents: 0 }], 56970),
    0,
  );
  // Nonsense falls back rather than billing NaN or a negative.
  for (const bad of [
    undefined,
    null,
    [],
    [{ label: "Final balance", amountCents: 100 }],
    [{ label: "Retainer", amountCents: "lots" }],
    [{ label: "Retainer", amountCents: -500 }],
    [{ label: "Retainer" }],
  ]) {
    assert.equal(retainerFromSchedule(bad, 56970), 56970, JSON.stringify(bad));
  }

  // functions/ cannot import from features/, so the rule is duplicated. The
  // two disagreeing means the figure a studio is shown and the figure the
  // client is billed are different figures.
  const body = (source: string) =>
    source.slice(source.indexOf("export function retainerFromSchedule"));
  const copy = readFileSync("functions/src/booking/agreed-retainer.ts", "utf8");
  const root = readFileSync("features/booking/agreed-retainer.ts", "utf8");
  assert.equal(
    body(copy).slice(0, body(root).length),
    body(root),
    "features/ and functions/ disagree about the agreed retainer",
  );
});
