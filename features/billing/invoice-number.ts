/**
 * Invoice numbers for the invoices StudioCue issues when a studio bills a
 * job itself: INV-0001, INV-0002, … per studio.
 *
 * Allocated in the same transaction that writes the invoice, from the
 * counter `invoiceCounters/{tenantId}` (functions/src/billing/invoice-number.ts).
 * A number is never reused — not after a void, and not after the studio
 * deletes the record — so a gap in the sequence always means "deleted",
 * never "issued twice".
 *
 * functions/src/billing/invoice-number.ts carries a copy of everything below
 * the marker; tests/studio-invoice-settings.test.ts fails on a drift.
 */

// --- shared with functions/src/billing/invoice-number.ts ---
export const INVOICE_NUMBER_PREFIX = "INV-";

/** 42 to "INV-0042". Padded to four digits, never truncated. */
export function formatInvoiceNumber(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("INVOICE_SEQUENCE_INVALID");
  return `${INVOICE_NUMBER_PREFIX}${String(sequence).padStart(4, "0")}`;
}

/** The sequence a counter document hands out next: 1 for a studio that has issued none. */
export function nextInvoiceSequence(counter: unknown): number {
  const next =
    typeof counter === "object" && counter !== null ? (counter as { next?: unknown }).next : undefined;
  return typeof next === "number" && Number.isSafeInteger(next) && next >= 1 ? next : 1;
}
