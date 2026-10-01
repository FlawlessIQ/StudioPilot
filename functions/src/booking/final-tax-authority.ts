import type { Firestore, Transaction } from "firebase-admin/firestore";
import { QUICKBOOKS_ITEMISED_FLAG } from "../operations/quickbooks-invoice-plan.js";

/**
 * Whose sales tax a final bill carries.
 *
 * For a studio switched on to itemised QuickBooks invoices
 * (tenantFeatures.quickbooksItemisedInvoices), QuickBooks is the sales-tax
 * authority: the final balance StudioCue raises is **pre-tax** —
 *
 *   pre-tax package total − retainer paid − earlier payments
 *
 * — and QuickBooks adds the tax when the invoice is made
 * (operations/quickbooks-held-invoice.ts), after which the bill carries
 * QuickBooks' total and is held for the studio to check.
 *
 * The pre-tax total is the agreed total less the agreed tax. A booking signed
 * while StudioCue added its own tax has that tax inside its total; taking it
 * out here is what stops it being charged twice once QuickBooks adds its own.
 * A booking signed pre-tax has tax 0, so the two readings agree.
 *
 * Off (or a Stripe studio): exactly the arithmetic StudioCue always used.
 */
export async function quickBooksIsTaxAuthority(
  db: Firestore,
  transaction: Transaction,
  tenantId: string,
  provider: unknown,
): Promise<boolean> {
  if (provider !== "quickbooks") return false;
  const features = await transaction.get(db.doc(`tenantFeatures/${tenantId}`));
  return features.exists === true && features.get(QUICKBOOKS_ITEMISED_FLAG) === true;
}

/** What the final bill is raised at, and what its calculation records. */
export function finalBillBasis(input: { totalCents: number; agreedTaxCents: number; quickBooksTax: boolean }): {
  /** The figure the balance is worked out from. */
  billedTotalCents: number;
  /** Tax inside billedTotalCents (0 when QuickBooks adds it). */
  taxCents: number;
  /** StudioCue's own agreed tax, recorded and not billed (QuickBooks only). */
  agreedTaxExcludedCents: number;
} {
  if (!input.quickBooksTax)
    return { billedTotalCents: input.totalCents, taxCents: input.agreedTaxCents, agreedTaxExcludedCents: 0 };
  const tax = Number.isSafeInteger(input.agreedTaxCents) && input.agreedTaxCents > 0 ? input.agreedTaxCents : 0;
  return { billedTotalCents: input.totalCents - tax, taxCents: 0, agreedTaxExcludedCents: tax };
}
