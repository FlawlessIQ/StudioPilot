import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { outstandingFinalBalance } from "@/features/booking/final-balance-due";
import { todayInbox } from "@/features/today/inbox";
import { paymentPlanSchedule, finalBalanceOnPlan, finalStatusWithInstallments } from "@/features/billing/payment-plan";
import { journeyPaymentPlan, paymentPlanRows } from "@/features/billing/payment-plan-view";
import { invoiceKindLabel } from "@/features/billing/studio-invoice-document";
import { invoiceDeletePlan } from "@/features/billing/invoice-purge-policy";
import { invoicePaymentRefusal } from "@/features/booking/invoice-payments";
import { quickBooksFinalLines } from "../functions/src/operations/quickbooks-invoice-lines";
import { paymentReminderDraft } from "../functions/src/billing/payment-reminders";
import { installmentRetriedByStudio, mayRaiseInstallmentBill } from "../functions/src/operations/installment-billing";
import { installmentInvoiceId } from "../functions/src/booking/installment-invoice";

/**
 * Payment plans through every reader that sums a job's bills or decides what
 * is owed (docs/planner-journey-plan.md, Phase 4): the screens' final balance,
 * Today, the journey step, the client's schedule, labels, deleting records,
 * the QuickBooks final's lines, reminders and the daily run's guards.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

// A $8,000 wedding: $4,000 to book, three installments of $1,000, $1,000 at the end.
const built = paymentPlanSchedule({
  totalCents: 800_000,
  retainerCents: 400_000,
  retainerDueDate: null,
  finalDueDate: "2027-05-29",
  today: "2026-10-12",
  installments: 3,
});
assert.ok(built.ok);
const schedule = built.lines; // installments Dec 8, Feb 4, Apr 2; final May 29

const proposal = {
  id: "prop1",
  projectId: "p1",
  status: "accepted",
  version: 1,
  pricingSnapshot: { totalCents: 800_000, taxCents: 0 },
  paymentSchedule: schedule,
  hasPaymentPlan: true,
};
const retainerPaid = { id: "ret", projectId: "p1", kind: "retainer", status: "paid", amountCents: 400_000, balanceCents: 0 };
const installment = (sequence: number, overrides: Record<string, unknown> = {}) => ({
  id: `installment_p1_${sequence}`,
  projectId: "p1",
  kind: "installment",
  installmentSequence: sequence,
  installmentCount: 3,
  status: "sent",
  amountCents: 100_000,
  balanceCents: 100_000,
  dueDate: schedule.find((line) => line.sequence === sequence)!.dueDate,
  ...overrides,
});
const job = {
  id: "p1",
  name: "Maya & Theo Johnson Wedding",
  state: "BOOKED",
  eventDate: "2027-06-12",
  packageSnapshotId: "snap1",
  archivedAt: null,
  paymentShape: "deposit_and_balance",
};

test("the screens' final balance is what is left after the deposit and every installment billed", () => {
  // Installments 1 paid and 2 out unpaid: the final is $1,000 (installment 3 unbilled is included).
  const due = outstandingFinalBalance({
    projectId: "p1",
    proposals: [proposal],
    invoices: [retainerPaid, installment(1, { status: "paid", balanceCents: 0 }), installment(2)],
  });
  // 800k − 500k paid − 100k owed on installment 2 = 200k (installment 3 and the final).
  assert.equal(due.cents, 200_000);
  // The closing line's date, never installment 1's.
  assert.equal(due.dueDate, "2027-05-29");
  assert.equal(due.finalStanding, false);
});

test("without a plan the screens' final balance reads exactly as before", () => {
  const due = outstandingFinalBalance({
    projectId: "p1",
    proposals: [
      {
        ...proposal,
        paymentSchedule: [
          { label: "Retainer", amountCents: 400_000, dueDate: null },
          { label: "Final balance", amountCents: 400_000, dueDate: "2027-05-29" },
        ],
        hasPaymentPlan: false,
      },
    ],
    invoices: [retainerPaid],
  });
  assert.deepEqual([due.cents, due.dueDate], [400_000, "2027-05-29"]);
});

test("paid another way, the balance on a plan takes in the installments not yet billed", () => {
  assert.equal(finalBalanceOnPlan(schedule, [installment(1, { status: "paid", balanceCents: 0 })]), 300_000);
  assert.equal(finalBalanceOnPlan(schedule, []), 400_000);
  assert.equal(finalBalanceOnPlan([{ label: "Retainer" }, { label: "Final balance", amountCents: 5 }], []), null);
});

test("readiness: a paid final with an installment still owed is only part of the balance", () => {
  assert.equal(finalStatusWithInstallments("paid", [installment(3)]), "partially_paid");
  assert.equal(finalStatusWithInstallments("paid", [installment(3, { status: "paid", balanceCents: 0 })]), "paid");
  assert.equal(finalStatusWithInstallments("sent", [installment(3)]), "sent");
  assert.equal(finalStatusWithInstallments(null, []), null);
});

test("Today: an installment due to bill gets its own card; the final waits for the plan", () => {
  const inbox = todayInbox({
    now: "2026-11-25T12:00:00Z",
    projects: [job],
    proposals: [proposal],
    invoiceReferences: [retainerPaid],
  } as Parameters<typeof todayInbox>[0]);
  const card = inbox.act.find((item) => item.id === "installment-p1-1");
  assert.ok(card, "the installment card");
  assert.equal(card!.title, "Bill Maya & Theo Johnson's installment 1 of 3 · $1,000");
  assert.deepEqual(card!.action, { kind: "installment", label: "Send installment 1 of 3", projectId: "p1", sequence: 1, amountCents: 100_000 });
  assert.match(card!.detail ?? "", /0 of 4 payments made/);
  assert.ok(!inbox.act.some((item) => item.id === "final-balance-p1"));
  // A month out with installment 3 billed and paid: the final's card is back.
  const later = todayInbox({
    now: "2027-05-20T12:00:00Z",
    projects: [job],
    proposals: [proposal],
    invoiceReferences: [retainerPaid, ...[1, 2, 3].map((sequence) => installment(sequence, { status: "paid", balanceCents: 0 }))],
  } as Parameters<typeof todayInbox>[0]);
  const final = later.act.find((item) => item.id === "final-balance-p1");
  assert.ok(final, "the final balance card");
  assert.match(final!.title, /\$1,000/);
  // Still months out, nothing due: no card at all.
  const quiet = todayInbox({
    now: "2026-10-20T12:00:00Z",
    projects: [job],
    proposals: [proposal],
    invoiceReferences: [retainerPaid],
  } as Parameters<typeof todayInbox>[0]);
  assert.ok(!quiet.act.some((item) => item.id.startsWith("installment-p1")));
});

test("Today: a studio's own installment draft says which installment", () => {
  const inbox = todayInbox({
    now: "2026-11-25T12:00:00Z",
    projects: [job],
    proposals: [proposal],
    invoiceReferences: [
      retainerPaid,
      installment(1, { billedBy: "studio", provider: null, status: "draft", number: "INV-0007", id: "studio_inst" }),
    ],
  } as Parameters<typeof todayInbox>[0]);
  const card = inbox.act.find((item) => item.id === "studio-invoice-studio_inst");
  assert.ok(card);
  assert.equal(card!.title, "Send Maya & Theo Johnson's installment 1 of 3 invoice · $1,000");
});

test("the journey's payment step reads 2 of 4 paid, and is done only when the plan is", () => {
  const twoPaid = journeyPaymentPlan({
    projectId: "p1",
    proposals: [proposal],
    invoices: [retainerPaid, installment(1, { status: "paid", balanceCents: 0 }), installment(2, { status: "paid", balanceCents: 0 })],
    today: "2027-01-10",
  });
  assert.ok(twoPaid);
  assert.deepEqual([twoPaid!.paid, twoPaid!.payments], [2, 4]);
  assert.equal(twoPaid!.next?.label, "Installment 3");
  assert.equal(twoPaid!.billNow, null);
  assert.equal(twoPaid!.installmentsPending, true);
  assert.equal(twoPaid!.overdue, false);
  const overdue = journeyPaymentPlan({
    projectId: "p1",
    proposals: [proposal],
    invoices: [retainerPaid, installment(1, { status: "overdue" })],
    today: "2026-12-20",
  });
  assert.equal(overdue!.overdue, true);
  assert.equal(journeyPaymentPlan({ projectId: "p1", proposals: [], invoices: [], today: "2027-01-10" }), null);
});

test("the client's schedule lists every payment: paid, billed, still to come", () => {
  const rows = paymentPlanRows({
    schedule,
    invoices: [retainerPaid, installment(1, { status: "paid", balanceCents: 0 }), installment(2)],
    depositWord: "Retainer",
  });
  assert.deepEqual(
    rows.map((row) => [row.label, row.amountCents, row.state]),
    [
      ["Retainer", 400_000, "paid"],
      ["Installment 1 of 3", 100_000, "paid"],
      ["Installment 2 of 3", 100_000, "billed"],
      ["Installment 3 of 3", 100_000, "upcoming"],
      ["Final balance", 100_000, "upcoming"],
    ],
  );
  // A final raised early took installment 3 in.
  const early = paymentPlanRows({
    schedule,
    invoices: [retainerPaid, { id: "f", projectId: "p1", kind: "final", status: "sent", amountCents: 300_000, balanceCents: 300_000, dueDate: "2027-05-29" }],
    depositWord: "Deposit",
  });
  assert.equal(early[0]!.label, "Deposit");
  assert.equal(early[1]!.state, "in_final");
  assert.equal(early[4]!.amountCents, 300_000);
  assert.deepEqual(paymentPlanRows({ schedule: [{ label: "Retainer" }, { label: "Final balance" }], invoices: [], depositWord: "Retainer" }), []);
});

test("labels: an installment is named, on the invoice and in the reminder", () => {
  assert.equal(invoiceKindLabel("installment", false, { sequence: 2, count: 3 }), "Installment 2 of 3");
  assert.equal(invoiceKindLabel("installment", false), "Installment 1");
  assert.equal(invoiceKindLabel("final", false), "Final balance");
  const reminder = paymentReminderDraft({
    sequence: 1,
    studioName: "Alder & Muse",
    clientFirstName: "Maya",
    projectName: "Maya & Theo Johnson Wedding",
    invoiceKind: "installment",
    balanceCents: 100_000,
    dueDate: "2026-12-08",
    today: "2026-12-15",
  });
  assert.match(reminder.subject, /your installment for/);
  assert.match(reminder.body, /the installment for Maya & Theo Johnson Wedding/);
});

test("an installment out with the couple can be paid by hand", () => {
  assert.equal(invoicePaymentRefusal(installment(1, { provider: "quickbooks", providerState: "completed", providerInvoiceId: "1042" })), null);
});

test("deleting a paid installment waits for the final, like the deposit", () => {
  const paidInstallment = installment(1, { status: "paid", balanceCents: 0 });
  assert.deepEqual(
    invoiceDeletePlan({ invoice: paidInstallment, others: [retainerPaid], project: {}, jobHasFinalBalance: true, inFlight: false }),
    { allowed: false, reason: "INVOICE_STILL_NEEDED" },
  );
  assert.deepEqual(
    invoiceDeletePlan({
      invoice: paidInstallment,
      others: [retainerPaid, { kind: "final", status: "paid", amountCents: 100_000, balanceCents: 0 }],
      project: {},
      jobHasFinalBalance: true,
      inFlight: false,
    }),
    { allowed: true, settles: null, paidInFull: false },
  );
});

test("QuickBooks final: installments have their own line, never 'Payments received'", () => {
  const lines = quickBooksFinalLines({
    amountCents: 100_000,
    packageTotalCents: 800_000,
    taxCents: 0,
    discountCents: 0,
    items: [{ kind: "package", name: "Full planning", summary: null, inclusions: [], quantity: 1, unitPriceCents: 800_000, amountCents: 800_000, taxable: true }],
    retainerPaidCents: 400_000,
    installmentsCents: 300_000,
  });
  assert.deepEqual(
    lines.lines.map((line) => [line.title, line.amountCents]),
    [
      ["Full planning", 800_000],
      ["Retainer received", -400_000],
      ["Installments", -300_000],
    ],
  );
});

test("the daily run: the final balance's guards, and a voided installment left to the studio", () => {
  assert.equal(mayRaiseInstallmentBill(job, "2026-11-24"), true);
  assert.equal(mayRaiseInstallmentBill({ ...job, clientAutomationsPausedAt: "2026-10-01T00:00:00Z" }, "2026-11-24"), false);
  assert.equal(mayRaiseInstallmentBill({ ...job, state: "POSTPONED" }, "2026-11-24"), false);
  assert.equal(mayRaiseInstallmentBill({ ...job, state: "PROPOSAL" }, "2026-11-24"), false);
  assert.equal(mayRaiseInstallmentBill({ ...job, paymentShape: "paid_in_full" }, "2026-11-24"), false);
  assert.equal(mayRaiseInstallmentBill({ ...job, eventDate: "2026-11-01" }, "2026-11-24"), false);
  assert.equal(installmentRetriedByStudio([installment(1, { status: "voided" })], 1), true);
  assert.equal(installmentRetriedByStudio([installment(1, { status: "superseded" })], 1), false);
  assert.equal(installmentRetriedByStudio([installment(2, { status: "voided" })], 1), false);
  assert.equal(installmentInvoiceId("p1", 2, 0), "installment_p1_2");
  assert.equal(installmentInvoiceId("p1", 2, 1), "installment_p1_2_r1");
});

test("wired through: scheduler order, the final's wait, amendments, the email and the quiet guard", () => {
  const scheduler = read("functions/src/operations/invoice-scheduler.ts");
  // Installments before finals, so the final nets off one billed the same day.
  assert.ok(scheduler.indexOf("raiseDueInstallments(db") < scheduler.indexOf("raiseFinalInvoice(db, transaction"));
  assert.match(scheduler, /waitForInstallments: true/);
  assert.match(read("functions/src/operations/installment-billing.ts"), /return clientOutreachStop\(project\) === null;/);
  const final = read("functions/src/booking/final-invoice.ts");
  assert.match(final, /totalCents - retainerPaidCents - earlierFinalsPaidCents - installmentsCents/);
  assert.match(read("functions/src/contracts/amendments.ts"), /respreadPaymentPlan\(\{/);
  assert.match(read("functions/src/booking/amendment-apply.ts"), /kind === "installment" && paidOf\(invoice\) === 0/);
  // Emailed as a balance bill, named for what it is — never as a retainer.
  assert.match(read("functions/src/operations/provider-runtime.ts"), /input\.kind==="final"\|\|input\.kind==="installment"\?"final_invoice":"retainer_invoice"/);
  assert.match(read("functions/src/billing/studio-invoice-send.ts"), /kind === "final" \|\| kind === "installment" \? "final_invoice"/);
  // The closeout requirement counts installments still owed.
  assert.match(read("functions/src/post-event/commands.ts"), /installmentsOutstandingCents\(invoices\.docs/);
});

test("the email for an installment billed in QuickBooks names it, never as a retainer or the final", async () => {
  const { renderEmailTemplate } = await import("../functions/src/communications/email-templates");
  const brand = { studioName: "Alder & Muse", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const email = renderEmailTemplate({
    key: "final_invoice",
    brand,
    recipientName: "Harper Bennett",
    projectName: "Harper & Jules Bennett Wedding",
    values: { invoiceKindLabel: "installment 2 of 3", invoiceUrl: "https://example.test/pay" },
  });
  assert.equal(email.subject, "Invoice from Alder & Muse");
  assert.match(email.text, /installment 2 of 3 invoice ready/);
  assert.doesNotMatch(email.text, /final balance|retainer/i);
  // Without a label it is the final balance, as it always was.
  const final = renderEmailTemplate({ key: "final_invoice", brand, recipientName: "Harper", projectName: "X", values: { invoiceUrl: "https://example.test/pay" } });
  assert.equal(final.subject, "Final invoice from Alder & Muse");
});
