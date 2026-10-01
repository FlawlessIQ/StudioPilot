import type { DocumentReference, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import type { SalesTaxTreatment } from "@/features/pricing/package-price";
import { salesTaxTreatment } from "@/features/billing/sales-tax-pricing";

/** `db.doc(...).get()`, or inside a transaction `(reference) => transaction.get(reference)`. */
export type DocumentGetter = (reference: DocumentReference) => Promise<DocumentSnapshot>;

/**
 * How a job is priced now (features/billing/sales-tax-pricing.ts), read the
 * same way functions/src/billing/sales-tax-treatment.ts reads it: the
 * studio's billing settings and its feature switches. Inside a transaction,
 * call this before any write. A missing document is "the old way".
 */
export async function readSalesTaxTreatment(
  db: Firestore,
  get: DocumentGetter,
  tenantId: string,
  project: { salesTaxExempt?: unknown } | null | undefined,
): Promise<SalesTaxTreatment | null> {
  const [settings, features] = await Promise.all([
    get(db.doc(`billingSettings/${tenantId}`)),
    get(db.doc(`tenantFeatures/${tenantId}`)),
  ]);
  const settingsTenant = settings.exists ? settings.get("tenantId") : undefined;
  return salesTaxTreatment({
    tenantId,
    billingSettings:
      settings.exists && (settingsTenant === undefined || settingsTenant === tenantId) ? settings.data() : undefined,
    tenantFeatures: features.exists ? features.data() : undefined,
    project,
  });
}
