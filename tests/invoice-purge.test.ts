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
  // Found by query, deleted only from the allow list; discovery only reports.
  assert.match(source, /for \(const collection of INVOICE_PURGE_OWNED\)/);
  assert.match(source, /\.where\("invoiceId", "==", invoiceId\)/);
  const discovery = source.slice(source.indexOf("for (const collection of await invoiceSweepCollections(db))"), source.indexOf("// The booking plan stays"));
  assert.match(discovery, /logger\.warn\("invoicePurgeKeptReference"/);
  assert.doesNotMatch(discovery, /delete/);
  // Every candidate tenant-checked.
  assert.match(source, /snapshot\.docs\.filter\(\(item\) => item\.get\("tenantId"\) === tenantId\)/);
  // The settled note first, the invoice last.
  const sweep = source.slice(source.indexOf("export async function sweepInvoiceRecords"));
  assert.ok(sweep.indexOf("auditEvents") < sweep.indexOf("// 4. Last: the invoice itself."));
  const command = source.slice(source.indexOf("export async function deleteInvoiceRecords"));
  assert.ok(command.indexOf("await projectReference.update(projectUpdate)") < command.indexOf("await sweepInvoiceRecords("));
  // The tombstone carries no amounts.
  const tombstone = command.slice(command.indexOf('action: "invoice.deleted"'), command.indexOf("ipAddress: context.ipAddress"));
  assert.doesNotMatch(tombstone, /Cents/);
  // The booking plan named the deleted deposit: it is unlinked, never deleted,
  // so a replacement deposit's payment still books the job (GR, 2026-10-22).
  assert.match(
    read("functions/src/billing/invoice-purge.ts"),
    /collection\("bookingOrchestrations"\)\.where\("invoiceId", "==", invoiceId\)[\s\S]*?update\(\{ invoiceId: null,/,
  );
  assert.match(read("functions/src/booking/commands.ts"), /type: z\.literal\("deleteInvoiceRecords"\)/);
});

test("only the invoice's own records are deleted: an allow list, not a deny list", () => {
  // The deny list deleted a job's booking plan (GR, Michelle & Kyle,
  // 2026-10-22) and still swept autopay charges and booking exceptions.
  assert.deepEqual([...features.INVOICE_PURGE_OWNED].sort(), ["documents", "emailJobs", "pdfJobs", "providerJobs"]);
  const invoiceId = "inv_1";
  for (const collection of [
    "autopayCharges",
    "bookingExceptions",
    "bookingOrchestrations",
    "auditEvents",
    "commandExecutions",
    "webhookEvents",
    "invoiceCounters",
    "invoiceReferences",
    "projects",
    "productEvents",
    "tasks",
    "aiActions",
    "someCollectionAddedNextYear",
  ])
    assert.equal(features.invoiceOwnsRecord(collection, `${collection}_x`, invoiceId), false, collection);
  for (const collection of ["emailJobs", "pdfJobs", "providerJobs"])
    assert.equal(features.invoiceOwnsRecord(collection, "anything", invoiceId), true, collection);
  // A document goes only when it is this invoice's PDF; any other file stays.
  assert.equal(features.invoiceOwnsRecord("documents", `studio_invoice_${invoiceId}`, invoiceId), true);
  assert.equal(features.invoiceOwnsRecord("documents", "studio_invoice_inv_2", invoiceId), false);
  assert.equal(features.invoiceOwnsRecord("documents", "contract_signed_1", invoiceId), false);
  assert.match(read("functions/src/billing/studio-invoice-pdf.ts"), /return `studio_invoice_\$\{invoiceId\}`;/);
  // Known keepers are not reported as new; autopay charges are proof of payment.
  for (const kept of ["autopayCharges", "bookingOrchestrations", "auditEvents", "invoiceReferences", "commandExecutions", "webhookEvents"])
    assert.ok(features.INVOICE_PURGE_KEPT.includes(kept), kept);
  assert.ok(!features.INVOICE_PURGE_KEPT.includes("bookingExceptions"), "a booking exception naming an invoice is new, so it is reported");
  for (const owned of features.INVOICE_PURGE_OWNED) assert.ok(!features.INVOICE_PURGE_KEPT.includes(owned), owned);
});

type Doc = Record<string, unknown>;
type SweepDb = Parameters<typeof import("../functions/src/billing/invoice-purge").sweepInvoiceRecords>[0];

/** Just enough Firestore for the sweep: equality filters, id order, cursors, batches. */
function fakeFirestore(store: Map<string, Doc>): SweepDb {
  const snap = (path: string) => {
    const data = store.get(path);
    return { id: path.split("/").pop()!, ref: ref(path), exists: Boolean(data), data: () => data, get: (field: string) => data?.[field] };
  };
  const ref = (path: string) => ({
    path,
    id: path.split("/").pop()!,
    get: async () => snap(path),
    delete: async () => void store.delete(path),
    update: async (fields: Doc) => void store.set(path, { ...store.get(path), ...fields }),
  });
  type Query = {
    where: (field: string, op: string, value: unknown) => Query;
    orderBy: () => Query;
    limit: (n: number) => Query;
    startAfter: (cursor: { id: string }) => Query;
    get: () => Promise<{ docs: ReturnType<typeof snap>[]; size: number }>;
  };
  const query = (collection: string, filters: Array<[string, unknown]> = [], max = Infinity, after = ""): Query => ({
    where: (field, _op, value) => query(collection, [...filters, [field, value]], max, after),
    orderBy: () => query(collection, filters, max, after),
    limit: (n) => query(collection, filters, n, after),
    startAfter: (cursor) => query(collection, filters, max, cursor.id),
    get: async () => {
      const docs = [...store.keys()]
        .filter((path) => path.split("/").length === 2 && path.startsWith(`${collection}/`))
        .sort()
        .map(snap)
        .filter((item) => item.id > after && filters.every(([field, value]) => item.get(field) === value))
        .slice(0, max);
      return { docs, size: docs.length };
    },
  });
  return {
    collection: (name: string) => query(name),
    doc: (path: string) => ref(path),
    listCollections: async () => [...new Set([...store.keys()].map((path) => path.split("/")[0]!))].map((id) => ({ id })),
    batch: () => {
      const deletes: string[] = [];
      return {
        delete: (target: { path: string }) => void deletes.push(target.path),
        commit: async () => deletes.forEach((path) => store.delete(path)),
      };
    },
  } as unknown as SweepDb;
}

test("the sweep deletes the invoice's own records, keeps the rest, and names what it kept", async () => {
  const { sweepInvoiceRecords } = await import("../functions/src/billing/invoice-purge");
  const OURS = "tenant-ours";
  const INV = "inv_1";
  const mine = { tenantId: OURS, projectId: "job-1", invoiceId: INV };
  const store = new Map<string, Doc>([
    [`invoiceReferences/${INV}`, { tenantId: OURS, projectId: "job-1" }],
    // Its own records: these go.
    [`emailJobs/studio_invoice_${INV}_a`, mine],
    [`pdfJobs/invoice_${INV}_r1`, mine],
    [`providerJobs/invoice_${INV}`, { ...mine, status: "succeeded" }],
    [`documents/studio_invoice_${INV}`, mine],
    [`aiActions/ai_payment_reminder_${INV}_1`, { tenantId: OURS }],
    [`tasks/amendment_void_${INV}`, { tenantId: OURS }],
    // Records that name it and outlive it: these stay.
    [`autopayCharges/autopay_${INV}_1`, { ...mine, status: "succeeded", amountCents: 100 }],
    ["bookingExceptions/retainer_job-1", mine],
    ["bookingOrchestrations/job-1", mine],
    ["documents/contract_signed_1", mine],
    ["someCollectionAddedNextYear/x", mine],
    ["auditEvents/a1", { tenantId: OURS, entityId: INV, after: { status: "paid", amountCents: 100 } }],
    // Another studio's record naming the same id is never treated as ours.
    ["emailJobs/theirs", { ...mine, tenantId: "tenant-theirs" }],
  ]);
  const db = fakeFirestore(store);
  const run = () => sweepInvoiceRecords(db, { tenantId: OURS, projectId: "job-1", invoiceId: INV, actorId: "owner", now: "t", storage: false });
  const result = await run();
  for (const path of [
    `invoiceReferences/${INV}`,
    `emailJobs/studio_invoice_${INV}_a`,
    `pdfJobs/invoice_${INV}_r1`,
    `providerJobs/invoice_${INV}`,
    `documents/studio_invoice_${INV}`,
    `aiActions/ai_payment_reminder_${INV}_1`,
    `tasks/amendment_void_${INV}`,
  ])
    assert.equal(store.has(path), false, path);
  for (const path of [
    `autopayCharges/autopay_${INV}_1`,
    "bookingExceptions/retainer_job-1",
    "bookingOrchestrations/job-1",
    "documents/contract_signed_1",
    "someCollectionAddedNextYear/x",
    "auditEvents/a1",
    "emailJobs/theirs",
  ])
    assert.ok(store.has(path), path);
  assert.deepEqual(store.get(`autopayCharges/autopay_${INV}_1`), { ...mine, status: "succeeded", amountCents: 100 }, "proof of payment untouched");
  assert.equal(store.get("bookingOrchestrations/job-1")!.invoiceId, null, "the booking plan is unlinked");
  assert.deepEqual(store.get("auditEvents/a1")!.after, { status: "paid" });
  assert.equal(result.deleted, 7);
  // Reported, not deleted. Known keepers (autopay, the plan, the audit) are not news.
  assert.deepEqual(result.kept, [
    { collection: "documents", count: 1 },
    { collection: "bookingExceptions", count: 1 },
    { collection: "someCollectionAddedNextYear", count: 1 },
  ]);
  // A second run deletes nothing, and still says what it left.
  const again = await run();
  assert.equal(again.deleted, 0);
  assert.deepEqual(again.kept, result.kept);
});

test("in flight means any job or charge on the invoice, not the first twenty", async () => {
  const { invoiceInFlight } = await import("../functions/src/billing/invoice-purge");
  const OURS = "tenant-ours";
  const INV = "inv_1";
  const store = new Map<string, Doc>([[`invoiceReferences/${INV}`, { tenantId: OURS }]]);
  for (let index = 0; index < 250; index += 1)
    store.set(`providerJobs/j_${String(index).padStart(3, "0")}`, { tenantId: OURS, invoiceId: INV, status: "succeeded" });
  const db = fakeFirestore(store);
  const invoice = () => db.doc(`invoiceReferences/${INV}`).get();
  assert.equal(await invoiceInFlight(db, OURS, await invoice()), false);
  // The last job, past the first page, is the one still running.
  store.set("providerJobs/j_249", { tenantId: OURS, invoiceId: INV, status: "running" });
  assert.equal(await invoiceInFlight(db, OURS, await invoice()), true);
  store.set("providerJobs/j_249", { tenantId: "tenant-theirs", invoiceId: INV, status: "running" });
  assert.equal(await invoiceInFlight(db, OURS, await invoice()), false, "another studio's job is not ours");
  // A card charged whose payment isn't in the books yet.
  store.set(`autopayCharges/autopay_${INV}_1`, { tenantId: OURS, invoiceId: INV, status: "charged" });
  assert.equal(await invoiceInFlight(db, OURS, await invoice()), true);
  store.set(`autopayCharges/autopay_${INV}_1`, { tenantId: OURS, invoiceId: INV, status: "succeeded" });
  assert.equal(await invoiceInFlight(db, OURS, await invoice()), false);
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
  // Warning wasn't enough (GR, 2026-10-21): emailing is refused, and the
  // button becomes the way to add them (tests/billing-guards.test.ts).
  assert.match(actions, /Add how clients pay you before you email it, so it says how to pay\./);
  assert.match(read("features/today/inbox.ts"), /Add how clients pay you first \(Settings → Invoices and payments\)/);
});
