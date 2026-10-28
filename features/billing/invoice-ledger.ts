/**
 * The Invoices page as a ledger (own invoicing, Phase 4;
 * docs/own-invoicing-plan-2026-10-09.md): every bill on every job, whoever
 * raised it — an invoice the studio issued itself through StudioCue, one
 * raised in QuickBooks, or a payment recorded by hand with no bill behind it
 * — with what's outstanding, what's late and what hasn't gone out yet, and a
 * CSV the studio's bookkeeper can open.
 *
 * Pure: the page passes the records it already holds.
 */

import { installmentName } from "@/features/billing/payment-plan";
import { invoiceRecordsDeleted } from "@/features/billing/invoice-purge-policy";
import { journeyPaymentPlan } from "@/features/billing/payment-plan-view";
import { studioTaxRateFor } from "@/features/billing/job-billing-from-records";
import { balanceMayBeAttested } from "@/features/booking/agreed-final-balance";
import { balanceFallbackSnapshot, outstandingFinalBalance } from "@/features/booking/final-balance-due";

type Row = Readonly<Record<string, unknown>>;
type IdRow = Row & { id: string };

export type LedgerSource = "studio" | "quickbooks" | "stripe" | "recorded";

export type LedgerState = "draft" | "owed" | "overdue" | "paid" | "closed";

export type LedgerRow = {
  id: string;
  projectId: string;
  jobName: string;
  clientName: string;
  /** INV-0042, QuickBooks' own number, or "" when there is none. */
  number: string;
  kind: string;
  kindLabel: string;
  source: LedgerSource;
  sourceLabel: string;
  status: string;
  state: LedgerState;
  issuedOn: string | null;
  sentOn: string | null;
  dueDate: string | null;
  paidOn: string | null;
  amountCents: number;
  taxCents: number;
  paidCents: number;
  balanceCents: number;
  currency: string;
  /** The studio's own invoice PDF, when there is one. */
  pdfPath: string | null;
};

export type LedgerTotals = {
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  draftCents: number;
  draftCount: number;
  paidCents: number;
};

export type LedgerFilter = "all" | "owed" | "overdue" | "draft" | "paid";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const cents = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
};
const day = (value: unknown): string | null => {
  const raw = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

const CLOSED = new Set(["voided", "void", "superseded", "failed", "refunded", "cancelled"]);

/** Where a bill came from. */
export function ledgerSource(invoice: Row): LedgerSource {
  const provider = text(invoice.provider);
  if (provider === "quickbooks") return "quickbooks";
  if (provider === "stripe") return "stripe";
  return invoice.billedBy === "studio" ? "studio" : "recorded";
}

const SOURCE_LABEL: Record<LedgerSource, string> = {
  studio: "You",
  quickbooks: "QuickBooks",
  stripe: "Stripe",
  recorded: "Recorded by you",
};

function kindLabel(invoice: Row): string {
  if (invoice.paidInFull === true) return "Payment in full";
  const kind = text(invoice.kind);
  if (kind === "retainer") return "Deposit";
  // A payment plan's: "Installment 2 of 3" (features/billing/payment-plan.ts).
  if (kind === "installment") return installmentName(Number(invoice.installmentSequence) || 1, Number(invoice.installmentCount) || null);
  if (kind === "final") return "Final balance";
  if (kind === "adjustment") return "Booking change";
  return "Invoice";
}

/** Where a bill stands, in the ledger's words. */
export function ledgerState(invoice: Row, today: string): LedgerState {
  const status = text(invoice.status);
  if (CLOSED.has(status)) return "closed";
  const balance = cents(invoice.balanceCents);
  if (status === "paid" || (balance <= 0 && cents(invoice.amountCents) > 0)) return "paid";
  if (status === "draft" || status === "review_required" || status === "queued") return "draft";
  const due = day(invoice.dueDate);
  if (status === "overdue" || (due && due < today && balance > 0)) return "overdue";
  return "owed";
}

/** The date the last payment came in, from what the record says. */
function paidOn(invoice: Row): string | null {
  const payments = Array.isArray(invoice.studioPayments) ? (invoice.studioPayments as Row[]) : [];
  const last = payments.map((payment) => day(payment.paidAt)).filter((value): value is string => Boolean(value)).sort().pop();
  return last ?? day(invoice.paidAt) ?? day((invoice.completionEvidence as Row | undefined)?.paidAt) ?? null;
}

export function ledgerRows(input: {
  invoices: ReadonlyArray<Row> | null | undefined;
  projects: ReadonlyArray<Row> | null | undefined;
  contacts?: ReadonlyArray<Row> | null | undefined;
  today: string;
  projectId?: string | null;
}): LedgerRow[] {
  const projects = new Map((input.projects ?? []).map((project) => [text(project.id), project]));
  const contacts = new Map((input.contacts ?? []).map((contact) => [text(contact.id), contact]));
  return (input.invoices ?? [])
    .filter((invoice) => !input.projectId || text(invoice.projectId) === input.projectId)
    .map((invoice): LedgerRow => {
      const project = projects.get(text(invoice.projectId));
      const contactId = Array.isArray(project?.clientContactIds) ? text((project?.clientContactIds as unknown[])[0]) : "";
      const contact = contactId ? contacts.get(contactId) : undefined;
      const source = ledgerSource(invoice);
      const amountCents = cents(invoice.amountCents);
      const balanceCents = Math.max(0, cents(invoice.balanceCents));
      return {
        id: text(invoice.id),
        projectId: text(invoice.projectId),
        jobName: text(project?.name) || "A job",
        clientName: text(contact?.displayName) || text(project?.clientName) || "",
        number: text(invoice.number) || text(invoice.providerDocNumber),
        kind: text(invoice.kind),
        kindLabel: kindLabel(invoice),
        source,
        sourceLabel: SOURCE_LABEL[source],
        status: text(invoice.status),
        state: ledgerState(invoice, input.today),
        issuedOn: day(invoice.issuedAt) ?? day(invoice.createdAt),
        sentOn: day(invoice.sentAt),
        dueDate: day(invoice.dueDate),
        paidOn: paidOn(invoice),
        amountCents,
        taxCents: Math.max(0, cents(invoice.taxCents)),
        paidCents: Math.max(0, amountCents - balanceCents),
        balanceCents,
        currency: text(invoice.currency) || "USD",
        pdfPath: text((invoice.pdf as Row | undefined)?.path) || null,
      };
    })
    .sort(
      (left, right) =>
        (right.issuedOn ?? "").localeCompare(left.issuedOn ?? "") || right.number.localeCompare(left.number),
    );
}

export function ledgerTotals(rows: readonly LedgerRow[]): LedgerTotals {
  const totals: LedgerTotals = {
    outstandingCents: 0,
    overdueCents: 0,
    overdueCount: 0,
    draftCents: 0,
    draftCount: 0,
    paidCents: 0,
  };
  for (const row of rows) {
    if (row.state === "closed") continue;
    totals.paidCents += row.paidCents;
    if (row.state === "owed" || row.state === "overdue") totals.outstandingCents += row.balanceCents;
    if (row.state === "overdue") {
      totals.overdueCents += row.balanceCents;
      totals.overdueCount += 1;
    }
    if (row.state === "draft") {
      totals.draftCents += row.balanceCents;
      totals.draftCount += 1;
    }
  }
  return totals;
}

export function filterLedger(rows: readonly LedgerRow[], filter: LedgerFilter): LedgerRow[] {
  if (filter === "all") return rows.filter((row) => row.state !== "closed");
  if (filter === "owed") return rows.filter((row) => row.state === "owed" || row.state === "overdue");
  return rows.filter((row) => row.state === filter);
}

const STATE_LABEL: Record<LedgerState, string> = {
  draft: "Not sent",
  owed: "Owed",
  overdue: "Overdue",
  paid: "Paid",
  closed: "Closed",
};

export function ledgerStateLabel(state: LedgerState): string {
  return STATE_LABEL[state];
}

/** 123456 → "1234.56": what a spreadsheet reads as a number. */
const decimal = (value: number) => (value / 100).toFixed(2);

function csvCell(value: string): string {
  // A cell a spreadsheet would run as a formula is written as text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The ledger as CSV for the studio's bookkeeper: one line per bill, amounts
 * in dollars as plain numbers, dates as YYYY-MM-DD.
 */
export function ledgerCsv(rows: readonly LedgerRow[]): string {
  const header = [
    "Invoice number",
    "Job",
    "Client",
    "Bill",
    "Billed through",
    "Status",
    "Issued",
    "Sent",
    "Due",
    "Paid on",
    "Currency",
    "Amount",
    "Tax",
    "Paid",
    "Balance",
  ];
  const lines = rows.map((row) =>
    [
      row.number,
      row.jobName,
      row.clientName,
      row.kindLabel,
      row.sourceLabel,
      STATE_LABEL[row.state],
      row.issuedOn ?? "",
      row.sentOn ?? "",
      row.dueDate ?? "",
      row.paidOn ?? "",
      row.currency,
      decimal(row.amountCents),
      decimal(row.taxCents),
      decimal(row.paidCents),
      decimal(row.balanceCents),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/**
 * Final balances that are due and that nothing has billed: not invoices, so
 * not in the totals above. An imported wedding 11 days out had $2,700 to pay
 * and no bill, and the ledger read $0 outstanding, $0 overdue, $0 not sent
 * (imported-job walk, 2026-10-27). Due from four weeks before the day, when
 * the scheduler raises a booking's own; the same arithmetic as the job's
 * "final balance hasn't been billed" card (final-invoice-reconciliation.tsx).
 */
export function unbilledFinalBalances(input: {
  projects: readonly IdRow[] | null | undefined;
  proposals: readonly IdRow[] | null | undefined;
  invoices: readonly IdRow[] | null | undefined;
  packageSnapshots: readonly IdRow[] | null | undefined;
  billingSettings: readonly IdRow[] | null | undefined;
  connections: readonly IdRow[] | null | undefined;
  today: string;
  projectId: string | null;
}): { cents: number; count: number } {
  const inFour = new Date(Date.parse(`${input.today}T12:00:00Z`) + 28 * 86_400_000).toISOString().slice(0, 10);
  let cents = 0;
  let count = 0;
  for (const project of input.projects ?? []) {
    const projectId = String(project.id ?? "");
    if (!projectId || (input.projectId && projectId !== input.projectId)) continue;
    if (project.archivedAt || project.clientAutomationsPausedAt || !balanceMayBeAttested(String(project.state ?? ""))) continue;
    const eventDate = typeof project.eventDate === "string" ? project.eventDate.slice(0, 10) : "";
    if (!eventDate || eventDate > inFour) continue;
    const plan = journeyPaymentPlan({ projectId, proposals: input.proposals, invoices: input.invoices, today: input.today });
    if (plan?.installmentsPending) continue;
    const due = outstandingFinalBalance({
      projectId,
      proposals: input.proposals,
      invoices: input.invoices,
      studioTaxBasisPoints: studioTaxRateFor({
        projectId,
        project,
        connections: input.connections,
        invoices: input.invoices,
        billingSettings: (input.billingSettings ?? []).find((record) => record.tenantId === project.tenantId) ?? null,
      }),
      recordsDeleted: invoiceRecordsDeleted(project),
      packageSnapshot: balanceFallbackSnapshot(project, input.packageSnapshots),
    });
    if (!due.cents || due.finalStanding) continue;
    cents += due.cents;
    count += 1;
  }
  return { cents, count };
}
