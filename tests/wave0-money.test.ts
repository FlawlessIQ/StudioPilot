import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  invoiceClosedToProviderWork,
  providerReportedInvoice,
} from "@/features/booking/invoice-standing";
import {
  heldAfterBooking,
  holdResumeStates,
} from "@/features/projects/hold-resume";
import { resumeTargetFor } from "@/features/projects/interruptions";
import { allowedProjectTransitions } from "@/features/projects/state-machine";
import { clientOutreachStop } from "@/features/post-event/client-outreach";
import {
  autopayChargeDue,
  autopayInvoiceUnchargeable,
  autopayProjectUnchargeable,
} from "../functions/src/billing/autopay-core.ts";
import { clientOutreachStop as functionsOutreachStop } from "../functions/src/post-event/client-outreach.ts";
import {
  holdResumeStates as functionsHoldResumeStates,
} from "../functions/src/crm/hold-resume.ts";
import {
  jobCalledOff,
  planStoppedBilling,
  writeStoppedBilling,
  type StoppedBillingReads,
} from "../functions/src/booking/stopped-billing.ts";
import { raiseFinalInvoice } from "../functions/src/booking/final-invoice.ts";
import {
  mayMarkOverdue,
  mayRaiseFinalBill,
} from "../functions/src/operations/invoice-scheduler.ts";

/**
 * The money audit of 2026-09-30, one test per way a studio could lose or take
 * money it shouldn't. Behaviour where the rule is pure; source reads only where
 * the fix is wiring inside a Cloud Function.
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
    create: (target: { path: string }, data: Doc) => writes.push(["create", target.path, data]),
    set: (target: { path: string }, data: Doc) => writes.push(["set", target.path, data]),
    update: (target: { path: string }, data: Doc) => writes.push(["update", target.path, data]),
  };
  return { db, transaction, snap, writes };
}

// ── 1. A hand-recorded payment is never reverted by a queued provider job ──

test("paid, replaced, voided and called-off invoices are closed to provider work", () => {
  for (const status of ["paid", "superseded", "voided", "void", "cancelled"])
    assert.equal(invoiceClosedToProviderWork(status), true, status);
  for (const status of ["queued", "sent", "awaiting_delivery", "draft", "overdue", "partially_paid", "failed", undefined])
    assert.equal(invoiceClosedToProviderWork(status), false, String(status));
});

test("both invoice create workers stop at a closed invoice before touching the provider", () => {
  const source = read("functions/src/operations/provider-runtime.ts");
  for (const worker of ["createStripeInvoice", "createQuickBooksInvoice"]) {
    const body = source.slice(source.indexOf(`export async function ${worker}`));
    const guard = body.indexOf("invoiceClosedToProviderWork(invoice.get(\"status\"))");
    const provider = body.indexOf("await connection(");
    assert.ok(guard > 0 && guard < provider, `${worker} must check the invoice before calling the provider`);
    // And the final write re-reads, so a payment recorded mid-create survives.
    assert.match(body.slice(0, body.indexOf("\nexport async function", 10)), /landProviderInvoice\(reference/);
  }
});

test("a failed or delivered job never overwrites a closed invoice", () => {
  const source = read("functions/src/operations/jobs.ts");
  assert.doesNotMatch(
    source,
    /\.doc\(`invoiceReferences\/\$\{String\(document\.get\("invoiceId"\)\)\}`\)\s*\.update\(/,
    "every job-outcome write to an invoice goes through updateInvoiceUnlessClosed",
  );
  assert.equal((source.match(/await updateInvoiceUnlessClosed\(/g) ?? []).length, 3);
  // Only a create job's failure says the invoice doesn't exist.
  assert.match(source, /\["create_quickbooks_invoice", "create_stripe_invoice"\]\.includes\(/);
  // And the couple isn't emailed a bill they've paid while it sat queued.
  assert.match(source, /held: "invoice_closed"/);
});

// ── 2. A provider sync does not undo a studio-recorded payment ─────────────

test("a QuickBooks or Stripe sync keeps a studio-recorded payment unless the provider says paid or voided", () => {
  const attested = { status: "paid", completionAuthority: "manual_attested", balanceCents: 0 };
  assert.deepEqual(
    providerReportedInvoice({ current: attested, reported: { status: "sent", balanceCents: 50000 } }),
    { status: "paid", balanceCents: 0, keptReason: "studio_recorded_payment" },
  );
  assert.deepEqual(
    providerReportedInvoice({ current: attested, reported: { status: "partially_paid", balanceCents: 100 } }).status,
    "paid",
  );
  assert.deepEqual(
    providerReportedInvoice({ current: attested, reported: { status: "voided", balanceCents: 0 } }),
    { status: "voided", balanceCents: 0, keptReason: null },
  );
  assert.deepEqual(
    providerReportedInvoice({ current: attested, reported: { status: "paid", balanceCents: 0 } }).keptReason,
    null,
  );
  // A provider-confirmed payment still follows the provider (a refund in QB).
  assert.equal(
    providerReportedInvoice({
      current: { status: "paid", completionAuthority: "provider_webhook", balanceCents: 0 },
      reported: { status: "partially_paid", balanceCents: 100 },
    }).status,
    "partially_paid",
  );
  // A bill StudioCue replaced or closed stays closed.
  assert.equal(
    providerReportedInvoice({
      current: { status: "superseded", balanceCents: 5000 },
      reported: { status: "sent", balanceCents: 5000 },
    }).status,
    "superseded",
  );
  // An ordinary open invoice follows the provider.
  assert.deepEqual(
    providerReportedInvoice({ current: { status: "sent" }, reported: { status: "partially_paid", balanceCents: 10 } }),
    { status: "partially_paid", balanceCents: 10, keptReason: null },
  );
});

test("both provider syncs go through the rule", () => {
  const runtime = read("functions/src/operations/provider-runtime.ts");
  const reconcile = runtime.slice(runtime.indexOf("export async function reconcileQuickBooksInvoice"));
  assert.match(reconcile.slice(0, reconcile.indexOf("batch.update(reference")), /providerReportedInvoice\(/);
  const webhooks = read("functions/src/booking/webhooks.ts");
  const stripe = webhooks.slice(webhooks.indexOf("export const stripeConnectWebhook"));
  assert.match(stripe, /providerReportedInvoice\(/);
  assert.match(stripe, /status: decided\.status/);
});

// ── 3 & 4. Autopay charges only a sent bill, on a live booked job ──────────

const liveInvoice = {
  kind: "final",
  status: "overdue",
  balanceCents: 250000,
  dueDate: "2026-10-01",
  provider: "quickbooks",
  providerState: "completed",
  providerInvoiceId: "145",
};

test("autopay never charges a bill QuickBooks was never sent", () => {
  assert.equal(autopayInvoiceUnchargeable(liveInvoice), null);
  assert.equal(autopayInvoiceUnchargeable({ ...liveInvoice, status: "draft" }), "not_unpaid");
  assert.equal(autopayInvoiceUnchargeable({ ...liveInvoice, status: "review_required" }), "not_unpaid");
  assert.equal(autopayInvoiceUnchargeable({ ...liveInvoice, providerState: "queued" }), "not_at_provider");
  assert.equal(autopayInvoiceUnchargeable({ ...liveInvoice, providerState: "review_required" }), "not_at_provider");
  assert.equal(
    autopayInvoiceUnchargeable({ ...liveInvoice, providerInvoiceId: "pending_final_p1" }),
    "no_provider_invoice",
  );
  assert.equal(autopayInvoiceUnchargeable({ ...liveInvoice, providerInvoiceId: null }), "no_provider_invoice");
  assert.deepEqual(
    autopayChargeDue({ invoice: { ...liveInvoice, providerState: "queued" }, attempts: [], today: "2026-11-01" }),
    { due: false, reason: "not_at_provider" },
  );
});

test("autopay never charges a cancelled, lost, on-hold, archived or unbooked job", () => {
  const charge = (project: Record<string, unknown> | null) =>
    autopayProjectUnchargeable(project, functionsOutreachStop(project));
  assert.equal(charge({ state: "PLANNING" }), null);
  assert.equal(charge({ state: "DELIVERED" }), null);
  assert.equal(charge({ state: "CANCELLED" }), "project_cancelled");
  assert.equal(charge({ state: "LOST" }), "project_cancelled");
  assert.equal(charge({ state: "POSTPONED" }), "project_on_hold");
  assert.equal(charge({ state: "ARCHIVED" }), "project_put_away");
  assert.equal(charge({ state: "PLANNING", archivedAt: "2026-09-01T00:00:00Z" }), "project_put_away");
  assert.equal(charge({ state: "PLANNING", clientAutomationsPausedAt: "2026-09-01" }), "project_automations_paused");
  assert.equal(charge({ state: "RETAINER_PENDING" }), "project_not_active");
  assert.equal(charge({ state: "CLOSED" }), "project_not_active");
  assert.equal(charge(null), "no_project");
});

test("the scheduler and the charge worker both check the job, and the worker re-checks the bill", () => {
  const source = read("functions/src/billing/autopay.ts");
  const worker = source.slice(source.indexOf("export async function chargeSavedCard"), source.indexOf("export const autopayScheduler"));
  assert.match(worker, /autopayInvoiceUnchargeable\(/);
  assert.match(worker, /autopayProjectUnchargeable\(/);
  assert.ok(
    worker.indexOf("autopayProjectUnchargeable(") < worker.indexOf("/quickbooks/v4/payments/charges"),
    "checked before the card is charged",
  );
  const scheduler = source.slice(source.indexOf("export const autopayScheduler"));
  assert.match(scheduler, /autopayProjectUnchargeable\(project\.data\(\), clientOutreachStop\(project\.data\(\)\)\)/);
});

test("the overdue sweep leaves unsent bills and stopped jobs alone", () => {
  const today = "2026-10-01";
  const invoice = { status: "sent", balanceCents: 5000, dueDate: "2026-09-20", providerState: "completed" };
  const booked = { state: "PLANNING" };
  assert.equal(mayMarkOverdue(invoice, booked, today), true);
  for (const status of ["draft", "review_required", "queued", "paid", "superseded", "failed"])
    assert.equal(mayMarkOverdue({ ...invoice, status }, booked, today), false, status);
  assert.equal(mayMarkOverdue({ ...invoice, providerState: "queued" }, booked, today), false);
  assert.equal(mayMarkOverdue({ ...invoice, dueDate: "2026-10-01" }, booked, today), false);
  for (const project of [{ state: "CANCELLED" }, { state: "LOST" }, { state: "POSTPONED" }, { state: "ARCHIVED" }, { state: "PLANNING", archivedAt: "x" }])
    assert.equal(mayMarkOverdue(invoice, project, today), false, JSON.stringify(project));
  assert.equal(mayMarkOverdue(invoice, null, today), false);
  // A quiet import still shows what's late; nothing is sent because of it.
  assert.equal(mayMarkOverdue(invoice, { state: "PLANNING", clientAutomationsPausedAt: "x" }, today), true);
});

// ── 5. Calling a job off closes its billing ────────────────────────────────

test("calling a job off stops every open bill, asks for voids where one was raised, and totals what was paid", () => {
  const plan = planStoppedBilling([
    { id: "retainer", status: "paid", kind: "retainer", amountCents: 50000, balanceCents: 0 },
    { id: "final", status: "sent", kind: "final", amountCents: 150000, balanceCents: 150000, providerState: "completed", providerInvoiceId: "145" },
    { id: "draft", status: "draft", kind: "final", amountCents: 150000, balanceCents: 150000, providerState: "queued", providerInvoiceId: "pending_draft" },
    { id: "old", status: "superseded", kind: "final", amountCents: 150000, balanceCents: 150000 },
  ]);
  assert.deepEqual(plan.close, ["final", "draft"]);
  assert.deepEqual(plan.voidAtProvider, ["final"]);
  assert.equal(plan.paidCents, 50000);
});

test("the cancellation write closes the plan, supersedes the bills and leaves the studio the right tasks", () => {
  const { db, transaction, snap, writes } = fakeFirestore({
    "invoiceReferences/r1": { tenantId: "t", projectId: "p", kind: "retainer", status: "paid", amountCents: 50000, balanceCents: 0, currency: "USD" },
    "invoiceReferences/f1": { tenantId: "t", projectId: "p", kind: "final", status: "sent", amountCents: 150000, balanceCents: 150000, providerState: "completed", providerInvoiceId: "145", provider: "quickbooks", providerDocNumber: "1045" },
    "bookingOrchestrations/p": { status: "active" },
  });
  const reads = {
    invoices: [snap("invoiceReferences/r1"), snap("invoiceReferences/f1")],
    plan: snap("bookingOrchestrations/p"),
    refundTask: snap("tasks/refund_or_keep_p"),
  } as unknown as StoppedBillingReads;
  const outcome = writeStoppedBilling(db as never, transaction as never, {
    tenantId: "t",
    projectId: "p",
    stop: "cancelled",
    reads,
    now: "2026-09-30T12:00:00.000Z",
    actor: "u1",
  });
  assert.deepEqual(outcome, { closedInvoiceIds: ["f1"], voidTaskIds: ["invoice_void_f1"], refundTask: true });
  const byPath = new Map(writes.map(([, path, data]) => [path, data]));
  assert.equal(byPath.get("invoiceReferences/f1")?.status, "superseded");
  assert.equal(byPath.has("invoiceReferences/r1"), false, "money received is not rewritten");
  assert.equal(byPath.get("bookingOrchestrations/p")?.status, "cancelled");
  assert.match(String(byPath.get("tasks/invoice_void_f1")?.title), /Void invoice 1045 in QuickBooks/);
  assert.equal(byPath.get("tasks/refund_or_keep_p")?.title, "Refund or keep the retainer paid after cancelling");
});

test("cancelling and closing as lost both close billing, and a paid retainer after either exits cleanly", () => {
  const crm = read("functions/src/crm/commands.ts");
  const transition = crm.slice(crm.indexOf('if (command.type === "transitionProject")'));
  assert.match(transition.slice(0, 6000), /readStoppedBilling\(/);
  assert.match(transition.slice(0, 8000), /writeStoppedBilling\(/);
  const close = crm.slice(crm.indexOf('if (lifecycle.type === "closeInquiry")'));
  assert.match(close.slice(0, 2000), /writeStoppedBilling\(db, transaction, \{[\s\S]*stop: "lost"/);

  const orchestration = read("functions/src/booking/orchestration.ts");
  const paid = orchestration.slice(orchestration.indexOf("export const bookingRetainerPaid"));
  assert.match(paid, /jobCalledOff\(project\.data\(\)\)/);
  assert.match(paid, /refundOrKeepTask\(/);
  assert.doesNotMatch(paid, /throw new Error\("INVALID_BOOKING_STATE"\)/);

  assert.equal(jobCalledOff({ state: "CANCELLED" }), true);
  assert.equal(jobCalledOff({ state: "LOST" }), true);
  assert.equal(jobCalledOff({ state: "ARCHIVED" }), true);
  assert.equal(jobCalledOff({ state: "ARCHIVED", bookingCompletedAt: "2026-01-01" }), false);
  assert.equal(jobCalledOff({ state: "RETAINER_PENDING" }), false);
});

// ── 6. Archived, cancelled, lost and held jobs are not billed or emailed ───

test("lost and on-hold jobs now stop outreach, in both copies", () => {
  for (const stop of [clientOutreachStop, functionsOutreachStop]) {
    assert.equal(stop({ state: "LOST" }), "cancelled");
    assert.equal(stop({ state: "POSTPONED" }), "on_hold");
    assert.equal(stop({ state: "PLANNING" }), null);
  }
});

test("the final bill catches up inside the 28-day window, only for live booked jobs", () => {
  const today = "2026-09-30";
  const horizon = "2026-10-28";
  assert.equal(mayRaiseFinalBill({ state: "PLANNING", eventDate: "2026-10-28" }, today, horizon), true);
  assert.equal(mayRaiseFinalBill({ state: "BOOKED", eventDate: "2026-10-10" }, today, horizon), true, "booked inside the window");
  assert.equal(mayRaiseFinalBill({ state: "PLANNING", eventDate: "2026-10-29" }, today, horizon), false);
  assert.equal(mayRaiseFinalBill({ state: "PLANNING", eventDate: "2026-09-29" }, today, horizon), false);
  for (const project of [
    { state: "PLANNING", eventDate: "2026-10-10", archivedAt: "2026-09-01" },
    { state: "PLANNING", eventDate: "2026-10-10", clientAutomationsPausedAt: "2026-09-01" },
    { state: "CANCELLED", eventDate: "2026-10-10" },
    { state: "POSTPONED", eventDate: "2026-10-10" },
    { state: "RETAINER_PENDING", eventDate: "2026-10-10" },
  ])
    assert.equal(mayRaiseFinalBill(project, today, horizon), false, JSON.stringify(project));
});

test("every client-facing scheduler reads the outreach stop", () => {
  for (const path of [
    "functions/src/communications/lifecycle-scheduler.ts",
    "functions/src/planning/questionnaire-reminder-scheduler.ts",
    "functions/src/contracts/reminders.ts",
    "functions/src/operations/invoice-scheduler.ts",
    "functions/src/ai/daily-digest.ts",
  ])
    assert.match(read(path), /clientOutreachStop\(/, path);
  const scheduler = read("functions/src/operations/invoice-scheduler.ts");
  assert.doesNotMatch(scheduler, /where\("eventDate", "==",/, "no longer an exact-day match");
});

// ── 7. A waived retainer does not block the final bill ─────────────────────

function finalBillStore(extra: Record<string, Doc>) {
  return {
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
    ...extra,
  };
}

test("a retainer waived on an approved exception counts as satisfied, with nothing paid", async () => {
  const { db, transaction, snap, writes } = fakeFirestore(
    finalBillStore({
      "bookingExceptions/x": { tenantId: "t", projectId: "p", type: "retainer", status: "approved" },
    }),
  );
  const outcome = await raiseFinalInvoice(db as never, transaction as never, snap("projects/p") as never, {
    invoiceId: "final_p",
    actor: "u1",
    now: "2026-09-30T00:00:00.000Z",
    provider: "quickbooks",
    resolveCustomer: true,
  });
  assert.deepEqual(outcome, { raised: true, invoiceId: "final_p", amountCents: 300000, reviewRequired: false });
  const invoice = writes.find(([, path]) => path === "invoiceReferences/final_p")![2];
  const calculation = invoice.calculation as { lines: Array<{ label: string; source: string }>; discrepancies: string[] };
  assert.deepEqual(calculation.discrepancies, []);
  assert.ok(calculation.lines.some((line) => line.source === "bookingExceptions/x"));
});

test("with no retainer and no waiver the server still refuses, and the copy doesn't push fake money", async () => {
  const { db, transaction, snap } = fakeFirestore(finalBillStore({}));
  const outcome = await raiseFinalInvoice(db as never, transaction as never, snap("projects/p") as never, {
    invoiceId: "final_p",
    actor: "u1",
    now: "2026-09-30T00:00:00.000Z",
    resolveCustomer: true,
  });
  assert.deepEqual(outcome, { raised: false, reason: "no_retainer" });
  const copy = read("lib/ai/friendly-error.ts");
  assert.doesNotMatch(copy, /Record the retainer first/);
});

// ── 8. A hold never skips the booking gate ─────────────────────────────────

test("a job held before booking comes back to where it was, never into planning", () => {
  for (const from of ["CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING"]) {
    const hold = { postponedFromState: from };
    assert.equal(heldAfterBooking(hold), false);
    assert.deepEqual(holdResumeStates(hold), [from, "CANCELLED"]);
    assert.equal(holdResumeStates(hold).includes("PLANNING"), false, from);
    assert.equal(resumeTargetFor("POSTPONED", hold), from);
    assert.ok(allowedProjectTransitions.POSTPONED.includes(from as never), `${from} is a move the machine allows`);
  }
});

test("a job held after booking comes back through planning or the booking gate", () => {
  for (const from of ["BOOKED", "PLANNING", "READY"]) {
    const hold = { postponedFromState: from };
    assert.equal(heldAfterBooking(hold), true);
    assert.deepEqual(holdResumeStates(hold), ["PLANNING", "CANCELLED"]);
    assert.equal(resumeTargetFor("POSTPONED", hold), "BOOKED");
  }
  // Held before postponedFromState existed: the booking stamp decides.
  assert.deepEqual(holdResumeStates({ bookingCompletedAt: "2026-05-01T00:00:00Z" }), ["PLANNING", "CANCELLED"]);
  assert.deepEqual(holdResumeStates({}), ["CONSULTATION", "CANCELLED"]);
  assert.equal(resumeTargetFor("POSTPONED", {}), "BOOKED", "the gate re-checks; it never guesses a stage");
});

test("the functions copy of the hold rule matches features/, and the command enforces it", () => {
  const body = (path: string) => {
    const source = read(path);
    return source.slice(source.indexOf("const HELD_BEFORE_BOOKING"));
  };
  assert.equal(body("functions/src/crm/hold-resume.ts"), body("features/projects/hold-resume.ts"));
  for (const hold of [{ postponedFromState: "PROPOSAL" }, { postponedFromState: "READY" }, {}, { bookingCompletedAt: "x" }])
    assert.deepEqual(functionsHoldResumeStates(hold), holdResumeStates(hold));

  const crm = read("functions/src/crm/commands.ts");
  const transition = crm.slice(crm.indexOf('if (command.type === "transitionProject")'));
  assert.match(transition, /!holdResumeStates\(project\)\.includes\(command\.input\.targetState\)/);
  assert.match(transition, /postponedFromState: project\.state/);
  // The two copies of the state machine agree about the way out of a hold.
  assert.match(
    crm,
    /POSTPONED: \["CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "BOOKED", "PLANNING", "CANCELLED"\]/,
  );
  // Cue and the job page both ask the rule.
  assert.match(read("components/ai/actions/job-actions.tsx"), /holdResumeStates\(hold\)/);
  assert.match(read("components/projects/live-project-detail.tsx"), /resumeTargetFor\(state, hold \?\? \{\}\)/);
});

// ── 9. The screens say what is now true ────────────────────────────────────

test("the cancelled and on-hold copy promises only what the server does", () => {
  const detail = read("components/projects/live-project-detail.tsx");
  assert.doesNotMatch(detail, /\n\s+Everything on it stays on file\. Nothing is outstanding for the\n/);
  assert.match(detail, /on the job's tasks for you to void or settle/);
  const thread = read("components/projects/project-thread.tsx");
  assert.doesNotMatch(thread, /nothing is being chased/);
});
