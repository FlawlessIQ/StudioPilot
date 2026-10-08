"use client";

import { getFirebaseClient } from "@/lib/firebase/client";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { activeMembership } from "@/lib/firebase/active-membership";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";

/**
 * Post a command to billingCommand (functions/src/saas/stripe.ts) for the
 * signed-in owner's studio. Null when the billing Functions URL isn't set
 * (local preview), so callers can say so rather than fail.
 */
export async function billingCommand<T>(type: string, fields: Record<string, unknown> = {}): Promise<T | null> {
  const endpoint = process.env.NEXT_PUBLIC_BILLING_FUNCTIONS_URL;
  if (!endpoint) return null;
  const { auth, firestore } = getFirebaseClient();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to manage billing.");
  const membership = await activeMembership(firestore, user.uid);
  const tenantId = membership.data().tenantId;
  if (typeof tenantId !== "string") throw new Error("No active studio membership was found.");
  const token = await getAppCheckToken();
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/billingCommand`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await user.getIdToken()}`,
      ...(token ? { "x-firebase-appcheck": token } : {}),
    },
    body: JSON.stringify({ type, tenantId, ...fields }),
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Billing could not be reached.");
  markTenantRecordsWritten();
  return result;
}
