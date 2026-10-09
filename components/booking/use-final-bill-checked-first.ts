"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { QUICKBOOKS_SALES_TAX_FEATURE } from "@/features/billing/sales-tax-pricing";

/**
 * Whether this studio's final bills wait for it in QuickBooks before going.
 *
 * For a studio switched on to itemised QuickBooks invoices, every final is
 * made in QuickBooks unsent and held for "Send with tax"
 * (functions/src/operations/quickbooks-final-tax.ts). "Send the final bill"
 * told GR the bill "goes to Conor by email… can be voided, not unsent", then
 * cleared the card, so he believed it was sent and Conor never got it
 * (2026-10-09). Read so that step says what will really happen.
 */
export function useFinalBillCheckedFirst(): boolean {
  const workspace = useWorkspace();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!dataIsLive || workspace.loading || !workspace.tenantId) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "tenantFeatures", workspace.tenantId))
      .then((features) => {
        if (active) setHeld(features.exists() && features.get(QUICKBOOKS_SALES_TAX_FEATURE) === true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspace.loading, workspace.tenantId]);
  return held;
}
