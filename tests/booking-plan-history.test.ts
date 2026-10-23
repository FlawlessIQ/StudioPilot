import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import {
  PLAN_HISTORY_COLLECTION,
  planHistoryId,
  planHistoryRecord,
  planReplacement,
  reopenPlan,
  reopenedPlanStep,
  replacePlan,
  staleFields,
  type PlanWriter,
} from "../functions/src/booking/plan-history.ts";

/**
 * A job's booking plan is never silently overwritten (audit, 2026-10-22).
 *
 * Every path that starts a plan wrote it wholesale whenever the one there was
 * not active, so a paused, failed, cancelled or needs_attention plan was
 * replaced and its `invoiceUnlinkedAt/By`, `restoredAt/By/Reason`,
 * `lastError` and approval history went with it. A replacement now copies
 * the plan into bookingOrchestrationHistory first, in the same write. And an
 * uncancelled job's plan reopens, so its deposit can book it again.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const NOW = "2026-10-23T15:00:00.000Z";

// --- fakes ------------------------------------------------------------------

type Write = { op: "create" | "update"; path: string; data: Record<string, unknown>; precondition?: unknown };

function recorder(): PlanWriter & { writes: Write[] } {
  const writes: Write[] = [];
  return {
    writes,
    create(reference, data) {
      writes.push({ op: "create", path: reference.path, data });
    },
    update(reference, data, precondition) {
      writes.push({ op: "update", path: reference.path, data, precondition });
    },
  };
}

const db = { doc: (path: string) => ({ path }) } as unknown as Firestore;
const updateTime = { seconds: 1, nanoseconds: 2 };

function snapshot(data: Record<string, unknown> | null): DocumentSnapshot {
  return {
    exists: data !== null,
    data: () => (data === null ? undefined : { ...data }),
    get: (field: string) => data?.[field],
    ref: { path: "bookingOrchestrations/project_1" },
    updateTime: data === null ? undefined : updateTime,
  } as unknown as DocumentSnapshot;
}

const nextPlan = {
  id: "project_1",
  tenantId: "tenant_1",
  projectId: "project_1",
  contractId: "contract_new",
  invoiceId: null,
  status: "active",
  currentStep: "wait_for_signature",
  lastError: null,
};

const pausedPlan = {
  id: "project_1",
  tenantId: "tenant_1",
  projectId: "project_1",
  contractId: "contract_old",
  invoiceId: null,
  status: "needs_attention",
  currentStep: "needs_attention",
  lastError: "BOOKING_GATE_BLOCKED",
  invoiceUnlinkedAt: "2026-10-20T10:00:00.000Z",
  invoiceUnlinkedBy: "user_owner",
  restoredAt: "2026-10-22T09:00:00.000Z",
  restoredBy: "support",
  restoredReason: "Restored after a deleted invoice",
  approvedBy: "user_owner",
  approvedAt: "2026-09-01T12:00:00.000Z",
};

const replace = (existing: DocumentSnapshot, writer = recorder()) => ({
  writer,
  outcome: replacePlan(db, writer, {
    existing,
    next: nextPlan,
    tenantId: "tenant_1",
    projectId: "project_1",
    now: NOW,
    actor: "user_owner",
    reason: "agreement_sent",
  }),
});

// --- pure ---------------------------------------------------------------------

test("a missing plan is created, a booked plan is kept, anything else is replaced", () => {
  assert.equal(planReplacement(null), "create");
  assert.equal(planReplacement(undefined), "create");
  assert.equal(planReplacement({ status: "completed" }), "keep");
  for (const status of ["active", "paused", "failed", "cancelled", "needs_attention", undefined])
    assert.equal(planReplacement({ status }), "replace", String(status));
});

test("the history row is the whole plan, keyed by job and moment", () => {
  assert.equal(PLAN_HISTORY_COLLECTION, "bookingOrchestrationHistory");
  assert.equal(planHistoryId("project_1", NOW), `project_1_${NOW}`);
  const record = planHistoryRecord({
    tenantId: "tenant_1",
    projectId: "project_1",
    previous: pausedPlan,
    replacedAt: NOW,
    replacedBy: "user_owner",
    reason: "agreement_sent",
  });
  assert.deepEqual(record, {
    id: `project_1_${NOW}`,
    tenantId: "tenant_1",
    projectId: "project_1",
    previousPlan: pausedPlan,
    previousStatus: "needs_attention",
    previousStep: "needs_attention",
    replacedAt: NOW,
    replacedBy: "user_owner",
    reason: "agreement_sent",
  });
});

test("fields only the old plan had are the ones the replacement deletes", () => {
  assert.deepEqual(staleFields(pausedPlan, nextPlan), [
    "invoiceUnlinkedAt",
    "invoiceUnlinkedBy",
    "restoredAt",
    "restoredBy",
    "restoredReason",
    "approvedBy",
    "approvedAt",
  ]);
  assert.deepEqual(staleFields(nextPlan, nextPlan), []);
});

// --- replacing ------------------------------------------------------------------

test("replacing a non-completed plan writes its history first, then replaces it only if unchanged", () => {
  const { writer, outcome } = replace(snapshot(pausedPlan));
  assert.equal(outcome, "replaced");
  assert.equal(writer.writes.length, 2);
  const [history, replacement] = writer.writes;
  assert.equal(history!.op, "create");
  assert.equal(history!.path, `bookingOrchestrationHistory/project_1_${NOW}`);
  assert.deepEqual(history!.data.previousPlan, pausedPlan);
  assert.equal(history!.data.tenantId, "tenant_1");
  assert.equal(history!.data.projectId, "project_1");
  assert.equal(history!.data.replacedBy, "user_owner");
  assert.equal(history!.data.reason, "agreement_sent");
  assert.equal(replacement!.op, "update");
  assert.equal(replacement!.path, "bookingOrchestrations/project_1");
  assert.deepEqual(replacement!.precondition, { lastUpdateTime: updateTime });
  // The new plan exactly: its fields, and the old-only ones deleted.
  for (const [key, value] of Object.entries(nextPlan)) assert.deepEqual(replacement!.data[key], value, key);
  for (const key of ["invoiceUnlinkedAt", "restoredAt", "restoredReason", "approvedBy"])
    // The functions package has its own firebase-admin, so the sentinel is
    // recognised by name rather than by class.
    assert.equal((replacement!.data[key] as { methodName?: string }).methodName, "FieldValue.delete", key);
});

test("every non-completed status is copied before it is replaced", () => {
  for (const status of ["active", "paused", "failed", "cancelled", "needs_attention"]) {
    const { writer, outcome } = replace(snapshot({ ...pausedPlan, status }));
    assert.equal(outcome, "replaced", status);
    assert.equal(writer.writes[0]!.path.startsWith("bookingOrchestrationHistory/"), true, status);
    assert.equal(writer.writes[0]!.data.previousStatus, status);
  }
});

test("a completed plan is never replaced, and nothing is written", () => {
  const { writer, outcome } = replace(snapshot({ ...pausedPlan, status: "completed" }));
  assert.equal(outcome, "kept");
  assert.deepEqual(writer.writes, []);
});

test("no plan yet: it is created, which fails if one appeared since — and there is no history", () => {
  const { writer, outcome } = replace(snapshot(null));
  assert.equal(outcome, "created");
  assert.deepEqual(writer.writes, [{ op: "create", path: "bookingOrchestrations/project_1", data: nextPlan }]);
});

// --- reopening on uncancel ------------------------------------------------------

const cancelledPlan = (extra: Record<string, unknown> = {}) => ({
  ...pausedPlan,
  status: "cancelled",
  currentStep: "cancelled",
  cancelledAt: "2026-10-21T10:00:00.000Z",
  cancelledReason: "project_cancelled",
  ...extra,
});

test("the reopened step follows the state the job came back to", () => {
  const step = (projectState: string, plan: Record<string, unknown> | null) => reopenedPlanStep({ projectState, plan });
  assert.equal(step("CONTRACT_PENDING", cancelledPlan({ cancelledFromStep: "wait_for_signature" })), "wait_for_signature");
  // Back at CONTRACT_PENDING the agreement goes again, whatever the plan waited on.
  assert.equal(step("CONTRACT_PENDING", cancelledPlan({ cancelledFromStep: "wait_for_payment" })), "wait_for_signature");
  assert.equal(step("RETAINER_PENDING", cancelledPlan({ cancelledFromStep: "wait_for_payment" })), "wait_for_payment");
  // Signed already: never back to waiting on a signature.
  assert.equal(step("RETAINER_PENDING", cancelledPlan({ cancelledFromStep: "wait_for_signature" })), "wait_for_payment");
  assert.equal(step("RETAINER_PENDING", cancelledPlan()), "wait_for_payment");
  assert.equal(step("RETAINER_PENDING", cancelledPlan({ cancelledFromStep: "wait_for_gate" })), "wait_for_gate");
  assert.equal(step("RETAINER_PENDING", cancelledPlan({ cancelledReason: "project_called_off" })), "wait_for_payment");
});

test("only a plan the cancel closed reopens, and only before booking", () => {
  const step = (projectState: string, plan: Record<string, unknown> | null) => reopenedPlanStep({ projectState, plan });
  assert.equal(step("CONTRACT_PENDING", null), null);
  assert.equal(step("CONTRACT_PENDING", { ...pausedPlan, status: "active" }), null);
  assert.equal(step("RETAINER_PENDING", { ...pausedPlan, status: "completed" }), null);
  for (const state of ["BOOKED", "PLANNING", "READY", "PROPOSAL", "CONSULTATION", "INQUIRY"])
    assert.equal(step(state, cancelledPlan()), null, state);
  // Closed because the acceptance was undone, not because the job was off.
  assert.equal(step("CONTRACT_PENDING", cancelledPlan({ cancelledReason: "acceptance_undone" })), null);
});

test("uncancelling reopens the plan, its closed copy kept in history", () => {
  const writer = recorder();
  const plan = cancelledPlan({ cancelledFromStep: "wait_for_payment" });
  const step = reopenPlan(db, writer, {
    existing: snapshot(plan),
    projectState: "RETAINER_PENDING",
    tenantId: "tenant_1",
    projectId: "project_1",
    now: NOW,
    actor: "user_owner",
    reason: "reopened_on_uncancel",
  });
  assert.equal(step, "wait_for_payment");
  const [history, reopened] = writer.writes;
  assert.equal(history!.op, "create");
  assert.equal(history!.path, `bookingOrchestrationHistory/project_1_${NOW}`);
  assert.deepEqual(history!.data.previousPlan, plan);
  assert.equal(history!.data.reason, "reopened_on_uncancel");
  assert.equal(reopened!.op, "update");
  assert.deepEqual(reopened!.precondition, { lastUpdateTime: updateTime });
  assert.equal(reopened!.data.status, "active");
  assert.equal(reopened!.data.currentStep, "wait_for_payment");
  assert.equal(reopened!.data.cancelledReason, null);
  assert.equal(reopened!.data.reopenedBy, "user_owner");
  // An update, not a set: what only the plan recorded stays on it.
  for (const key of ["invoiceUnlinkedAt", "restoredAt", "lastError", "approvedBy"]) assert.equal(key in reopened!.data, false, key);
});

test("a plan that does not reopen is not written at all", () => {
  for (const [projectState, plan] of [
    ["BOOKED", cancelledPlan()],
    ["RETAINER_PENDING", { ...pausedPlan, status: "completed" }],
    ["RETAINER_PENDING", null],
    ["RETAINER_PENDING", cancelledPlan({ tenantId: "tenant_other" })],
  ] as const) {
    const writer = recorder();
    const step = reopenPlan(db, writer, {
      existing: snapshot(plan),
      projectState,
      tenantId: "tenant_1",
      projectId: "project_1",
      now: NOW,
      actor: "user_owner",
      reason: "reopened_on_uncancel",
    });
    assert.equal(step, null);
    assert.deepEqual(writer.writes, []);
  }
});

// --- source pins ---------------------------------------------------------------

const PLAN_WRITERS = [
  "functions/src/booking/orchestration.ts",
  "functions/src/booking/commands.ts",
  "functions/src/contracts/commands.ts",
  "functions/src/contracts/combined-commands.ts",
];

test("no path writes a booking plan wholesale any more", () => {
  for (const path of PLAN_WRITERS) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /\.set\(\s*(?:db|firestore)\.doc\(`bookingOrchestrations\/|\.set\(\s*(?:orchestrationReference|planReference)\s*,/,
      path,
    );
    assert.match(source, /replacePlan\((?:db|firestore), (?:transaction|batch), \{/, path);
  }
  const counts = PLAN_WRITERS.map((path) => (read(path).match(/replacePlan\((?:db|firestore), (?:transaction|batch), \{/g) ?? []).length);
  // Acceptance + no agreement; sequence approval + recorded signature; the agreement; the booking link.
  assert.deepEqual(counts, [2, 2, 1, 1]);
});

test("acceptance re-reads the plan inside its transaction before replacing it", () => {
  const source = read("functions/src/booking/orchestration.ts");
  const accepted = source.slice(source.indexOf("export const bookingProposalAccepted"), source.indexOf("export const bookingContractCompleted"));
  const transaction = accepted.slice(accepted.indexOf("await db.runTransaction("));
  assert.match(transaction, /transaction\.get\(planReference\)/);
  assert.match(transaction, /if \(currentPlan\.exists && \["active", "completed"\]\.includes\(String\(currentPlan\.get\("status"\)\)\)\)/);
  assert.match(transaction, /replacePlan\(db, transaction, \{\s*existing: currentPlan,/);
  const noAgreement = source.slice(source.indexOf("async function bookWithoutAgreement"));
  assert.match(noAgreement, /transaction\.get\(planReference\)/);
  assert.match(noAgreement, /currentPlan\.get\("status"\) === "completed"\) \{[\s\S]{0,200}return false;/);
});

test("uncancelProject reads the plan before any write and reopens it", () => {
  const crm = read("functions/src/crm/commands.ts");
  const branch = crm.slice(crm.indexOf('if (command.type === "uncancelProject")'), crm.indexOf('if (command.type === "reopenJob")'));
  const planRead = branch.indexOf("db.doc(`bookingOrchestrations/${command.input.projectId}`)");
  const firstWrite = branch.search(/transaction\.(?:set|update|create)\(/);
  assert.ok(planRead > 0 && planRead < firstWrite, "the plan is read before the first write");
  assert.match(branch, /reopenPlan\(db, transaction, \{\s*existing: bookingPlan,\s*projectState: target,/);
  assert.match(branch, /reason: "reopened_on_uncancel"/);
});

test("a cancel records the step the plan was on, for the undo", () => {
  assert.match(read("functions/src/booking/stopped-billing.ts"), /cancelledFromStep: reads\.plan\.get\("currentStep"\) \?\? null/);
  assert.match(read("functions/src/booking/orchestration.ts"), /cancelledFromStep: currentPlan\.get\("currentStep"\) \?\? null/);
});

test("raising a retainer points an active plan at it, or reopens a cancelled one", () => {
  const source = read("functions/src/booking/commands.ts");
  const branch = source.slice(source.indexOf('command.type === "createRetainerInvoice"'), source.indexOf('command.type === "runBookingGate"'));
  assert.match(branch, /batch\.update\(retainerPlan\.ref, \{\s*invoiceId,\s*currentStep: "wait_for_payment",/);
  assert.match(branch, /reopenPlan\(firestore, batch, \{[\s\S]{0,300}reason: "reopened_for_retainer",/);
});

test("the history collection is server-only in the rules", () => {
  assert.match(
    read("firestore.rules"),
    /match \/bookingOrchestrationHistory\/\{historyId\} \{\s*allow read, write: if false;\s*\}/,
  );
});

test("a purge names the history rows it deletes with the job", () => {
  for (const path of ["features/projects/purge-policy.ts", "functions/src/projects/purge-policy.ts"])
    assert.match(read(path), /bookingOrchestrationHistory: \{ one: "earlier booking automation", many: "earlier booking automations" \}/, path);
});
