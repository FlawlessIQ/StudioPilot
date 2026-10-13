import {
  installmentName,
  nextInstallmentToBill,
  paymentPlanProgress,
  planInvoiceStands,
  scheduleInstallments,
  type InstallmentDue,
} from "@/features/billing/payment-plan";

/**
 * A job's payment plan as the studio's screens read it — the journey's
 * payment step ("2 of 4 paid"), Today's installment card and the client's
 * schedule — from the accepted proposal and the job's invoices
 * (features/billing/payment-plan.ts holds the rules). Display only; the
 * server decides every bill again.
 */

type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The proposal the couple accepted: the newest accepted version. */
export function acceptedProposalFor(proposals: readonly Row[] | null | undefined, projectId: string): Row | null {
  return (
    (proposals ?? [])
      .filter((proposal) => proposal.projectId === projectId && proposal.status === "accepted")
      .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] ?? null
  );
}

export type JourneyPaymentPlan = {
  payments: number;
  paid: number;
  next: { label: string; amountCents: number; dueDate: string | null; billed: boolean } | null;
  /** An installment's bill is due to go out and nothing has billed it. */
  billNow: InstallmentDue | null;
  /** An installment is still to be billed, now or later: the final balance waits for it. */
  installmentsPending: boolean;
  /** An installment or the final balance is past its date, unpaid. */
  overdue: boolean;
};

/** The journey's view of a job's plan, or null for a job without one. */
export function journeyPaymentPlan(input: {
  projectId: string;
  proposals: readonly Row[] | null | undefined;
  invoices: readonly Row[] | null | undefined;
  today: string;
}): JourneyPaymentPlan | null {
  const accepted = acceptedProposalFor(input.proposals, input.projectId);
  const schedule = accepted?.paymentSchedule;
  if (!scheduleInstallments(schedule).length) return null;
  const invoices = (input.invoices ?? []).filter((invoice) => invoice.projectId === input.projectId);
  const progress = paymentPlanProgress(schedule, invoices);
  if (!progress) return null;
  const overdue = invoices.some((invoice) => {
    const kind = text(invoice.kind);
    if ((kind !== "installment" && kind !== "final") || !planInvoiceStands(invoice)) return false;
    if (!(Number(invoice.balanceCents ?? 0) > 0)) return false;
    if (invoice.status === "overdue") return true;
    const due = text(invoice.dueDate).slice(0, 10);
    return Boolean(due) && due < input.today && !["draft", "review_required", "queued"].includes(text(invoice.status));
  });
  return {
    payments: progress.payments,
    paid: progress.paid,
    next: progress.next,
    billNow: nextInstallmentToBill({ schedule, invoices, today: input.today }),
    installmentsPending: nextInstallmentToBill({ schedule, invoices, today: input.today, ignoreDate: true }) !== null,
    overdue,
  };
}

export type PlanScheduleRow = {
  label: string;
  amountCents: number;
  dueDate: string | null;
  /** "in_final": never billed on its own, the final balance took it in. */
  state: "paid" | "billed" | "upcoming" | "in_final";
};

/**
 * Every payment on the plan for the client's page: the deposit, each
 * installment and the final balance, each paid, billed (out with them) or
 * still to come. `depositWord` is the trade's ("Retainer" / "Deposit").
 */
export function paymentPlanRows(input: {
  schedule: unknown;
  invoices: readonly Row[];
  depositWord: string;
}): PlanScheduleRow[] {
  const installments = scheduleInstallments(input.schedule);
  if (!installments.length || !Array.isArray(input.schedule)) return [];
  const standing = input.invoices.filter(planInvoiceStands);
  const paidOff = (invoice: Row | undefined) =>
    Boolean(invoice) && Number(invoice!.amountCents ?? 0) > 0 && Number(invoice!.balanceCents ?? 0) <= 0;
  const stateOf = (invoice: Row | undefined): PlanScheduleRow["state"] =>
    !invoice ? "upcoming" : paidOff(invoice) || invoice.status === "paid" ? "paid" : "billed";
  const retainer = standing.find((invoice) => invoice.kind === "retainer");
  const final = standing.find((invoice) => invoice.kind === "final");
  const count = installments.length;
  return (input.schedule as Row[]).map((line): PlanScheduleRow => {
    const amountCents = Math.max(0, Math.round(Number(line.amountCents ?? 0)));
    const dueDate = text(line.dueDate).slice(0, 10) || null;
    const kind = text(line.kind) || (line.label === "Retainer" ? "retainer" : /^Installment \d+$/.test(text(line.label)) ? "installment" : "final");
    if (kind === "retainer") return { label: input.depositWord, amountCents, dueDate, state: stateOf(retainer) };
    if (kind === "installment") {
      const sequence = Number(line.sequence) || Number(/(\d+)$/.exec(text(line.label))?.[1] ?? 1);
      const bill = standing.find((invoice) => invoice.kind === "installment" && Number(invoice.installmentSequence) === sequence);
      // Taken in by the final balance when one stands and this was never billed.
      return {
        label: installmentName(sequence, count),
        amountCents: bill ? Number(bill.amountCents ?? amountCents) : amountCents,
        dueDate,
        state: bill ? stateOf(bill) : final ? "in_final" : "upcoming",
      };
    }
    return {
      label: "Final balance",
      amountCents: final ? Math.max(0, Math.round(Number(final.amountCents ?? amountCents))) : amountCents,
      dueDate: final ? text(final.dueDate).slice(0, 10) || dueDate : dueDate,
      state: stateOf(final),
    };
  });
}
