import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as features from "../features/billing/invoice-purge-policy";
import * as functionsCopy from "../functions/src/billing/invoice-purge-policy";
import { outstandingFinalBalance } from "../features/booking/final-balance-due";

/**
 * Deleting invoice records (own invoicing, Phase 5). The third hard delete
 * (memory: hard-delete-is-one-exception), held to the same three rules, and
 * to Conor's of 2026-10-09: a paid bill leaves a money-free settled note so
 * the job never goes backwards; the audit keeps that it happened, without
 * the money; a QuickBooks bill loses only StudioCue's copy.
 * The sweep itself runs against Firestore in tests/invoice-purge-sweep.test.ts.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const shared = (source: string) => source.slice(source.indexOf("// --- shared with"));

test("the features and functions copies match", () => {
  assert.equal(shared(read("functions/src/billing/invoice-purge-policy.ts")), shared(read("features/billing/invoice-purge-policy.ts")));
});

for (const [name, policy] of [
  ["features", features],
  ["functions", functionsCopy],
] as const) {
  const plan = (invoice: Record<string, unknown>, extra: Partial<Parameters<typeof policy.invoiceDeletePlan>[0]> = {}) =>
    policy.invoiceDeletePlan({ invoice, others: [], project: {}, jobHasFinalBalance: true, inFlight: false, ...extra });
  const paidDeposit = { kind: "retainer", status: "paid", amountCents: 100, balanceCents: 0 };

  test(`${name}: unpaid and closed bills can go any time, leaving no note`, () => {
    assert.deepEqual(plan({ kind: "retainer", status: "sent", amountCents: 100, balanceCents: 100 }), { allowed: true, settles: null, paidInFull: false });
    assert.deepEqual(plan({ kind: "final", status: "draft", amountCents: 100, balanceCents: 100 }), { allowed: true, settles: null, paidInFull: false });
    for (const status of ["voided", "superseded", "failed"])
      assert.deepEqual(plan({ kind: "final", status, amountCents: 100, balanceCents: 0 }), { allowed: true, settles: null, paidInFull: false });
  });

  test(`${name}: never part paid, never mid-flight`, () => {
    assert.deepEqual(plan({ kind: "final", status: "partially_paid", amountCents: 100, balanceCents: 40 }), { allowed: false, reason: "INVOICE_PARTLY_PAID" });
    assert.deepEqual(plan(paidDeposit, { inFlight: true }), { allowed: false, reason: "INVOICE_IN_FLIGHT" });
  });

  test(`${name}: a paid final settles; a paid deposit waits for the final`, () => {
    assert.deepEqual(plan({ kind: "final", status: "paid", amountCents: 100, balanceCents: 0 }), { allowed: true, settles: "final", paidInFull: false });
    assert.deepEqual(plan(paidDeposit), { allowed: false, reason: "INVOICE_STILL_NEEDED" });
    assert.deepEqual(plan(paidDeposit, { others: [{ kind: "final", status: "paid", amountCents: 200, balanceCents: 0 }] }), { allowed: true, settles: "retainer", paidInFull: false });
    // The final deleted earlier: its settled note counts.
    assert.deepEqual(plan(paidDeposit, { project: { billing: { settled: { final: { at: "x" } } } } }), { allowed: true, settles: "retainer", paidInFull: false });
    // Paid in full, or a job with no final: nothing is worked out from it.
    assert.deepEqual(plan({ ...paidDeposit, paidInFull: true }), { allowed: true, settles: "retainer", paidInFull: true });
    assert.deepEqual(plan(paidDeposit, { jobHasFinalBalance: false }), { allowed: true, settles: "retainer", paidInFull: false });
  });

  test(`${name}: the settled note reads as paid, and says records were deleted`, () => {
    const project = { billing: { settled: { retainer: { at: "t", deleted: true, paidInFull: true } }, recordsDeletedAt: "t" } };
    assert.equal(policy.settledInvoiceStatus(project, "retainer"), "paid");
    assert.equal(policy.settledInvoiceStatus(project, "final"), null);
    assert.equal(policy.paidInFullSettledByDeletion(project), true);
    assert.equal(policy.invoiceRecordsDeleted(project), true);
    assert.equal(policy.invoiceRecordsDeleted({}), false);
  });

  test(`${name}: the audit keeps what happened, never the money`, () => {
    assert.deepEqual(
      policy.scrubMoney({ status: "paid", amountCents: 5, balanceCents: 0, paidAt: "2026-10-01", method: "Zelle", reference: "123", nested: { totalCents: 9, via: "email" }, number: "INV-0001" }),
      { status: "paid", nested: { via: "email" }, number: "INV-0001" },
    );
    assert.equal(policy.scrubMoney(null), null);
  });
}

test("the sweep keeps the job purge's three rules", () => {
  const source = read("functions/src/billing/invoice-purge.ts");
  // Discovery, not a list.
  assert.match(source, /await db\.listCollections\(\)/);
  assert.match(source, /\.where\("invoiceId", "==", invoiceId\)/);
  // Every candidate tenant-checked.
  assert.match(source, /page\.docs\.filter\(\(item\) => item\.get\("tenantId"\) === tenantId\)/);
  // The settled note first, the invoice last.
  const sweep = source.slice(source.indexOf("export async function sweepInvoiceRecords"));
  assert.ok(sweep.indexOf("auditEvents") < sweep.indexOf("// 4. Last: the invoice itself."));
  const command = source.slice(source.indexOf("export async function deleteInvoiceRecords"));
  assert.ok(command.indexOf("await projectReference.update(projectUpdate)") < command.indexOf("await sweepInvoiceRecords("));
  // The tombstone carries no amounts.
  const tombstone = command.slice(command.indexOf('action: "invoice.deleted"'), command.indexOf("ipAddress: context.ipAddress"));
  assert.doesNotMatch(tombstone, /Cents/);
  // Idempotency rows, counters and the job are never swept.
  for (const kept of ["commandExecutions", "webhookEvents", "invoiceCounters", "projects"])
    assert.ok(features.INVOICE_PURGE_PROTECTED.includes(kept), kept);
  assert.match(read("functions/src/booking/commands.ts"), /type: z\.literal\("deleteInvoiceRecords"\)/);
});

test("nothing goes backwards, and nothing is re-billed from what's left", () => {
  // Closeout and readiness read the settled note.
  assert.match(read("functions/src/post-event/commands.ts"), /invoiceSettledByDeletion\(project\.data\(\), "final"\)/);
  for (const path of [
    "functions/src/workflow/readiness-evidence-loader.ts",
    "functions/src/workflow/commands.ts",
    "components/projects/use-readiness-evidence.ts",
    "components/projects/use-project-journey.ts",
    "components/today/use-today-inbox.ts",
  ])
    assert.match(read(path), /settledInvoiceStatus\(.*"final"\)/, path);
  // No balance is worked out once records are gone.
  assert.match(read("functions/src/booking/final-invoice.ts"), /if \(invoiceRecordsDeleted\(project\.data\(\)\)\) return \{ raised: false, reason: "records_deleted" \}/);
  const proposals = [{ id: "p", projectId: "j", status: "accepted", version: 1, pricingSnapshot: { totalCents: 1000, taxCents: 0 } }];
  assert.equal(outstandingFinalBalance({ projectId: "j", proposals, invoices: [] }).cents, 1000);
  assert.equal(outstandingFinalBalance({ projectId: "j", proposals, invoices: [], recordsDeleted: true }).cents, null);
  for (const path of ["features/today/inbox.ts", "components/planning/final-invoice-reconciliation.tsx", "components/ai/actions/booking-actions.tsx"])
    assert.match(read(path), /recordsDeleted: invoiceRecordsDeleted\(/, path);
});

test("the studio sees what goes and what stays before anything is deleted", () => {
  const ui = read("components/billing/delete-invoice-records.tsx");
  assert.match(ui, /keeps a note that it was settled — no amounts/);
  assert.match(ui, /It stays in QuickBooks; only StudioCue's copy goes\./);
  assert.match(ui, /Download the PDFs first/);
  assert.match(ui, /Type the job's name to confirm/);
  assert.match(read("components/billing/invoice-ledger.tsx"), /<DeleteJobInvoices projectId=\{projectId\} rows=\{rows\} \/>/);
  const errors = read("lib/ai/friendly-error.ts");
  for (const code of ["INVOICE_IN_FLIGHT", "INVOICE_PARTLY_PAID", "INVOICE_STILL_NEEDED", "INVOICE_DELETE_CONFIRMATION_MISMATCH", "INVOICE_RECORDS_DELETED"])
    assert.match(errors, new RegExp(`${code}:`), code);
});

test("an invoice never goes out silent about paying (Riley Park, 2026-10-10)", async () => {
  const { renderEmailTemplate } = await import("../functions/src/communications/email-templates");
  const email = renderEmailTemplate({
    key: "retainer_invoice",
    brand: { studioName: "Spin Theory DJs", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Riley Park",
    projectName: "Riley Park",
    values: { billedBy: "studio", invoiceNumber: "INV-0001", invoiceKindLabel: "Deposit", amountLabel: "$540.00", dueLabel: "October 23, 2026", invoiceUrl: "https://studio-cue.com/client/payments" },
  });
  assert.match(email.text, /Spin Theory DJs will let you know how to pay\. Reply to this email with any questions\./);
  const actions = read("components/booking/studio-invoice-actions.tsx");
  assert.match(actions, /You haven't added how clients pay you yet, so it won't say how to pay/);
  assert.match(read("features/today/inbox.ts"), /Add how clients pay you first \(Settings → Invoices and payments\)/);
});
