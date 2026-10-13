import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evenInstallmentDates,
  finalScheduleLine,
  hasPaymentPlan,
  installmentName,
  installmentsBilledCents,
  installmentsOutstandingCents,
  installmentsThatFit,
  nextInstallmentToBill,
  packagePaymentPlan,
  paidInstallments,
  paymentPlanProgress,
  paymentPlanSchedule,
  respreadPaymentPlan,
  scheduleInstallments,
  scheduleLineKind,
  splitEvenly,
  type PlanLine,
} from "../features/billing/payment-plan";

/**
 * Payment plans (docs/planner-journey-plan.md, Phase 4): the deposit, up to
 * six installments, then the final balance. The rules are decided in
 * features/billing/payment-plan.ts and copied into functions/; these pin them.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const MARKER = "// --- shared with functions/src/billing/payment-plan.ts ---";
const sum = (lines: readonly { amountCents: number }[]) => lines.reduce((total, line) => total + line.amountCents, 0);

test("the functions copy matches the features copy below the marker", () => {
  const features = read("features/billing/payment-plan.ts");
  const functions = read("functions/src/billing/payment-plan.ts");
  assert.ok(features.includes(MARKER) && functions.includes(MARKER));
  assert.equal(functions.slice(functions.indexOf(MARKER)), features.slice(features.indexOf(MARKER)));
});

test("off: no installments is exactly the deposit and the final balance", () => {
  const result = paymentPlanSchedule({
    totalCents: 650_000,
    retainerCents: 195_000,
    retainerDueDate: null,
    finalDueDate: "2027-05-29",
    today: "2026-10-12",
    installments: 0,
  });
  assert.ok(result.ok);
  assert.deepEqual(
    result.lines.map(({ label, amountCents, dueDate }) => ({ label, amountCents, dueDate })),
    [
      { label: "Retainer", amountCents: 195_000, dueDate: null },
      { label: "Final balance", amountCents: 455_000, dueDate: "2027-05-29" },
    ],
  );
  assert.equal(result.installments, 0);
  assert.equal(result.collapsed, false);
  assert.equal(hasPaymentPlan(result.lines), false);
});

test("even split: three installments and the final share what is left after the deposit", () => {
  const result = paymentPlanSchedule({
    totalCents: 800_000,
    retainerCents: 400_000,
    retainerDueDate: null,
    finalDueDate: "2027-05-29",
    today: "2026-10-12",
    installments: 3,
  });
  assert.ok(result.ok);
  assert.deepEqual(
    result.lines.map((line) => line.label),
    ["Retainer", "Installment 1", "Installment 2", "Installment 3", "Final balance"],
  );
  assert.deepEqual(
    result.lines.map((line) => line.amountCents),
    [400_000, 100_000, 100_000, 100_000, 100_000],
  );
  assert.equal(sum(result.lines), 800_000);
  assert.deepEqual(
    result.lines.map((line) => line.kind),
    ["retainer", "installment", "installment", "installment", "final"],
  );
  assert.deepEqual(
    result.lines.filter((line) => line.kind === "installment").map((line) => line.sequence),
    [1, 2, 3],
  );
});

test("spacing: N installments make N + 1 even gaps between booking and the final balance", () => {
  // Oct 12 2026 → May 29 2027 is 229 days: four gaps of 57¼, rounded to the day.
  assert.deepEqual(evenInstallmentDates("2026-10-12", "2027-05-29", 3), ["2026-12-08", "2027-02-04", "2027-04-02"]);
  const result = paymentPlanSchedule({
    totalCents: 800_000,
    retainerCents: 400_000,
    retainerDueDate: null,
    finalDueDate: "2027-05-29",
    today: "2026-10-12",
    installments: 3,
  });
  assert.ok(result.ok);
  const dates = result.lines.map((line) => line.dueDate);
  assert.deepEqual(dates, [null, "2026-12-08", "2027-02-04", "2027-04-02", "2027-05-29"]);
});

test("spacing starts from the deposit's date when it is later than today", () => {
  const result = paymentPlanSchedule({
    totalCents: 400_000,
    retainerCents: 100_000,
    retainerDueDate: "2026-11-01",
    finalDueDate: "2027-03-01",
    today: "2026-10-12",
    installments: 2,
  });
  assert.ok(result.ok);
  const installments = result.lines.filter((line) => line.kind === "installment");
  assert.ok(installments.every((line) => line.dueDate! > "2026-11-01" && line.dueDate! < "2027-03-01"));
});

test("rounding: whole cents, the remainder on the last line, and the lines always add up to the total", () => {
  assert.deepEqual(splitEvenly(100_000, 3), [33_333, 33_333, 33_334]);
  assert.deepEqual(splitEvenly(1, 4), [0, 0, 0, 1]);
  for (const [total, retainer, count] of [
    [999_999, 333_333, 4],
    [100_001, 0, 6],
    [123_457, 61_728, 3],
    [50_000, 49_999, 1],
  ] as const) {
    const result = paymentPlanSchedule({
      totalCents: total,
      retainerCents: retainer,
      retainerDueDate: null,
      finalDueDate: "2028-01-01",
      today: "2026-10-12",
      installments: count,
    });
    assert.ok(result.ok);
    assert.equal(sum(result.lines), total, `${total}/${retainer}/${count}`);
    const amounts = result.lines.slice(1).map((line) => line.amountCents);
    // Every installment is the same share; the final carries what rounding left.
    const installments = amounts.slice(0, -1);
    assert.ok(installments.every((amount) => amount === installments[0]));
    assert.ok(amounts[amounts.length - 1]! >= installments[0]!);
    assert.ok(amounts[amounts.length - 1]! - installments[0]! < amounts.length);
  }
});

test("short lead time: only the installments that fit two weeks apart are kept", () => {
  // 60 days: floor(60 / 14) − 1 = 3.
  assert.equal(installmentsThatFit("2026-10-12", "2026-12-11", 6), 3);
  // 29 days: one fits.
  assert.equal(installmentsThatFit("2026-10-12", "2026-11-10", 4), 1);
  // 27 days: none.
  assert.equal(installmentsThatFit("2026-10-12", "2026-11-08", 4), 0);
  // Already past the balance's date.
  assert.equal(installmentsThatFit("2026-10-12", "2026-10-01", 3), 0);
  const tight = paymentPlanSchedule({
    totalCents: 600_000,
    retainerCents: 300_000,
    retainerDueDate: null,
    finalDueDate: "2026-12-11",
    today: "2026-10-12",
    installments: 6,
  });
  assert.ok(tight.ok);
  assert.equal(tight.installments, 3);
  assert.equal(tight.collapsed, true);
  assert.equal(sum(tight.lines), 600_000);
  const dates = tight.lines.map((line) => line.dueDate).filter((date): date is string => Boolean(date));
  for (let index = 1; index < dates.length; index += 1) {
    const gap = (Date.parse(dates[index]!) - Date.parse(dates[index - 1]!)) / 86_400_000;
    assert.ok(gap >= 14, `gap ${gap}`);
  }
});

test("short lead time: when none fit the plan collapses to the schedule without one", () => {
  const result = paymentPlanSchedule({
    totalCents: 600_000,
    retainerCents: 300_000,
    retainerDueDate: null,
    finalDueDate: "2026-10-30",
    today: "2026-10-12",
    installments: 3,
  });
  assert.ok(result.ok);
  assert.equal(result.installments, 0);
  assert.equal(result.collapsed, true);
  assert.deepEqual(result.lines.map((line) => line.label), ["Retainer", "Final balance"]);
  assert.equal(sum(result.lines), 600_000);
  // No balance date, or nothing left after the deposit: nothing to spread.
  for (const overrides of [{ finalDueDate: null }, { retainerCents: 600_000 }]) {
    const none = paymentPlanSchedule({
      totalCents: 600_000,
      retainerCents: 300_000,
      retainerDueDate: null,
      finalDueDate: "2027-10-30",
      today: "2026-10-12",
      installments: 3,
      ...overrides,
    });
    assert.ok(none.ok);
    assert.equal(none.installments, 0);
  }
});

test("a studio's own lines: dates kept, amounts checked, the final takes the rest", () => {
  const result = paymentPlanSchedule({
    totalCents: 1_000_000,
    retainerCents: 500_000,
    retainerDueDate: "2026-10-20",
    finalDueDate: "2027-05-01",
    today: "2026-10-12",
    installments: [
      { dueDate: "2026-12-01", amountCents: 150_000 },
      { dueDate: "2027-02-01", amountCents: 150_000 },
      { dueDate: "2027-04-01", amountCents: null },
    ],
  });
  assert.ok(result.ok);
  // The blank line and the final share the 200,000 left.
  assert.deepEqual(result.lines.map((line) => line.amountCents), [500_000, 150_000, 150_000, 100_000, 100_000]);
  assert.deepEqual(result.lines.map((line) => line.dueDate), ["2026-10-20", "2026-12-01", "2027-02-01", "2027-04-01", "2027-05-01"]);
  assert.equal(sum(result.lines), 1_000_000);
  // Every amount given: a final of nothing is allowed — the last installment is the balance.
  const exact = paymentPlanSchedule({
    totalCents: 1_000_000,
    retainerCents: 500_000,
    retainerDueDate: null,
    finalDueDate: "2027-05-01",
    today: "2026-10-12",
    installments: [
      { dueDate: "2027-01-01", amountCents: 250_000 },
      { dueDate: "2027-04-01", amountCents: 250_000 },
    ],
  });
  assert.ok(exact.ok);
  assert.equal(exact.lines[exact.lines.length - 1]!.amountCents, 0);
  assert.equal(sum(exact.lines), 1_000_000);
});

test("a studio's own lines are refused when they don't fit", () => {
  const base = {
    totalCents: 1_000_000,
    retainerCents: 500_000,
    retainerDueDate: "2026-10-20",
    finalDueDate: "2027-05-01",
    today: "2026-10-12",
  };
  const refuse = (installments: Array<{ dueDate: string | null; amountCents?: number | null }>, error: string) => {
    const result = paymentPlanSchedule({ ...base, installments });
    assert.equal(result.ok, false, error);
    assert.equal(!result.ok && result.error, error);
  };
  refuse([{ dueDate: "2026-12-01", amountCents: 600_000 }], "PAYMENT_PLAN_EXCEEDS_TOTAL");
  refuse([{ dueDate: "2026-12-01", amountCents: 300_000 }, { dueDate: "2027-01-01", amountCents: 300_000 }], "PAYMENT_PLAN_EXCEEDS_TOTAL");
  refuse([{ dueDate: "2027-02-01" }, { dueDate: "2027-01-01" }], "PAYMENT_PLAN_DATES_OUT_OF_ORDER");
  refuse([{ dueDate: "2027-01-01" }, { dueDate: "2027-01-01" }], "PAYMENT_PLAN_DATES_OUT_OF_ORDER");
  refuse([{ dueDate: "2027-06-01" }], "PAYMENT_PLAN_AFTER_FINAL");
  refuse([{ dueDate: "2026-10-20" }], "PAYMENT_PLAN_DATE_BEFORE_DEPOSIT");
  refuse([{ dueDate: null }], "PAYMENT_PLAN_DATE_REQUIRED");
  refuse([{ dueDate: "2027-02-30" }], "PAYMENT_PLAN_DATE_REQUIRED");
  refuse([{ dueDate: "2027-01-01", amountCents: 0 }], "PAYMENT_PLAN_AMOUNT_INVALID");
  refuse([{ dueDate: "2027-01-01", amountCents: 12.5 }], "PAYMENT_PLAN_AMOUNT_INVALID");
  refuse(
    Array.from({ length: 7 }, (_, index) => ({ dueDate: `2026-11-${String(index + 10).padStart(2, "0")}` })),
    "PAYMENT_PLAN_TOO_MANY_INSTALLMENTS",
  );
  const noBalanceDate = paymentPlanSchedule({ ...base, finalDueDate: null, installments: [{ dueDate: "2027-01-01" }] });
  assert.equal(!noBalanceDate.ok && noBalanceDate.error, "PAYMENT_PLAN_BALANCE_DATE_REQUIRED");
});

test("reading a schedule: by kind, else by label, and never the balance by position", () => {
  const planned = paymentPlanSchedule({
    totalCents: 800_000,
    retainerCents: 400_000,
    retainerDueDate: null,
    finalDueDate: "2027-05-29",
    today: "2026-10-12",
    installments: 3,
  });
  assert.ok(planned.ok);
  // The final balance is the last line, not the second.
  assert.deepEqual(finalScheduleLine(planned.lines), { amountCents: 100_000, dueDate: "2027-05-29" });
  // Lines written before plans have no kind; their labels still say what they are.
  const legacy = [
    { label: "Retainer", amountCents: 100, dueDate: null },
    { label: "Installment 1", amountCents: 50, dueDate: "2027-01-01" },
    { label: "Final balance", amountCents: 50, dueDate: "2027-02-01" },
  ];
  assert.deepEqual(legacy.map(scheduleLineKind), ["retainer", "installment", "final"]);
  assert.deepEqual(scheduleInstallments(legacy), [{ sequence: 1, amountCents: 50, dueDate: "2027-01-01" }]);
  assert.equal(scheduleLineKind({ label: "Payment in full" }), "retainer");
  assert.equal(scheduleLineKind({ label: "Payment on the day" }), "final");
  assert.equal(hasPaymentPlan([{ label: "Retainer" }, { label: "Final balance" }]), false);
});

test("a package's plan is off unless it says how many installments, and never more than six", () => {
  assert.equal(packagePaymentPlan(undefined), null);
  assert.equal(packagePaymentPlan(null), null);
  assert.equal(packagePaymentPlan({ installments: 0 }), null);
  assert.deepEqual(packagePaymentPlan({ installments: 3 }), { installments: 3 });
  assert.deepEqual(packagePaymentPlan({ installments: 9 }), { installments: 6 });
});

test("labels: Installment 2 of 3 on the bill", () => {
  assert.equal(installmentName(2, 3), "Installment 2 of 3");
  assert.equal(installmentName(1, 1), "Installment 1");
  assert.equal(installmentName(1, null), "Installment 1");
});

const planOf = (lines: readonly PlanLine[]) => lines.map(({ label, amountCents, dueDate, kind, sequence }) => ({ label, amountCents, dueDate, kind, sequence }));
const threeInstallments = () => {
  const result = paymentPlanSchedule({
    totalCents: 800_000,
    retainerCents: 400_000,
    retainerDueDate: null,
    finalDueDate: "2027-05-29",
    today: "2026-10-12",
    installments: 3,
  });
  assert.ok(result.ok);
  return result.lines;
};

test("respread: paid lines stay; the rest of a higher total is spread over the unpaid lines and the final", () => {
  const schedule = threeInstallments();
  const next = respreadPaymentPlan({
    schedule,
    totalCents: 860_000,
    retainerCents: 400_000,
    retainerDueDate: null,
    finalDueDate: "2027-05-29",
    paid: [{ sequence: 1, amountCents: 100_000 }],
  });
  assert.ok(next);
  assert.deepEqual(
    next.map((line) => [line.label, line.amountCents, line.dueDate]),
    [
      ["Retainer", 400_000, null],
      ["Installment 1", 100_000, "2026-12-08"],
      ["Installment 2", 120_000, "2027-02-04"],
      ["Installment 3", 120_000, "2027-04-02"],
      ["Final balance", 120_000, "2027-05-29"],
    ],
  );
  assert.equal(sum(next), 860_000);
});

test("respread: a lower total, an earlier date, and nothing left to spread", () => {
  const schedule = threeInstallments();
  // The wedding moved earlier: the balance falls due Mar 1, so installment 3 (Apr 1) is folded into it.
  const earlier = respreadPaymentPlan({
    schedule,
    totalCents: 700_000,
    retainerCents: 400_000,
    retainerDueDate: null,
    finalDueDate: "2027-03-01",
    paid: [{ sequence: 1, amountCents: 100_000 }],
  });
  assert.ok(earlier);
  assert.deepEqual(planOf(earlier).map((line) => line.label), ["Retainer", "Installment 1", "Installment 2", "Final balance"]);
  assert.deepEqual(earlier.map((line) => line.amountCents), [400_000, 100_000, 100_000, 100_000]);
  assert.equal(sum(earlier), 700_000);
  // Paid already covers the new total: the unpaid lines go and the final is nothing (a refund is a task elsewhere).
  const covered = respreadPaymentPlan({
    schedule,
    totalCents: 450_000,
    retainerCents: 400_000,
    retainerDueDate: null,
    finalDueDate: "2027-05-29",
    paid: [{ sequence: 1, amountCents: 100_000 }],
  });
  assert.ok(covered);
  assert.deepEqual(covered.map((line) => [line.label, line.amountCents]), [
    ["Retainer", 400_000],
    ["Installment 1", 100_000],
    ["Final balance", 0],
  ]);
  // No plan: the caller writes the two lines it always did.
  assert.equal(
    respreadPaymentPlan({
      schedule: [{ label: "Retainer", amountCents: 1 }, { label: "Final balance", amountCents: 1 }],
      totalCents: 2,
      retainerCents: 1,
      retainerDueDate: null,
      finalDueDate: null,
      paid: [],
    }),
    null,
  );
});

test("respread: the sum invariant holds for any change", () => {
  const schedule = threeInstallments();
  for (const total of [400_000, 500_001, 812_345, 1_999_999]) {
    for (const paid of [[], [{ sequence: 1, amountCents: 100_000 }], [{ sequence: 1, amountCents: 100_000 }, { sequence: 2, amountCents: 100_000 }]]) {
      const next = respreadPaymentPlan({ schedule, totalCents: total, retainerCents: 400_000, retainerDueDate: null, finalDueDate: "2027-05-29", paid });
      assert.ok(next);
      const paidCents = paid.reduce((s, entry) => s + entry.amountCents, 0);
      assert.equal(sum(next), Math.max(total, 400_000 + paidCents), `${total} ${paid.length}`);
      assert.ok(next.every((line) => line.amountCents >= 0));
    }
  }
});

const invoice = (overrides: Record<string, unknown>) => ({ kind: "installment", status: "sent", amountCents: 100_000, balanceCents: 100_000, ...overrides });

test("invoices: billed and outstanding count each installment bill, paid or not, and never a replaced one", () => {
  const invoices = [
    { kind: "retainer", status: "paid", amountCents: 400_000, balanceCents: 0 },
    invoice({ installmentSequence: 1, status: "paid", balanceCents: 0 }),
    invoice({ installmentSequence: 2, status: "partially_paid", balanceCents: 40_000 }),
    invoice({ installmentSequence: 3, status: "superseded" }),
  ];
  assert.equal(installmentsBilledCents(invoices), 200_000);
  assert.equal(installmentsOutstandingCents(invoices), 40_000);
  assert.deepEqual(paidInstallments(invoices), [
    { sequence: 1, amountCents: 100_000 },
    { sequence: 2, amountCents: 100_000 },
  ]);
});

test("the scheduler bills the next installment two weeks before it falls due, one at a time, in order", () => {
  const schedule = threeInstallments(); // Dec 8, Feb 4, Apr 2, final May 29
  assert.equal(nextInstallmentToBill({ schedule, invoices: [], today: "2026-11-23" }), null);
  assert.deepEqual(nextInstallmentToBill({ schedule, invoices: [], today: "2026-11-24" }), {
    sequence: 1,
    count: 3,
    amountCents: 100_000,
    dueDate: "2026-12-08",
    billOn: "2026-11-24",
  });
  // Billed: the next waits for its own day.
  const billed = [invoice({ installmentSequence: 1 })];
  assert.equal(nextInstallmentToBill({ schedule, invoices: billed, today: "2026-12-20" }), null);
  assert.equal(nextInstallmentToBill({ schedule, invoices: billed, today: "2027-01-21" })?.sequence, 2);
  // A booking signed late: every date passed, still one at a time.
  assert.equal(nextInstallmentToBill({ schedule, invoices: [], today: "2027-05-01" })?.sequence, 1);
  // A refused or replaced bill is no bill: it is raised again.
  assert.equal(nextInstallmentToBill({ schedule, invoices: [invoice({ installmentSequence: 1, status: "failed" })], today: "2026-12-01" })?.sequence, 1);
  // A person pressed Send early.
  assert.equal(nextInstallmentToBill({ schedule, invoices: [], today: "2026-10-20", ignoreDate: true })?.sequence, 1);
});

test("once a final stands no installment is billed: it took in the rest", () => {
  const schedule = threeInstallments();
  const invoices = [invoice({ installmentSequence: 1, status: "paid", balanceCents: 0 }), { kind: "final", status: "sent", amountCents: 300_000, balanceCents: 300_000 }];
  assert.equal(nextInstallmentToBill({ schedule, invoices, today: "2027-04-01" }), null);
  // A superseded final doesn't.
  assert.equal(
    nextInstallmentToBill({
      schedule,
      invoices: [invoices[0]!, { kind: "final", status: "superseded", amountCents: 300_000, balanceCents: 300_000 }],
      today: "2027-04-01",
    })?.sequence,
    2,
  );
  // No plan, nothing to bill.
  assert.equal(nextInstallmentToBill({ schedule: [{ label: "Retainer" }, { label: "Final balance" }], invoices: [], today: "2027-04-01" }), null);
});

test("progress: 2 of 4 paid, and an installment taken in by the final is settled with it", () => {
  const schedule = threeInstallments();
  assert.equal(paymentPlanProgress([{ label: "Retainer" }, { label: "Final balance" }], []), null);
  const twoPaid = paymentPlanProgress(schedule, [
    { kind: "retainer", status: "paid", amountCents: 400_000, balanceCents: 0 },
    invoice({ installmentSequence: 1, status: "paid", balanceCents: 0 }),
    invoice({ installmentSequence: 2, status: "paid", balanceCents: 0 }),
  ]);
  assert.deepEqual(twoPaid && { payments: twoPaid.payments, paid: twoPaid.paid }, { payments: 4, paid: 2 });
  assert.equal(twoPaid?.next?.label, "Installment 3");
  assert.equal(twoPaid?.next?.billed, false);
  const allPaid = paymentPlanProgress(schedule, [
    invoice({ installmentSequence: 1, status: "paid", balanceCents: 0 }),
    { kind: "final", status: "paid", amountCents: 300_000, balanceCents: 0 },
  ]);
  assert.deepEqual(allPaid && { payments: allPaid.payments, paid: allPaid.paid, next: allPaid.next }, { payments: 4, paid: 4, next: null });
});
