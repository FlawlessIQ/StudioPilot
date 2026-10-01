import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bookingBlockerLabel } from "@/features/booking/gate-requirements";

/**
 * Four things the production walk of 2026-09-30 found on the FlawlessIQ test
 * wedding, after Waves 0–3 shipped.
 */
const source = (path: string) => readFileSync(path, "utf8");

test("a booking-check blocker reads as a sentence, old codes included", () => {
  assert.equal(bookingBlockerLabel("contractAttestedManually"), "the agreement isn't signed");
  assert.equal(bookingBlockerLabel("retainerSatisfied"), "the retainer isn't paid");
  assert.equal(bookingBlockerLabel("someNewThing"), "some new thing");
  assert.equal(bookingBlockerLabel(undefined), "something needs checking");
  assert.match(source("features/today/inbox.ts"), /plan\.blockers\.map\(\(value\) => bookingBlockerLabel\(value\)\)/);
});

test("a stage change without a reason says so instead of doing nothing", () => {
  const page = source("components/projects/live-project-detail.tsx");
  assert.equal((page.match(/setNotice\(REASON_NEEDED\);/g) ?? []).length, 2);
});

test("a task row shows who it's for", () => {
  const row = source("components/tasks/task-record-actions.tsx");
  assert.match(row, /assigneeLabel\(assigneeValue\(task\), useTaskAssignees\(\)\)/);
  assert.equal((row.match(/\{forEl\}/g) ?? []).length, 2);
});

test("invoice rows say Retainer or Final bill, not a provider id", () => {
  const view = source("components/studio/live-domain-view.tsx");
  assert.match(view, /secondaryText: invoiceRowLabel,/);
  assert.doesNotMatch(view, /secondary: \["providerInvoiceId", "kind"\]/);
});

test("a final bill held for review has Check and send on its Invoices row", () => {
  const actions = source("components/booking/invoice-corrections.tsx");
  assert.match(actions, /href=\{`#final-invoice-\$\{invoice\.id\}`\}/);
  assert.match(actions, /invoice\.status === "review_required" &&\s*OWNER_ADMIN\.includes/);
  const card = source("components/planning/final-invoice-reconciliation.tsx");
  assert.match(card, /id=\{`final-invoice-\$\{invoice\.id\}`\}/);
  assert.doesNotMatch(card, /<small>Project \{String\(invoice\.projectId\)\}<\/small>/);
});
