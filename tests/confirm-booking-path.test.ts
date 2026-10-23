import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { integrityTaskFix } from "../features/tasks/integrity-task";
import { manualAdvanceFor } from "../features/projects/manual-advance";

/**
 * GR, 2026-10-23: Today said "Confirm the booking for Michelle Graziano and
 * Kyle Clemency", opened the task list, and its "Mark done" hid the reminder
 * while the job stayed unbooked — and the job's own card offered to record a
 * deposit QuickBooks had already been paid.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("a safety-sweep task opens where it's fixed, with the fix as its button", () => {
  const task = { source: "integrity_check", integrityRule: "deposit_paid_not_booked", projectId: "p 1" };
  assert.deepEqual(integrityTaskFix(task), { href: "/studio/booking?project=p%201", label: "Confirm the booking" });
  assert.equal(integrityTaskFix({ ...task, integrityRule: "signed_no_deposit" })?.label, "Send the deposit invoice");
  assert.equal(integrityTaskFix({ ...task, integrityRule: "paid_after_cancel" })?.href, "/studio/projects/p%201");
  assert.equal(integrityTaskFix({ source: "workflow" }), null);
  assert.match(read("features/today/inbox.ts"), /label: integrityFix \? integrityFix\.label :/);
});

test("the task list has no tick for a problem that closes itself", () => {
  const row = read("components/tasks/task-record-actions.tsx");
  assert.match(row, /disabled=\{busy !== null \|\| cancelled \|\| Boolean\(fix && !settled\)\}/);
  assert.match(row, /closes by itself once it&rsquo;s fixed/);
});

test("ticked off while still broken, the reminder comes back after an hour", () => {
  assert.match(
    read("functions/src/operations/integrity-sweep.ts"),
    /current\.get\("completedBy"\) !== "integrity-sweep" && completedAt && now - completedAt > 60 \* MINUTE\)\s*await current\.ref\.update\(\{ status: "not_started"/,
  );
});

test("a paid deposit offers to confirm the booking, never to record it again", () => {
  const paid = manualAdvanceFor("RETAINER_PENDING", "BOOKED", "p1", "photographer", true);
  assert.equal(paid?.label, "Confirm the booking");
  assert.equal(paid?.href, "/studio/booking?project=p1");
  assert.equal(manualAdvanceFor("RETAINER_PENDING", "BOOKED", "p1", "photographer", false)?.label, "Record the retainer");
  // A vendor's client paid a deposit (trades.ts).
  assert.match(String(manualAdvanceFor("RETAINER_PENDING", "BOOKED", "p1", "dj", true)?.detail), /deposit is paid/);
  assert.match(read("components/projects/live-project-detail.tsx"), /manualAdvanceFor\(state, target, projectId, trade, retainerPaid\)/);
});
