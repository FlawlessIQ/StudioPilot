"use client";

import { getAuth } from "firebase/auth";
import { activeMembership } from "@/lib/firebase/active-membership";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";

export async function sendCommunicationsCommand(
  input: Record<string, unknown>,
) {
  const endpoint = process.env.NEXT_PUBLIC_BOOKING_FUNCTIONS_URL;
  if (!endpoint) return { mode: "preview" as const, payload: {} };
  const client = getFirebaseClient();
  const user = getAuth(client.app).currentUser;
  if (!user) throw new Error("Sign in before sending a message.");
  const membership = await activeMembership(client.firestore, user.uid);
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/communicationsCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({
        ...input,
        tenantId: membership.data().tenantId as string,
      }),
    },
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "MESSAGE_SEND_FAILED";
    throw new Error(error);
  }
  markTenantRecordsWritten();
  return { mode: "live" as const, payload };
}
