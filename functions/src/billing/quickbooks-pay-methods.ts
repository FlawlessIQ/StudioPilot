import type { Firestore } from "firebase-admin/firestore";
import { normaliseBillingSettings, quickBooksOnlinePaymentFlags } from "./sales-tax-settings.js";

/**
 * The online payment fields for a QuickBooks invoice StudioCue creates for
 * this studio: what it chose under Integrations → QuickBooks, bank transfer
 * only by default (sales-tax-settings.ts).
 */
export async function quickBooksOnlinePaymentFlagsFor(db: Firestore, tenantId: string) {
  const settings = await db.doc(`billingSettings/${tenantId}`).get();
  return quickBooksOnlinePaymentFlags(
    normaliseBillingSettings(settings.exists && settings.get("tenantId") === tenantId ? settings.data() : null, tenantId)
      .quickbooksPayMethods,
  );
}
