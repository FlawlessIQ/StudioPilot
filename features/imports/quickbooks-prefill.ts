import type { ExistingBooking } from "./existing-booking";

/**
 * What QuickBooks shows a client has paid, laid onto a booking being imported.
 *
 * A studio that billed through QuickBooks already has the payment history, and
 * typing it back in from a spreadsheet is exactly where a wrong amount gets
 * imported as fact. So the payments come from QuickBooks instead — but only as
 * a prefill the studio reviews, with the one caveat that matters said every
 * time: QuickBooks keeps a client's history across every job they ever booked,
 * so a returning client's payments may not all be for this wedding. If they
 * add up to more than the contract, the import's own check stops it.
 */

export type QuickBooksClientHistory = {
  email: string;
  customer: { id: string; name: string } | null;
  invoicedCents: number;
  openCents: number;
  invoiceCount: number;
  payments: Array<{ id: string; amountCents: number; paidOn: string }>;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** The QuickBooks customer for any of these emails, primary first. */
export function findQuickBooksHistory(
  emails: ReadonlyArray<string | null>,
  histories: readonly QuickBooksClientHistory[],
): QuickBooksClientHistory | null {
  const byEmail = new Map(histories.map((history) => [history.email.toLowerCase(), history]));
  return (
    emails
      .map((email) => (email ? byEmail.get(email.toLowerCase()) : undefined))
      .find((candidate) => candidate?.customer) ?? null
  );
}

/** What to tell the studio about a history, in words — the caveat always included. */
export function quickBooksPaymentNotes(history: QuickBooksClientHistory | null): string[] {
  if (!history?.customer)
    return ["No QuickBooks customer has this email, so what's been paid comes from what you entered."];
  if (history.payments.length === 0)
    return [
      `QuickBooks has ${history.customer.name} but no payments from them, so what's been paid comes from what you entered.`,
    ];
  const total = history.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const notes = [
    `${history.payments.length} payment${history.payments.length === 1 ? "" : "s"} from QuickBooks, ${money(total)} in all. QuickBooks keeps every job a client has booked, so check these are all for this wedding.`,
  ];
  if (history.invoiceCount > 1 && history.openCents > 0)
    notes.push(`QuickBooks also shows ${money(history.openCents)} still open across their invoices.`);
  return notes;
}

export function applyQuickBooksPayments(
  booking: ExistingBooking,
  histories: readonly QuickBooksClientHistory[],
): { booking: ExistingBooking; applied: boolean; notes: string[] } {
  const history = findQuickBooksHistory(
    booking.clients.map((client) => client.email),
    histories,
  );
  const notes = quickBooksPaymentNotes(history);
  if (!history?.customer || history.payments.length === 0)
    return { booking, applied: false, notes };
  return {
    applied: true,
    notes,
    booking: {
      ...booking,
      payments: history.payments.map((payment) => ({
        amountCents: payment.amountCents,
        paidOn: payment.paidOn,
        method: "QuickBooks payment",
      })),
    },
  };
}
