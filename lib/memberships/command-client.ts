"use client";

import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";

export async function runMembershipCommand(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const endpoint = process.env.NEXT_PUBLIC_MEMBERSHIP_FUNCTIONS_URL;
  if (!endpoint) {
    throw new Error("Membership services are not configured.");
  }
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before managing workspace access.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/membershipCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({
        ...body,
        idempotencyKey: crypto.randomUUID(),
      }),
    },
  );
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "The membership request failed.",
    );
  }
  markTenantRecordsWritten();
  return result;
}
