import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  invoiceAtProvider,
  invoiceVoidRefusal,
  paymentCorrectable,
  planPaymentCorrection,
} from "@/features/booking/invoice-corrections";
import { providerReportedInvoice } from "@/features/booking/invoice-standing";
import { outstandingFinalBalance } from "@/features/booking/final-balance-due";
import { eventDateLock } from "@/features/projects/event-date-lock";
import { friendlyError } from "@/lib/ai/friendly-error";
import { todayInbox } from "@/features/today/inbox";
import { describeProviderFailure } from "@/features/today/provider-failure";
import {
  approveFinalInvoiceIn,
  correctPaymentRecordIn,
  voidInvoiceIn,
  type CorrectionContext,
} from "../functions/src/booking/invoice-corrections.ts";
import { raiseFinalInvoice } from "../functions/src/booking/final-invoice.ts";

/**
 * The money audit of 2026-09-30, wave 1: taking back a bill, correcting a
 * payment, sending a final bill held for review, and the booking-safety fixes
 * beside them. Behaviour where the rule is pure or the command takes its
 * transaction; source reads only where the fix is wiring inside a Function.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

// ── A tiny in-memory Firestore, enough for one transaction ─────────────────
type Doc = Record<string, unknown>;
function fakeFirestore(store: Record<string, Doc>) {
  const ref = (path: string) => ({ path, id: path.split("/").pop()! });
  const snap = (path: string) => {
    const data = store[path];
    return {
      id: path.split("/").pop()!,
      exists: Boolean(data),
      ref: ref(path),
      data: () => data,
      get: (field: string) =>
        field.split(".").reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], data),
    };
  };
  type Query = {
    collection: string;
    filters: Array<[string, unknown]>;
    where: (field: string, op: string, value: unknown) => Query;
    limit: () => Query;
  };
  const query = (collection: string, filters: Array<[string, unknown]> = []): Query => ({
    collection,
    filters,
    where: (field, _op, value) => query(collection, [...filters, [field, value]]),
    limit() {
      return this;
    },
  });
  const writes: Array<[string, string, Doc]> = [];
  const db = { doc: ref, collection: (name: string) => query(name) };
  const transaction = {
    get: async (target: { path?: string } | Query) =>
      "collection" in target
        ? {
            docs: Object.keys(store)
              .filter((path) => path.split("/").length === 2 && path.startsWith(`${target.collection}/`))
              .map(snap)
              .filter((document) => target.filters.every(([field, value]) => document.get(field) === value)),
          }
        : snap(String(target.path)),
    create: (target: { path: string }, data: Doc) => {
      if (store[target.path]) throw new Error(`ALREADY_EXISTS ${target.path}`);
      writes.push(["create", target.path, data]);
    },
    set: (target: { path: string }, data: Doc) => writes.push(["set", target.path, data]),
    update: (target: { path: string }, data: Doc) => writes.push(["update", target.path, data]),
  };
  /** Land the recorded writes, as a committed transaction would. */
  const commit = () => {
    for (const [kind, path, data] of writes.splice(0)) {
      store[path] = kind === "update" ? { ...store[path], ...data } : { ...data };
    }
  };
  return { db, transaction, snap, writes, commit };
}

const context = (overrides: Partial<CorrectionContext> = {}): CorrectionContext => ({
  tenantId: "t",
  role: "studio_owner",
  actorId: "u1",
  now: "2026-09-30T12:00:00.000Z",
  idempotencyKey: "key-00000001",
  ipAddress: null,
  userAgent: null,
  ...overrides,
});

const writeTo = (writes: Array<[string, string, Doc]>, path: string) =>
  writes.find(([, target]) => target === path)?.[2];

/** A retainer QuickBooks created and emailed. */
const qbRetainer = {
  tenantId: "t",
  projectId: "p",
  kind: "retainer",
  provider: "quickbooks",
  providerInvoiceId: "145",
  providerState: "completed",
  status: "sent",
  currency: "USD",
  amountCents: 100000,
  balanceCents: 100000,
};

// ── 1. Void and re-raise ───────────────────────────────────────────────────

test("an unpaid bill can be voided; one with money on it, or already closed, cannot", () => {
  assert.equal(invoiceVoidRefusal(qbRetainer), null);
  assert.equal(invoiceVoidRefusal({ ...qbRetainer, status: "review_required", providerState: "review_required" }), null);
  assert.equal(invoiceVoidRefusal({ ...qbRetainer, status: "queued", providerState: "queued" }), null);
  assert.equal(invoiceVoidRefusal({ ...qbRetainer, status: "paid", balanceCents: 0 }), "INVOICE_HAS_PAYMENT");
  assert.equal(invoiceVoidRefusal({ ...qbRetainer, status: "partially_paid", balanceCents: 40000 }), "INVOICE_HAS_PAYMENT");
  // A QuickBooks balance below the amount is money taken, whatever the status.
  assert.equal(invoiceVoidRefusal({ ...qbRetainer, balanceCents: 99999 }), "INVOICE_HAS_PAYMENT");
  for (const status of ["voided", "superseded", "failed", "void", "cancelled"])
    assert.equal(invoiceVoidRefusal({ ...qbRetainer, status }), "INVOICE_NOT_VOIDABLE", status);
});

test("voiding a QuickBooks bill closes it here and queues the void there", async () => {
  const { db, transaction, writes } = fakeFirestore({ "invoiceReferences/r1": { ...qbRetainer } });
  const result = await voidInvoiceIn(db as never, transaction as never, context(), {
    projectId: "p",
    invoiceId: "r1",
    reason: "Wrong amount",
  });
  assert.equal(result.providerVoid, "queued");
  const invoice = writeTo(writes, "invoiceReferences/r1")!;
  assert.equal(invoice.status, "voided");
  assert.equal(invoice.voidReason, "Wrong amount");
  assert.deepEqual(invoice.voidedFrom, { status: "sent", balanceCents: 100000 });
  const job = writeTo(writes, "providerJobs/void_r1")!;
  assert.equal(job.type, "void_quickbooks_invoice");
  assert.equal(job.providerInvoiceId, "145");
  assert.equal(job.status, "queued");
  assert.ok(writes.some(([kind, path, data]) => kind === "create" && path.startsWith("auditEvents/") && data.action === "invoice.voided"));
});

test("a bill the provider never created is voided here only; Stripe gets its own job", async () => {
  const pending = { ...qbRetainer, providerInvoiceId: null, providerState: "queued", status: "queued" };
  const first = fakeFirestore({ "invoiceReferences/r1": pending });
  const result = await voidInvoiceIn(first.db as never, first.transaction as never, context(), {
    projectId: "p",
    invoiceId: "r1",
    reason: "Wrong amount",
  });
  assert.equal(result.providerVoid, "not_needed");
  assert.ok(!first.writes.some(([, path]) => path.startsWith("providerJobs/")));
  const stripe = fakeFirestore({ "invoiceReferences/r1": { ...qbRetainer, provider: "stripe", providerInvoiceId: "in_1" } });
  await voidInvoiceIn(stripe.db as never, stripe.transaction as never, context(), {
    projectId: "p",
    invoiceId: "r1",
    reason: "Wrong amount",
  });
  assert.equal(writeTo(stripe.writes, "providerJobs/void_r1")!.type, "void_stripe_invoice");
});

test("voiding is refused for a paid bill, another job's bill, or a coordinator", async () => {
  const paid = fakeFirestore({ "invoiceReferences/r1": { ...qbRetainer, status: "paid", balanceCents: 0 } });
  await assert.rejects(
    voidInvoiceIn(paid.db as never, paid.transaction as never, context(), { projectId: "p", invoiceId: "r1", reason: "x x x" }),
    /INVOICE_HAS_PAYMENT/,
  );
  const other = fakeFirestore({ "invoiceReferences/r1": { ...qbRetainer } });
  await assert.rejects(
    voidInvoiceIn(other.db as never, other.transaction as never, context(), { projectId: "elsewhere", invoiceId: "r1", reason: "x x x" }),
    /INVOICE_NOT_FOUND/,
  );
  await assert.rejects(
    voidInvoiceIn(other.db as never, other.transaction as never, context({ role: "studio_coordinator" }), {
      projectId: "p",
      invoiceId: "r1",
      reason: "x x x",
    }),
    /INVOICE_VOID_PERMISSION_REQUIRED/,
  );
});

test("a voided bill stays voided when the provider reports anything but paid", () => {
  assert.deepEqual(
    providerReportedInvoice({ current: { status: "voided", balanceCents: 0 }, reported: { status: "sent", balanceCents: 100000 } }),
    { status: "voided", balanceCents: 0, keptReason: "closed_in_studiocue" },
  );
  // Money the couple paid at the provider anyway is still real money.
  assert.equal(
    providerReportedInvoice({ current: { status: "voided" }, reported: { status: "paid", balanceCents: 0 } }).status,
    "paid",
  );
});

test("after a void, a new final bill can be raised; the old one no longer blocks it", async () => {
  const { db, transaction, snap } = fakeFirestore({
    "projects/p": { tenantId: "t", state: "PLANNING", eventDate: "2026-10-20", packageSnapshotId: "s" },
    "packageSnapshots/s": { tenantId: "t", totalCents: 300000, taxCents: 0, retainerCents: 100000, currency: "USD" },
    "proposals/pr": {
      tenantId: "t",
      projectId: "p",
      status: "accepted",
      version: 1,
      pricingSnapshot: { totalCents: 300000, taxCents: 0 },
      paymentSchedule: [{ label: "Retainer", amountCents: 100000 }, { label: "Balance", amountCents: 200000 }],
    },
    "invoiceReferences/r": { tenantId: "t", projectId: "p", kind: "retainer", status: "paid", amountCents: 100000, balanceCents: 0, provider: "quickbooks", providerCustomerId: "c1" },
    "invoiceReferences/final_p": { tenantId: "t", projectId: "p", kind: "final", status: "voided", amountCents: 250000, balanceCents: 0 },
  });
  const outcome = await raiseFinalInvoice(db as never, transaction as never, snap("projects/p") as never, {
    invoiceId: "final_p_m1",
    actor: "u1",
    now: "2026-09-30T00:00:00.000Z",
    provider: "quickbooks",
    resolveCustomer: true,
  });
  assert.deepEqual(outcome, { raised: true, invoiceId: "final_p_m1", amountCents: 200000, reviewRequired: false });
});

test("the provider void jobs are dispatched, and a refusal becomes a task to void it by hand", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /type === "void_quickbooks_invoice"\)\s*return voidQuickBooksInvoice\(document\)/);
  assert.match(jobs, /type === "void_stripe_invoice"\) return voidStripeInvoice\(document\)/);
  assert.match(jobs, /\["void_quickbooks_invoice", "void_stripe_invoice"\]\.includes\([\s\S]{0,120}!retryable[\s\S]{0,80}recordProviderVoidFailed\(/);
  const runtime = read("functions/src/operations/provider-runtime.ts");
  const qb = runtime.slice(runtime.indexOf("export async function voidQuickBooksInvoice"));
  // Reads the SyncToken, refuses a paid invoice, then voids.
  assert.ok(qb.indexOf("QUICKBOOKS_INVOICE_HAS_PAYMENT") < qb.indexOf("operation=void"));
  assert.match(qb, /SyncToken/);
  const stripe = runtime.slice(runtime.indexOf("export async function voidStripeInvoice"));
  assert.ok(stripe.indexOf("STRIPE_INVOICE_HAS_PAYMENT") < stripe.indexOf("/void`"));
  // A stray created after the studio voided is voided there too.
  assert.match(runtime, /current\.get\("status"\)==="voided"\?providerVoidJobType/);
  assert.match(describeProviderFailure("void_quickbooks_invoice").title, /void it yourself/);
});

test("the retainer step picks the bill that stands, so a voided one can be raised again", () => {
  const workspace = read("components/booking/project-booking-workspace.tsx");
  assert.match(workspace, /retainersByAge\.find\(\(item\) => isStandingInvoice\(item\.status\)\)/);
  const create = read("functions/src/booking/commands.ts");
  // A void keeps its own status rather than being re-stamped superseded.
  assert.match(create, /\.filter\(\(document\) => document\.get\("status"\) !== "voided"\)/);
  const cue = read("components/ai/actions/booking-actions.tsx");
  assert.match(cue, /isStandingInvoice\(item\.status\),?\s*\)/);
});

test("'void it first' now names a control that exists", () => {
  const message = friendlyError(new Error("INVOICE_ALREADY_RAISED"), "x");
  assert.doesNotMatch(message, /Void it first/);
  assert.match(message, /Void this invoice/);
  assert.match(read("components/booking/invoice-corrections.tsx"), /Void this invoice/);
});

// ── 2. Correct a mistyped payment ──────────────────────────────────────────

/** A retainer recorded by hand: StudioCue's own record, no provider. */
const attested = {
  tenantId: "t",
  projectId: "p",
  kind: "retainer",
  provider: null,
  providerInvoiceId: null,
  providerState: "not_applicable",
  completionAuthority: "manual_attested",
  completionEvidence: { kind: "manual_attestation", method: "Bank transfer", paidAt: "2026-09-01", amountCents: 100000 },
  status: "paid",
  currency: "USD",
  amountCents: 100000,
  balanceCents: 0,
};

test("only a payment a person recorded is correctable", () => {
  assert.equal(paymentCorrectable(attested), true);
  assert.equal(paymentCorrectable({ ...attested, completionAuthority: "imported" }), true);
  // QuickBooks confirmed it: correct it there.
  assert.equal(paymentCorrectable({ ...qbRetainer, status: "paid", balanceCents: 0 }), false);
  assert.equal(
    planPaymentCorrection({ ...qbRetainer, status: "paid", balanceCents: 0 }, {
      amountCents: 0,
      paidAt: "2026-09-01",
      method: "x",
      reference: null,
      reason: "x",
    }).ok,
    false,
  );
});

test("a corrected payment says what arrived: full, part, or nothing", () => {
  const input = { paidAt: "2026-09-02", method: "Cheque", reference: null, reason: "Wrong day" };
  assert.deepEqual(planPaymentCorrection(attested, { ...input, amountCents: 100000 }), {
    ok: true,
    paidCents: 100000,
    fields: { status: "paid", balanceCents: 0, completionAuthority: "manual_attested", paidAt: "2026-09-02T00:00:00.000Z" },
    reopenedAtProvider: false,
  });
  const part = planPaymentCorrection(attested, { ...input, amountCents: 40000 });
  assert.ok(part.ok);
  // No authority: the gate must not read a part payment as the retainer paid.
  assert.deepEqual(part.fields, { status: "partially_paid", balanceCents: 60000, completionAuthority: null, paidAt: "2026-09-02T00:00:00.000Z" });
  const none = planPaymentCorrection(attested, { ...input, amountCents: 0 });
  assert.ok(none.ok);
  assert.equal(none.fields.status, "voided");
  assert.deepEqual(planPaymentCorrection(attested, { ...input, amountCents: 100001 }), { ok: false, code: "PAYMENT_EXCEEDS_INVOICE" });
  assert.deepEqual(planPaymentCorrection(attested, { ...input, amountCents: -1 }), { ok: false, code: "PAYMENT_AMOUNT_INVALID" });
});

test("on a bill QuickBooks holds, a correction is all or nothing, and nothing reopens it there", () => {
  const settledAtQuickBooks = {
    ...qbRetainer,
    status: "paid",
    balanceCents: 0,
    completionAuthority: "manual_attested",
    completionEvidence: { kind: "manual_attestation", priorStatus: "awaiting_delivery" },
  };
  assert.equal(invoiceAtProvider(settledAtQuickBooks), true);
  const input = { paidAt: "2026-09-02", method: "Cheque", reference: null, reason: "Never arrived" };
  assert.deepEqual(planPaymentCorrection(settledAtQuickBooks, { ...input, amountCents: 50000 }), {
    ok: false,
    code: "PARTIAL_PAYMENT_AT_PROVIDER",
  });
  assert.deepEqual(planPaymentCorrection(settledAtQuickBooks, { ...input, amountCents: 0 }), {
    ok: true,
    paidCents: 0,
    fields: { status: "awaiting_delivery", balanceCents: 100000, completionAuthority: null, paidAt: null },
    reopenedAtProvider: true,
  });
});

test("corrections are appended, each superseding the last; the attestation is never edited", async () => {
  const fake = fakeFirestore({ "invoiceReferences/r1": structuredClone(attested) });
  const input = { projectId: "p", invoiceId: "r1", paidAt: "2026-09-02", method: "Cheque", reference: null, reason: "Part only" };
  const first = await correctPaymentRecordIn(fake.db as never, fake.transaction as never, context(), { ...input, amountCents: 40000 });
  assert.equal(first.status, "partially_paid");
  const update = writeTo(fake.writes, "invoiceReferences/r1")!;
  assert.equal("completionEvidence" in update, false, "the original attestation is left as it was");
  const entries = update.paymentCorrections as Array<Doc>;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.supersedes, "completionEvidence");
  assert.deepEqual(entries[0]!.before, { status: "paid", balanceCents: 0, paidCents: 100000, completionAuthority: "manual_attested" });
  assert.ok(fake.writes.some(([, path, data]) => path.startsWith("auditEvents/") && data.action === "invoice.payment_corrected"));
  fake.commit();
  // Still correctable after the authority was cleared: the correction is on record.
  const second = await correctPaymentRecordIn(fake.db as never, fake.transaction as never, context({ idempotencyKey: "key-00000002" }), {
    ...input,
    amountCents: 100000,
    reason: "It was all there",
  });
  assert.equal(second.status, "paid");
  const again = writeTo(fake.writes, "invoiceReferences/r1")!;
  const both = again.paymentCorrections as Array<Doc>;
  assert.equal(both.length, 2);
  assert.deepEqual(both[0], entries[0], "the earlier entry is carried over untouched");
  assert.equal(both[1]!.supersedes, first.correctionId);
  assert.equal(again.completionAuthority, "manual_attested");
});

test("withdrawing a payment from a QuickBooks bill re-reads its balance there", async () => {
  const fake = fakeFirestore({
    "invoiceReferences/r1": { ...qbRetainer, status: "paid", balanceCents: 0, completionAuthority: "manual_attested" },
  });
  await correctPaymentRecordIn(fake.db as never, fake.transaction as never, context(), {
    projectId: "p",
    invoiceId: "r1",
    amountCents: 0,
    paidAt: "2026-09-02",
    method: "Cheque",
    reference: null,
    reason: "Cheque bounced",
  });
  const job = fake.writes.find(([, path]) => path.startsWith("providerJobs/reconcile_"))?.[2];
  assert.equal(job?.type, "reconcile_quickbooks_invoice");
  assert.equal(job?.providerInvoiceId, "145");
});

test("partial payments are not recorded directly: the record-payment commands still take no amount", () => {
  const commands = read("functions/src/booking/commands.ts");
  for (const type of ["recordRetainerPayment", "recordFinalPayment"]) {
    const schema = commands.slice(commands.indexOf(`type: z.literal("${type}")`));
    assert.doesNotMatch(schema.slice(0, schema.indexOf("}),")), /amountCents/, type);
  }
});

// ── 3. The retainer form shows what the server records ─────────────────────

test("'Paid another way' shows the agreed retainer, not the package's", () => {
  const workspace = read("components/booking/project-booking-workspace.tsx");
  assert.match(workspace, /retainerFromSchedule\(\s*proposal\?\.paymentSchedule/);
  assert.doesNotMatch(workspace, /currency\(\s*packageSnapshot\.retainerCents/);
  assert.doesNotMatch(workspace, /invoice\?\.amountCents \?\? packageSnapshot\.retainerCents/);
  const cue = read("components/ai/actions/booking-actions.tsx");
  assert.doesNotMatch(cue, /retainerLabel=\{dollars\(invoice\?\.amountCents \?\? snapshot\.retainerCents\)\}/);
  assert.match(cue, /retainerLabel=\{dollars\(invoice \? invoice\.amountCents : agreedRetainer\)\}/);
});

// ── 4. An approved waiver is found, reused, and stops the old bill ─────────

test("the booking gate finds the job's approved waiver itself", () => {
  const commands = read("functions/src/booking/commands.ts");
  const gate = commands.slice(commands.indexOf('command.type === "runBookingGate"'));
  const lookup = gate.slice(0, gate.indexOf("const blockingStates"));
  assert.match(lookup, /\.collection\("bookingExceptions"\)[\s\S]*\.where\("projectId", "==", command\.input\.projectId\)[\s\S]*status"\) === "approved"/);
});

test("waiving reuses an approved waiver and voids a retainer bill still out", () => {
  const commands = read("functions/src/booking/commands.ts");
  const approve = commands.slice(commands.indexOf('command.type === "approveRetainerException"'));
  const body = approve.slice(0, approve.indexOf("} else if ("));
  assert.match(body, /existing\?\.id \?\?/);
  assert.match(body, /if \(!existing\)\s*transaction\.create\(firestore\.doc\(`bookingExceptions/);
  assert.match(body, /invoiceVoidRefusal\(invoice\.data\(\) \?\? \{\}\) === null/);
  assert.match(body, /writeInvoiceVoid\(firestore, transaction,[\s\S]*source: "retainer_waived"/);
});

// ── 5. A final bill held for review can be checked and sent ────────────────

function heldFinalStore(extra: Record<string, Doc> = {}) {
  return {
    "projects/p": { tenantId: "t", state: "PLANNING", eventDate: "2026-10-20", packageSnapshotId: "s" },
    "packageSnapshots/s": { tenantId: "t", totalCents: 300000, taxCents: 0, retainerCents: 100000, currency: "USD" },
    "proposals/pr": {
      tenantId: "t",
      projectId: "p",
      status: "accepted",
      version: 1,
      pricingSnapshot: { totalCents: 300000, taxCents: 0 },
    },
    // The couple paid 40,000 of a 100,000 retainer: the mismatch that held it.
    "invoiceReferences/r": { tenantId: "t", projectId: "p", kind: "retainer", status: "partially_paid", amountCents: 100000, balanceCents: 60000 },
    "invoiceReferences/final_p": {
      tenantId: "t",
      projectId: "p",
      kind: "final",
      provider: "quickbooks",
      status: "review_required",
      providerState: "review_required",
      providerInvoiceId: null,
      amountCents: 260000,
      balanceCents: 260000,
      calculation: { discrepancies: ["RETAINER_EVIDENCE_MISMATCH"] },
    },
    ...extra,
  };
}

test("a held final bill is sent at the balance as it stands, once the studio confirms that figure", async () => {
  const stale = fakeFirestore(heldFinalStore());
  await assert.rejects(
    approveFinalInvoiceIn(stale.db as never, stale.transaction as never, context(), {
      projectId: "p",
      invoiceId: "final_p",
      confirmAmountCents: 200000,
    }),
    /FINAL_AMOUNT_CHANGED/,
  );
  const fake = fakeFirestore(heldFinalStore());
  const result = await approveFinalInvoiceIn(fake.db as never, fake.transaction as never, context(), {
    projectId: "p",
    invoiceId: "final_p",
    confirmAmountCents: 260000,
  });
  assert.deepEqual(result, { invoiceId: "final_p", amountCents: 260000, provider: "quickbooks" });
  const invoice = writeTo(fake.writes, "invoiceReferences/final_p")!;
  assert.equal(invoice.status, "draft");
  assert.equal(invoice.providerState, "queued");
  assert.equal(invoice.providerInvoiceId, "pending_final_p");
  const calculation = invoice.calculation as Doc;
  assert.deepEqual(calculation.reviewedDiscrepancies, ["RETAINER_EVIDENCE_MISMATCH"]);
  assert.equal(calculation.approvedBy, "u1");
  assert.equal(writeTo(fake.writes, "providerJobs/invoice_final_p")!.type, "create_quickbooks_invoice");
});

test("only a held final bill is approved this way", async () => {
  const sent = fakeFirestore(
    heldFinalStore({ "invoiceReferences/final_p": { tenantId: "t", projectId: "p", kind: "final", status: "sent", amountCents: 1, balanceCents: 1 } }),
  );
  await assert.rejects(
    approveFinalInvoiceIn(sent.db as never, sent.transaction as never, context(), { projectId: "p", invoiceId: "final_p", confirmAmountCents: 1 }),
    /FINAL_INVOICE_NOT_IN_REVIEW/,
  );
});

test("the screens see a held bill, and Today asks the studio to check it", () => {
  const store = heldFinalStore();
  const invoices = Object.entries(store)
    .filter(([path]) => path.startsWith("invoiceReferences/"))
    .map(([path, data]) => ({ id: path.split("/")[1]!, ...data }));
  const proposals = [{ id: "pr", ...store["proposals/pr"] }];
  const due = outstandingFinalBalance({ projectId: "p", proposals, invoices });
  assert.equal(due.heldForReviewId, "final_p");
  assert.equal(due.cents, 260000);
  const inbox = todayInbox({
    now: "2026-09-30T12:00:00Z",
    projects: [{ id: "p", name: "Chen wedding", state: "PLANNING", eventDate: "2026-10-20", packageSnapshotId: "s", archivedAt: null }],
    proposals,
    invoiceReferences: invoices,
  });
  const card = inbox.act.find((item) => item.id === "final-balance-review-p");
  assert.ok(card, "a card for the held bill");
  assert.match(card!.title, /Check and send Chen's final bill · \$2,600/);
  assert.deepEqual(card!.action, { kind: "link", label: "Check it", href: "/studio/invoices?project=p" });
  const copy = read("components/planning/final-invoice-reconciliation.tsx");
  assert.doesNotMatch(copy, /Human review is still required before the provider draft\s+is sent/);
});

// ── 6. A signed booking's date moves by a booking change ───────────────────

test("the date is editable until the couple signs, and then only by a booking change", () => {
  const lock = (state: string, contractStatuses: string[] = [], extra: Doc = {}) =>
    eventDateLock({ state, contractStatuses, ...extra });
  for (const state of ["LEAD", "CONSULTATION", "PROPOSAL", "CANCELLED", "LOST"]) assert.equal(lock(state), null, state);
  assert.equal(lock("CONTRACT_PENDING"), null, "no agreement out yet");
  assert.equal(lock("CONTRACT_PENDING", ["voided"]), null);
  assert.equal(lock("CONTRACT_PENDING", ["sent"]), "agreement_out");
  for (const state of ["RETAINER_PENDING", "BOOKED", "PLANNING", "READY", "EVENT_COMPLETE", "DELIVERED", "CLOSED"])
    assert.equal(lock(state), "signed", state);
  assert.equal(lock("POSTPONED", [], { postponedFromState: "PROPOSAL" }), null);
  assert.equal(lock("POSTPONED", [], { postponedFromState: "BOOKED" }), "signed");
  assert.equal(lock("POSTPONED", [], { bookingCompletedAt: "2026-05-01T00:00:00Z" }), "signed");
  assert.equal(lock("POSTPONED", ["completed"], { postponedFromState: "CONTRACT_PENDING" }), "signed");
});

test("updateProject refuses a signed booking's new date, and the edit sheet says where to go", () => {
  const crm = read("functions/src/crm/commands.ts");
  const update = crm.slice(crm.indexOf('if (command.type === "updateProject") {'));
  const guard = update.slice(0, update.indexOf("transaction.update(projectReference"));
  assert.match(guard, /eventDateLock\(/);
  assert.match(guard, /EVENT_DATE_LOCKED_AFTER_SIGNING/);
  assert.match(guard, /EVENT_DATE_LOCKED_AGREEMENT_OUT/);
  const sheet = read("components/projects/project-edit.tsx");
  assert.match(sheet, /The client has signed — change the date with/);
  assert.match(sheet, /disabled=\{dateLock !== null\}/);
  assert.match(friendlyError(new Error("EVENT_DATE_LOCKED_AFTER_SIGNING"), "x"), /Change the booking/);
});

// ── 7. A failed retainer is retried at today's figures ─────────────────────

test("a retry of a retainer the provider never created recomputes its amount and due date", () => {
  const commands = read("functions/src/booking/commands.ts");
  const retry = commands.slice(commands.indexOf("const failedInvoice = existingInvoices.docs.find("));
  const body = retry.slice(0, retry.indexOf("await retryBatch.commit()"));
  assert.match(body, /const neverRaised = !failedInvoice\.get\("providerInvoiceId"\)/);
  assert.match(body, /agreedRetainerCents\(/);
  assert.match(body, /amountCents: agreedNow,\s*balanceCents: agreedNow,\s*dueDate: command\.input\.dueDate/);
});

// ── 8. Package changes ignore bills nobody holds ───────────────────────────

test("a failed or superseded bill does not block a package change", () => {
  for (const path of ["functions/src/crm/commands.ts", "functions/src/booking/proposals.ts"]) {
    const source = read(path);
    const guard = source.slice(0, source.indexOf('throw new Error("INVOICE_ALREADY_RAISED")'));
    assert.match(guard.slice(-400), /isStandingInvoice\(status\) && !\["void", "cancelled"\]\.includes\(status\)/, path);
  }
});

// ── The copies stay the same rule ──────────────────────────────────────────

test("features/ and functions/ agree on the correction and date-lock rules", () => {
  const below = (source: string, marker: string) => source.slice(source.indexOf(marker));
  assert.equal(
    below(read("functions/src/booking/invoice-corrections-core.ts"), "export type CorrectableInvoice"),
    below(read("features/booking/invoice-corrections.ts"), "export type CorrectableInvoice"),
  );
  assert.equal(
    below(read("functions/src/crm/event-date-lock.ts"), "export type EventDateLock"),
    below(read("features/projects/event-date-lock.ts"), "export type EventDateLock"),
  );
});
