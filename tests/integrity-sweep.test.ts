import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { integrityTask, jobIntegrityFindings } from "../functions/src/operations/integrity-sweep.ts";

/**
 * The hourly safety sweep (2026-10-22 reliability review): records that
 * disagree — a paid deposit on a job that never booked — are found within the
 * hour instead of by the studio.
 */
const read = (path: string) => readFileSync(path, "utf8");
const now = Date.parse("2026-10-23T12:00:00Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const job = (state: string, extra: Record<string, unknown> = {}) => ({ tenantId: "t1", state, name: "Michelle & Kyle", ...extra });

test("a paid deposit on a job that didn't book is found, and shown to the studio", () => {
  const findings = jobIntegrityFindings({
    projectId: "p1",
    project: job("RETAINER_PENDING"),
    plan: null,
    retainers: [{ id: "inv1", status: "paid", balanceCents: 0, updatedAt: ago(30) }],
    completedContracts: [{ completedAt: ago(1500) }],
    now,
  });
  assert.deepEqual(findings.map((finding) => finding.rule), ["deposit_paid_not_booked"]);
  const task = integrityTask(findings[0]!, new Date(now).toISOString());
  assert.equal(task?.source, "integrity_check");
  assert.match(String(task?.title), /Confirm the booking for Michelle & Kyle/);
});

test("just paid is given its 15 minutes; called-off jobs are left alone", () => {
  const paidJustNow = [{ id: "inv1", status: "paid", balanceCents: 0, updatedAt: ago(5) }];
  const plan = { status: "active", policy: {} };
  assert.deepEqual(jobIntegrityFindings({ projectId: "p", project: job("RETAINER_PENDING"), plan, retainers: paidJustNow, completedContracts: [], now }), []);
  assert.deepEqual(jobIntegrityFindings({ projectId: "p", project: job("CANCELLED"), plan: null, retainers: [{ status: "paid", balanceCents: 0, updatedAt: ago(90) }], completedContracts: [], now }), []);
});

test("a signed agreement with no deposit, and a missing booking plan, are found", () => {
  const rules = jobIntegrityFindings({ projectId: "p", project: job("RETAINER_PENDING"), plan: null, retainers: [], completedContracts: [{ completedAt: ago(120) }], now }).map((finding) => finding.rule);
  assert.deepEqual(rules.sort(), ["booking_plan_missing", "signed_no_deposit"]);
  // The studio bills this one itself and was told so: no deposit is expected from us.
  const own = jobIntegrityFindings({ projectId: "p", project: job("RETAINER_PENDING"), plan: { status: "active", policy: { createRetainerAfterSignature: false } }, retainers: [], completedContracts: [{ completedAt: ago(120) }], now });
  assert.deepEqual(own, []);
  const stuck = jobIntegrityFindings({ projectId: "p", project: job("CONTRACT_PENDING"), plan: { status: "active" }, retainers: [], completedContracts: [{ completedAt: ago(90) }], now });
  assert.deepEqual(stuck.map((finding) => finding.rule), ["signed_not_advanced"]);
});

test("findings alert once, close themselves, and reach Today the hour they're found", () => {
  const sweep = read("functions/src/operations/integrity-sweep.ts");
  assert.match(sweep, /if \(open\) continue;\s*raised \+= 1;\s*logger\.error\("integrityFinding", \{\s*studiocueOperationalError: true/);
  assert.match(sweep, /await record\.ref\.update\(\{ resolvedAt: nowIso \}\)/);
  assert.match(read("features/today/inbox.ts"), /const onTheDay = checklist \|\| text\(task\.source\) === "integrity_check";/);
  assert.match(read("firestore.rules"), /match \/integrityFindings\/\{findingId\} \{\s*allow read, write: if false;/);
  assert.match(read("functions/src/index.ts"), /export \{ integritySweep \} from "\.\/operations\/integrity-sweep\.js";/);
});
