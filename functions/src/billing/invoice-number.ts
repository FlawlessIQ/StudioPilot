import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";

/**
 * The functions copy of features/billing/invoice-number.ts, plus the
 * allocator. Everything below the marker must match the features copy
 * exactly; tests/studio-invoice-settings.test.ts fails on a drift.
 */

/**
 * Reserve the studio's next invoice number inside a transaction.
 *
 * Firestore transactions read before they write, so this is two steps: call
 * it with the other reads, then call `commit()` alongside the other writes.
 * Two invoices raised at once cannot share a number — the second
 * transaction sees the first's write and retries.
 */
export async function reserveInvoiceNumber(
  db: Firestore,
  transaction: Transaction,
  tenantId: string,
  timestamp: string,
): Promise<{ number: string; sequence: number; commit: () => void }> {
  const reference: DocumentReference = db.doc(`invoiceCounters/${tenantId}`);
  const counter = await transaction.get(reference);
  if (counter.exists && counter.get("tenantId") !== tenantId) throw new Error("INVOICE_COUNTER_TENANT_MISMATCH");
  const sequence = nextInvoiceSequence(counter.exists ? counter.data() : null);
  return {
    number: formatInvoiceNumber(sequence),
    sequence,
    commit: () =>
      transaction.set(reference, { tenantId, next: sequence + 1, updatedAt: timestamp }, { merge: true }),
  };
}

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
