import type { Firestore } from "firebase-admin/firestore";
import { tradeOf, type Trade } from "./trades.js";

/** A studio's trade, read from its tenant. A missing tenant or trade is a photographer. */
export async function tenantTrade(db: Firestore, tenantId: string): Promise<Trade> {
  if (!tenantId) return tradeOf(null);
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  return tradeOf(tenant.get("trade"));
}
