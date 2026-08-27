/**
 * What to do when a studio says the retainer was paid another way.
 *
 * The photographer's case, and it is the common one: the couple pays by bank
 * transfer, or hands over a cheque, or taps a card reader at the consultation.
 * StudioCue has already raised a QuickBooks invoice, so the money exists in two
 * places and only one of them knows it arrived.
 *
 * This used to be refused outright — `RETAINER_INVOICE_ALREADY_EXISTS` — for a
 * good reason recorded at the throw site: attesting a payment *beside* an
 * invoice already out with the client would leave the same retainer with two
 * records and no way to tell which was real. The refusal protected the books and
 * stranded the studio, because the *only* path onward was a QuickBooks webhook
 * that is never coming for money that never went through QuickBooks.
 *
 * The resolution is not to permit a second record. It is to settle the one that
 * exists: the invoice out with the client becomes the paid invoice, marked as
 * vouched for by a person rather than confirmed by the provider. One retainer,
 * one record, one answer — and `completionAuthority` still says which kind of
 * evidence closed it.
 *
 * Pure function, no I/O.
 */

export type RetainerInvoiceRow = {
  id: string;
  status: string;
  balanceCents: number;
};

export type RetainerAttestationPlan =
  /** No invoice stands; write an attested one. */
  | { action: "create" }
  /** An invoice is out with the client; that is the record to settle. */
  | { action: "settle"; invoiceId: string }
  /**
   * Already settled. Not an error: a retried click, or two people recording
   * the same cheque, must not fail after the first one succeeded.
   */
  | { action: "already_paid"; invoiceId: string };

/** Statuses that mean an invoice no longer stands for anything. */
const NOT_STANDING = new Set(["failed", "superseded", "voided"]);

export function isStandingRetainer(status: unknown): boolean {
  return !NOT_STANDING.has(String(status));
}

const settled = (invoice: RetainerInvoiceRow): boolean =>
  invoice.status === "paid" && Number(invoice.balanceCents ?? 0) === 0;

export function planRetainerAttestation(
  invoices: readonly RetainerInvoiceRow[],
): RetainerAttestationPlan {
  const standing = invoices.filter((invoice) => isStandingRetainer(invoice.status));
  // Deliberately checked before "settle": if any standing invoice is already
  // paid, the money is in and nothing further should be written.
  const paid = standing.find(settled);
  if (paid) return { action: "already_paid", invoiceId: paid.id };
  const outstanding = standing[0];
  if (outstanding) return { action: "settle", invoiceId: outstanding.id };
  return { action: "create" };
}
