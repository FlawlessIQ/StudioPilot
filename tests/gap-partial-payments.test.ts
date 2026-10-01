import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  dollarsToCents,
  invoicePaymentRefusal,
  planInvoicePayment,
} from "@/features/booking/invoice-payments";
import { providerReportedInvoice, unconfirmedStudioPaymentCents } from "@/features/booking/invoice-standing";
import { backwardMovesFor } from "@/features/projects/going-back";
import { describeProviderFailure } from "@/features/today/provider-failure";
import { friendlyError } from "@/lib/ai/friendly-error";
import { autopayInvoiceUnchargeable } from "../functions/src/billing/autopay-core.ts";
import type { CorrectionContext } from "../functions/src/booking/invoice-corrections.ts";
import {
  landStudioPaymentAtProvider,
  recordInvoicePaymentIn,
  recordProviderPaymentFailed,
} from "../functions/src/booking/invoice-payments.ts";

/**
 * Two gaps closed on 2026-09-30.
 *
 * 1. A payment recorded by hand always settled the whole balance, and a part
 *    payment was possible only on a bill StudioCue kept alone — QuickBooks and
 *    Stripe never heard of it, so their balance (the one autopay charges and
 *    every sync reads back) kept asking for money already paid. Now any amount
 *    up to the balance is recorded here and pushed to the provider.
 * 2. Undoing a cancel brought the job back and left the studio's calendar
 *    empty: the cancel had deleted the wedding's event and nothing put it back.
 *
 * Behaviour where the rule is pure or the command takes its transaction;
 * source reads only where the fix is wiring inside a Function.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

// ── A tiny in-memory Firestore, as tests/wave1-money.test.ts keeps ─────────
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
  const db = {
    doc: ref,
    collection: (name: string) => query(name),
    runTransaction: async <T>(run: (tx: typeof transaction) => Promise<T>) => {
      const result = await run(transaction);
      commit();
      return result;
    },
  };
  return { db, transaction, snap, writes, commit, store };
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

const project = { tenantId: "t", state: "BOOKED" };

const input = {
  projectId: "p",
  invoiceId: "r1",
  amountCents: 40000,
  paidAt: "2026-09-29",
  method: "Bank transfer",
  reference: "TX-88",
  attestation: true as const,
};

// ── 1. The rule ────────────────────────────────────────────────────────────

test("a part payment on a QuickBooks bill: part paid here, and a job to record it there", () => {
  const plan = planInvoicePayment(qbRetainer, { amountCents: 40000, paidAt: "2026-09-29" });
  assert.deepEqual(plan, {
    ok: true,
    settles: false,
    // No authority and no paidAt: the booking gate reads a studio-vouched
    // authority as "the retainer is paid", and a part payment is not that.
    fields: { status: "partially_paid", balanceCents: 60000 },
    providerJobType: "record_quickbooks_payment",
  });
});

test("a payment that clears the balance settles it, vouched for by a person", () => {
  const partPaid = { ...qbRetainer, status: "partially_paid", balanceCents: 60000 };
  const plan = planInvoicePayment(partPaid, { amountCents: 60000, paidAt: "2026-10-02" });
  assert.ok(plan.ok);
  assert.equal(plan.settles, true);
  assert.deepEqual(plan.fields, {
    status: "paid",
    balanceCents: 0,
    completionAuthority: "manual_attested",
    paidAt: "2026-10-02T00:00:00.000Z",
  });
  assert.equal(plan.providerJobType, "record_quickbooks_payment");
});

test("Stripe gets its own job; a bill StudioCue keeps alone needs none", () => {
  const stripe = planInvoicePayment({ ...qbRetainer, provider: "stripe", providerInvoiceId: "in_1" }, { amountCents: 100, paidAt: "2026-09-29" });
  assert.ok(stripe.ok && stripe.providerJobType === "record_stripe_payment");
  const own = planInvoicePayment(
    { ...qbRetainer, provider: null, providerInvoiceId: null, providerState: "not_applicable" },
    { amountCents: 100, paidAt: "2026-09-29" },
  );
  assert.ok(own.ok && own.providerJobType === null);
});

test("more than the balance, nothing, or fractions of a cent are refused", () => {
  const partPaid = { ...qbRetainer, status: "partially_paid", balanceCents: 60000 };
  assert.deepEqual(planInvoicePayment(partPaid, { amountCents: 60001, paidAt: "2026-09-29" }), { ok: false, code: "PAYMENT_EXCEEDS_BALANCE" });
  assert.deepEqual(planInvoicePayment(partPaid, { amountCents: 0, paidAt: "2026-09-29" }), { ok: false, code: "PAYMENT_AMOUNT_INVALID" });
  assert.deepEqual(planInvoicePayment(partPaid, { amountCents: 10.5, paidAt: "2026-09-29" }), { ok: false, code: "PAYMENT_AMOUNT_INVALID" });
  assert.equal(dollarsToCents("$1,250.50"), 125050);
  assert.equal(dollarsToCents("12.345"), null);
});

test("only a retainer or final bill out with the couple, with money left on it, takes a payment", () => {
  assert.equal(invoicePaymentRefusal(qbRetainer), null);
  assert.equal(invoicePaymentRefusal({ ...qbRetainer, status: "overdue" }), null);
  assert.equal(invoicePaymentRefusal({ ...qbRetainer, kind: "final", status: "partially_paid", balanceCents: 5 }), null);
  for (const status of ["paid", "voided", "void", "superseded", "cancelled", "failed"])
    assert.equal(invoicePaymentRefusal({ ...qbRetainer, status }), "INVOICE_NOT_PAYABLE", status);
  // Still being created at QuickBooks: its create job writes QuickBooks'
  // balance when it lands, which would put the payment back on the bill.
  assert.equal(
    invoicePaymentRefusal({ ...qbRetainer, status: "queued", providerState: "queued", providerInvoiceId: "pending_r1" }),
    "INVOICE_NOT_BILLED_YET",
  );
  assert.equal(invoicePaymentRefusal({ ...qbRetainer, kind: "final", status: "review_required" }), "INVOICE_NOT_BILLED_YET");
  assert.equal(invoicePaymentRefusal({ ...qbRetainer, kind: "deposit_refund" }), "INVOICE_NOT_PAYABLE");
  assert.equal(invoicePaymentRefusal({ ...qbRetainer, balanceCents: 0 }), "INVOICE_NOTHING_OWED");
  // Every refusal reads as a sentence.
  for (const code of ["INVOICE_NOT_PAYABLE", "INVOICE_NOT_BILLED_YET", "INVOICE_NOTHING_OWED", "PAYMENT_EXCEEDS_BALANCE", "PAYMENT_RECORD_PERMISSION_REQUIRED"])
    assert.doesNotMatch(friendlyError(new Error(code), "fallback"), /_|fallback/, code);
});

// ── 2. A re-read balance cannot undo a payment the provider hasn't taken ───

test("while a recorded payment is on its way to the provider, its higher balance is out of date", () => {
  const pending = [{ id: "a", amountCents: 40000, provider: { state: "queued" } }];
  const current = { status: "partially_paid", balanceCents: 60000, studioPayments: pending };
  assert.equal(unconfirmedStudioPaymentCents(pending), 40000);
  assert.deepEqual(
    providerReportedInvoice({ current, reported: { status: "sent", balanceCents: 100000 } }),
    { status: "partially_paid", balanceCents: 60000, keptReason: "studio_payment_not_at_provider" },
  );
  // Failed too: the studio was asked to record it there; until they do, the
  // couple does not owe it again.
  const failed = [{ id: "a", amountCents: 40000, provider: { state: "failed" } }];
  assert.equal(
    providerReportedInvoice({ current: { ...current, studioPayments: failed }, reported: { status: "sent", balanceCents: 100000 } }).balanceCents,
    60000,
  );
  // Once the provider agrees (or knows better: lower), it wins again.
  assert.deepEqual(
    providerReportedInvoice({ current, reported: { status: "partially_paid", balanceCents: 50000 } }),
    { status: "partially_paid", balanceCents: 50000, keptReason: null },
  );
  const landed = [{ id: "a", amountCents: 40000, provider: { state: "completed" } }];
  assert.equal(
    providerReportedInvoice({ current: { ...current, studioPayments: landed }, reported: { status: "sent", balanceCents: 100000 } }).keptReason,
    null,
  );
  // Paid or voided at the provider always wins.
  assert.equal(providerReportedInvoice({ current, reported: { status: "paid", balanceCents: 0 } }).status, "paid");
});

// ── 3. The command ─────────────────────────────────────────────────────────

test("recording a part payment: balance down at once, payment appended, QuickBooks job queued", async () => {
  const fake = fakeFirestore({ "invoiceReferences/r1": { ...qbRetainer }, "projects/p": { ...project } });
  const result = await recordInvoicePaymentIn(fake.db as never, fake.transaction as never, context(), input);
  assert.equal(result.status, "partially_paid");
  assert.equal(result.balanceCents, 60000);
  assert.equal(result.providerSync, "queued");
  const update = writeTo(fake.writes, "invoiceReferences/r1")!;
  assert.equal(update.status, "partially_paid");
  assert.equal(update.balanceCents, 60000);
  assert.equal(update.completionAuthority, undefined, "a part payment is not a vouched-for paid retainer");
  assert.equal(update.completionEvidence, undefined);
  const [entry] = update.studioPayments as Array<Record<string, unknown>>;
  assert.equal(entry!.amountCents, 40000);
  assert.equal(entry!.method, "Bank transfer");
  assert.equal(entry!.attestedBy, "u1");
  assert.equal((entry!.provider as Record<string, unknown>).state, "queued");
  const job = fake.writes.find(([, path]) => path.startsWith("providerJobs/payment_"))?.[2];
  assert.equal(job?.type, "record_quickbooks_payment");
  assert.equal(job?.paymentId, entry!.id);
  assert.equal(job?.providerInvoiceId, "145");
  assert.ok(String(job?.idempotencyKey).length <= 50, "QuickBooks requestid is at most 50 characters");
  const audit = fake.writes.find(([, path]) => path.startsWith("auditEvents/"))?.[2];
  assert.equal(audit?.action, "invoice.part_payment_attested");

  // A retried click answers with the first result and writes nothing.
  fake.commit();
  const again = await recordInvoicePaymentIn(fake.db as never, fake.transaction as never, context(), input);
  assert.equal(again.paymentId, result.paymentId);
  assert.equal(fake.writes.length, 0);

  // A second payment is appended beside the first, never over it.
  const second = await recordInvoicePaymentIn(fake.db as never, fake.transaction as never, context({ idempotencyKey: "key-00000002" }), {
    ...input,
    amountCents: 60000,
  });
  assert.equal(second.status, "paid");
  const settled = writeTo(fake.writes, "invoiceReferences/r1")!;
  assert.equal((settled.studioPayments as unknown[]).length, 2);
  assert.equal(settled.completionAuthority, "manual_attested");
  assert.equal((settled.completionEvidence as Record<string, unknown>).partPayments, 1);
});

test("the payment that clears a retainer booked without it settles the exception", async () => {
  const fake = fakeFirestore({
    "invoiceReferences/r1": { ...qbRetainer },
    "projects/p": { ...project },
    "bookingExceptions/x": { tenantId: "t", projectId: "p", type: "retainer", status: "approved" },
  });
  await recordInvoicePaymentIn(fake.db as never, fake.transaction as never, context(), { ...input, amountCents: 100000 });
  assert.equal(writeTo(fake.writes, "bookingExceptions/x")?.retainerInvoiceId, "r1");
  assert.equal(fake.writes.find(([, path]) => path.startsWith("auditEvents/"))?.[2].action, "invoice.payment_attested");
});

test("the command refuses what the rule refuses, and anyone but an owner or admin", async () => {
  const staff = fakeFirestore({ "invoiceReferences/r1": { ...qbRetainer }, "projects/p": { ...project } });
  await assert.rejects(
    recordInvoicePaymentIn(staff.db as never, staff.transaction as never, context({ role: "studio_staff" }), input),
    /PAYMENT_RECORD_PERMISSION_REQUIRED/,
  );
  const over = fakeFirestore({ "invoiceReferences/r1": { ...qbRetainer }, "projects/p": { ...project } });
  await assert.rejects(
    recordInvoicePaymentIn(over.db as never, over.transaction as never, context(), { ...input, amountCents: 100001 }),
    /PAYMENT_EXCEEDS_BALANCE/,
  );
  const other = fakeFirestore({ "invoiceReferences/r1": { ...qbRetainer, tenantId: "x" }, "projects/p": { ...project } });
  await assert.rejects(recordInvoicePaymentIn(other.db as never, other.transaction as never, context(), input), /INVOICE_NOT_FOUND/);
  assert.equal(over.writes.length + staff.writes.length + other.writes.length, 0);
});

// ── 4. The provider's answer ───────────────────────────────────────────────

const jobSnap = (fields: Record<string, unknown>) => ({
  id: "payment_x",
  get: (field: string) => fields[field],
});

test("landed at the provider: marked so, and its balance taken — unless another payment is still on its way", async () => {
  const fake = fakeFirestore({
    "invoiceReferences/r1": {
      ...qbRetainer,
      status: "partially_paid",
      balanceCents: 30000,
      studioPayments: [
        { id: "a", amountCents: 40000, provider: { state: "queued" } },
        { id: "b", amountCents: 30000, provider: { state: "queued" } },
      ],
    },
  });
  // QuickBooks has taken "a" but not yet "b": it says 60000 is left.
  await landStudioPaymentAtProvider(fake.db as never, jobSnap({ invoiceId: "r1", paymentId: "a" }) as never, {
    providerPaymentId: "qb-9",
    result: "recorded",
    reported: { status: "partially_paid", balanceCents: 60000 },
  });
  const invoice = fake.store["invoiceReferences/r1"]!;
  assert.equal(invoice.balanceCents, 30000, "b is still owed only once");
  const payments = invoice.studioPayments as Array<{ id: string; provider: Record<string, unknown> }>;
  assert.equal(payments[0]!.provider.state, "completed");
  assert.equal(payments[0]!.provider.providerPaymentId, "qb-9");
  assert.equal(payments[1]!.provider.state, "queued");
});

test("refused by the provider: the payment stays, and the studio gets a task to record it there", async () => {
  const fake = fakeFirestore({
    "invoiceReferences/r1": {
      ...qbRetainer,
      providerDocNumber: "1045",
      status: "partially_paid",
      balanceCents: 60000,
      studioPayments: [{ id: "a", amountCents: 40000, paidAt: "2026-09-29", method: "Bank transfer", provider: { state: "queued" } }],
    },
  });
  await recordProviderPaymentFailed(fake.db as never, jobSnap({ invoiceId: "r1", paymentId: "a" }) as never, {
    code: "QUICKBOOKS_PAYMENT_RECORD_FAILED",
    message: "QUICKBOOKS_PAYMENT_RECORD_FAILED:400:bad",
  });
  const invoice = fake.store["invoiceReferences/r1"]!;
  assert.equal(invoice.balanceCents, 60000);
  assert.equal((invoice.studioPayments as Array<{ provider: Record<string, unknown> }>)[0]!.provider.state, "failed");
  const task = fake.store["tasks/payment_sync_a"]!;
  assert.equal(task.title, "Record this payment in QuickBooks yourself");
  assert.match(String(task.description), /\$400\.00 paid by Bank transfer on 2026-09-29 against the retainer invoice 1045/);
  assert.equal(task.assignedRole, "studio_owner");
  assert.match(describeProviderFailure("record_quickbooks_payment").title, /record it there yourself/);
});

test("autopay charges what is left on a part-paid bill, not what it was raised for", () => {
  const finalBill = { ...qbRetainer, kind: "final", status: "partially_paid", balanceCents: 60000, dueDate: "2026-10-01" };
  assert.equal(autopayInvoiceUnchargeable(finalBill), null);
  // The charge amount is the invoice's balance at charge time.
  assert.match(read("functions/src/billing/autopay.ts"), /existing\.get\("amountCents"\) \?\? invoice\.get\("balanceCents"\)/);
});

// ── 5. Wiring inside Functions ─────────────────────────────────────────────

test("the payment jobs are dispatched, and their failure raises the task", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /type === "record_quickbooks_payment"\)\s*return recordQuickBooksPayment/);
  assert.match(jobs, /type === "record_stripe_payment"\) return recordStripePayment/);
  assert.match(jobs, /\["record_quickbooks_payment", "record_stripe_payment"\][\s\S]{0,120}!retryable[\s\S]{0,80}recordProviderPaymentFailed/);
  // An invoice email going out never turns a part-paid bill back into `sent`.
  assert.match(jobs, /current\.get\("status"\) === "partially_paid" &&/);
  const runtime = read("functions/src/operations/provider-runtime.ts");
  // QuickBooks: a Payment linked to the invoice, idempotent by requestid.
  assert.match(runtime, /\/payment\?minorversion=75&requestid=/);
  assert.match(runtime, /LinkedTxn: \[\{ TxnId: providerInvoiceId, TxnType: "Invoice" \}\]/);
  // Stripe: a credit note for a part, paid out of band for the rest.
  assert.match(runtime, /Paid outside Stripe on \$\{text\(payment\.paidAt\)\} by \$\{text\(payment\.method\)\}/);
  assert.match(runtime, /paid_out_of_band: "true"/);
  // Both re-reads of a provider balance carry the recorded payments.
  assert.match(runtime, /studioPayments:invoice\.get\("studioPayments"\)\},reported:\{status,balanceCents\}/);
  assert.match(read("functions/src/booking/webhooks.ts"), /studioPayments: current\?\.get\("studioPayments"\)/);
  assert.match(read("functions/src/booking/webhooks.ts"), /amountPaid > 0 \|\| credited > 0/);
  // The command is reachable from the booking endpoint.
  assert.match(read("functions/src/booking/commands.ts"), /command\.type === "recordInvoicePayment"\)\s*result = await recordInvoicePayment/);
});

test("features/ and functions/ agree on the payment and standing rules", () => {
  const below = (source: string, marker: string) => source.slice(source.indexOf(marker));
  assert.equal(
    below(read("functions/src/booking/invoice-payments-core.ts"), "export type PayableInvoice"),
    below(read("features/booking/invoice-payments.ts"), "export type PayableInvoice"),
  );
  assert.equal(
    below(read("functions/src/booking/invoice-standing.ts"), "const NOT_STANDING"),
    below(read("features/booking/invoice-standing.ts"), "const NOT_STANDING"),
  );
});

test("the payment control is on the retainer card, the final bill and the Invoices row, and Cue reaches it", () => {
  assert.match(read("components/booking/project-booking-workspace.tsx"), /<RecordInvoicePayment/);
  assert.match(read("components/planning/final-invoice-reconciliation.tsx"), /<RecordInvoicePayment/);
  assert.match(read("components/booking/invoice-corrections.tsx"), /<RecordInvoicePayment invoice=\{invoice\} \/>/);
  assert.match(read("components/ai/actions/prepared-actions.tsx"), /record_partial_payment: RecordPartialPaymentCard,/);
  assert.match(read("functions/src/ai/action-catalog.ts"), /id: "record_partial_payment"/);
});

// ── 6. Undoing a cancel puts the calendar event back ───────────────────────

test("undoing a booked job's cancel queues its calendar event back, when the calendar is connected", () => {
  const crm = read("functions/src/crm/commands.ts");
  const branch = crm.slice(crm.indexOf('if (command.type === "uncancelProject")'), crm.indexOf('if (command.type === "reopenJob")'));
  assert.match(branch, /const calendarConnected = booked/);
  assert.match(branch, /\.where\("provider", "==", "google_calendar"\)\s*\.where\("status", "==", "connected"\)/);
  assert.match(branch, /if \(calendarConnected\) \{[\s\S]{0,400}type: "restore_booking_calendar_event"/);
  // Crew invites are not touched: no crew job in the undo.
  assert.doesNotMatch(branch, /add_crew_calendar_invite/);
  assert.match(read("functions/src/operations/jobs.ts"), /type === "restore_booking_calendar_event"\)\s*return restoreBookingCalendarEvent/);
  const runtime = read("functions/src/operations/provider-runtime.ts");
  const restore = runtime.slice(runtime.indexOf("export async function restoreBookingCalendarEvent"));
  // Cancelled again first, or already on the calendar: nothing to do.
  assert.match(restore, /if \(!ON_THE_CALENDAR\.has\(state\)\)/);
  assert.match(restore, /if \(text\(project\.get\("calendarEventId"\)\)\) return/);
  // A deleted event comes back under its id by being confirmed again.
  assert.match(runtime, /if \(text\(existing\.status\) !== "cancelled"\) return text\(existing\.id\);[\s\S]{0,200}method: "PATCH"[\s\S]{0,200}status: "confirmed"/);
});

test("the undo says the calendar comes back for a booked job, and the crew's invites don't", () => {
  const now = "2026-10-10T12:00:00.000Z";
  const [booked] = backwardMovesFor(
    { id: "p", state: "CANCELLED", cancelledFromState: "PLANNING", cancelledAt: "2026-10-01T00:00:00Z" },
    { agreementOut: false, now },
  );
  assert.match(booked!.detail, /back on your Google Calendar/);
  assert.match(booked!.detail, /calendar invites were withdrawn/);
  assert.match(booked!.detail, /stay released and voided/);
  const [early] = backwardMovesFor(
    { id: "p", state: "CANCELLED", cancelledFromState: "PROPOSAL", cancelledAt: "2026-10-01T00:00:00Z" },
    { agreementOut: false, now },
  );
  assert.doesNotMatch(early!.detail, /Calendar/);
});
