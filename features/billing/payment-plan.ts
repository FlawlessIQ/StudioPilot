/**
 * Payment plans: a deposit, then installments, then the final balance
 * (docs/planner-journey-plan.md, N9 / Phase 4).
 *
 * A wedding planner takes about half to book and the rest in three or four
 * installments, paid in full a month before; DJs and photographers are asked
 * for plans too. Before this, StudioCue billed two payments only: the deposit
 * (retainer) and the final balance. A plan adds up to six installments
 * between them. Everything else about billing stays as it was:
 *
 * - The plan is the accepted proposal's `paymentSchedule`, as it always was:
 *   "Retainer", "Installment 1" … "Installment N", "Final balance". The two
 *   end lines keep their labels, so every reader that finds the retainer or
 *   the balance by label still finds them; each line also says what it is
 *   (`kind`, and `sequence` for an installment).
 * - Off unless a studio turns it on, on a package (`paymentPlan`) or on one
 *   proposal. A schedule with no installment lines is today's schedule.
 * - Each installment becomes its own invoice (`kind: "installment"`,
 *   `installmentSequence`), raised `INSTALLMENT_BILL_LEAD_DAYS` before it
 *   falls due by the same daily run, through the same paths (QuickBooks,
 *   Stripe, or the studio's own invoice), and chased by the same reminders.
 * - The final balance is what is left: the agreed total, less the deposit
 *   paid, less every installment billed (paid or not; each is owed on its own
 *   bill), less earlier balance payments. So a final raised early — by a
 *   person, or because an installment could not be billed — takes in every
 *   installment not yet billed, and once a final stands no installment is
 *   raised again. Nothing is ever billed twice.
 *
 * The rules, decided here and tested in tests/payment-plan.test.ts:
 *
 * - **Spacing.** By default the installments are spread evenly, by day,
 *   between booking (the deposit's due date, or today) and the final
 *   balance's due date: N installments and the final make N + 1 equal gaps.
 * - **Rounding.** What is left after the deposit is split evenly in whole
 *   cents over the installments and the final; the remainder goes on the
 *   last line, the final balance.
 * - **Short lead time.** Two payments are never closer than
 *   `MIN_INSTALLMENT_GAP_DAYS` (two weeks, the time a bill is out before it
 *   falls due — so no more than one installment bill is ever waiting). A
 *   booking too close to the event keeps only the installments that fit:
 *   floor(days / 14) − 1 of them. When none fit the plan collapses to the
 *   deposit and the final balance, exactly the schedule without a plan.
 * - **A studio's own lines.** Edited per proposal before it is sent: each
 *   date after the deposit's, in order, none after the final balance's; each
 *   amount whole cents above zero; together no more than what is left after
 *   the deposit, the final balance taking the rest. A blank amount shares
 *   what is left evenly with the final.
 * - **Changes after signing** (an amendment, a package change): a line with
 *   any payment on it stays as billed; the rest of the new total, after the
 *   deposit, is spread evenly again over the installments not yet paid and
 *   the final balance, on their dates. An unpaid line now due after the
 *   final balance is folded into it. An unpaid bill whose amount moved is
 *   superseded and raised again at the new figure, as a final is.
 *
 * functions/src/billing/payment-plan.ts is a copy of everything below the
 * marker; tests/payment-plan.test.ts fails on a drift.
 */

// --- shared with functions/src/billing/payment-plan.ts ---

/** The most installments a plan carries, between the deposit and the final balance. */
export const MAX_INSTALLMENTS = 6;

/**
 * The closest two payments may fall. A bill goes out
 * `INSTALLMENT_BILL_LEAD_DAYS` before its date, so with this gap no more than
 * one installment is ever billed and waiting.
 */
export const MIN_INSTALLMENT_GAP_DAYS = 14;

/**
 * Days before an installment falls due that its bill is raised: the final
 * balance's lead (operations/invoice-scheduler.ts `FINAL_BILL_LEAD_DAYS`).
 */
export const INSTALLMENT_BILL_LEAD_DAYS = 14;

export type PlanLineKind = "retainer" | "installment" | "final";

export type PlanLine = {
  label: string;
  amountCents: number;
  dueDate: string | null;
  kind: PlanLineKind;
  /** Installments only: 1, 2, 3 … in date order. */
  sequence?: number;
};

/** One installment as a studio sets it: a date, and an amount or blank for an even share. */
export type PlanInstallmentInput = { dueDate: string | null; amountCents?: number | null };

export type PlanError =
  | "PAYMENT_PLAN_TOO_MANY_INSTALLMENTS"
  | "PAYMENT_PLAN_DATE_REQUIRED"
  | "PAYMENT_PLAN_BALANCE_DATE_REQUIRED"
  | "PAYMENT_PLAN_DATE_BEFORE_DEPOSIT"
  | "PAYMENT_PLAN_DATES_OUT_OF_ORDER"
  | "PAYMENT_PLAN_AFTER_FINAL"
  | "PAYMENT_PLAN_AMOUNT_INVALID"
  | "PAYMENT_PLAN_EXCEEDS_TOTAL";

export type PlanResult =
  | {
      ok: true;
      lines: PlanLine[];
      /** Installments on the schedule (0: deposit and final balance only). */
      installments: number;
      /** Asked for more than fit before the final balance (the short-lead-time rule). */
      collapsed: boolean;
    }
  | { ok: false; error: PlanError };

const RETAINER_LABEL = "Retainer";
const FINAL_LABEL = "Final balance";
/** Lines a proposal took to book, or the closing balance, as older schedules label them. */
const RETAINER_LABELS = ["Retainer", "Payment in full"];
const FINAL_LABELS = ["Final balance", "Balance", "Final payment", "Payment on the day", "Invoice after the event"];
const INSTALLMENT_LABEL = /^Installment (\d+)$/;

/** Bills nobody owes: replaced, refused, voided or called off. */
const NOT_STANDING = ["superseded", "failed", "voided", "void", "cancelled"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const whole = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

/** "2027-06-12", or null for anything else. */
export function planDay(value: unknown): string | null {
  const day = typeof value === "string" ? value.slice(0, 10) : "";
  if (!ISO_DAY.test(day)) return null;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  // A real day: "2027-02-30" parses, as March 2.
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day ? day : null;
}

/** A calendar day moved by whole days. */
export function shiftPlanDay(day: string, days: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Math.round(days));
  return value.toISOString().slice(0, 10);
}

/** Whole days from one calendar day to another. */
export function daysBetweenPlanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Installment 2". */
export function installmentLabel(sequence: number): string {
  return `Installment ${Math.max(1, Math.round(sequence))}`;
}

/** "Installment 2 of 3" — on the bill, the email and the portal. */
export function installmentName(sequence: number, count?: number | null): string {
  const of = Number(count);
  return Number.isInteger(of) && of >= sequence && of > 1
    ? `${installmentLabel(sequence)} of ${of}`
    : installmentLabel(sequence);
}

/**
 * A package's plan setting (`packages.paymentPlan`, copied to its snapshot):
 * how many installments its proposals start with. Null is off — the default
 * for every package, so a studio that never turns a plan on sees nothing new.
 */
export function packagePaymentPlan(value: unknown): { installments: number } | null {
  const installments = whole(record(value).installments);
  return installments >= 1 ? { installments: Math.min(MAX_INSTALLMENTS, installments) } : null;
}

/** What a schedule line is: its own `kind` when it has one, else its label (lines written before plans). */
export function scheduleLineKind(line: unknown): PlanLineKind | "other" {
  const entry = record(line);
  if (entry.kind === "retainer" || entry.kind === "installment" || entry.kind === "final") return entry.kind;
  const label = typeof entry.label === "string" ? entry.label : "";
  if (RETAINER_LABELS.includes(label)) return "retainer";
  if (INSTALLMENT_LABEL.test(label)) return "installment";
  if (FINAL_LABELS.includes(label)) return "final";
  return "other";
}

export type ScheduledInstallment = { sequence: number; amountCents: number; dueDate: string | null };

/** The installment lines of a schedule, in order. None on a schedule without a plan. */
export function scheduleInstallments(schedule: unknown): ScheduledInstallment[] {
  if (!Array.isArray(schedule)) return [];
  return schedule
    .filter((line) => scheduleLineKind(line) === "installment")
    .map((line, index) => {
      const entry = record(line);
      const fromLabel = INSTALLMENT_LABEL.exec(typeof entry.label === "string" ? entry.label : "");
      const sequence = whole(entry.sequence) || (fromLabel ? Number(fromLabel[1]) : index + 1);
      return { sequence, amountCents: Math.max(0, whole(entry.amountCents)), dueDate: planDay(entry.dueDate) };
    });
}

/** Whether a schedule carries a payment plan. */
export function hasPaymentPlan(schedule: unknown): boolean {
  return scheduleInstallments(schedule).length > 0;
}

/**
 * The closing line: the one marked or labelled the final balance, else the
 * last line. Never found by position alone — with a plan, the second line is
 * the first installment, not the balance.
 */
export function finalScheduleLine(schedule: unknown): { amountCents: number; dueDate: string | null } | null {
  if (!Array.isArray(schedule) || !schedule.length) return null;
  const line = schedule.find((entry) => scheduleLineKind(entry) === "final") ?? (schedule.length > 1 ? schedule[schedule.length - 1] : null);
  if (!line) return null;
  const entry = record(line);
  return { amountCents: Math.max(0, whole(entry.amountCents)), dueDate: planDay(entry.dueDate) };
}

/**
 * Split an amount into `parts` whole-cent shares, evenly, with the remainder
 * on the last share. Never a negative share.
 */
export function splitEvenly(totalCents: number, parts: number): number[] {
  const count = Math.max(1, Math.round(parts));
  const total = Math.max(0, Math.round(totalCents));
  const share = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? total - share * (count - 1) : share));
}

/**
 * How many installments fit between booking and the final balance's due
 * date, two weeks apart at the least, of the `requested` (the short-lead-time
 * rule): floor(days / MIN_INSTALLMENT_GAP_DAYS) − 1, never below nought.
 */
export function installmentsThatFit(startDay: string, finalDueDay: string, requested: number): number {
  const span = daysBetweenPlanDays(startDay, finalDueDay);
  const fit = Math.floor(span / MIN_INSTALLMENT_GAP_DAYS) - 1;
  return Math.max(0, Math.min(Math.round(requested), MAX_INSTALLMENTS, fit));
}

/** `count` dates spread evenly between two days: N dates make N + 1 equal gaps. */
export function evenInstallmentDates(startDay: string, finalDueDay: string, count: number): string[] {
  const span = daysBetweenPlanDays(startDay, finalDueDay);
  return Array.from({ length: Math.max(0, Math.round(count)) }, (_, index) =>
    shiftPlanDay(startDay, Math.round((span * (index + 1)) / (count + 1))),
  );
}

/** The deposit and the final balance alone: the schedule without a plan. */
function twoLines(input: {
  remainingCents: number;
  retainerCents: number;
  retainerDueDate: string | null;
  finalDueDate: string | null;
}): PlanLine[] {
  return [
    { label: RETAINER_LABEL, amountCents: input.retainerCents, dueDate: input.retainerDueDate, kind: "retainer" },
    { label: FINAL_LABEL, amountCents: input.remainingCents, dueDate: input.finalDueDate, kind: "final" },
  ];
}

/**
 * A deposit job's payment lines, with a plan or without.
 *
 * `installments` is a count (a package's default: dates and amounts are
 * worked out here, short lead time included) or a studio's own lines (dates
 * kept as given and checked; blank amounts share what is left). With no
 * installments it is exactly the two lines a deposit job always had.
 */
export function paymentPlanSchedule(input: {
  totalCents: number;
  retainerCents: number;
  retainerDueDate: string | null;
  finalDueDate: string | null;
  /** The day the schedule is worked out: the start of the spacing when the deposit has no date. */
  today: string;
  installments: number | readonly PlanInstallmentInput[];
}): PlanResult {
  const total = Math.max(0, whole(input.totalCents));
  const retainerCents = Math.min(Math.max(0, whole(input.retainerCents)), total);
  const remaining = total - retainerCents;
  const retainerDueDate = planDay(input.retainerDueDate);
  const finalDueDate = planDay(input.finalDueDate);
  const base = { remainingCents: remaining, retainerCents, retainerDueDate, finalDueDate };

  if (typeof input.installments === "number") {
    const requested = Math.max(0, Math.round(input.installments));
    if (requested === 0) return { ok: true, lines: twoLines(base), installments: 0, collapsed: false };
    const today = planDay(input.today) ?? "1970-01-01";
    const start = retainerDueDate && retainerDueDate > today ? retainerDueDate : today;
    const count = finalDueDate && remaining > 0 ? installmentsThatFit(start, finalDueDate, requested) : 0;
    if (count === 0) return { ok: true, lines: twoLines(base), installments: 0, collapsed: true };
    const dates = evenInstallmentDates(start, finalDueDate!, count);
    const shares = splitEvenly(remaining, count + 1);
    return {
      ok: true,
      lines: [
        { label: RETAINER_LABEL, amountCents: retainerCents, dueDate: retainerDueDate, kind: "retainer" },
        ...dates.map(
          (dueDate, index): PlanLine => ({
            label: installmentLabel(index + 1),
            amountCents: shares[index]!,
            dueDate,
            kind: "installment",
            sequence: index + 1,
          }),
        ),
        { label: FINAL_LABEL, amountCents: shares[count]!, dueDate: finalDueDate, kind: "final" },
      ],
      installments: count,
      collapsed: count < Math.min(requested, MAX_INSTALLMENTS),
    };
  }

  const lines = input.installments;
  if (!lines.length) return { ok: true, lines: twoLines(base), installments: 0, collapsed: false };
  if (lines.length > MAX_INSTALLMENTS) return { ok: false, error: "PAYMENT_PLAN_TOO_MANY_INSTALLMENTS" };
  if (!finalDueDate) return { ok: false, error: "PAYMENT_PLAN_BALANCE_DATE_REQUIRED" };
  const dates: string[] = [];
  for (const line of lines) {
    const dueDate = planDay(line.dueDate);
    if (!dueDate) return { ok: false, error: "PAYMENT_PLAN_DATE_REQUIRED" };
    if (retainerDueDate && dueDate <= retainerDueDate) return { ok: false, error: "PAYMENT_PLAN_DATE_BEFORE_DEPOSIT" };
    if (dates.length && dueDate <= dates[dates.length - 1]!) return { ok: false, error: "PAYMENT_PLAN_DATES_OUT_OF_ORDER" };
    if (dueDate > finalDueDate) return { ok: false, error: "PAYMENT_PLAN_AFTER_FINAL" };
    dates.push(dueDate);
  }
  const given: Array<number | null> = [];
  for (const line of lines) {
    if (line.amountCents === null || line.amountCents === undefined) {
      given.push(null);
      continue;
    }
    const amount = Number(line.amountCents);
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: "PAYMENT_PLAN_AMOUNT_INVALID" };
    given.push(amount);
  }
  const fixed = given.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  if (fixed > remaining) return { ok: false, error: "PAYMENT_PLAN_EXCEEDS_TOTAL" };
  const blanks = given.filter((amount) => amount === null).length;
  // Blank lines and the final balance share what the given amounts leave.
  const shares = splitEvenly(remaining - fixed, blanks + 1);
  let next = 0;
  const amounts = given.map((amount) => amount ?? shares[next++]!);
  if (amounts.some((amount) => amount <= 0)) return { ok: false, error: "PAYMENT_PLAN_EXCEEDS_TOTAL" };
  return {
    ok: true,
    lines: [
      { label: RETAINER_LABEL, amountCents: retainerCents, dueDate: retainerDueDate, kind: "retainer" },
      ...dates.map(
        (dueDate, index): PlanLine => ({
          label: installmentLabel(index + 1),
          amountCents: amounts[index]!,
          dueDate,
          kind: "installment",
          sequence: index + 1,
        }),
      ),
      { label: FINAL_LABEL, amountCents: shares[blanks]!, dueDate: finalDueDate, kind: "final" },
    ],
    installments: dates.length,
    collapsed: false,
  };
}

/**
 * The plan again after a change to a signed booking (amendment or package
 * change): the rule in the header. `paid` is each installment with money on
 * its bill — those lines stay at the amount billed. Returns null for a
 * schedule without a plan, so the caller writes the two lines it always did.
 */
export function respreadPaymentPlan(input: {
  schedule: unknown;
  totalCents: number;
  retainerCents: number;
  retainerDueDate: string | null;
  finalDueDate: string | null;
  paid: ReadonlyArray<{ sequence: number; amountCents: number }>;
}): PlanLine[] | null {
  const installments = scheduleInstallments(input.schedule);
  if (!installments.length) return null;
  const total = Math.max(0, whole(input.totalCents));
  const retainerCents = Math.min(Math.max(0, whole(input.retainerCents)), total);
  const finalDueDate = planDay(input.finalDueDate);
  const paid = new Map(input.paid.map((entry) => [whole(entry.sequence), Math.max(0, whole(entry.amountCents))]));
  const kept = installments.filter((line) => paid.has(line.sequence));
  // Unpaid lines keep their dates; one now due after the balance is folded into it.
  const open = installments.filter(
    (line) => !paid.has(line.sequence) && !(finalDueDate && line.dueDate && line.dueDate > finalDueDate),
  );
  const keptCents = kept.reduce((sum, line) => sum + paid.get(line.sequence)!, 0);
  const remaining = total - retainerCents - keptCents;
  const spread = remaining > 0 ? open : [];
  const shares = splitEvenly(Math.max(0, remaining), spread.length + 1);
  const amountOf = new Map<number, number>([
    ...kept.map((line): [number, number] => [line.sequence, paid.get(line.sequence)!]),
    ...spread.map((line, index): [number, number] => [line.sequence, shares[index]!]),
  ]);
  return [
    { label: RETAINER_LABEL, amountCents: retainerCents, dueDate: planDay(input.retainerDueDate), kind: "retainer" },
    ...installments
      .filter((line) => amountOf.has(line.sequence))
      .map(
        (line): PlanLine => ({
          label: installmentLabel(line.sequence),
          amountCents: amountOf.get(line.sequence)!,
          dueDate: line.dueDate,
          kind: "installment",
          sequence: line.sequence,
        }),
      ),
    { label: FINAL_LABEL, amountCents: shares[spread.length]!, dueDate: finalDueDate, kind: "final" },
  ];
}

// ── Invoices ───────────────────────────────────────────────────────────────

/** An `invoiceReferences` record, as stored: kind, status, amountCents, balanceCents, installmentSequence. */
export type PlanInvoice = Readonly<Record<string, unknown>>;

/** A bill somebody still owes or has paid: not replaced, refused, voided or called off. */
export function planInvoiceStands(invoice: PlanInvoice): boolean {
  return !NOT_STANDING.includes(String(invoice.status ?? ""));
}

const paidOn = (invoice: PlanInvoice) => {
  const amount = Math.max(0, whole(invoice.amountCents));
  const balance = invoice.balanceCents === undefined || invoice.balanceCents === null ? amount : Math.max(0, whole(invoice.balanceCents));
  return Math.max(0, amount - balance);
};

/** The standing installment bills, by sequence. */
function standingInstallments(invoices: readonly PlanInvoice[]): PlanInvoice[] {
  return invoices.filter((invoice) => invoice.kind === "installment" && planInvoiceStands(invoice));
}

/** Everything billed on standing installment bills, paid or not: each is owed on its own bill. */
export function installmentsBilledCents(invoices: readonly PlanInvoice[]): number {
  return standingInstallments(invoices).reduce((sum, invoice) => sum + Math.max(0, whole(invoice.amountCents)), 0);
}

/** What is still owed on standing installment bills. */
export function installmentsOutstandingCents(invoices: readonly PlanInvoice[]): number {
  return standingInstallments(invoices).reduce((sum, invoice) => {
    const amount = Math.max(0, whole(invoice.amountCents));
    return sum + (amount - paidOn(invoice));
  }, 0);
}

/**
 * The final balance's status as readiness reads it ("Final balance paid"): a
 * paid final with an installment still owed on its own bill is only part of
 * the balance paid. Any other status passes through.
 */
export function finalStatusWithInstallments<T extends string | null | undefined>(
  status: T,
  invoices: readonly PlanInvoice[],
): T | "partially_paid" {
  return status === "paid" && installmentsOutstandingCents(invoices) > 0 ? "partially_paid" : status;
}

/** Each installment with money on its bill — the lines a change keeps (`respreadPaymentPlan`). */
export function paidInstallments(invoices: readonly PlanInvoice[]): Array<{ sequence: number; amountCents: number }> {
  return standingInstallments(invoices)
    .filter((invoice) => paidOn(invoice) > 0 && whole(invoice.installmentSequence) > 0)
    .map((invoice) => ({ sequence: whole(invoice.installmentSequence), amountCents: Math.max(0, whole(invoice.amountCents)) }));
}

/**
 * The final balance on a plan as it stands: the closing line, plus every
 * installment not yet billed — a final takes them in. What "the balance,
 * paid another way" records. Null on a schedule without a plan.
 */
export function finalBalanceOnPlan(schedule: unknown, invoices: readonly PlanInvoice[]): number | null {
  const installments = scheduleInstallments(schedule);
  const closing = finalScheduleLine(schedule);
  if (!installments.length || !closing) return null;
  const billed = new Set(standingInstallments(invoices).map((invoice) => whole(invoice.installmentSequence)));
  return installments
    .filter((line) => !billed.has(line.sequence))
    .reduce((sum, line) => sum + line.amountCents, closing.amountCents);
}

/** Whether a final bill stands: once one does, it has taken in every installment not yet billed. */
function finalStands(invoices: readonly PlanInvoice[]): boolean {
  return invoices.some((invoice) => invoice.kind === "final" && planInvoiceStands(invoice));
}

export type InstallmentDue = {
  sequence: number;
  /** Installments on the plan, for "Installment 2 of 3". */
  count: number;
  amountCents: number;
  /** The agreed date. */
  dueDate: string;
  /** The day its bill goes out: `INSTALLMENT_BILL_LEAD_DAYS` before. */
  billOn: string;
};

/**
 * The next installment to bill, if its day has come: the earliest one with
 * no standing bill, once it is `INSTALLMENT_BILL_LEAD_DAYS` or fewer from its
 * date. One at a time, in order, so a late booking whose first dates have
 * passed is billed one installment a day, never all at once. Null when a
 * final stands (it took in the rest), when every installment is billed, or
 * when the next one's day has not come.
 */
export function nextInstallmentToBill(input: {
  schedule: unknown;
  invoices: readonly PlanInvoice[];
  today: string;
  /** Bill it now, whatever the date: a person pressed Send. */
  ignoreDate?: boolean;
}): InstallmentDue | null {
  const installments = scheduleInstallments(input.schedule);
  if (!installments.length || finalStands(input.invoices)) return null;
  const billed = new Set(standingInstallments(input.invoices).map((invoice) => whole(invoice.installmentSequence)));
  const next = installments.find((line) => !billed.has(line.sequence) && line.amountCents > 0);
  if (!next || !next.dueDate) return null;
  const billOn = shiftPlanDay(next.dueDate, -INSTALLMENT_BILL_LEAD_DAYS);
  if (!input.ignoreDate && billOn > input.today) return null;
  return { sequence: next.sequence, count: installments.length, amountCents: next.amountCents, dueDate: next.dueDate, billOn };
}

export type PlanProgress = {
  /** Installments and the final balance: the payments after booking. */
  payments: number;
  paid: number;
  /** The next one not yet paid, if any. */
  next: { label: string; amountCents: number; dueDate: string | null; billed: boolean } | null;
};

/**
 * "2 of 4 paid": the payments after booking (each installment and the final
 * balance) and how many are settled. An installment the final balance took
 * in is settled when the final is. Null on a schedule without a plan.
 */
export function paymentPlanProgress(schedule: unknown, invoices: readonly PlanInvoice[]): PlanProgress | null {
  const installments = scheduleInstallments(schedule);
  if (!installments.length) return null;
  const standing = standingInstallments(invoices);
  const final = invoices.find((invoice) => invoice.kind === "final" && planInvoiceStands(invoice));
  const finalPaid = Boolean(final && whole(final.amountCents) > 0 && paidOn(final) >= whole(final.amountCents));
  const settledFinal = invoices.some((invoice) => invoice.kind === "final" && invoice.status === "paid");
  const finalSettled = finalPaid || settledFinal;
  const rows = installments.map((line) => {
    const bill = standing.find((invoice) => whole(invoice.installmentSequence) === line.sequence);
    const paid = bill
      ? whole(bill.amountCents) > 0 && paidOn(bill) >= whole(bill.amountCents)
      : // Taken in by the final balance.
        Boolean(final) && finalSettled;
    return { label: installmentLabel(line.sequence), amountCents: line.amountCents, dueDate: line.dueDate, billed: Boolean(bill) || Boolean(final), paid };
  });
  const closing = finalScheduleLine(schedule);
  rows.push({
    label: FINAL_LABEL,
    amountCents: final ? Math.max(0, whole(final.amountCents)) : (closing?.amountCents ?? 0),
    dueDate: closing?.dueDate ?? null,
    billed: Boolean(final),
    paid: finalSettled || (!final && (closing?.amountCents ?? 0) === 0 && rows.every((row) => row.paid)),
  });
  const next = rows.find((row) => !row.paid) ?? null;
  return {
    payments: rows.length,
    paid: rows.filter((row) => row.paid).length,
    next: next ? { label: next.label, amountCents: next.amountCents, dueDate: next.dueDate, billed: next.billed } : null,
  };
}
